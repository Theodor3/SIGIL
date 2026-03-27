# Arena Learning Shooter

Single-player 2D arena shooter with two modes:
- `duel`: human vs learning AI opponent
- `co_op`: human + learning AI ally vs enemy waves

## Run locally

```powershell
python -m http.server 5173
```

Open `http://localhost:5173`.

## Controls

- Move: `WASD`
- Aim: mouse
- Shoot: left click
- Dash: `Space`
- Toggle fullscreen: `F`
- Exit fullscreen: `Esc`

## AI runtime

- Browser API: `window.loadPolicy(modelUrl, metadataUrl)`.
- Deterministic stepping: `window.advanceTime(ms)`.
- Text state: `window.render_game_to_text()`.
- Registry: `assets/models/model-registry.json`.

The runtime tries this order:
1. Load lightweight `linear-mlp` JSON model.
2. If available, try TensorFlow.js `loadLayersModel`.
3. Fallback to deterministic scripted policy.

## Offline ML pipeline

Scripts in `ml/scripts`:
- `generate_dataset.py`
- `train_behavior_clone.py`
- `self_play_finetune.py`
- `export_model_registry.py`

Example sequence:

```powershell
python ml/scripts/generate_dataset.py --output ml/data/trajectories.jsonl --episodes 200
python ml/scripts/train_behavior_clone.py --input ml/data/trajectories.jsonl --output ml/artifacts/opponent
python ml/scripts/train_behavior_clone.py --input ml/data/trajectories.jsonl --output ml/artifacts/ally --role ally
python ml/scripts/self_play_finetune.py --input ml/artifacts/opponent/model.json --output ml/artifacts/opponent/model_finetuned.json
python ml/scripts/export_model_registry.py --opponent ml/artifacts/opponent/model_finetuned.json --ally ml/artifacts/ally/model.json --dest assets/models
```

## Playwright smoke loop

Skill client path:
`$CODEX_HOME/skills/develop-web-game/scripts/web_game_playwright_client.js`

Run duel and co-op scenarios using action files in `tests/`.
