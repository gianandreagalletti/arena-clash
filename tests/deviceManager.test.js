import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceManager } from '../src/input/deviceManager.js';

test('device manager: join/leave slot assignment logic with padIndex (not pad object)', () => {
  const manager = new DeviceManager();

  const kmDevice = { kind: 'keyboardMouse' };
  const gp0 = { kind: 'gamepad', padIndex: 0 }; // Store 0-based index
  const gp1 = { kind: 'gamepad', padIndex: 1 };

  // Pad 0 joins → claims P1 (slot 0).
  let idx = manager.join(gp0);
  assert.strictEqual(idx, 0);
  assert.strictEqual(manager.slots[0], gp0);
  assert.strictEqual(manager.slots[1], null);

  // Pad 1 joins → claims P2 (slot 1).
  idx = manager.join(gp1);
  assert.strictEqual(idx, 1);
  assert.strictEqual(manager.slots[1], gp1);

  // Keyboard joins → claims P3 (slot 2).
  idx = manager.join(kmDevice);
  assert.strictEqual(idx, 2);
  assert.strictEqual(manager.slots[2], kmDevice);

  // All filled.
  assert.strictEqual(manager.allSlotsFilled(), true);

  // Pad 0 tries to join again → already has a slot, returns -1.
  idx = manager.join(gp0);
  assert.strictEqual(idx, -1);

  // Pad 0 leaves → frees P1.
  idx = manager.leave(gp0);
  assert.strictEqual(idx, 0);
  assert.strictEqual(manager.slots[0], null);
  assert.strictEqual(manager.allSlotsFilled(), false);

  // Pad 0 can rejoin → claims P1 (slot 0).
  idx = manager.join(gp0);
  assert.strictEqual(idx, 0);
  assert.strictEqual(manager.allSlotsFilled(), true);
});

test('device manager: same device (gamepad by padIndex) not double-counted', () => {
  const manager = new DeviceManager();

  const gp0_ref1 = { kind: 'gamepad', padIndex: 0 };
  const gp0_ref2 = { kind: 'gamepad', padIndex: 0 }; // Different object, same padIndex

  // First reference joins.
  let idx = manager.join(gp0_ref1);
  assert.strictEqual(idx, 0);

  // Second reference is seen as the same device (same padIndex).
  idx = manager.findSlotForDevice(gp0_ref2);
  assert.strictEqual(idx, 0);

  // Try to join second reference → already has a slot.
  idx = manager.join(gp0_ref2);
  assert.strictEqual(idx, -1);
});

test('device manager: keyboard/mouse is treated as a single device', () => {
  const manager = new DeviceManager();

  const kmDevice1 = { kind: 'keyboardMouse' };
  const kmDevice2 = { kind: 'keyboardMouse' }; // Different object, same kind

  let idx = manager.join(kmDevice1);
  assert.strictEqual(idx, 0);

  idx = manager.join(kmDevice2);
  assert.strictEqual(idx, -1); // Already has a slot (same kind).

  idx = manager.leave(kmDevice2); // Leave via different object
  assert.strictEqual(idx, 0); // Still found and removed.
  assert.strictEqual(manager.slots[0], null);
});

test('device manager: buildFrames resolves padIndex to live gamepads from gamepadList', () => {
  const manager = new DeviceManager();

  // Mock Phaser gamepad objects.
  const mockPad0 = {
    index: 0,
    connected: true,
    leftStick: { x: 0.5, y: 0.2 },
    rightStick: { x: 0, y: 0 },
    R2: 0,
    L1: false,
    R1: false,
    Y: false,
  };
  const mockPad1 = {
    index: 1,
    connected: true,
    leftStick: { x: -0.3, y: 0 },
    rightStick: { x: 0.1, y: 0.4 },
    R2: 0,
    L1: false,
    R1: false,
    Y: false,
  };
  const gamepadList = [mockPad0, mockPad1];

  // Join pads: P1=pad0, P2=pad1, P3=keyboard.
  manager.join({ kind: 'gamepad', padIndex: 0 });
  manager.join({ kind: 'gamepad', padIndex: 1 });
  manager.join({ kind: 'keyboardMouse' });

  // buildFrames with live gamepadList → resolves indices to real pads.
  // The 3rd argument is the crosshair in WORLD TILES (already converted by
  // render/coords.js screenToWorld), never raw canvas pixels. P3 sits at
  // (15, 15) and the crosshair is 4 tiles to its right.
  const frames = manager.buildFrames(
    gamepadList,
    { w: false, a: false, s: false, d: false, q: false, e: false, r: false },
    { x: 19, y: 15 },
    false,
    [{ x: 5, y: 5 }, { x: 10, y: 10 }, { x: 15, y: 15 }]
  );

  // Frame for P1 (pad0) should have the pad's stick values.
  assert.strictEqual(frames[0].moveX, 0.5);
  assert.strictEqual(frames[0].moveY, 0.2);
  assert.strictEqual(frames[0].aimX, 0);
  assert.strictEqual(frames[0].aimY, 0);

  // Frame for P2 (pad1) should have its stick values after deadzone filtering.
  assert.strictEqual(frames[1].moveX, -0.3); // 0.3 > deadzone 0.2, so passes through
  assert.strictEqual(frames[1].moveY, 0); // 0 < deadzone 0.2, so clamped to 0
  assert.strictEqual(frames[1].aimX, 0); // 0.1 < deadzone 0.2, so clamped to 0
  assert.strictEqual(frames[1].aimY, 0.4); // 0.4 > deadzone 0.2, so passes through

  // Frame for P3 (keyboard) should be neutral since no keys are pressed...
  assert.strictEqual(frames[2].moveX, 0);
  assert.strictEqual(frames[2].moveY, 0);
  // ...but its aim points from P3's own sim position at the crosshair.
  assert.strictEqual(frames[2].aimX, 1);
  assert.strictEqual(frames[2].aimY, 0);
});
