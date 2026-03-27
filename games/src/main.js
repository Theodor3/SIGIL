import { ArenaGame } from "./game.js";
import { loadPolicy } from "./ai/policy-runtime.js";

const canvas = document.getElementById("game-canvas");
const menu = document.getElementById("menu");
const startDuelBtn = document.getElementById("start-duel-btn");
const startCoopBtn = document.getElementById("start-coop-btn");
const restartBtn = document.getElementById("restart-btn");
const hudMode = document.getElementById("hud-mode");
const hudScore = document.getElementById("hud-score");
const hudTimer = document.getElementById("hud-timer");
const hudStatus = document.getElementById("hud-status");

const defaultPolicy = {
  backend: "scripted",
  inferAction() {
    return { move_x: 0, move_y: 0, aim_x: 1, aim_y: 0, shoot: 0, dash: 0 };
  },
};

const policies = {
  opponent: defaultPolicy,
  ally: defaultPolicy,
};

function updateHud(snapshot) {
  hudMode.textContent = `Mode: ${snapshot.mode}`;
  hudScore.textContent = `Score: ${snapshot.score}`;
  hudTimer.textContent = `Time: ${snapshot.time.toFixed(1)}s`;
  const wave = snapshot.mode === "co_op" ? ` wave ${snapshot.wave}` : "";
  hudStatus.textContent = `Status: ${snapshot.status}${wave}`;

  if (snapshot.status !== "running" && snapshot.mode !== "menu") {
    restartBtn.classList.add("visible");
  } else {
    restartBtn.classList.remove("visible");
  }
}

function onModeChange() {
  menu.classList.add("hidden");
}

const game = new ArenaGame({
  canvas,
  onHudUpdate: updateHud,
  onModeChange,
  policies,
});

async function loadPolicies() {
  const registryResponse = await fetch("./assets/models/model-registry.json");
  const registry = await registryResponse.json();

  const opp = registry.policies.opponent;
  const ally = registry.policies.ally;

  try {
    policies.opponent = await loadPolicy(opp.model_url, opp.metadata_url);
  } catch (err) {
    console.warn("Opponent policy fallback", err);
  }

  try {
    policies.ally = await loadPolicy(ally.model_url, ally.metadata_url);
  } catch (err) {
    console.warn("Ally policy fallback", err);
  }

  window.__policyRuntime = {
    opponent: policies.opponent.backend,
    ally: policies.ally.backend,
  };
}

startDuelBtn.addEventListener("click", () => game.start("duel"));
startCoopBtn.addEventListener("click", () => game.start("co_op"));
restartBtn.addEventListener("click", () => game.restart());

document.addEventListener("keydown", async (event) => {
  if (event.key === "Escape" && document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
  }
});

window.render_game_to_text = () => game.renderToText();
window.advanceTime = (ms) => game.advanceTime(ms);
window.loadPolicy = loadPolicy;

loadPolicies().catch((err) => {
  console.warn("Policy loading failed, scripted fallback will be used", err);
});

window.requestAnimationFrame((ts) => game.runFrame(ts));
