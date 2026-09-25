// Every gameplay number lives here. No magic numbers in logic code (architecture rule 8).
// Seconds are converted to integer ticks once, at module load, via secToTicks().

export const TICK_RATE = 60; // fixed sim ticks per second

export function secToTicks(sec) {
  return Math.round(sec * TICK_RATE);
}

// --- World ---
export const TILE_SIZE_PX = 32; // render-only: px per tile
export const ARENA_WIDTH_TILES = 24;
export const ARENA_HEIGHT_TILES = 16;
export const PLAYER_RADIUS_TILES = 0.4;

// --- Round / match flow ---
export const SPAWN_INVULN_SEC = 1.5;
export const SPAWN_INVULN_TICKS = secToTicks(SPAWN_INVULN_SEC);
export const ROUND_COUNTDOWN_SEC = 3;
export const ROUND_COUNTDOWN_TICKS = secToTicks(ROUND_COUNTDOWN_SEC);
export const ROUND_RECAP_SEC = 5;
export const ROUND_RECAP_TICKS = secToTicks(ROUND_RECAP_SEC);
export const ROUNDS_TO_WIN_MATCH = 3;
export const FIRST_30S_WINDOW_TICKS = secToTicks(30);

// --- Aim assist ---
// DISABLED: projectiles now always fly exactly along the raw input aim. The
// cone/bend values below are deliberately left untouched so assist can be
// switched back on by flipping this one flag — see the single guard in
// systems/projectiles.js (spawnProjectile).
//
// Why it was turned off: assist rotated the shot up to AIM_ASSIST_MAX_BEND_DEGREES
// toward any enemy inside the cone with no line-of-sight test, so aiming at a
// wall with an opponent roughly behind/near it sent the bullet somewhere else.
export const AIM_ASSIST_ENABLED = false;

// Detection cone (half-angle candidates must fall within to be considered) and
// the maximum the projectile direction is allowed to bend toward that target.
// Setting AIM_ASSIST_MAX_BEND_DEGREES to 0 also disables aim assist entirely.
export const AIM_ASSIST_CONE_DEGREES = 20;
export const AIM_ASSIST_MAX_BEND_DEGREES = 10;
// Per-device override: lets us tone assist down for mouse aiming later if it proves too strong.
export const AIM_ASSIST_ENABLED_BY_DEVICE = {
  gamepad: true,
  keyboardMouse: true,
};

// --- Input deadzones ---
export const STICK_DEADZONE = 0.2;
export const AIM_HOLD_LAST_DIRECTION_DEADZONE = 0.2; // below this magnitude, keep previous aim

// --- Ultimate charge (tracked this week, not spendable yet) ---
export const ULT_CHARGE_MAX = 100;
export const ULT_CHARGE_PER_DAMAGE_DEALT = 1; // per HP of damage dealt, awarded to attacker
export const ULT_CHARGE_PER_DAMAGE_TAKEN = 0.5; // per HP of damage taken, awarded to victim
export const ULT_CHARGE_PER_ELIMINATION = 20; // awarded to the player who got the kill
export const ULT_CHARGE_CARRY_FRACTION = 0.5; // fraction carried into the next round

// --- Shared actions ---
// All three characters get the same Shoot / Slash / Shield. Characters differ
// only by HP and Speed (see CHARACTERS below).
export const ACTIONS = {
  shoot: {
    damage: 18,
    // cooldownTicks is the single source of truth for rate of fire — a
    // separate shotsPerSec field would silently go stale the moment a
    // character overrides the cooldown (Sniper does).
    cooldownTicks: secToTicks(1 / 2), // 30 ticks = 2 shots/s
    projectileSpeedTilesPerSec: 14,
    // null = unlimited: a shot flies until it hits a player, cover or an arena
    // edge. The key is kept so a finite range can be re-enabled later.
    rangeTiles: null,
    // Pure safety net so a projectile can never leak if it somehow misses every
    // collision check. At 14 tiles/s this is 42 tiles — far past the arena
    // diagonal (~28.8), so it should never trigger in normal play.
    maxLifetimeSec: 3.0,
    maxLifetimeTicks: secToTicks(3.0),
    projectileRadiusTiles: 0.12,
  },
  slash: {
    damage: 14,
    hitsPerSec: 2.5,
    cooldownTicks: secToTicks(1 / 2.5), // 24 ticks
    reachTiles: 1.5,
    arcDegrees: 90,
  },
  shield: {
    durationSec: 2.0,
    durationTicks: secToTicks(2.0), // 120 ticks
    damageReduction: 0.7, // incoming damage multiplied by (1 - this) while active
    cooldownSec: 6.0,
    cooldownTicks: secToTicks(6.0), // 360 ticks, starts when the shield ENDS
    // TODO Week 2/3: boostable/charged shield (duration or reduction scaling with
    // spent points / charge). Flat value for now, identical for every character.
  },
};

// --- Map pickups & amulets ---
// Two independent spawners drop items on the map during a round. Temporary
// pickups expire and are wiped at round end; amulets are permanent for the
// rest of the MATCH, stack additively and have no cap.
//
// All values are playtesting starting points. Seconds are converted to ticks
// once, here, so no logic ever converts at runtime.
export const PICKUPS = {
  pickupRadius: 0.4, // tiles; the Hunter amulet adds to this
  minDistFromPlayer: 3, // tiles; a spawn this close to a living player is rejected

  temporary: {
    firstSpawnTicks: secToTicks(4.0), // after the round countdown ends
    intervalMinTicks: secToTicks(6.0),
    intervalMaxTicks: secToTicks(10.0),
    maxOnMap: 2,
    lifetimeTicks: secToTicks(12.0),
    weights: {
      medkit: 20,
      overcharge: 15,
      adrenaline: 15,
      shieldBattery: 15,
      grenade: 15,
      mine: 10,
      cloak: 10,
    },
    // TODO: explosions ignore line of sight this pass — cover does not block a
    // blast. Revisit once it shows up in playtests.
    grenade: { rangeTiles: 5, fuseTicks: secToTicks(1.0), radiusTiles: 1.5, damage: 35 },
    mine: {
      armTicks: secToTicks(1.0),
      triggerRadiusTiles: 0.6,
      radiusTiles: 1.2,
      damage: 35,
    },
    overcharge: { mult: 1.3, durationTicks: secToTicks(8.0) },
    adrenaline: { mult: 1.25, durationTicks: secToTicks(6.0) },
    medkit: { heal: 35 },
    cloak: { durationTicks: secToTicks(4.0) },
  },

  amulets: {
    firstSpawnTicks: secToTicks(10.0),
    intervalMinTicks: secToTicks(12.0),
    intervalMaxTicks: secToTicks(20.0),
    maxOnMap: 1,
    weights: {
      amuletSpeed: 1,
      amuletVitality: 1,
      amuletBlade: 1,
      amuletMarksman: 1,
      amuletWard: 1,
      amuletFury: 1,
      amuletHunter: 1,
    },
    // Per amulet held. Duplicates add together, then multiply against boosts.
    perStack: {
      speed: 0.05,
      hp: 0.08,
      slash: 0.06,
      shoot: 0.06,
      shieldCdTicks: secToTicks(1.0),
      ultGain: 0.08,
      pickupRadius: 0.3,
    },
    shieldCooldownFloorTicks: secToTicks(2.0), // a floor on the stat, not a cap on amulets
  },
};

/** Ids of the two pickup families, and the amulet stat each amulet type feeds. */
export const TEMPORARY_PICKUP_IDS = Object.keys(PICKUPS.temporary.weights);
export const AMULET_IDS = Object.keys(PICKUPS.amulets.weights);
/** Pickups that occupy the single item slot instead of applying instantly. */
export const USABLE_PICKUP_IDS = ['grenade', 'mine'];

// --- Pre-match boost allocation ---
// Each player spends BOOST_POINTS_PER_PLAYER points across these categories.
// Bonuses are multipliers on the base stat, applied once in createInitialState
// and carried unchanged through every round of the match.
export const BOOST_POINTS_PER_PLAYER = 10;
export const BOOST_CATEGORIES = ['hp', 'speed', 'shootDmg', 'slashDmg'];
export const BOOST_BONUS_PER_POINT = {
  hp: 0.04, // +4% max HP per point
  speed: 0.03, // +3% move speed per point
  shootDmg: 0.03, // +3% Shoot damage per point
  slashDmg: 0.05, // +5% Slash damage per point
};

// --- Characters ---
// Every character starts from the shared ACTIONS baseline above. A `shoot`
// block here overrides that baseline for one character; `nova` / `dog` are
// that character's unique ability.
//
// EVERY NUMBER IN THIS BLOCK IS A FIRST-PASS GUESS, NOT FINAL BALANCE. They
// are named config specifically so they can be tuned without touching sim
// logic. See README "Character identity" for the reasoning behind each.
export const CHARACTERS = {
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    color: '#e74c3c', // red
    hp: 80, // deliberately the squishiest: high reward, high punish
    speedTilesPerSec: 4.5,
    // Trades rate of fire for damage per hit: missing should hurt.
    // TUNABLE: damage x2 and cooldown x2 keep nominal DPS at the 36/s baseline
    // (36 dmg every 1.0s vs 18 every 0.5s). That parity is what the DPS-band
    // test pins; shift either number and the test will tell you how far the
    // character drifted from baseline.
    shoot: {
      damage: 36,
      cooldownTicks: secToTicks(1.0),
      projectileSpeedTilesPerSec: 22, // reads as a rifle, and shortens lead time
    },
  },
  berserker: {
    id: 'berserker',
    name: 'Berserker',
    color: '#3498db', // blue
    hp: 140, // tanky, because the nova forces him into melee range
    speedTilesPerSec: 5.0,
    // Telegraphed AoE nova: a windup the victims can see and walk out of, and
    // that the Berserker can be punished for starting. Paid for with the ult
    // charge meter that was already being tracked (see ULT_CHARGE_* above) —
    // no second resource system.
    nova: {
      radiusTiles: 3, // measured center-to-center, inclusive at exactly this
      damage: 45,
      windupTicks: secToTicks(0.5),
      ultCost: 50, // half a full meter
      windupMoveMultiplier: 0.5, // slowed while charging, so the tell matters
    },
  },
  summoner: {
    id: 'summoner',
    name: 'Summoner',
    color: '#2ecc71', // green
    hp: 100,
    speedTilesPerSec: 4.2,
    // A killable pressure tool, not a free permanent annoyance: one at a time,
    // takes damage like any other entity, and costs the Summoner tempo when it
    // dies.
    dog: {
      hp: 40,
      damage: 8,
      attackRangeTiles: 0.9,
      attackCooldownTicks: secToTicks(0.8),
      speedTilesPerSec: 5.5, // faster than any player, but has to find them
      radiusTiles: 0.3,
      // 0 = pure random walk, 1 = direct chase. Around half keeps it reading as
      // an erratic animal rather than a heat-seeking missile.
      trackingBias: 0.5,
      respawnCooldownTicks: secToTicks(5), // starts when the dog dies
    },
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);

/** The Shoot config for one character: the shared baseline with that character's overrides applied. */
export function shootConfigFor(characterId) {
  return { ...ACTIONS.shoot, ...(CHARACTERS[characterId].shoot || {}) };
}
