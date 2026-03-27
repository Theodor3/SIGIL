# Small-Model Sandbox

This folder holds lightweight local training experiments for the trading system.

Starting point:
- [local-alpha-sandbox.ipynb](C:/Users/Theodore/OneDrive/Documents/Playground/output/jupyter-notebook/local-alpha-sandbox.ipynb)

What the first notebook does:
- loads the latest feature and rank outputs from the trading pipeline
- creates a simple `top_bucket_target` label from the current ranker
- trains a small tree-based classifier
- reports ROC AUC, feature importance, and top predicted names

Why it exists:
- to make local ML feel concrete and understandable
- to give you a safe place to test models before wiring them into the trading system
- to create a path from "current model imitation" to "forward alpha prediction"

Recommended evolution:
1. Replace the label with realized forward outcomes from paper trades.
2. Build a second notebook for `Nowcast Ablation` cohort modeling.
3. Build a third notebook for `Earnings Drift Lab` event labels.

Validation note:
- I scaffolded this notebook cleanly, but I could not execute it here because this environment does not expose a runnable Python interpreter on PATH.
