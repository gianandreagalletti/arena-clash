import { CHARACTERS, PLAYER_RADIUS_TILES, ROUND_COUNTDOWN_TICKS } from './config/balance.js';
import { SPAWN_POINTS } from './arena.js';
import { createRng } from './rng.js';

function createPlayer(index, characterId) {
  const def = CHARACTERS[characterId];
  const spawn = SPAWN_POINTS[index];
  return {
    id: index,
    characterId,
    x: spawn.x,
    y: spawn.y,
    radiusTiles: PLAYER_RADIUS_TILES,
    aimX: spawn.defaultAimX,
    aimY: spawn.defaultAimY,
    hp: def.hp,
    maxHp: def.hp,
    alive: true,
    fireCooldownTicks: 0,
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
 * P1..P3 in order.
 */
export function createInitialState(seed, characterIds) {
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
    players: characterIds.map((id, i) => createPlayer(i, id)),
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
