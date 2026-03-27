import argparse
import json
import math
import random
from pathlib import Path

FEATURES = [
    "self_x", "self_y", "self_vx", "self_vy", "self_hp", "target_x", "target_y", "target_hp",
    "target_dist", "threat_x", "threat_y", "threat_dist", "time_left_norm", "mode_duel", "mode_co_op", "cooldown_dash",
]
ACTIONS = ["move_x", "move_y", "aim_x", "aim_y", "shoot", "dash"]


def tanh(x):
    return math.tanh(x)


def dot(row, vec):
    return sum(a * b for a, b in zip(row, vec))


def forward(x, w1, b1, w2, b2):
    h = [tanh(dot(row, x) + b1[i]) for i, row in enumerate(w1)]
    y = [tanh(dot(row, h) + b2[i]) for i, row in enumerate(w2)]
    y[4] = 1.0 if y[4] > 0 else 0.0
    y[5] = 1.0 if y[5] > 0 else 0.0
    return y, h


def init_weights(input_size, hidden_size, output_size):
    rng = random.Random(7)
    w1 = [[(rng.random() * 2 - 1) * 0.25 for _ in range(input_size)] for _ in range(hidden_size)]
    b1 = [(rng.random() * 2 - 1) * 0.05 for _ in range(hidden_size)]
    w2 = [[(rng.random() * 2 - 1) * 0.25 for _ in range(hidden_size)] for _ in range(output_size)]
    b2 = [(rng.random() * 2 - 1) * 0.05 for _ in range(output_size)]
    return w1, b1, w2, b2


def load_records(path, role):
    xs, ys = [], []
    with Path(path).open("r", encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            if rec["role"] != role:
                continue
            xs.append([rec["observation"][k] for k in FEATURES])
            ys.append([rec["action"][k] for k in ACTIONS])
    return xs, ys


def train(xs, ys, epochs=30, lr=0.03, hidden_size=12):
    in_size = len(FEATURES)
    out_size = len(ACTIONS)
    w1, b1, w2, b2 = init_weights(in_size, hidden_size, out_size)

    for _ in range(epochs):
        for x, y_true in zip(xs, ys):
            y_pred, h = forward(x, w1, b1, w2, b2)

            dy = [(y_pred[i] - y_true[i]) * (1 - y_pred[i] ** 2) for i in range(out_size)]
            for i in range(out_size):
                for j in range(hidden_size):
                    w2[i][j] -= lr * dy[i] * h[j]
                b2[i] -= lr * dy[i]

            dh = [0.0 for _ in range(hidden_size)]
            for j in range(hidden_size):
                signal = sum(dy[i] * w2[i][j] for i in range(out_size))
                dh[j] = signal * (1 - h[j] ** 2)

            for j in range(hidden_size):
                for k in range(in_size):
                    w1[j][k] -= lr * dh[j] * x[k]
                b1[j] -= lr * dh[j]

    return w1, b1, w2, b2


def compute_stats(xs):
    stats = {}
    n = max(1, len(xs))
    for idx, feature in enumerate(FEATURES):
        mean = sum(x[idx] for x in xs) / n
        var = sum((x[idx] - mean) ** 2 for x in xs) / n
        std = max(1e-4, var ** 0.5)
        stats[feature] = {"mean": round(mean, 6), "std": round(std, 6)}
    return stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--role", default="opponent", choices=["opponent", "ally"])
    parser.add_argument("--epochs", type=int, default=30)
    args = parser.parse_args()

    xs, ys = load_records(args.input, args.role)
    if not xs:
        raise SystemExit(f"No records found for role={args.role}")

    w1, b1, w2, b2 = train(xs, ys, epochs=args.epochs)

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    model = {
        "format": "linear-mlp",
        "input_size": len(FEATURES),
        "hidden_size": len(w1),
        "output_size": len(ACTIONS),
        "weights": {"w1": w1, "b1": b1, "w2": w2, "b2": b2},
    }

    metadata = {
        "version": "1.0.0",
        "checkpoint_id": f"{args.role}-bc-v1",
        "supported_mode": args.role,
        "feature_order": FEATURES,
        "action_order": ACTIONS,
        "normalization": compute_stats(xs),
        "action_bounds": {
            "min": {"move_x": -1, "move_y": -1, "aim_x": -1, "aim_y": -1},
            "max": {"move_x": 1, "move_y": 1, "aim_x": 1, "aim_y": 1},
        },
    }

    (out_dir / "model.json").write_text(json.dumps(model, indent=2), encoding="utf-8")
    (out_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
