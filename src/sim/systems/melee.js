// Berserker-style instantaneous frontal-arc melee attack.

import { applyDamage, isUntargetable } from './damage.js';

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Resolves one melee swing immediately: hits every alive, targetable enemy
 * within `reachTiles` and inside the frontal arc (centered on the attacker's
 * current aim direction), at most once per call (one call = one swing).
 */
export function performMelee(state, attacker, characterDef) {
  const { damage, arcDegrees, reachTiles } = characterDef.attack;
  const halfArcRad = ((arcDegrees / 2) * Math.PI) / 180;
  const aimAngle = Math.atan2(attacker.aimY, attacker.aimX);

  for (const target of state.players) {
    if (target.id === attacker.id) continue;
    if (isUntargetable(state, target)) continue;

    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const dist = Math.hypot(dx, dy);
    if (dist > reachTiles) continue;

    if (dist > 0) {
      const angleToTarget = Math.atan2(dy, dx);
      const diff = Math.abs(normalizeAngle(angleToTarget - aimAngle));
      if (diff > halfArcRad) continue;
    }

    applyDamage(state, target, damage, attacker);
  }

  state.meleeSwings.push({
    playerId: attacker.id,
    x: attacker.x,
    y: attacker.y,
    aimX: attacker.aimX,
    aimY: attacker.aimY,
    arcDegrees,
    reachTiles,
    tick: state.tick,
  });
}
