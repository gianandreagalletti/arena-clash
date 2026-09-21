import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceManager } from '../src/input/deviceManager.js';

test('device manager: join/leave slot assignment logic', () => {
  const manager = new DeviceManager();

  const pad0 = { index: 0, connected: true };
  const pad1 = { index: 1, connected: true };
  const kmDevice = { kind: 'keyboardMouse' };

  const gp0 = { kind: 'gamepad', pad: pad0 };
  const gp1 = { kind: 'gamepad', pad: pad1 };

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

test('device manager: same device (gamepad by index) not double-counted', () => {
  const manager = new DeviceManager();

  const pad0 = { index: 0, connected: true };
  const gp0_ref1 = { kind: 'gamepad', pad: pad0 };
  const gp0_ref2 = { kind: 'gamepad', pad: pad0 }; // Different object, same pad.index

  // First reference joins.
  let idx = manager.join(gp0_ref1);
  assert.strictEqual(idx, 0);

  // Second reference is seen as the same device (same pad.index).
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
