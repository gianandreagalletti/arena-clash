// Central damage application: HP, ult charge, elimination bookkeeping, no self-damage.

import {
  ACTIONS,
  ULT_CHARGE_MAX,
  ULT_CHARGE_PER_DAMAGE_DEALT,
  ULT_CHARGE_PER_DAMAGE_TAKEN,
  ULT_CHARGE_PER_ELIMINATION,
  FIRST_30S_WINDOW_TICKS,
} from '../config/balance.js';

function clampUlt(v) {
  return Math.max(0, Math.min(ULT_CHARGE_MAX, v));
}

/** True while the player's Shield is up (damage reduced, not blocked entirely). */
export function isShielded(state, player) {
  return state.tick < player.shieldActiveUntilTick;
}

/**
 * Applies damage from `sourcePlayer` to `targetPlayer`. No-ops if the target is
 * invulnerable, dead, or the target IS the source (no self-damage).
 *
 * An active Shield reduces the incoming amount before anything else, so HP,
 * damage-dealt/taken stats and ult charge all reflect the damage that actually
 * landed.
 */
export function applyDamage(state, targetPlayer, amount, sourcePlayer) {
  if (!targetPlayer.alive) return;
  if (sourcePlayer && sourcePlayer.id === targetPlayer.id) return;
  if (state.tick < targetPlayer.invulnUntilTick) return;
  if (amount <= 0) return;

  const effective = isShielded(state, targetPlayer)
    ? amount * (1 - ACTIONS.shield.damageReduction)
    : amount;

  targetPlayer.hp = Math.max(0, targetPlayer.hp - effective);
  targetPlayer.damageTaken += effective;
  targetPlayer.ultCharge = clampUlt(targetPlayer.ultCharge + effective * ULT_CHARGE_PER_DAMAGE_TAKEN);

  if (state.tick - state.roundStartTick < FIRST_30S_WINDOW_TICKS) {
    targetPlayer.damageTakenFirst30s = true;
  }

  if (sourcePlayer) {
    sourcePlayer.damageDealt += effective;
    sourcePlayer.ultCharge = clampUlt(sourcePlayer.ultCharge + effective * ULT_CHARGE_PER_DAMAGE_DEALT);
  }

  if (targetPlayer.hp <= 0 && targetPlayer.alive) {
    targetPlayer.alive = false;
    targetPlayer.deathTick = state.tick;
    if (sourcePlayer && sourcePlayer.alive) {
      sourcePlayer.eliminations += 1;
      sourcePlayer.ultCharge = clampUlt(sourcePlayer.ultCharge + ULT_CHARGE_PER_ELIMINATION);
    }
  }
}

/** True if `player` cannot currently be targeted (dead or spawn-invulnerable). */
export function isUntargetable(state, player) {
  return !player.alive || state.tick < player.invulnUntilTick;
}
