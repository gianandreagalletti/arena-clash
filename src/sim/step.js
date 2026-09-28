// The pure sim step function. step(state, inputs) -> newState.
// Never mutates its `state` argument; never touches Phaser/DOM/window/Math.random.

import { ACTIONS, AIM_HOLD_LAST_DIRECTION_DEADZONE } from './config/balance.js';
import { applyMovement } from './systems/movement.js';
import { performMelee } from './systems/melee.js';
import { spawnProjectile, updateProjectiles } from './systems/projectiles.js';
import { tickCountdown, checkRoundEnd, tickRecap, finishDraft } from './systems/round.js';
import { canStartNova, startNova, tickNova, moveMultiplierFor } from './systems/nova.js';
import { canSummonDog, summonDog, updateDogs } from './systems/dog.js';
import { updatePickupSpawners, collectPickups } from './systems/pickups.js';
import { useItem, updateExplosives } from './systems/explosives.js';
import { speedMultiplierFor, breakCloak } from './systems/effects.js';
import { tickDraft } from './systems/draft.js';
import {
  updateSkill,
  updateDash,
  isDashing,
  abilityMoveMultiplier,
  cancelChargedShot,
} from './systems/abilities.js';
import { updateSummons, trapSlowFor } from './systems/summons.js';

// `ult` is the character's unique ability: Berserker nova, Summoner dog summon.
// Sniper has none (its identity is statistical), so the button does nothing.
// `item` uses whatever is in the single item slot (grenade or mine).
// `skill1`/`skill2` are the two drafted ability slots, held (Charged Shot needs
// the level, not just the edge). `draftPick` is only read during the draft.
export const NEUTRAL_INPUT = Object.freeze({
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  fire: false,
  slash: false,
  shield: false,
  ult: false,
  item: false,
  skill1: false,
  skill2: false,
  draftPick: null,
});

function cloneState(state) {
  return structuredClone(state);
}

function tickPlaying(state, inputs) {
  // Fixed phase order: spawn -> collect -> (per player) act -> explosives ->
  // dogs -> projectiles -> round check.
  updatePickupSpawners(state);
  collectPickups(state);

  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i];
    if (!player.alive) continue; // eliminated players are spectators: no sim effect

    const input = inputs[i] || NEUTRAL_INPUT;

    if (player.shootCooldownTicks > 0) player.shootCooldownTicks -= 1;
    if (player.slashCooldownTicks > 0) player.slashCooldownTicks -= 1;
    for (let slot = 0; slot < player.skillCooldowns.length; slot++) {
      if (player.skillCooldowns[slot] > 0) player.skillCooldowns[slot] -= 1;
    }

    const aimMag = Math.hypot(input.aimX || 0, input.aimY || 0);
    if (aimMag >= AIM_HOLD_LAST_DIRECTION_DEADZONE) {
      player.aimX = input.aimX / aimMag;
      player.aimY = input.aimY / aimMag;
    }
    // else: keep the previous aim direction (idle stick / mouse didn't move).

    // A dash (Charge / Roll) takes over movement entirely for its duration.
    if (isDashing(player)) {
      updateDash(state, player);
    } else {
      // Movement is allowed even while shielded, but a nova windup slows it so
      // the telegraph actually costs the Berserker something. Adrenaline, a
      // Charged Shot being held and enemy Thorn Traps are all separate
      // multipliers on top of the amulet/boost-derived speed.
      applyMovement(
        player,
        input,
        player.speedTilesPerSec *
          moveMultiplierFor(player) *
          speedMultiplierFor(state, player) *
          abilityMoveMultiplier(player) *
          trapSlowFor(state, player)
      );
    }

    // Shield: its cooldown starts when the shield ends, so shieldReadyAtTick
    // alone gates both re-triggering mid-shield and pressing during cooldown.
    // The cooldown length is per player (the Ward amulet shortens it).
    if (input.shield && state.tick >= player.shieldReadyAtTick) {
      player.shieldActiveUntilTick = state.tick + ACTIONS.shield.durationTicks;
      player.shieldReadyAtTick = player.shieldActiveUntilTick + player.shieldCooldownTicks;
      cancelChargedShot(player); // shielding drops a charge: no shot, no cooldown
    }

    // Ult button: whichever unique ability this character has.
    if (input.ult) {
      if (canStartNova(state, player)) startNova(state, player);
      else if (canSummonDog(state, player)) summonDog(state, player);
    }

    const shielded = state.tick < player.shieldActiveUntilTick;
    const charging = player.charging !== null;

    // Item button: edge-triggered, one use per press, blocked while shielded
    // (same rule as Shoot/Slash). An empty slot simply does nothing.
    if (input.item && !player.itemHeldLastTick && !shielded) useItem(state, player);
    player.itemHeldLastTick = !!input.item;

    // Skill slots. Both the edge and the held level are passed through, because
    // Charged Shot charges while held and fires on release.
    const skillsHeld = [!!input.skill1, !!input.skill2];
    for (let slot = 0; slot < skillsHeld.length; slot++) {
      const justPressed = skillsHeld[slot] && !player.skillsHeldLastTick[slot];
      if (!shielded) updateSkill(state, player, input, slot, justPressed, skillsHeld[slot]);
      player.skillsHeldLastTick[slot] = skillsHeld[slot];
    }

    // Shoot is locked out while a Charged Shot is being held.
    if (!shielded && !charging && !player.chargingSkill) {
      if (input.fire && player.shootCooldownTicks <= 0) {
        spawnProjectile(state, player);
        player.shootCooldownTicks = player.shootCooldownMaxTicks;
        breakCloak(player); // attacking gives your position away
      }
      if (input.slash && player.slashCooldownTicks <= 0) {
        performMelee(state, player);
        player.slashCooldownTicks = ACTIONS.slash.cooldownTicks;
        breakCloak(player);
      }
    }

    tickNova(state, player);
  }

  updateSummons(state);
  updateExplosives(state);
  updateDogs(state);
  updateProjectiles(state);
  checkRoundEnd(state);
}

/**
 * Advances the sim by exactly one tick (1/60s). `inputs` is an array of up to
 * 3 InputFrame objects, index-aligned with `state.players`. Missing/neutral
 * entries are treated as NEUTRAL_INPUT (e.g. a disconnected device).
 */
export function step(state, inputs) {
  const next = cloneState(state);
  next.tick += 1;
  next.meleeSwings = [];
  next.explosions = [];
  next.novaBlasts = [];
  next.pendingLogPrint = null;
  next.voidRoundThisTick = false;

  const safeInputs = inputs || [];

  if (next.roundState === 'countdown') {
    tickCountdown(next);
  } else if (next.roundState === 'playing') {
    tickPlaying(next, safeInputs);
  } else if (next.roundState === 'recap') {
    tickRecap(next);
  } else if (next.roundState === 'draft') {
    // Only the draft runs during the draft: no combat, no spawners, no timers.
    if (tickDraft(next, safeInputs)) finishDraft(next);
  }
  // 'matchOver': no-op; the render layer starts a new match via createInitialState().

  return next;
}
