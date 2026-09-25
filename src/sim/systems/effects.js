// Timed pickup effects (Overcharge, Adrenaline, Cloak).
//
// These are NOT folded into the player's derived stats, because they expire:
// state.js recomputes derived stats only on amulet pickup, so a timed
// multiplier stored there would stick around forever. They're applied at the
// point of use instead, as a separate multiplier — which is also exactly what
// the stat-composition rules ask for (boosts x amulets x timed effect).

import { PICKUPS } from '../config/balance.js';

export function isOvercharged(state, player) {
  return state.tick < player.effects.overchargeUntilTick;
}

export function isAdrenalized(state, player) {
  return state.tick < player.effects.adrenalineUntilTick;
}

export function isCloaked(state, player) {
  return state.tick < player.effects.cloakUntilTick;
}

/** Damage multiplier for Shoot and Slash right now. */
export function damageMultiplierFor(state, player) {
  return isOvercharged(state, player) ? PICKUPS.temporary.overcharge.mult : 1;
}

/** Movement speed multiplier right now. */
export function speedMultiplierFor(state, player) {
  return isAdrenalized(state, player) ? PICKUPS.temporary.adrenaline.mult : 1;
}

/** Attacking gives your position away: Shooting or Slashing drops the cloak at once. */
export function breakCloak(player) {
  player.effects.cloakUntilTick = 0;
}
