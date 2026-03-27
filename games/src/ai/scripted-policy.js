export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function length(x, y) {
  return Math.hypot(x, y) || 1;
}

export function scriptedPolicy(observation, role = "opponent") {
  const self = observation.self;
  const target = observation.target;
  const threat = observation.nearestThreat;
  const tx = target.x - self.x;
  const ty = target.y - self.y;
  const targetDist = length(tx, ty);

  let moveX = tx / targetDist;
  let moveY = ty / targetDist;
  let shoot = targetDist < 0.5 ? 1 : 0;

  if (role === "ally") {
    const desiredDist = 0.25;
    if (targetDist < desiredDist) {
      moveX = -moveX * 0.4;
      moveY = -moveY * 0.4;
    }
    if (threat.dist < 0.45) {
      const ax = self.x - threat.x;
      const ay = self.y - threat.y;
      const mag = length(ax, ay);
      moveX += (ax / mag) * 0.8;
      moveY += (ay / mag) * 0.8;
      shoot = 1;
    }
  }

  if (role === "opponent") {
    if (targetDist > 0.55) {
      moveX *= 1.0;
      moveY *= 1.0;
    } else if (targetDist < 0.28) {
      moveX *= -0.75;
      moveY *= -0.75;
    }
  }

  const aimX = tx / targetDist;
  const aimY = ty / targetDist;

  const dash = observation.cooldowns.dashReady && targetDist > 0.5 ? 1 : 0;

  return {
    move_x: clamp(moveX, -1, 1),
    move_y: clamp(moveY, -1, 1),
    aim_x: clamp(aimX, -1, 1),
    aim_y: clamp(aimY, -1, 1),
    shoot,
    dash,
  };
}
