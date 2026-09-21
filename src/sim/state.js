import {
  CHARACTERS,
  ACTIONS,
  PLAYER_RADIUS_TILES,
  ROUND_COUNTDOWN_TICKS,
  BOOST_CATEGORIES,
  BOOST_BONUS_PER_POINT,
  BOOST_POINTS_PER_PLAYER,
} from './config/balance.js';
import { SPAWN_POINTS } from './arena.js';
import { createRng } from './rng.js';

/** Zeroed boost allocation — the default when no pre-match screen ran (tests, debug). */
export function createEmptyBoosts() {
  return { hp: 0, speed: 0, shootDmg: 0, slashDmg: 0 };
}

function normalizeBoosts(raw, playerIndex) {
  const boosts = createEmptyBoosts();
  if (!raw) return boosts;

  let spent = 0;
  for (const category of BOOST_CATEGORIES) {
    const points = raw[category] ?? 0;
    if (!Number.isInteger(points) || points < 0) {
      throw new Error(`Boost points for P${playerIndex + 1}.${category} must be a non-negative integer`);
    }
    boosts[category] = points;
    spent += points;
  }
  if (spent > BOOST_POINTS_PER_PLAYER) {
    throw new Error(`P${playerIndex + 1} spent ${spent} boost points (max ${BOOST_POINTS_PER_PLAYER})`);
  }
  return boosts;
}

/** Multiplier for a category, e.g. 3 points of hp -> 1.12. */
function boostMultiplier(boosts, category) {
  return 1 + BOOST_BONUS_PER_POINT[category] * boosts[category];
}

function createPlayer(index, characterId, rawBoosts) {
  const def = CHARACTERS[characterId];
  const spawn = SPAWN_POINTS[index];
  const boosts = normalizeBoosts(rawBoosts, index);

  // Boosted stats are derived ONCE here and stay fixed for the whole match.
  const maxHp = def.hp * boostMultiplier(boosts, 'hp');

  return {
    id: index,
    characterId,
    boosts,
    x: spawn.x,
    y: spawn.y,
    radiusTiles: PLAYER_RADIUS_TILES,
    aimX: spawn.defaultAimX,
    aimY: spawn.defaultAimY,
    hp: maxHp,
    maxHp,
    speedTilesPerSec: def.speedTilesPerSec * boostMultiplier(boosts, 'speed'),
    shootDamage: ACTIONS.shoot.damage * boostMultiplier(boosts, 'shootDmg'),
    slashDamage: ACTIONS.slash.damage * boostMultiplier(boosts, 'slashDmg'),
    alive: true,
    shootCooldownTicks: 0,
    slashCooldownTicks: 0,
    shieldActiveUntilTick: 0,
    shieldReadyAtTick: 0,
    invulnUntilTick: 0,
    ultCharge: 0,
    roundsWon: 0,
    // Per-round stats (reset by systems/round.js at the start of each round).
    damageDealt: 0,
    damageTaken: 0,
    eliminations: 0,
    deathTick: null,
    damageTakenFirst30s: false,
  };
}

/**
 * Creates a brand-new match state. `characterIds` is an array of 3 character
 * id strings (e.g. ['sniper', 'berserker', 'summoner']) assigned to players
 * P1..P3 in order. `boostAllocations` is an optional array of 3 point
 * allocations ({ hp, speed, shootDmg, slashDmg }) from the pre-match boost
 * screen; omitted entries default to zero points.
 */
export function createInitialState(seed, characterIds, boostAllocations) {
  if (!Array.isArray(characterIds) || characterIds.length !== 3) {
    throw new Error('createInitialState requires exactly 3 characterIds');
  }
  for (const id of characterIds) {
    if (!CHARACTERS[id]) throw new Error(`Unknown characterId: ${id}`);
  }

  return {
    tick: 0,
    seed,
    rng: createRng(seed),
    roundNumber: 1,
    roundState: 'countdown', // 'countdown' | 'playing' | 'recap' | 'matchOver'
    roundStateTimerTicks: ROUND_COUNTDOWN_TICKS,
    roundStartTick: 0,
    matchWinner: null,
    pendingMatchOver: false,
    players: characterIds.map((id, i) => createPlayer(i, id, boostAllocations && boostAllocations[i])),
    projectiles: [],
    nextProjectileId: 1,
    logs: [],
    pendingLogPrint: null, // set by round.js when a round just ended; caller should print + clear
    // Per-tick transient data for rendering (cleared every tick by step()):
    meleeSwings: [],
    explosions: [],
    voidRoundThisTick: false,
  };
}
