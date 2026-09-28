// Summoner ability summons: the Viper and the Thorn Trap, plus the poison the
// viper applies.
//
// The viper is a damageable entity like the dog, so it goes through the same
// applyDamage path and is hit by the same projectiles and slashes.

import { TICK_RATE, ARENA_WIDTH_TILES, ARENA_HEIGHT_TILES, abilityConfig } from '../config/balance.js';
import { COVER_BLOCKS, clamp, pushCircleOutOfRect } from '../arena.js';
import { applyDamage, isUntargetable } from './damage.js';

// --- Viper ---

export function liveViperFor(state, ownerId) {
  return state.vipers.find((v) => v.ownerId === ownerId && v.alive) || null;
}

export function summonViper(state, owner, config) {
  if (liveViperFor(state, owner.id)) return; // one at a time, like the dog
  state.vipers.push({
    id: state.nextViperId++,
    kind: 'viper', // damageable-entity tag, see systems/damage.js
    ownerId: owner.id,
    x: owner.x,
    y: owner.y,
    radiusTiles: config.radiusTiles,
    hp: config.hp,
    maxHp: config.hp,
    alive: true,
    biteCooldownTicks: 0,
    expiresAtTick: state.tick + config.lifetimeTicks,
  });
}

function nearestEnemyPlayer(state, entity) {
  let best = null;
  let bestDist = Infinity;
  for (const player of state.players) {
    if (player.id === entity.ownerId) continue;
    if (isUntargetable(state, player)) continue;
    const dist = Math.hypot(player.x - entity.x, player.y - entity.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = player;
    }
  }
  return best;
}

/** Poison refreshes its timer rather than stacking, so re-biting does not double it. */
function applyPoison(target, config, sourceId, tick) {
  target.poisonUntilTick = tick + config.poisonDurationTicks;
  target.poisonDps = config.poisonDps;
  target.poisonSourceId = sourceId;
}

function updateViper(state, viper, owner, config) {
  const target = nearestEnemyPlayer(state, viper);

  // Unlike the dog's biased wander, the viper simply hunts.
  if (target) {
    const angle = Math.atan2(target.y - viper.y, target.x - viper.x);
    const step = config.speedTilesPerSec / TICK_RATE;
    let x = clamp(viper.x + Math.cos(angle) * step, viper.radiusTiles, ARENA_WIDTH_TILES - viper.radiusTiles);
    let y = clamp(viper.y + Math.sin(angle) * step, viper.radiusTiles, ARENA_HEIGHT_TILES - viper.radiusTiles);
    for (const block of COVER_BLOCKS) {
      const pushed = pushCircleOutOfRect(x, y, viper.radiusTiles, block);
      x = pushed.x;
      y = pushed.y;
    }
    viper.x = x;
    viper.y = y;
  }

  if (viper.biteCooldownTicks > 0) viper.biteCooldownTicks -= 1;
  if (!target || viper.biteCooldownTicks > 0) return;

  const dist = Math.hypot(target.x - viper.x, target.y - viper.y);
  if (dist > config.biteRangeTiles + target.radiusTiles) return;

  const dealt = applyDamage(state, target, config.biteDamage, viper);
  viper.biteCooldownTicks = config.biteIntervalTicks;
  if (dealt > 0) {
    applyPoison(target, config, viper.ownerId, state.tick);
    if (owner) owner.damageByAbility.viper = (owner.damageByAbility.viper || 0) + dealt;
  }
}

// --- Thorn Trap ---

export function placeThornTrap(state, owner, config) {
  state.traps.push({
    id: state.nextTrapId++,
    ownerId: owner.id,
    x: owner.x,
    y: owner.y,
    radiusTiles: config.radiusTiles,
    armedAtTick: state.tick + config.armTicks,
    expiresAtTick: state.tick + config.armTicks + config.durationTicks,
    enterDamage: config.enterDamage,
    slowMult: config.slowMult,
    insideIds: [], // who is standing in it, so entry damage lands once per entry
  });
}

/** True once armed and not yet expired. */
function trapIsLive(state, trap) {
  return state.tick >= trap.armedAtTick && state.tick < trap.expiresAtTick;
}

/** Slowest multiplier from any enemy trap the player is standing in (1 when clear). */
export function trapSlowFor(state, player) {
  let slow = 1;
  for (const trap of state.traps) {
    if (trap.ownerId === player.id) continue; // your own thorns don't bite you
    if (!trapIsLive(state, trap)) continue;
    const dist = Math.hypot(player.x - trap.x, player.y - trap.y);
    if (dist <= trap.radiusTiles + player.radiusTiles) slow = Math.min(slow, trap.slowMult);
  }
  return slow;
}

function updateTrap(state, trap) {
  if (!trapIsLive(state, trap)) return;

  for (const player of state.players) {
    if (player.id === trap.ownerId) continue;
    const inside =
      player.alive &&
      Math.hypot(player.x - trap.x, player.y - trap.y) <= trap.radiusTiles + player.radiusTiles;
    const wasInside = trap.insideIds.includes(player.id);

    if (inside && !wasInside) {
      trap.insideIds.push(player.id);
      if (!isUntargetable(state, player)) {
        const owner = state.players.find((p) => p.id === trap.ownerId) || null;
        const dealt = applyDamage(state, player, trap.enterDamage, owner);
        if (dealt > 0 && owner) {
          owner.damageByAbility.thornTrap = (owner.damageByAbility.thornTrap || 0) + dealt;
        }
      }
    } else if (!inside && wasInside) {
      // Leaving re-arms the entry damage for the next time they walk in.
      trap.insideIds = trap.insideIds.filter((id) => id !== player.id);
    }
  }
}

// --- Poison ---

function tickPoison(state) {
  for (const player of state.players) {
    if (!player.alive || state.tick >= player.poisonUntilTick) continue;
    const source = state.players.find((p) => p.id === player.poisonSourceId) || null;
    const perTick = player.poisonDps / TICK_RATE;
    const dealt = applyDamage(state, player, perTick, source);
    if (dealt > 0 && source) {
      source.damageByAbility.viper = (source.damageByAbility.viper || 0) + dealt;
    }
  }
}

/** Advances vipers, traps and poison, then reaps anything expired or dead. */
export function updateSummons(state) {
  for (const viper of state.vipers) {
    if (!viper.alive) continue;
    const owner = state.players.find((p) => p.id === viper.ownerId);
    // A summon outlives neither its owner nor its own lifetime.
    if (!owner || !owner.alive || state.tick >= viper.expiresAtTick) {
      viper.alive = false;
      continue;
    }
    updateViper(state, viper, owner, abilityConfig(owner.characterId, 'viper'));
  }
  if (state.vipers.some((v) => !v.alive)) state.vipers = state.vipers.filter((v) => v.alive);

  for (const trap of state.traps) updateTrap(state, trap);
  if (state.traps.some((t) => state.tick >= t.expiresAtTick)) {
    state.traps = state.traps.filter((t) => state.tick < t.expiresAtTick);
  }

  tickPoison(state);
}
