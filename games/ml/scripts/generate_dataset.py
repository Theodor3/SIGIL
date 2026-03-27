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


def clamp(v, low=-1.0, high=1.0):
    return max(low, min(high, v))


def scripted_action(obs, role):
    dx = obs["target_x"] - obs["self_x"]
    dy = obs["target_y"] - obs["self_y"]
    mag = math.hypot(dx, dy) or 1.0
    mx = dx / mag
    my = dy / mag
    shoot = 1 if obs["target_dist"] < 0.35 else 0
    dash = 1 if obs["cooldown_dash"] > 0.5 and obs["target_dist"] > 0.5 else 0

    if role == "ally":
        mx *= 0.8
        my *= 0.8
        if obs["threat_dist"] < 0.28:
            mx = clamp(mx + (obs["self_x"] - obs["threat_x"]) * 1.3)
            my = clamp(my + (obs["self_y"] - obs["threat_y"]) * 1.3)
        shoot = 1 if obs["threat_dist"] < 0.4 else shoot

    return {
        "move_x": clamp(mx),
        "move_y": clamp(my),
        "aim_x": clamp(dx / mag),
        "aim_y": clamp(dy / mag),
        "shoot": shoot,
        "dash": dash,
    }


def random_obs(mode):
    duel = 1.0 if mode == "duel" else 0.0
    coop = 1.0 - duel
    return {
        "self_x": random.random(),
        "self_y": random.random(),
        "self_vx": random.uniform(-1, 1),
        "self_vy": random.uniform(-1, 1),
        "self_hp": random.uniform(0.2, 1),
        "target_x": random.random(),
        "target_y": random.random(),
        "target_hp": random.uniform(0.2, 1),
        "target_dist": random.random(),
        "threat_x": random.random(),
        "threat_y": random.random(),
        "threat_dist": random.random(),
        "time_left_norm": random.random(),
        "mode_duel": duel,
        "mode_co_op": coop,
        "cooldown_dash": random.random(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--episodes", type=int, default=200)
    parser.add_argument("--steps", type=int, default=64)
    args = parser.parse_args()

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    with out.open("w", encoding="utf-8") as f:
        for ep in range(args.episodes):
            mode = "duel" if ep % 2 == 0 else "co_op"
            role = "opponent" if mode == "duel" else "ally"
            for _ in range(args.steps):
                obs = random_obs(mode)
                action = scripted_action(obs, role)
                rec = {"mode": mode, "role": role, "observation": obs, "action": action}
                f.write(json.dumps(rec) + "\n")


if __name__ == "__main__":
    main()
