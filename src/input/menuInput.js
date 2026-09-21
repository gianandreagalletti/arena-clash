// Menu navigation input: raw button reads plus false->true edge detection,
// so menu screens act once per press instead of every frame while held.

import { GAMEPAD_BUTTON_A, GAMEPAD_BUTTON_B, GAMEPAD_BUTTON_START } from './gamepad.js';

// UI-only threshold (not a gameplay number): how far a stick must move to count
// as a menu nudge. Deliberately higher than the in-game STICK_DEADZONE.
const MENU_STICK_THRESHOLD = 0.5;

const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;

function pressed(pad, index) {
  return !!(pad.buttons[index] && pad.buttons[index].pressed);
}

/** Raw (held, not edge-detected) menu button state for a gamepad. */
export function readGamepadMenuRaw(pad) {
  if (!pad) return { up: false, down: false, left: false, right: false, add: false, remove: false, ready: false };

  const lx = pad.leftStick.x;
  const ly = pad.leftStick.y;

  return {
    up: pressed(pad, DPAD_UP) || ly < -MENU_STICK_THRESHOLD,
    down: pressed(pad, DPAD_DOWN) || ly > MENU_STICK_THRESHOLD,
    left: pressed(pad, DPAD_LEFT) || lx < -MENU_STICK_THRESHOLD,
    right: pressed(pad, DPAD_RIGHT) || lx > MENU_STICK_THRESHOLD,
    add: pressed(pad, GAMEPAD_BUTTON_A),
    remove: pressed(pad, GAMEPAD_BUTTON_B),
    ready: pressed(pad, GAMEPAD_BUTTON_START),
  };
}

/** Raw menu button state for keyboard: arrows to navigate/spend, Enter to ready up. */
export function readKeyboardMenuRaw(arrowKeys, enterKey) {
  return {
    up: arrowKeys.up.isDown,
    down: arrowKeys.down.isDown,
    left: arrowKeys.left.isDown,
    right: arrowKeys.right.isDown,
    add: arrowKeys.right.isDown,
    remove: arrowKeys.left.isDown,
    ready: enterKey.isDown,
  };
}

/**
 * Turns per-frame held state into one-shot edges, keyed per device so several
 * devices can navigate the same screen independently.
 */
export class EdgeTracker {
  constructor() {
    this.prev = new Map();
  }

  edges(deviceKey, raw) {
    const seen = this.prev.has(deviceKey);
    const prev = this.prev.get(deviceKey) || {};
    const out = {};
    for (const key of Object.keys(raw)) {
      // First sight of a device only primes the baseline: a button already held
      // when the screen opened (e.g. Start pressed to leave the join screen)
      // must not immediately fire here.
      out[key] = seen ? !!raw[key] && !prev[key] : false;
    }
    this.prev.set(deviceKey, { ...raw });
    return out;
  }
}
