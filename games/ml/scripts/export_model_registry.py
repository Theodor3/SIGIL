import argparse
import json
import shutil
from pathlib import Path


def copy_checkpoint(source_model, target_dir, mode):
    source_model = Path(source_model)
    source_meta = source_model.parent / "metadata.json"
    target_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_model, target_dir / "model.json")
    if source_meta.exists():
        shutil.copy2(source_meta, target_dir / "metadata.json")
    else:
        metadata = {
            "version": "1.0.0",
            "checkpoint_id": f"{mode}-exported-v1",
            "supported_mode": mode,
            "feature_order": [],
            "action_order": [],
            "normalization": {},
            "action_bounds": {
                "min": {"move_x": -1, "move_y": -1, "aim_x": -1, "aim_y": -1},
                "max": {"move_x": 1, "move_y": 1, "aim_x": 1, "aim_y": 1},
            },
        }
        (target_dir / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--opponent", required=True)
    parser.add_argument("--ally", required=True)
    parser.add_argument("--dest", required=True)
    args = parser.parse_args()

    dest = Path(args.dest)
    opp_dir = dest / "opponent"
    ally_dir = dest / "ally"

    copy_checkpoint(args.opponent, opp_dir, "opponent")
    copy_checkpoint(args.ally, ally_dir, "ally")

    registry = {
        "version": "1.0.0",
        "default_mode": "duel",
        "policies": {
            "opponent": {
                "model_url": "./assets/models/opponent/model.json",
                "metadata_url": "./assets/models/opponent/metadata.json",
                "checkpoint_id": "opponent-exported-v1",
                "stable": True,
            },
            "ally": {
                "model_url": "./assets/models/ally/model.json",
                "metadata_url": "./assets/models/ally/metadata.json",
                "checkpoint_id": "ally-exported-v1",
                "stable": True,
            },
        },
    }
    (dest / "model-registry.json").write_text(json.dumps(registry, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
