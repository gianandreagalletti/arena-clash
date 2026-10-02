import {
  CHARACTERS,
  ACTIONS,
  shootConfigFor,
  PLAYER_RADIUS_TILES,
  ROUND_COUNTDOWN_TICKS,
  BOOST_CATEGORIES,
  BOOST_BONUS_PER_POINT,
  BOOST_POINTS_PER_PLAYER,
  abilityConfig,
  PICKUPS,
  AMULET_IDS,
  TEMPORARY_PICKUP_IDS,
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

/** Zeroed amulet inventory. Counts are match-level and stack additively, with no cap. */
export function createEmptyAmulets() {
  const amulets = {};
  for (const id of AMULET_IDS) amulets[id] = 0;
  return amulets;
}

/** Zeroed per-round pickup tallies for the end-of-round log. */
function createPickupTallies() {
  const collected = {};
  for (const id of [...TEMPORARY_PICKUP_IDS, ...AMULET_IDS]) collected[id] = 0;
  return collected;
}

/**
 * Recomputes every stat derived from character base + boosts + amulets.
 *
 * Called once at player creation and again the moment an amulet is picked up —
 * never per tick. Timed pickups (Overcharge, Adrenaline) are deliberately NOT
 * folded in here: they expire, so they're applied at the point of use as a
 * separate multiplier (see systems/effects.js).
 */
export function recomputeDerivedStats(player) {
  const def = CHARACTERS[player.characterId];
  const shoot = shootConfigFor(player.characterId);
  const per = PICKUPS.amulets.perStack;
  const a = player.amulets;

  // Drafted stat points sit alongside the pre-match allocation and are summed
  // here. They are kept separate on purpose: the pre-match screen validates
  // its 10-point budget, while draft points deliberately have no cap and may
  // push a category past 10.
  const points = (category) => player.boosts[category] + player.statPicks[category];
  const boostMul = (category) => 1 + BOOST_BONUS_PER_POINT[category] * points(category);

  // Owned passive abilities, as plain multipliers (1 when not owned).
  const has = (id) => player.abilities.passives.includes(id);
  const cfg = (id) => abilityConfig(player.characterId, id);
  const greatsword = has('greatsword') ? cfg('greatsword') : null;
  const longsword = has('longsword') ? cfg('longsword') : null;
  const focus = has('focus') ? cfg('focus') : null;
  const alphaDog = has('alphaDog') ? cfg('alphaDog') : null;
  const packLeader = has('packLeader') ? cfg('packLeader') : null;

  player.maxHp = def.hp * boostMul('hp') * (1 + per.hp * a.amuletVitality);
  player.speedTilesPerSec = def.speedTilesPerSec * boostMul('speed') * (1 + per.speed * a.amuletSpeed);
  player.shootDamage = shoot.damage * boostMul('shootDmg') * (1 + per.shoot * a.amuletMarksman);
  player.slashDamage =
    ACTIONS.slash.damage *
    boostMul('slashDmg') *
    (1 + per.slash * a.amuletBlade) *
    (greatsword ? greatsword.damageMult : 1);

  // Greatsword swings harder but slower; a higher cooldown IS the slower rate.
  player.slashCooldownMaxTicks = ACTIONS.slash.cooldownTicks / (greatsword ? greatsword.rateMult : 1);
  player.slashReachTiles = ACTIONS.slash.reachTiles + (longsword ? longsword.reachBonusTiles : 0);

  player.shootCooldownMaxTicks = shoot.cooldownTicks;
  player.shootProjectileSpeed = shoot.projectileSpeedTilesPerSec * (focus ? focus.speedMult : 1);
  // NOTE: Shoot range is unlimited (rangeTiles === null) since the projectile
  // pass, so Focus's range bonus has nothing to extend and is a no-op. Kept
  // wired for the day a finite range comes back. Flagged in the README.
  player.shootRangeTiles =
    shoot.rangeTiles === null ? null : shoot.rangeTiles + (focus ? focus.rangeBonusTiles : 0);

  // Summoner's dog, scaled by its owner's passives.
  const dog = def.dog;
  if (dog) {
    player.dogMaxHp = dog.hp * (alphaDog ? alphaDog.hpMult : 1);
    player.dogBiteDamage = dog.damage * (alphaDog ? alphaDog.biteMult : 1);
    player.dogRespawnTicks = dog.respawnCooldownTicks * (packLeader ? packLeader.respawnMult : 1);
  }

  // Ward shortens the Shield cooldown but never past the floor. The floor is a
  // limit on the STAT, not on how many Wards a player may hold.
  player.shieldCooldownTicks = Math.max(
    PICKUPS.amulets.shieldCooldownFloorTicks,
    ACTIONS.shield.cooldownTicks - per.shieldCdTicks * a.amuletWard
  );
  player.ultGainMultiplier = 1 + per.ultGain * a.amuletFury;
  player.pickupRadiusTiles = PICKUPS.pickupRadius + per.pickupRadius * a.amuletHunter;
}

function createPlayer(index, characterId, rawBoosts) {
  const spawn = SPAWN_POINTS[index];
  const boosts = normalizeBoosts(rawBoosts, index);

  const player = {
    id: index,
    kind: 'player', // damageable-entity tag, see systems/damage.js
    characterId,
    boosts,
    // Match-level: amulets survive rounds and eliminations, and only reset on a
    // brand-new match (i.e. a fresh createInitialState).
    amulets: createEmptyAmulets(),
    // Match-level draft results: stat points and owned abilities both
    // accumulate across rounds and only reset on a brand-new match.
    statPicks: { hp: 0, speed: 0, shootDmg: 0, slashDmg: 0 },
    abilities: { passives: [], slots: [null, null] },
    x: spawn.x,
    y: spawn.y,
    radiusTiles: PLAYER_RADIUS_TILES,
    aimX: spawn.defaultAimX,
    aimY: spawn.defaultAimY,
    hp: 0, // set from maxHp once derived stats exist
    maxHp: 0,
    alive: true,
    shootCooldownTicks: 0,
    slashCooldownTicks: 0,
    shieldActiveUntilTick: 0,
    shieldReadyAtTick: 0,
    invulnUntilTick: 0,
    ultCharge: 0,
    // Ability state (per-round; reset by systems/round.js).
    charging: null, // null | 'nova' — a real sim state, not just a render cue
    chargeReleaseTick: 0,
    dogReadyAtTick: 0, // Summoner only: set when its dog dies
    // Pickups (per-round).
    item: null, // null | 'grenade' | 'mine' — the single usable-item slot
    itemHeldLastTick: false, // for edge-triggering the Item button
    // `vanishUntilTick` runs ALONGSIDE cloakUntilTick rather than replacing it:
    // Vanish sets both, so every gameplay rule keyed on "cloaked" (aim assist,
    // breaking on attack) behaves exactly as before. The extra field exists only
    // so the renderer can tell the two apart — Vanish hides the Sniper outright
    // while the Cloak pickup only fades him.
    effects: { overchargeUntilTick: 0, adrenalineUntilTick: 0, cloakUntilTick: 0, vanishUntilTick: 0 },
    // Skills (per-round). Index 0/1 match abilities.slots.
    skillCooldowns: [0, 0],
    skillsHeldLastTick: [false, false],
    chargingSkill: null, // { slot, startTick } while holding Charged Shot
    // { ticksLeft, vx, vy, damage, invulnerable, hitIds, abilityId } during
    // Charge/Roll. vx/vy are tiles per SECOND, divided by TICK_RATE each tick.
    dash: null,
    poisonUntilTick: 0,
    poisonDps: 0,
    poisonSourceId: null,
    abilityUses: {},
    damageByAbility: {},
    roundsWon: 0,
    // Per-round stats (reset by systems/round.js at the start of each round).
    damageDealt: 0,
    damageTaken: 0,
    eliminations: 0,
    deathTick: null,
    damageTakenFirst30s: false,
    pickupsCollected: createPickupTallies(),
    itemsUsed: { grenade: 0, mine: 0 },
    damageByExplosive: { grenade: 0, mine: 0 },
  };

  recomputeDerivedStats(player);
  player.hp = player.maxHp;
  return player;
}

export { createPickupTallies };

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
    dogs: [], // Summoner minions — damageable entities, see systems/dog.js
    nextDogId: 1,
    // Map items and the things they leave behind (see systems/pickups.js,
    // systems/explosives.js). All cleared at round end.
    pickups: [],
    nextPickupId: 1,
    vipers: [], // Summoner ability summons — damageable like dogs
    nextViperId: 1,
    traps: [],
    nextTrapId: 1,
    draft: null, // set while roundState === 'draft', see systems/draft.js
    explosives: [], // live grenades and armed mines
    nextExplosiveId: 1,
    nextExplosionId: 1,
    // Spawner timers, armed when the round countdown ends.
    nextTempSpawnTick: 0,
    nextAmuletSpawnTick: 0,
    // Per-round audit trail for the end-of-round log.
    roundPickupEvents: [],
    // The draft that produced the loadouts for the round now being played, kept
    // after `state.draft` is cleared so the end-of-round log can report what was
    // offered and what was taken. Null for round 1, which has no draft before it.
    lastDraft: null,
    logs: [],
    pendingLogPrint: null, // set by round.js when a round just ended; caller should print + clear
    // Per-tick transient data for rendering (cleared every tick by step()):
    meleeSwings: [],
    explosions: [],
    novaBlasts: [],
    voidRoundThisTick: false,
  };
}
