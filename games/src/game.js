const TAU = Math.PI * 2;

const DIFFICULTY = {
  easy: { reactionMs: 180, aimNoise: 0.11, aggression: 0.82 },
  normal: { reactionMs: 130, aimNoise: 0.06, aggression: 1.0 },
  hard: { reactionMs: 95, aimNoise: 0.03, aggression: 1.15 },
};

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(x, y) {
  const mag = Math.hypot(x, y) || 1;
  return { x: x / mag, y: y / mag, mag };
}

function circleHit(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = a.r + b.r;
  return dx * dx + dy * dy <= r * r;
}

function createActor(id, team, x, y, color) {
  return {
    id,
    team,
    x,
    y,
    vx: 0,
    vy: 0,
    r: 16,
    hp: 100,
    maxHp: 100,
    speed: 220,
    dashCooldown: 0,
    shootCooldown: 0,
    color,
    alive: true,
    aimX: 1,
    aimY: 0,
  };
}

export class ArenaGame {
  constructor({ canvas, onHudUpdate, onModeChange, policies }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onHudUpdate = onHudUpdate;
    this.onModeChange = onModeChange;
    this.policies = policies;

    this.width = canvas.width;
    this.height = canvas.height;
    this.mode = "menu";
    this.result = "waiting";
    this.score = 0;
    this.wave = 1;
    this.time = 0;
    this.running = false;

    this.lastFrameTs = 0;
    this.accumulator = 0;
    this.fixedStep = 1 / 60;
    this.maxAccumulator = 0.25;

    this.input = {
      keys: new Set(),
      mouseX: this.width * 0.5,
      mouseY: this.height * 0.5,
      shootHeld: false,
    };

    this.aiTimers = { opponent: 0, ally: 0, enemy: 0 };
    this.aiActions = {
      opponent: { move_x: 0, move_y: 0, aim_x: 1, aim_y: 0, shoot: 0, dash: 0 },
      ally: { move_x: 0, move_y: 0, aim_x: 1, aim_y: 0, shoot: 0, dash: 0 },
      enemy: new Map(),
    };

    this.projectiles = [];
    this.enemies = [];

    this.difficulty = DIFFICULTY.normal;

    this.player = createActor("player", "human", this.width * 0.35, this.height * 0.5, "#7ee4ff");
    this.opponent = createActor("opponent", "ai-opponent", this.width * 0.7, this.height * 0.5, "#ff8278");
    this.ally = createActor("ally", "ai-ally", this.width * 0.25, this.height * 0.55, "#b8ffb2");

    this.bindInput();
  }

  bindInput() {
    window.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      if (key === "f") {
        this.toggleFullscreen();
        return;
      }
      this.input.keys.add(key);
    });

    window.addEventListener("keyup", (event) => {
      this.input.keys.delete(event.key.toLowerCase());
    });

    this.canvas.addEventListener("mousemove", (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.width / rect.width;
      const scaleY = this.height / rect.height;
      this.input.mouseX = (event.clientX - rect.left) * scaleX;
      this.input.mouseY = (event.clientY - rect.top) * scaleY;
    });

    this.canvas.addEventListener("mousedown", (event) => {
      if (event.button === 0) this.input.shootHeld = true;
    });

    this.canvas.addEventListener("mouseup", (event) => {
      if (event.button === 0) this.input.shootHeld = false;
    });
  }

  async toggleFullscreen() {
    if (!document.fullscreenElement) {
      await this.canvas.requestFullscreen().catch(() => {});
    } else {
      await document.exitFullscreen().catch(() => {});
    }
  }

  resetActors() {
    this.player = createActor("player", "human", this.width * 0.35, this.height * 0.5, "#7ee4ff");
    this.opponent = createActor("opponent", "ai-opponent", this.width * 0.7, this.height * 0.5, "#ff8278");
    this.ally = createActor("ally", "ai-ally", this.width * 0.25, this.height * 0.55, "#b8ffb2");
  }

  start(mode) {
    this.mode = mode;
    this.result = "running";
    this.score = 0;
    this.wave = 1;
    this.time = 0;
    this.projectiles = [];
    this.enemies = [];
    this.aiActions.enemy.clear();
    this.aiTimers = { opponent: 0, ally: 0, enemy: 0 };
    this.resetActors();

    if (mode === "co_op") {
      this.spawnWave();
    }

    this.running = true;
    this.onModeChange(mode);
    this.updateHud();
    this.draw();
  }

  restart() {
    if (this.mode === "menu") return;
    this.start(this.mode);
  }

  spawnWave() {
    const count = 2 + this.wave;
    for (let i = 0; i < count; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      const enemy = createActor(
        `enemy-${this.wave}-${i}`,
        "enemy",
        side > 0 ? this.width - rand(40, 120) : rand(40, 120),
        rand(70, this.height - 70),
        "#ffc766",
      );
      enemy.speed = 150 + this.wave * 4;
      enemy.hp = 60;
      enemy.maxHp = 60;
      this.enemies.push(enemy);
      this.aiActions.enemy.set(enemy.id, { move_x: 0, move_y: 0, aim_x: 1, aim_y: 0, shoot: 0, dash: 0 });
    }
  }

  end(result) {
    this.result = result;
    this.running = false;
    this.updateHud();
  }

  runFrame(timestamp) {
    if (!this.lastFrameTs) {
      this.lastFrameTs = timestamp;
    }
    const dt = (timestamp - this.lastFrameTs) / 1000;
    this.lastFrameTs = timestamp;
    this.accumulator = Math.min(this.accumulator + dt, this.maxAccumulator);

    while (this.accumulator >= this.fixedStep) {
      this.update(this.fixedStep);
      this.accumulator -= this.fixedStep;
    }
    this.draw();

    window.requestAnimationFrame((ts) => this.runFrame(ts));
  }

  update(dt) {
    this.time += dt;
    if (!this.running) {
      this.updateHud();
      return;
    }

    this.tickActor(this.player, dt);
    this.tickActor(this.opponent, dt);
    this.tickActor(this.ally, dt);
    this.enemies.forEach((enemy) => this.tickActor(enemy, dt));

    if (this.mode === "duel") {
      this.updateDuel(dt);
    } else if (this.mode === "co_op") {
      this.updateCoop(dt);
    }

    this.updateProjectiles(dt);
    this.checkTerminalState();
    this.updateHud();
  }

  tickActor(actor, dt) {
    actor.dashCooldown = Math.max(0, actor.dashCooldown - dt);
    actor.shootCooldown = Math.max(0, actor.shootCooldown - dt);
    actor.x += actor.vx * dt;
    actor.y += actor.vy * dt;
    actor.x = clamp(actor.x, actor.r, this.width - actor.r);
    actor.y = clamp(actor.y, actor.r, this.height - actor.r);
    actor.vx *= 0.78;
    actor.vy *= 0.78;
  }

  applyAction(actor, action, dt) {
    if (!actor.alive) return;

    const moveX = clamp(action.move_x || 0, -1, 1);
    const moveY = clamp(action.move_y || 0, -1, 1);
    const move = normalize(moveX, moveY);
    actor.vx += move.x * actor.speed * this.difficulty.aggression * dt * 3.2;
    actor.vy += move.y * actor.speed * this.difficulty.aggression * dt * 3.2;

    const aim = normalize(action.aim_x || 1, action.aim_y || 0);
    actor.aimX = aim.x;
    actor.aimY = aim.y;

    if (action.dash && actor.dashCooldown <= 0) {
      actor.vx += aim.x * 300;
      actor.vy += aim.y * 300;
      actor.dashCooldown = 1.6;
    }

    if (action.shoot && actor.shootCooldown <= 0) {
      this.spawnProjectile(actor);
      actor.shootCooldown = 0.2;
    }
  }

  spawnProjectile(actor) {
    const speed = 440;
    this.projectiles.push({
      x: actor.x + actor.aimX * (actor.r + 6),
      y: actor.y + actor.aimY * (actor.r + 6),
      vx: actor.aimX * speed,
      vy: actor.aimY * speed,
      r: 4,
      team: actor.team,
      life: 1.6,
      damage: 14,
      owner: actor.id,
    });
  }

  getHumanAction() {
    const moveX = (this.input.keys.has("d") || this.input.keys.has("arrowright") ? 1 : 0)
      - (this.input.keys.has("a") || this.input.keys.has("arrowleft") ? 1 : 0);
    const moveY = (this.input.keys.has("s") || this.input.keys.has("arrowdown") ? 1 : 0)
      - (this.input.keys.has("w") || this.input.keys.has("arrowup") ? 1 : 0);
    const dir = normalize(this.input.mouseX - this.player.x, this.input.mouseY - this.player.y);
    return {
      move_x: moveX,
      move_y: moveY,
      aim_x: dir.x,
      aim_y: dir.y,
      shoot: this.input.shootHeld ? 1 : 0,
      dash: this.input.keys.has(" ") ? 1 : 0,
    };
  }

  buildObservation(selfActor, targetActor, threats, modeFlags) {
    const self = {
      x: selfActor.x / this.width,
      y: selfActor.y / this.height,
      vx: selfActor.vx / 260,
      vy: selfActor.vy / 260,
      hp: selfActor.hp / selfActor.maxHp,
    };

    const target = {
      x: targetActor ? targetActor.x / this.width : 0.5,
      y: targetActor ? targetActor.y / this.height : 0.5,
      hp: targetActor ? targetActor.hp / targetActor.maxHp : 0,
      dist: targetActor ? Math.hypot(targetActor.x - selfActor.x, targetActor.y - selfActor.y) / Math.hypot(this.width, this.height) : 1,
    };

    const nearestThreatEntity = threats.length
      ? threats.reduce((best, cur) => {
          const bestD = Math.hypot(best.x - selfActor.x, best.y - selfActor.y);
          const curD = Math.hypot(cur.x - selfActor.x, cur.y - selfActor.y);
          return curD < bestD ? cur : best;
        })
      : null;

    const nearestThreat = nearestThreatEntity
      ? {
          x: nearestThreatEntity.x / this.width,
          y: nearestThreatEntity.y / this.height,
          dist: Math.hypot(nearestThreatEntity.x - selfActor.x, nearestThreatEntity.y - selfActor.y) / Math.hypot(this.width, this.height),
        }
      : { x: 0.5, y: 0.5, dist: 1 };

    const flat = {
      self_x: self.x,
      self_y: self.y,
      self_vx: self.vx,
      self_vy: self.vy,
      self_hp: self.hp,
      target_x: target.x,
      target_y: target.y,
      target_hp: target.hp,
      target_dist: target.dist,
      threat_x: nearestThreat.x,
      threat_y: nearestThreat.y,
      threat_dist: nearestThreat.dist,
      time_left_norm: clamp(1 - this.time / 180, 0, 1),
      mode_duel: modeFlags.duel ? 1 : 0,
      mode_co_op: modeFlags.coop ? 1 : 0,
      cooldown_dash: selfActor.dashCooldown <= 0 ? 1 : 0,
    };

    return {
      self,
      target,
      nearestThreat,
      modeFlags,
      cooldowns: { dashReady: selfActor.dashCooldown <= 0 },
      flat,
    };
  }

  getEnemyTarget(enemy) {
    const candidates = [this.player, this.ally].filter((a) => a.alive);
    if (!candidates.length) return this.player;
    return candidates.reduce((best, cur) => {
      const bd = Math.hypot(best.x - enemy.x, best.y - enemy.y);
      const cd = Math.hypot(cur.x - enemy.x, cur.y - enemy.y);
      return cd < bd ? cur : best;
    });
  }

  updateDuel(dt) {
    this.applyAction(this.player, this.getHumanAction(), dt);

    this.aiTimers.opponent += dt;
    if (this.aiTimers.opponent >= this.difficulty.reactionMs / 1000) {
      this.aiTimers.opponent = 0;
      const obs = this.buildObservation(this.opponent, this.player, [this.player], { duel: true, coop: false });
      const action = this.policies.opponent.inferAction(obs);
      const noisy = this.addAimNoise(action, this.difficulty.aimNoise);
      this.aiActions.opponent = this.maskInvalidAction(this.opponent, noisy);
    }
    this.applyAction(this.opponent, this.aiActions.opponent, dt);
  }

  updateCoop(dt) {
    this.applyAction(this.player, this.getHumanAction(), dt);

    this.aiTimers.ally += dt;
    if (this.aiTimers.ally >= this.difficulty.reactionMs / 1000) {
      this.aiTimers.ally = 0;
      const target = this.enemies.find((e) => e.alive) || this.player;
      const obs = this.buildObservation(this.ally, target, this.enemies, { duel: false, coop: true });
      const action = this.policies.ally.inferAction(obs);
      this.aiActions.ally = this.maskInvalidAction(this.ally, this.addAimNoise(action, this.difficulty.aimNoise * 0.8));
    }
    this.applyAction(this.ally, this.aiActions.ally, dt);

    this.aiTimers.enemy += dt;
    if (this.aiTimers.enemy >= 0.16) {
      this.aiTimers.enemy = 0;
      this.enemies.forEach((enemy) => {
        if (!enemy.alive) return;
        const target = this.getEnemyTarget(enemy);
        const dir = normalize(target.x - enemy.x, target.y - enemy.y);
        this.aiActions.enemy.set(enemy.id, {
          move_x: dir.x,
          move_y: dir.y,
          aim_x: dir.x,
          aim_y: dir.y,
          shoot: dir.mag < 190 ? 1 : 0,
          dash: 0,
        });
      });
    }

    this.enemies.forEach((enemy) => {
      if (!enemy.alive) return;
      const action = this.aiActions.enemy.get(enemy.id);
      this.applyAction(enemy, this.maskInvalidAction(enemy, action), dt);
    });

    const aliveEnemies = this.enemies.filter((e) => e.alive);
    if (!aliveEnemies.length) {
      this.wave += 1;
      this.score += 100;
      this.spawnWave();
    }
  }

  addAimNoise(action, amount) {
    const noisy = { ...action };
    noisy.aim_x = clamp((action.aim_x ?? 1) + rand(-amount, amount), -1, 1);
    noisy.aim_y = clamp((action.aim_y ?? 0) + rand(-amount, amount), -1, 1);
    return noisy;
  }

  maskInvalidAction(actor, action) {
    const out = {
      move_x: clamp(action.move_x ?? 0, -1, 1),
      move_y: clamp(action.move_y ?? 0, -1, 1),
      aim_x: clamp(action.aim_x ?? 1, -1, 1),
      aim_y: clamp(action.aim_y ?? 0, -1, 1),
      shoot: actor.shootCooldown <= 0 ? (action.shoot ? 1 : 0) : 0,
      dash: actor.dashCooldown <= 0 ? (action.dash ? 1 : 0) : 0,
    };

    return out;
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }

    const actors = [this.player, this.opponent, this.ally, ...this.enemies];

    for (const projectile of this.projectiles) {
      if (projectile.life <= 0) continue;
      for (const actor of actors) {
        if (!actor.alive || actor.team === projectile.team) continue;
        if (!circleHit(projectile, actor)) continue;

        actor.hp -= projectile.damage;
        projectile.life = 0;
        if (actor.hp <= 0) {
          actor.hp = 0;
          actor.alive = false;
          if (this.mode === "co_op" && actor.team === "enemy") this.score += 20;
          if (this.mode === "duel" && actor.id === "opponent") this.score += 200;
          if (this.mode === "duel" && actor.id === "player") this.score -= 80;
        }
        break;
      }
    }

    this.projectiles = this.projectiles.filter((p) => p.life > 0 && p.x > -10 && p.x < this.width + 10 && p.y > -10 && p.y < this.height + 10);
  }

  checkTerminalState() {
    if (this.mode === "duel") {
      if (!this.player.alive) this.end("lost duel");
      if (!this.opponent.alive) this.end("won duel");
    }

    if (this.mode === "co_op") {
      if (!this.player.alive && !this.ally.alive) {
        this.end("wave failed");
      }
    }
  }

  drawGrid() {
    const ctx = this.ctx;
    ctx.fillStyle = "#0b1320";
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = "rgba(140, 195, 255, 0.12)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= this.width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = 0; y <= this.height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
  }

  drawActor(actor) {
    if (!actor.alive) return;
    const ctx = this.ctx;
    ctx.fillStyle = actor.color;
    ctx.beginPath();
    ctx.arc(actor.x, actor.y, actor.r, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
    ctx.beginPath();
    ctx.moveTo(actor.x, actor.y);
    ctx.lineTo(actor.x + actor.aimX * (actor.r + 14), actor.y + actor.aimY * (actor.r + 14));
    ctx.stroke();

    const hpW = 40;
    const ratio = actor.hp / actor.maxHp;
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.fillRect(actor.x - hpW / 2, actor.y - actor.r - 12, hpW, 5);
    ctx.fillStyle = ratio > 0.35 ? "#63ff9e" : "#ff7066";
    ctx.fillRect(actor.x - hpW / 2, actor.y - actor.r - 12, hpW * ratio, 5);
  }

  drawProjectiles() {
    const ctx = this.ctx;
    for (const p of this.projectiles) {
      ctx.fillStyle = p.team === "human" ? "#a6f0ff" : p.team.includes("ai") ? "#ffcd9b" : "#ffd9a1";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
  }

  drawOverlayText() {
    if (this.running) return;
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = "#e9f6ff";
    ctx.font = "bold 44px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(this.result.toUpperCase(), this.width / 2, this.height / 2 - 10);
    ctx.font = "20px Segoe UI";
    ctx.fillText("Press restart to play again", this.width / 2, this.height / 2 + 28);
  }

  draw() {
    this.drawGrid();
    this.drawProjectiles();
    this.drawActor(this.player);
    if (this.mode === "duel") this.drawActor(this.opponent);
    if (this.mode === "co_op") {
      this.drawActor(this.ally);
      this.enemies.forEach((enemy) => this.drawActor(enemy));
    }
    this.drawOverlayText();
  }

  updateHud() {
    this.onHudUpdate({
      mode: this.mode,
      score: this.score,
      time: this.time,
      status: this.result,
      wave: this.wave,
    });
  }

  renderToText() {
    const payload = {
      coordinate_system: "origin top-left; +x right; +y down",
      mode: this.mode,
      status: this.result,
      timer_seconds: Number(this.time.toFixed(2)),
      score: this.score,
      wave: this.mode === "co_op" ? this.wave : null,
      player: this.actorText(this.player),
      opponent: this.mode === "duel" ? this.actorText(this.opponent) : null,
      ally: this.mode === "co_op" ? this.actorText(this.ally) : null,
      enemies: this.mode === "co_op" ? this.enemies.filter((e) => e.alive).map((e) => this.actorText(e)) : [],
      projectiles: this.projectiles.map((p) => ({ x: Number(p.x.toFixed(1)), y: Number(p.y.toFixed(1)), team: p.team })),
    };

    return JSON.stringify(payload);
  }

  actorText(actor) {
    return {
      id: actor.id,
      alive: actor.alive,
      x: Number(actor.x.toFixed(1)),
      y: Number(actor.y.toFixed(1)),
      vx: Number(actor.vx.toFixed(2)),
      vy: Number(actor.vy.toFixed(2)),
      hp: actor.hp,
      dash_cd: Number(actor.dashCooldown.toFixed(2)),
      shoot_cd: Number(actor.shootCooldown.toFixed(2)),
    };
  }

  advanceTime(ms) {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) {
      this.update(1 / 60);
    }
    this.draw();
  }
}

