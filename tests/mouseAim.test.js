import test from 'node:test';
import assert from 'node:assert/strict';
import { step, newPlayingGame, clearInvuln, makeInput } from './helpers.js';
import {
  screenToWorld,
  worldToScreenX,
  worldToScreenY,
  CANVAS_WIDTH_PX,
  CANVAS_HEIGHT_PX,
} from '../src/render/coords.js';
import { readKeyboardMouseFrame } from '../src/input/keyboardMouse.js';
import { readGamepadFrame } from '../src/input/gamepad.js';
import { shootConfigFor } from '../src/sim/config/balance.js';

const NO_KEYS = { w: false, a: false, s: false, d: false, q: false, e: false, r: false };

/**
 * A model of the full browser -> Phaser pointer pipeline, so the round trip can
 * be exercised at window sizes/aspect ratios/zooms that a Node test can't
 * actually open.
 *
 * Forward:  world tiles -> game px -> camera -> canvas px -> page client px
 * Backward: page client px -> pointer.x/y (ScaleManager) -> pointer.worldX/Y (Camera)
 *
 * devicePixelRatio is deliberately absent: it only changes the canvas backing
 * store, never the game-resolution coordinates Phaser reports on the Pointer,
 * so it cannot enter this conversion.
 */
function makeDisplay({ displayW, displayH, canvasLeft = 0, canvasTop = 0, zoom = 1, scrollX = 0, scrollY = 0 }) {
  const fit = Math.min(displayW / CANVAS_WIDTH_PX, displayH / CANVAS_HEIGHT_PX); // Scale.FIT
  const letterboxX = (displayW - CANVAS_WIDTH_PX * fit) / 2; // Scale.CENTER_BOTH
  const letterboxY = (displayH - CANVAS_HEIGHT_PX * fit) / 2;
  const centerX = CANVAS_WIDTH_PX / 2;
  const centerY = CANVAS_HEIGHT_PX / 2;

  return {
    worldTileToClient(tile) {
      const gameX = worldToScreenX(tile.x);
      const gameY = worldToScreenY(tile.y);
      const canvasX = (gameX - scrollX - centerX) * zoom + centerX;
      const canvasY = (gameY - scrollY - centerY) * zoom + centerY;
      return { x: canvasLeft + letterboxX + canvasX * fit, y: canvasTop + letterboxY + canvasY * fit };
    },
    clientToPointer(client) {
      const canvasX = (client.x - canvasLeft - letterboxX) / fit;
      const canvasY = (client.y - canvasTop - letterboxY) / fit;
      return {
        x: canvasX,
        y: canvasY,
        worldX: (canvasX - centerX) / zoom + scrollX + centerX,
        worldY: (canvasY - centerY) / zoom + scrollY + centerY,
      };
    },
  };
}

const DISPLAY_CONFIGS = [
  { name: '1:1, no scaling', displayW: CANVAS_WIDTH_PX, displayH: CANVAS_HEIGHT_PX },
  { name: 'small window, letterboxed', displayW: 640, displayH: 480 },
  { name: 'maximized 16:9', displayW: 1920, displayH: 1080 },
  { name: 'ultrawide (pillarboxed)', displayW: 2560, displayH: 800 },
  { name: 'portrait (letterboxed)', displayW: 800, displayH: 1400 },
  { name: 'canvas offset inside the page', displayW: 1280, displayH: 720, canvasLeft: 137, canvasTop: 42 },
  { name: 'camera zoom 2x', displayW: 1280, displayH: 720, zoom: 2 },
  { name: 'camera zoom 2x + scroll', displayW: 1280, displayH: 720, zoom: 2, scrollX: 40, scrollY: -25 },
];

const WORLD_POINTS = [
  { x: 0, y: 0 },
  { x: 12, y: 8 },
  { x: 23.5, y: 15.5 },
  { x: 5.25, y: 3.75 },
  { x: 1, y: 14 },
];

test('screenToWorld round-trips world -> screen -> world at every window size, aspect and zoom', () => {
  for (const config of DISPLAY_CONFIGS) {
    const display = makeDisplay(config);
    for (const point of WORLD_POINTS) {
      const client = display.worldTileToClient(point);
      const back = screenToWorld(display.clientToPointer(client));
      assert.ok(
        Math.abs(back.x - point.x) < 0.01,
        `${config.name}: x drifted ${back.x - point.x} tiles at (${point.x}, ${point.y})`
      );
      assert.ok(
        Math.abs(back.y - point.y) < 0.01,
        `${config.name}: y drifted ${back.y - point.y} tiles at (${point.x}, ${point.y})`
      );
    }
  }
});

test('screenToWorld is the exact inverse of worldToScreen, including the 1-tile wall-ring margin', () => {
  // The regression that caused the bug: input/ converted tiles -> px without
  // the world margin the art pass added, putting its idea of the player one
  // tile up-left of where the renderer actually drew them.
  const point = { x: 7, y: 3 };
  const back = screenToWorld({ worldX: worldToScreenX(point.x), worldY: worldToScreenY(point.y) });
  assert.strictEqual(back.x, point.x);
  assert.strictEqual(back.y, point.y);
});

test('clicking the pixel a target is drawn on produces an aim vector that hits it in the sim', () => {
  const shooter = { x: 5, y: 2 };
  const target = { x: 15, y: 2 }; // the y = 2 lane is clear of every cover block

  for (const config of DISPLAY_CONFIGS) {
    const display = makeDisplay(config);

    let state = newPlayingGame(21, ['sniper', 'berserker', 'summoner']);
    clearInvuln(state);
    state.players[0].x = shooter.x;
    state.players[0].y = shooter.y;
    state.players[1].x = target.x;
    state.players[1].y = target.y;
    state.players[2].x = 5;
    state.players[2].y = 14;

    // Point the mouse exactly at the pixel the renderer draws the target on.
    const client = display.worldTileToClient(target);
    const aimWorld = screenToWorld(display.clientToPointer(client));

    const frame = readKeyboardMouseFrame(NO_KEYS, aimWorld, state.players[0], true);
    assert.ok(Math.abs(frame.aimY) < 1e-6, `${config.name}: aim should be dead level, got ${frame.aimY}`);
    assert.ok(Math.abs(frame.aimX - 1) < 1e-6, `${config.name}: aim should point straight at the target`);

    state = step(state, [frame, makeInput(), makeInput()]);
    for (let i = 0; i < 90; i++) state = step(state, [makeInput(), makeInput(), makeInput()]);

    assert.strictEqual(
      state.players[1].damageTaken,
      shootConfigFor(state.players[0].characterId).damage,
      `${config.name}: the shot should land on the clicked target`
    );
  }
});

test('mouse aim is computed from the sim position, so a diagonal click aims diagonally', () => {
  const player = { x: 10, y: 8 };
  const aimWorld = { x: 13, y: 11 }; // +3, +3 => exactly 45 degrees
  const frame = readKeyboardMouseFrame(NO_KEYS, aimWorld, player, false);

  const expected = 1 / Math.SQRT2;
  assert.ok(Math.abs(frame.aimX - expected) < 1e-12);
  assert.ok(Math.abs(frame.aimY - expected) < 1e-12);
});

test('gamepad aim is untouched by the conversion: direction only, no position involved', () => {
  const pad = { leftStick: { x: 0, y: 0 }, rightStick: { x: 0, y: -1 }, R2: 0, R1: false, L1: false };
  const frame = readGamepadFrame(pad);

  assert.strictEqual(frame.aimX, 0);
  assert.strictEqual(frame.aimY, -1);
  // readGamepadFrame takes only the pad — there is no screen/world coordinate
  // in its signature at all, so display geometry cannot affect it.
  assert.strictEqual(readGamepadFrame.length, 1);
});
