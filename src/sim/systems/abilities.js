// Active abilities: the two skill slots, their cooldowns, and the dash /
// charge states they put the player into.
//
// Passive abilities are not here — they fold into derived stats in
// state.js recomputeDerivedStats(), because they never need a per-tick branch.

import { TICK_RATE, ARENA_WIDTH_TILES, ARENA_HEIGHT_TILES, abilityConfig } from '../config/balance.js';
import { COVER_BLOCKS, circleIntersectsRect, clamp } from '../arena.js';
import { applyDamage, isUntargetable, damageableEntities, belongsTo } from './damage.js';
import { damageMultiplierFor } from './effects.js';
import { spawnProjectile } from './projectiles.js';
import { summonViper, placeThornTrap } from './summons.js';

/** The ability in one slot, or null. */
export function skillInSlot(player, slot) {
  return player.abilities.slots[slot] || null;
}

function tally(player, abilityId, dealt = 0) {
  player.abilityUses[abilityId] = (player.abilityUses[abilityId] || 0) + (dealt === 0 ? 1 : 0);
  if (dealt > 0) player.damageByAbility[abilityId] = (player.damageByAbility[abilityId] || 0) + dealt;
}

function startCooldown(player, slot, config) {
  player.skillCooldowns[slot] = config.cooldownTicks;
}

/** A dash along (dirX, dirY); Charge damages what it passes through, Roll is invulnerable instead. */
function startDash(player, config, dirX, dirY, { damage = 0, invulnerable = false }) {
  const speed = config.distanceTiles / (config.durationTicks / TICK_RATE);
  player.dash = {
    endTick: null, // filled by the caller, which knows the current tick
    ticksLeft: config.durationTicks,
    vx: dirX * speed,
    vy: dirY * speed,
    damage,
    invulnerable,
    hitIds: [],
    abilityId: null,
  };
}

/** The direction a dash should take: movement input, falling back to aim when standing still. */
function dashDirection(player, input) {
  const mx = input.moveX || 0;
  const my = input.moveY || 0;
  const mag = Math.hypot(mx, my);
  if (mag > 0) return { x: mx / mag, y: my / mag };
  const aimMag = Math.hypot(player.aimX, player.aimY) || 1;
  return { x: player.aimX / aimMag, y: player.aimY / aimMag };
}

function whirlwind(state, player, config) {
  let dealt = 0;
  for (const target of damageableEntities(state)) {
    if (belongsTo(target, player.id)) continue;
    if (isUntargetable(state, target)) continue;
    const dist = Math.hypot(target.x - player.x, target.y - player.y);
    if (dist > player.slashReachTiles + target.radiusTiles) continue;
    dealt += applyDamage(state, target, config.damage * damageMultiplierFor(state, player), player);
  }
  // A 360 slash is still a slash: it gives your position away.
  state.meleeSwings.push({
    playerId: player.id,
    x: player.x,
    y: player.y,
    aimX: player.aimX,
    aimY: player.aimY,
    arcDegrees: 360,
    reachTiles: player.slashReachTiles,
    tick: state.tick,
  });
  return dealt;
}

/**
 * Handles one skill slot for one player this tick. `pressed`/`held` are the
 * edge and level of that slot's button.
 */
export function updateSkill(state, player, input, slot, pressed, held) {
  const abilityId = skillInSlot(player, slot);
  if (!abilityId) return;
  const config = abilityConfig(player.characterId, abilityId);
  if (!config) return;

  // Charged Shot is the only hold ability: charge while held, fire on release.
  if (config.hold) {
    updateChargedShot(state, player, slot, abilityId, config, held);
    return;
  }

  if (!pressed || player.skillCooldowns[slot] > 0) return;

  switch (abilityId) {
    case 'charge': {
      const dir = dashDirection(player, input);
      startDash(player, config, dir.x, dir.y, { damage: config.damage });
      player.dash.abilityId = abilityId;
      break;
    }
    case 'roll': {
      const dir = dashDirection(player, input);
      startDash(player, config, dir.x, dir.y, { invulnerable: true });
      player.dash.abilityId = abilityId;
      break;
    }
    case 'whirlwind': {
      const dealt = whirlwind(state, player, config);
      if (dealt > 0) tally(player, abilityId, dealt);
      break;
    }
    case 'vanish': {
      // Shares the Cloak effect exactly; if both are running, the later end wins.
      player.effects.cloakUntilTick = Math.max(
        player.effects.cloakUntilTick,
        state.tick + config.durationTicks
      );
      // Tracked separately so the renderer can hide him outright instead of
      // just fading him. Gameplay reads cloakUntilTick and is unaffected. A
      // Cloak pickup taken mid-Vanish therefore outlasts the invisibility and
      // leaves him faded for the remainder, which is the behaviour we want.
      player.effects.vanishUntilTick = Math.max(
        player.effects.vanishUntilTick,
        state.tick + config.durationTicks
      );
      break;
    }
    case 'viper':
      summonViper(state, player, config);
      break;
    case 'thornTrap':
      placeThornTrap(state, player, config);
      break;
    default:
      return; // unknown active: do nothing rather than guess
  }

  tally(player, abilityId);
  startCooldown(player, slot, config);
}

function updateChargedShot(state, player, slot, abilityId, config, held) {
  const charging = player.chargingSkill && player.chargingSkill.slot === slot;

  if (held && !charging && player.skillCooldowns[slot] <= 0) {
    player.chargingSkill = { slot, startTick: state.tick };
    return;
  }
  if (!charging) return;

  if (held) return; // keep charging

  // Released: fire, scaled by how long it was held.
  const heldTicks = state.tick - player.chargingSkill.startTick;
  const fraction = Math.min(1, heldTicks / config.maxChargeTicks);
  const mult = config.minMult + (config.maxMult - config.minMult) * fraction;

  player.chargingSkill = null;
  spawnProjectile(state, player, { damageMult: mult, abilityId });
  tally(player, abilityId);
  startCooldown(player, slot, config);
}

/** Shield cancels a charge outright: no shot, and no cooldown spent. */
export function cancelChargedShot(player) {
  player.chargingSkill = null;
}

/** True while the player is mid-dash and normal movement should not run. */
export function isDashing(player) {
  return player.dash !== null;
}

/** Movement multiplier from ability states (Charged Shot slows you while charging). */
export function abilityMoveMultiplier(player) {
  if (!player.chargingSkill) return 1;
  const abilityId = skillInSlot(player, player.chargingSkill.slot);
  const config = abilityConfig(player.characterId, abilityId);
  return config && config.moveMult ? config.moveMult : 1;
}

/** Advances an in-progress dash: moves, damages what it passes through, stops on geometry. */
export function updateDash(state, player) {
  const dash = player.dash;
  if (!dash) return;

  const stepX = dash.vx / TICK_RATE;
  const stepY = dash.vy / TICK_RATE;
  let x = player.x + stepX;
  let y = player.y + stepY;

  x = clamp(x, player.radiusTiles, ARENA_WIDTH_TILES - player.radiusTiles);
  y = clamp(y, player.radiusTiles, ARENA_HEIGHT_TILES - player.radiusTiles);

  // Cover stops a dash dead rather than sliding along it.
  const blocked = COVER_BLOCKS.some((block) => circleIntersectsRect(x, y, player.radiusTiles, block));
  if (blocked) {
    player.dash = null;
    return;
  }

  player.x = x;
  player.y = y;

  if (dash.damage > 0) {
    for (const target of damageableEntities(state)) {
      if (belongsTo(target, player.id)) continue;
      if (isUntargetable(state, target)) continue;
      const key = `${target.kind}:${target.id}`;
      if (dash.hitIds.includes(key)) continue; // once per enemy per dash
      const dist = Math.hypot(target.x - player.x, target.y - player.y);
      if (dist > player.radiusTiles + target.radiusTiles) continue;
      const dealt = applyDamage(state, target, dash.damage * damageMultiplierFor(state, player), player);
      dash.hitIds.push(key);
      if (dealt > 0 && dash.abilityId) tally(player, dash.abilityId, dealt);
    }
  }

  dash.ticksLeft -= 1;
  if (dash.ticksLeft <= 0) player.dash = null;
}

/** True if the player currently ignores damage because of a Roll. */
export function isDashInvulnerable(player) {
  return !!(player.dash && player.dash.invulnerable);
}
