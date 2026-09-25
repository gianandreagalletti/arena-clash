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
    shotsPerSec: 2,
    cooldownTicks: secToTicks(1 / 2), // 30 ticks = one shot every 0.5s
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
// Characters differ ONLY by HP and Speed. Everything else (id/name/color) is
// identity/presentation, and all combat numbers live in ACTIONS above.
export const CHARACTERS = {
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    color: '#e74c3c', // red
    hp: 80,
    speedTilesPerSec: 4.5,
  },
  berserker: {
    id: 'berserker',
    name: 'Berserker',
    color: '#3498db', // blue
    hp: 140,
    speedTilesPerSec: 5.0,
  },
  summoner: {
    id: 'summoner',
    name: 'Summoner',
    color: '#2ecc71', // green
    hp: 100,
    speedTilesPerSec: 4.2,
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);
