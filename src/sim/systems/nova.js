// Berserker nova: a telegraphed AoE centered on the caster.
//
// The windup is a real sim state (`player.charging === 'nova'`), not a render
// animation: the renderer reads it to draw a telegraph, and a future interrupt
// mechanic has something concrete to cancel. Damage lands ONCE, at the end of
// the windup, on everything inside the radius AT THAT MOMENT — so walking out
// during the windup genuinely saves you.

import { CHARACTERS } from '../config/balance.js';
import { applyDamage, isUntargetable, damageableEntities, belongsTo } from './damage.js';

/** The nova config for a character, or null if it doesn't have one. */
export function novaConfigFor(characterId) {
  return CHARACTERS[characterId].nova || null;
}

/** True if `player` could start a nova right now. */
export function canStartNova(state, player) {
  const nova = novaConfigFor(player.characterId);
  if (!nova) return false;
  if (player.charging) return false; // already winding up
  return player.ultCharge >= nova.ultCost;
}

/**
 * Begins the windup and pays the ult cost up front, so a Berserker who dies
 * mid-windup has still spent the meter (and deals no damage — see damage.js,
 * which clears `charging` on death).
 */
export function startNova(state, player) {
  const nova = novaConfigFor(player.characterId);
  player.ultCharge -= nova.ultCost;
  player.charging = 'nova';
  player.chargeReleaseTick = state.tick + nova.windupTicks;
}

/** Detonates any nova whose windup finished this tick. Call once per tick, for live players only. */
export function tickNova(state, player) {
  if (player.charging !== 'nova') return;
  if (state.tick < player.chargeReleaseTick) return;

  const nova = novaConfigFor(player.characterId);
  player.charging = null;

  for (const target of damageableEntities(state)) {
    if (belongsTo(target, player.id)) continue;
    if (isUntargetable(state, target)) continue;
    // Center-to-center, inclusive: a target at exactly radiusTiles is hit.
    const dist = Math.hypot(target.x - player.x, target.y - player.y);
    if (dist <= nova.radiusTiles) {
      applyDamage(state, target, nova.damage, player);
    }
  }

  // Transient render cue, cleared next tick by step().
  state.novaBlasts.push({
    playerId: player.id,
    x: player.x,
    y: player.y,
    radiusTiles: nova.radiusTiles,
    tick: state.tick,
  });
}

/** Movement multiplier for a player this tick (slowed while winding up a nova). */
export function moveMultiplierFor(player) {
  if (player.charging !== 'nova') return 1;
  return novaConfigFor(player.characterId).windupMoveMultiplier;
}
