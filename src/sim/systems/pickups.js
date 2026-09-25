// Map items: two independent spawners (temporary pickups and amulets),
// collection, and applying each item's effect.
//
// Every random draw goes through the seeded RNG threaded in state, in a FIXED
// order per attempt — interval, then type, then position — so a replay of the
// same seed and inputs produces the same items in the same places at the same
// ticks. An attempt that is skipped (family already at maxOnMap, or no valid
// tile) still rolls its interval first, so skipping costs the same RNG as
// succeeding and the stream never diverges.

import {
  PICKUPS,
  TEMPORARY_PICKUP_IDS,
  AMULET_IDS,
  USABLE_PICKUP_IDS,
} from '../config/balance.js';
import { SPAWN_CANDIDATE_TILES } from '../arena.js';
import { nextRandom } from '../rng.js';
import { recomputeDerivedStats } from '../state.js';

const FAMILIES = {
  temporary: { config: PICKUPS.temporary, timerField: 'nextTempSpawnTick' },
  amulet: { config: PICKUPS.amulets, timerField: 'nextAmuletSpawnTick' },
};

// --- Seeded RNG helpers (each advances state.rng) ---

function draw(state) {
  const roll = nextRandom(state.rng);
  state.rng = roll.rng;
  return roll.value;
}

function drawIntInclusive(state, min, max) {
  return min + Math.floor(draw(state) * (max - min + 1));
}

function drawWeighted(state, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const target = draw(state) * total;
  let acc = 0;
  for (const [key, weight] of entries) {
    acc += weight;
    if (target < acc) return key;
  }
  return entries[entries.length - 1][0]; // float guard: last bucket
}

// --- Spawning ---

/** Arms both spawners. Called when the round countdown ends. */
export function armPickupSpawners(state) {
  state.nextTempSpawnTick = state.tick + PICKUPS.temporary.firstSpawnTicks;
  state.nextAmuletSpawnTick = state.tick + PICKUPS.amulets.firstSpawnTicks;
}

function validTilesFor(state) {
  const minDistSq = PICKUPS.minDistFromPlayer * PICKUPS.minDistFromPlayer;
  return SPAWN_CANDIDATE_TILES.filter((tile) => {
    for (const player of state.players) {
      if (!player.alive) continue;
      const dx = player.x - tile.x;
      const dy = player.y - tile.y;
      if (dx * dx + dy * dy < minDistSq) return false;
    }
    // One item per tile.
    return !state.pickups.some((p) => p.x === tile.x && p.y === tile.y);
  });
}

function trySpawn(state, family) {
  const { config, timerField } = FAMILIES[family];
  if (state.tick < state[timerField]) return;

  // 1. Interval — always rolled, even for an attempt that gets skipped.
  state[timerField] = state.tick + drawIntInclusive(state, config.intervalMinTicks, config.intervalMaxTicks);

  const onMap = state.pickups.filter((p) => p.family === family).length;
  if (onMap >= config.maxOnMap) return;

  // 2. Type.
  const type = drawWeighted(state, config.weights);

  // 3. Position.
  const tiles = validTilesFor(state);
  if (tiles.length === 0) return;
  const tile = tiles[Math.floor(draw(state) * tiles.length)];

  const pickup = {
    id: state.nextPickupId++,
    type,
    family,
    x: tile.x,
    y: tile.y,
    spawnTick: state.tick,
  };
  state.pickups.push(pickup);
  state.roundPickupEvents.push({
    pickupId: pickup.id,
    type,
    family,
    spawnTick: state.tick,
    outcome: 'uncollected',
    collectedBy: null,
    collectedTick: null,
  });
}

function findEvent(state, pickupId) {
  return state.roundPickupEvents.find((e) => e.pickupId === pickupId) || null;
}

/** Removes temporary pickups nobody took in time. Amulets have no lifetime. */
function despawnExpired(state) {
  if (state.pickups.length === 0) return;
  const lifetime = PICKUPS.temporary.lifetimeTicks;
  state.pickups = state.pickups.filter((pickup) => {
    if (pickup.family !== 'temporary') return true;
    if (state.tick - pickup.spawnTick < lifetime) return true;
    const event = findEvent(state, pickup.id);
    if (event) event.outcome = 'despawned';
    return false;
  });
}

export function updatePickupSpawners(state) {
  despawnExpired(state);
  trySpawn(state, 'temporary');
  trySpawn(state, 'amulet');
}

// --- Collection ---

/**
 * The player who takes a pickup this tick: the closest one in reach. Ghosts
 * can't collect; spawn-invulnerable players can. An exact tie goes to the
 * lower player index, because players are scanned in index order and only a
 * strictly smaller distance replaces the current best.
 */
function findCollector(state, pickup) {
  let best = null;
  let bestDist = Infinity;
  for (const player of state.players) {
    if (!player.alive) continue;
    const reach = player.radiusTiles + player.pickupRadiusTiles;
    const dist = Math.hypot(player.x - pickup.x, player.y - pickup.y);
    if (dist > reach) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = player;
    }
  }
  return best;
}

export function collectPickups(state) {
  if (state.pickups.length === 0) return;

  const remaining = [];
  for (const pickup of state.pickups) {
    const collector = findCollector(state, pickup);
    if (!collector) {
      remaining.push(pickup);
      continue;
    }
    // A usable item with the slot already full is simply not picked up — it
    // stays on the map for someone else.
    if (USABLE_PICKUP_IDS.includes(pickup.type) && collector.item !== null) {
      remaining.push(pickup);
      continue;
    }

    applyPickup(state, collector, pickup);
    const event = findEvent(state, pickup.id);
    if (event) {
      event.outcome = 'collected';
      event.collectedBy = collector.id;
      event.collectedTick = state.tick;
    }
  }
  state.pickups = remaining;
}

/** Applies one item's effect to `player`. Exported for tests and direct use. */
export function applyPickup(state, player, pickup) {
  player.pickupsCollected[pickup.type] += 1;

  if (pickup.family === 'amulet') {
    const prevMaxHp = player.maxHp;
    player.amulets[pickup.type] += 1;
    recomputeDerivedStats(player);
    // Vitality mid-round raises the ceiling AND current HP by the same amount,
    // so it's a buff rather than a free full heal.
    player.hp += player.maxHp - prevMaxHp;
    return;
  }

  const cfg = PICKUPS.temporary;
  switch (pickup.type) {
    case 'grenade':
    case 'mine':
      player.item = pickup.type;
      break;
    case 'overcharge':
      player.effects.overchargeUntilTick = state.tick + cfg.overcharge.durationTicks;
      break;
    case 'adrenaline':
      player.effects.adrenalineUntilTick = state.tick + cfg.adrenaline.durationTicks;
      break;
    case 'cloak':
      player.effects.cloakUntilTick = state.tick + cfg.cloak.durationTicks;
      break;
    case 'medkit':
      player.hp = Math.min(player.maxHp, player.hp + cfg.medkit.heal);
      break;
    case 'shieldBattery':
      // Clears the cooldown, but does nothing to a shield that is already up.
      if (state.tick >= player.shieldActiveUntilTick) player.shieldReadyAtTick = state.tick;
      break;
    default:
      break;
  }
}

/** Everything on the map is wiped at a round boundary, uncollected amulets included. */
export function clearRoundPickups(state) {
  state.pickups = [];
  state.explosives = [];
  state.roundPickupEvents = [];
  state.nextTempSpawnTick = 0;
  state.nextAmuletSpawnTick = 0;
}

export { TEMPORARY_PICKUP_IDS, AMULET_IDS };
