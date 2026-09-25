// Central damage application: HP, ult charge, elimination bookkeeping, no self-damage.
//
// Works on any "damageable entity", tagged with `kind`:
//   'player' — full path: spawn invuln, Shield reduction, damage stats, ult
//              charge, elimination credit.
//   'dog'    — Summoner minion: HP and death only. It has no invuln, no shield
//              and no meters of its own.
// Both go through this one function on purpose: the dog is hit by exactly the
// same projectile/slash code paths a player is.

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
  return player.kind === 'player' && state.tick < player.shieldActiveUntilTick;
}

/** The player who should be credited for damage dealt by `source` (a dog credits its owner). */
function creditFor(state, source) {
  if (!source) return null;
  if (source.kind === 'player') return source;
  return state.players.find((p) => p.id === source.ownerId) || null;
}

/** True if `a` and `b` are the same entity, or a player and their own dog. */
function isFriendly(a, b) {
  if (!a || !b) return false;
  const aOwner = a.kind === 'dog' ? a.ownerId : a.id;
  const bOwner = b.kind === 'dog' ? b.ownerId : b.id;
  return aOwner === bOwner;
}

/**
 * Applies damage from `source` to `target`. No-ops if the target is dead, the
 * amount is non-positive, the two belong to the same player (no self-damage,
 * and no shooting your own dog), or the target is spawn-invulnerable.
 *
 * An active Shield reduces the incoming amount before anything else, so HP,
 * damage-dealt/taken stats and ult charge all reflect the damage that actually
 * landed. Ult charge earned is scaled by the entity's Fury amulets.
 *
 * Returns the damage that actually landed (0 when the call no-ops).
 */
export function applyDamage(state, target, amount, source) {
  if (!target.alive) return 0;
  if (amount <= 0) return 0;
  if (isFriendly(target, source)) return 0;
  if (target.kind === 'player' && state.tick < target.invulnUntilTick) return 0;

  const effective = isShielded(state, target) ? amount * (1 - ACTIONS.shield.damageReduction) : amount;

  target.hp = Math.max(0, target.hp - effective);

  if (target.kind === 'player') {
    target.damageTaken += effective;
    target.ultCharge = clampUlt(
      target.ultCharge + effective * ULT_CHARGE_PER_DAMAGE_TAKEN * target.ultGainMultiplier
    );

    if (state.tick - state.roundStartTick < FIRST_30S_WINDOW_TICKS) {
      target.damageTakenFirst30s = true;
    }
  }

  // Only damage to PLAYERS feeds the attacker's meters — otherwise a
  // respawning dog would be a free ult-charge farm.
  const credit = creditFor(state, source);
  if (credit && target.kind === 'player') {
    credit.damageDealt += effective;
    credit.ultCharge = clampUlt(
      credit.ultCharge + effective * ULT_CHARGE_PER_DAMAGE_DEALT * credit.ultGainMultiplier
    );
  }

  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    if (target.kind === 'player') {
      target.deathTick = state.tick;
      target.charging = null; // a player killed mid-windup never releases it
      if (credit && credit.alive) {
        credit.eliminations += 1;
        credit.ultCharge = clampUlt(credit.ultCharge + ULT_CHARGE_PER_ELIMINATION * credit.ultGainMultiplier);
      }
    }
  }

  return effective; // callers tally per-source damage (e.g. grenade vs mine)
}

/** True if `entity` cannot currently be targeted (dead, or a spawn-invulnerable player). */
export function isUntargetable(state, entity) {
  if (!entity.alive) return true;
  return entity.kind === 'player' && state.tick < entity.invulnUntilTick;
}

/** Every entity a projectile or slash can hit this tick: players and live dogs. */
export function damageableEntities(state) {
  return [...state.players, ...state.dogs];
}

/** True if `entity` belongs to the player with id `playerId` (that player, or their dog). */
export function belongsTo(entity, playerId) {
  return entity.kind === 'dog' ? entity.ownerId === playerId : entity.id === playerId;
}
