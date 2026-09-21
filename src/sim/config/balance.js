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
// Detection cone (half-angle candidates must fall within to be considered) and
// the maximum the projectile direction is allowed to bend toward that target.
// Setting AIM_ASSIST_MAX_BEND_DEGREES to 0 disables aim assist entirely.
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

// --- Characters ---
// attack.cooldownTicks is derived once from cooldownSec (or hitsPerSec) below.
export const CHARACTERS = {
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    color: '#e74c3c', // red
    hp: 80,
    speedTilesPerSec: 4.5,
    attack: {
      kind: 'projectile',
      damage: 35,
      speedTilesPerSec: 18,
      rangeTiles: 14,
      cooldownSec: 1.2,
      cooldownTicks: secToTicks(1.2),
      projectileRadiusTiles: 0.12,
    },
    // Week 2 stubs — numbers TODO, see GDD.
    ability1: {
      // TODO(week2): see GDD for values (e.g. piercing shot / charge shot)
    },
    ability2: {
      // TODO(week2): see GDD for values
    },
    ultimate: {
      // TODO(week2): see GDD for values
    },
  },
  berserker: {
    id: 'berserker',
    name: 'Berserker',
    color: '#3498db', // blue
    hp: 140,
    speedTilesPerSec: 5.0,
    attack: {
      kind: 'melee',
      damage: 12,
      arcDegrees: 90,
      reachTiles: 1.5,
      hitsPerSec: 3,
      cooldownTicks: secToTicks(1 / 3),
    },
    ability1: {
      // TODO(week2): see GDD for values
    },
    ability2: {
      // TODO(week2): see GDD for values
    },
    ultimate: {
      // TODO(week2): see GDD for values
    },
  },
  summoner: {
    id: 'summoner',
    name: 'Summoner',
    color: '#2ecc71', // green
    hp: 100,
    speedTilesPerSec: 4.2,
    attack: {
      kind: 'projectile_aoe',
      damage: 16, // explosion damage
      speedTilesPerSec: 10,
      rangeTiles: 9,
      cooldownSec: 0.5,
      cooldownTicks: secToTicks(0.5),
      projectileRadiusTiles: 0.12,
      explodeRadiusTiles: 0.75,
    },
    ability1: {
      // TODO(week2): see GDD for values
    },
    ability2: {
      // TODO(week2): see GDD for values
    },
    ultimate: {
      // TODO(week2): see GDD for values
    },
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);
