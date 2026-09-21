// The pure sim step function. step(state, inputs) -> newState.
// Never mutates its `state` argument; never touches Phaser/DOM/window/Math.random.

import { CHARACTERS, AIM_HOLD_LAST_DIRECTION_DEADZONE } from './config/balance.js';
import { applyMovement } from './systems/movement.js';
import { performMelee } from './systems/melee.js';
import { spawnProjectile, updateProjectiles } from './systems/projectiles.js';
import { tickCountdown, checkRoundEnd, tickRecap } from './systems/round.js';

export const NEUTRAL_INPUT = Object.freeze({
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  fire: false,
  ab1: false,
  ab2: false,
  ult: false,
});

function cloneState(state) {
  return structuredClone(state);
}

function tickPlaying(state, inputs) {
  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i];
    if (!player.alive) continue; // eliminated players are spectators: no sim effect

    const input = inputs[i] || NEUTRAL_INPUT;
    const characterDef = CHARACTERS[player.characterId];

    if (player.fireCooldownTicks > 0) {
      player.fireCooldownTicks -= 1;
    }

    const aimMag = Math.hypot(input.aimX || 0, input.aimY || 0);
    if (aimMag >= AIM_HOLD_LAST_DIRECTION_DEADZONE) {
      player.aimX = input.aimX / aimMag;
      player.aimY = input.aimY / aimMag;
    }
    // else: keep the previous aim direction (idle stick / mouse didn't move).

    applyMovement(player, input, characterDef.speedTilesPerSec);

    if (input.fire && player.fireCooldownTicks <= 0) {
      if (characterDef.attack.kind === 'melee') {
        performMelee(state, player, characterDef);
      } else {
        spawnProjectile(state, player, characterDef);
      }
      player.fireCooldownTicks = characterDef.attack.cooldownTicks;
    }
  }

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
  next.pendingLogPrint = null;
  next.voidRoundThisTick = false;

  const safeInputs = inputs || [];

  if (next.roundState === 'countdown') {
    tickCountdown(next);
  } else if (next.roundState === 'playing') {
    tickPlaying(next, safeInputs);
  } else if (next.roundState === 'recap') {
    tickRecap(next);
  }
  // 'matchOver': no-op; the render layer starts a new match via createInitialState().

  return next;
}
