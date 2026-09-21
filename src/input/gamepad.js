// Maps a Phaser 3 Gamepad instance (Xbox-standard layout) to an InputFrame.
// Left stick: move · Right stick: aim (holds last direction when idle) ·
// RT: Shoot (hold) · RB: Slash · LB: Shield · Y: reserved (future ultimate).

import { STICK_DEADZONE } from '../sim/config/balance.js';

function applyDeadzone(v) {
  return Math.abs(v) < STICK_DEADZONE ? 0 : v;
}

/**
 * `pad`: a Phaser.Input.Gamepad.Gamepad. When the right stick is idle (inside
 * the deadzone) this reports aimX/aimY as 0 — the sim itself is responsible
 * for holding the last non-idle aim direction (see AIM_HOLD_LAST_DIRECTION_DEADZONE
 * in sim/step.js), so there's a single source of truth for that rule.
 */
export function readGamepadFrame(pad) {
  if (!pad) {
    return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, slash: false, shield: false };
  }

  return {
    moveX: applyDeadzone(pad.leftStick.x),
    moveY: applyDeadzone(pad.leftStick.y),
    aimX: applyDeadzone(pad.rightStick.x),
    aimY: applyDeadzone(pad.rightStick.y),
    fire: pad.R2 > 0.5, // RT
    slash: !!pad.R1, // RB
    shield: !!pad.L1, // LB
  };
}

// Button indices used by deviceManager.js for join/leave/start (Xbox-standard mapping).
export const GAMEPAD_BUTTON_A = 0;
export const GAMEPAD_BUTTON_B = 1;
export const GAMEPAD_BUTTON_START = 9;
