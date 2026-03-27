Original prompt: Create and implement a web game MVP plan for a single-player 2D arena shooter with learning-model AI in two modes (duel opponent and co-op ally), browser inference, offline training pipeline, deterministic stepping, and Playwright-based validation.

## TODO
- [x] Scaffold project structure
- [x] Implement arena shooter core loop + two modes
- [x] Implement AI runtime interfaces and fallback policy
- [x] Implement render_game_to_text and advanceTime hooks
- [x] Add offline training/data pipeline scripts + model registry
- [x] Add Playwright smoke runner and validate screenshots/state/errors
- [x] Update docs and leave next-agent suggestions

## Work Log
- Scaffolded a greenfield browser game project with `index.html` and ES module sources.
- Implemented the playable 2D arena shooter with two modes:
  - `duel`: human vs AI opponent.
  - `co_op`: human + AI ally vs scripted enemy waves.
- Added deterministic simulation hook: `window.advanceTime(ms)`.
- Added text state export: `window.render_game_to_text()` with coordinate note and core gameplay state.
- Implemented shared AI action space and observation contract, including cooldown/mode features.
- Implemented browser AI runtime interface `loadPolicy(modelUrl, metadataUrl)` with:
  - lightweight `linear-mlp` model loading,
  - optional TensorFlow.js path if `window.tf` is present,
  - scripted fallback behavior.
- Added balancing/safety controls:
  - action clamping,
  - cooldown enforcement,
  - invalid action masking,
  - difficulty profile knobs.
- Added model registry and two checkpoint bundles:
  - `assets/models/opponent/*`
  - `assets/models/ally/*`
  - `assets/models/model-registry.json`
- Implemented offline ML pipeline scripts in `ml/scripts`:
  - synthetic trajectory generation,
  - behavior cloning training,
  - self-play fine-tune jitter pass,
  - export/registry sync.
- Added Playwright smoke assets:
  - `tests/actions_duel.json`
  - `tests/actions_coop.json`
  - `scripts/web_game_playwright_client.js` (local copy of skill client due Node ESM resolution).
  - `scripts/run_smoke.ps1`

## Validation
- Ran Playwright duel smoke loop with screenshot + `render_game_to_text` capture.
- Ran Playwright co-op smoke loop with screenshot + `render_game_to_text` capture.
- Checked generated artifacts in `output/web-game/duel` and `output/web-game/coop`.
- Confirmed no `errors-*.json` console error files were emitted.
- Visually inspected final screenshots (`shot-2.png`) for both modes.

## Remaining TODO / Suggestions
- Optionally integrate real TensorFlow.js model files (`model.json` + shards) and include `tf.min.js` in `index.html` for production inference.
- Expand action payload coverage to include explicit pause/resume and restart assertions in automated tests.
- Add unit tests around policy normalization and collision/damage edge cases.

