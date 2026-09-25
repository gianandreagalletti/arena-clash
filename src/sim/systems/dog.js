// Summoner minion ("dog"): a killable pressure tool, one alive at a time.
//
// Movement is a random walk biased toward the nearest enemy player. Randomness
// comes from the seeded RNG threaded through state (sim/rng.js) — never
// Math.random — so a given seed always produces the same path, like everything
// else in sim/.

import { TICK_RATE, CHARACTERS, ARENA_WIDTH_TILES, ARENA_HEIGHT_TILES } from '../config/balance.js';
import { COVER_BLOCKS, clamp, pushCircleOutOfRect } from '../arena.js';
import { applyDamage, isUntargetable } from './damage.js';
import { nextRandom } from '../rng.js';

/** The dog config for a character, or null if it doesn't have one. */
export function dogConfigFor(characterId) {
  return CHARACTERS[characterId].dog || null;
}

export function liveDogFor(state, ownerId) {
  return state.dogs.find((d) => d.ownerId === ownerId && d.alive) || null;
}

/** True if `player` could summon right now: has a dog, none alive, off cooldown. */
export function canSummonDog(state, player) {
  if (!dogConfigFor(player.characterId)) return false;
  if (liveDogFor(state, player.id)) return false; // capped at one — re-summoning does nothing
  return state.tick >= player.dogReadyAtTick;
}

export function summonDog(state, owner) {
  const cfg = dogConfigFor(owner.characterId);
  state.dogs.push({
    id: state.nextDogId++,
    kind: 'dog', // damageable-entity tag, see systems/damage.js
    ownerId: owner.id,
    x: owner.x,
    y: owner.y,
    radiusTiles: cfg.radiusTiles,
    hp: cfg.hp,
    maxHp: cfg.hp,
    alive: true,
    attackCooldownTicks: 0,
  });
}

/** Nearest targetable enemy player to `dog`, or null. */
function nearestEnemy(state, dog) {
  let best = null;
  let bestDist = Infinity;
  for (const player of state.players) {
    if (player.id === dog.ownerId) continue;
    if (isUntargetable(state, player)) continue;
    const dist = Math.hypot(player.x - dog.x, player.y - dog.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = player;
    }
  }
  return best;
}

/**
 * Picks this tick's heading: with probability `trackingBias` head straight at
 * the nearest enemy, otherwise pick a uniformly random direction. Consumes
 * seeded RNG and returns the advanced rng alongside the angle.
 */
function chooseHeading(rng, dog, target, trackingBias) {
  const roll = nextRandom(rng);
  if (target && roll.value < trackingBias) {
    return { angle: Math.atan2(target.y - dog.y, target.x - dog.x), rng: roll.rng };
  }
  const wander = nextRandom(roll.rng);
  return { angle: wander.value * Math.PI * 2, rng: wander.rng };
}

function moveDog(state, dog, cfg) {
  const target = nearestEnemy(state, dog);
  const heading = chooseHeading(state.rng, dog, target, cfg.trackingBias);
  state.rng = heading.rng;

  const distPerTick = cfg.speedTilesPerSec / TICK_RATE;
  let x = dog.x + Math.cos(heading.angle) * distPerTick;
  let y = dog.y + Math.sin(heading.angle) * distPerTick;

  // Same arena helpers the player uses, applied with the dog's own radius.
  x = clamp(x, dog.radiusTiles, ARENA_WIDTH_TILES - dog.radiusTiles);
  y = clamp(y, dog.radiusTiles, ARENA_HEIGHT_TILES - dog.radiusTiles);
  for (const block of COVER_BLOCKS) {
    const pushed = pushCircleOutOfRect(x, y, dog.radiusTiles, block);
    x = pushed.x;
    y = pushed.y;
  }

  dog.x = x;
  dog.y = y;
  return target;
}

function tryBite(state, dog, cfg, target) {
  if (!target || dog.attackCooldownTicks > 0) return;
  const dist = Math.hypot(target.x - dog.x, target.y - dog.y);
  if (dist > cfg.attackRangeTiles + target.radiusTiles) return;

  applyDamage(state, target, cfg.damage, dog); // credited to the Summoner, see damage.js
  dog.attackCooldownTicks = cfg.attackCooldownTicks;
}

/** Advances every live dog one tick, then reaps the dead and starts their owner's respawn cooldown. */
export function updateDogs(state) {
  for (const dog of state.dogs) {
    if (!dog.alive) continue;
    const owner = state.players.find((p) => p.id === dog.ownerId);
    // A dog outlives nothing: if its Summoner is gone, so is it.
    if (!owner || !owner.alive) {
      dog.alive = false;
      continue;
    }

    if (dog.attackCooldownTicks > 0) dog.attackCooldownTicks -= 1;

    const cfg = dogConfigFor(owner.characterId);
    const target = moveDog(state, dog, cfg);
    tryBite(state, dog, cfg, target);
  }

  const dead = state.dogs.filter((d) => !d.alive);
  for (const dog of dead) {
    const owner = state.players.find((p) => p.id === dog.ownerId);
    if (!owner) continue;
    const cfg = dogConfigFor(owner.characterId);
    owner.dogReadyAtTick = state.tick + cfg.respawnCooldownTicks;
  }
  if (dead.length > 0) state.dogs = state.dogs.filter((d) => d.alive);
}
