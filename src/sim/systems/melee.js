// Slash: instantaneous frontal-arc melee attack. Shared by all characters.

import { ACTIONS, abilityConfig } from '../config/balance.js';
import { applyDamage, isUntargetable, damageableEntities, belongsTo } from './damage.js';
import { damageMultiplierFor } from './effects.js';

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Resolves one Slash swing immediately: hits every alive, targetable enemy
 * within `reachTiles` and inside the frontal arc (centered on the attacker's
 * current aim direction), at most once per call (one call = one swing).
 * Damage comes from the attacker's boost-derived `slashDamage`.
 */
export function performMelee(state, attacker) {
  const { arcDegrees } = ACTIONS.slash;
  // Reach is owner-derived so Longsword extends it (see state.js).
  const reachTiles = attacker.slashReachTiles;
  const damage = attacker.slashDamage * damageMultiplierFor(state, attacker);
  const bloodthirst = attacker.abilities.passives.includes('bloodthirst')
    ? abilityConfig(attacker.characterId, 'bloodthirst')
    : null;
  let healed = 0;
  const halfArcRad = ((arcDegrees / 2) * Math.PI) / 180;
  const aimAngle = Math.atan2(attacker.aimY, attacker.aimX);

  for (const target of damageableEntities(state)) {
    if (belongsTo(target, attacker.id)) continue;
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

    const dealt = applyDamage(state, target, damage, attacker);
    // Bloodthirst drinks a share of what actually landed, after Shield.
    if (bloodthirst && dealt > 0) healed += dealt * bloodthirst.healFraction;
  }

  if (healed > 0) attacker.hp = Math.min(attacker.maxHp, attacker.hp + healed);

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
