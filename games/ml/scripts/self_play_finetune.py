import argparse
import json
import random
from pathlib import Path


def jitter(values, scale=0.01):
    rng = random.Random(19)
    out = []
    for row in values:
        if isinstance(row, list):
            out.append([v + (rng.random() * 2 - 1) * scale for v in row])
        else:
            out.append(row + (rng.random() * 2 - 1) * scale)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    model = json.loads(Path(args.input).read_text(encoding="utf-8"))
    weights = model["weights"]
    weights["w1"] = jitter(weights["w1"], scale=0.008)
    weights["b1"] = jitter(weights["b1"], scale=0.004)
    weights["w2"] = jitter(weights["w2"], scale=0.008)
    weights["b2"] = jitter(weights["b2"], scale=0.004)

    Path(args.output).write_text(json.dumps(model, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
