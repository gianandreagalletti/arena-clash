// Maps physical devices (up to 3 gamepads, one keyboard/mouse) to player
// slots (P1-P3) and produces one InputFrame per player per tick. The sim
// never sees this — it only ever receives the resulting InputFrame array.

import { createEmptyFrame } from './InputFrame.js';
import { readGamepadFrame } from './gamepad.js';
import { readKeyboardMouseFrame } from './keyboardMouse.js';

// Device descriptors: { kind: 'gamepad', padIndex } | { kind: 'keyboardMouse' }
// Store pad INDEX (0-based), not the pad object itself, so we always look up live pads.

export class DeviceManager {
  constructor() {
    this.slots = [null, null, null];
    this.debugMode = false;
    this.debugPlayerIndex = 0;
    this.disconnectedSlots = new Set();
  }

  reset() {
    this.slots = [null, null, null];
    this.disconnectedSlots.clear();
  }

  _sameDevice(a, b) {
    if (!a || !b || a.kind !== b.kind) return false;
    if (a.kind === 'gamepad') return a.padIndex === b.padIndex;
    return true; // keyboard/mouse is a singleton
  }

  findSlotForDevice(device) {
    return this.slots.findIndex((s) => this._sameDevice(s, device));
  }

  /** A device claims the next free slot. No-ops if it already holds one, or none are free. */
  join(device) {
    if (this.findSlotForDevice(device) !== -1) return -1;
    const freeIndex = this.slots.findIndex((s) => s === null);
    if (freeIndex === -1) return -1;
    this.slots[freeIndex] = device;
    return freeIndex;
  }

  /** A device gives up its slot (B / Esc). */
  leave(device) {
    const idx = this.findSlotForDevice(device);
    if (idx !== -1) this.slots[idx] = null;
    return idx;
  }

  allSlotsFilled() {
    return this.slots.every((s) => s !== null);
  }

  toggleDebug() {
    this.debugMode = !this.debugMode;
  }

  cycleDebugPlayer() {
    this.debugPlayerIndex = (this.debugPlayerIndex + 1) % 3;
  }

  /**
   * Builds the 3 InputFrames for this tick.
   * `gamepadList`: live array from this.input.gamepad.gamepads (or null/empty array if not available).
   * `keys`: { w,a,s,d,q,e,r } booleans for the keyboard.
   * `pointerScreen`: { x, y } in canvas px.
   * `mouseDown`: boolean.
   * `playersWorld`: array of 3 { x, y } — current sim positions, for mouse-relative aim.
   */
  buildFrames(gamepadList, keys, pointerScreen, mouseDown, playersWorld) {
    const frames = [createEmptyFrame(), createEmptyFrame(), createEmptyFrame()];

    if (this.debugMode) {
      frames[this.debugPlayerIndex] = readKeyboardMouseFrame(
        keys,
        pointerScreen,
        playersWorld[this.debugPlayerIndex],
        mouseDown
      );
      return frames;
    }

    for (let i = 0; i < 3; i++) {
      const device = this.slots[i];
      if (!device) continue;

      if (device.kind === 'gamepad') {
        const pad = gamepadList && gamepadList[device.padIndex];
        if (!pad || !pad.connected) {
          this.disconnectedSlots.add(i);
          continue; // neutral input until it reconnects
        }
        this.disconnectedSlots.delete(i);
        frames[i] = readGamepadFrame(pad);
      } else if (device.kind === 'keyboardMouse') {
        frames[i] = readKeyboardMouseFrame(keys, pointerScreen, playersWorld[i], mouseDown);
      }
    }

    return frames;
  }
}
