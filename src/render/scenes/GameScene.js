import Phaser from 'phaser';
import { createInitialState } from '../../sim/state.js';
import { step } from '../../sim/step.js';
import { printRoundLog } from '../../sim/log.js';
import { TICK_RATE } from '../../sim/config/balance.js';
import { GAMEPAD_BUTTON_A } from '../../input/gamepad.js';
import { createArenaRenderer } from '../arenaRenderer.js';
import { createPlayerRenderer } from '../players/playerRenderer.js';
import { createFxRenderer } from '../fx/fxRenderer.js';
import { createHud, updateHud, updateDisconnectBanner } from '../hud.js';
import { createHitboxOverlay } from '../debug/hitboxOverlay.js';
import { PALETTE } from '../art/palette.js';
import { PIXEL_FONT_FAMILY } from '../art/font.js';

const MS_PER_TICK = 1000 / TICK_RATE;
const MAX_TICKS_PER_FRAME = 6; // clamps the simulation if a frame stalls badly

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init({ deviceManager, characterIds, boostAllocations }) {
    this.deviceManager = deviceManager;
    this.characterIds = characterIds;
    // Fixed for the whole match, including a rematch from the match-over screen.
    this.boostAllocations = boostAllocations;
  }

  create() {
    this.state = createInitialState((Date.now() ^ 0) >>> 0, this.characterIds, this.boostAllocations);
    this.accumulatorMs = 0;

    this.arena = createArenaRenderer(this);
    this.playerRenderer = createPlayerRenderer(this);
    this.fxRenderer = createFxRenderer(this);
    this.hud = createHud(this);
    this.hitboxOverlay = createHitboxOverlay(this);

    this.keys = this.input.keyboard.addKeys({
      w: Phaser.Input.Keyboard.KeyCodes.W,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      q: Phaser.Input.Keyboard.KeyCodes.Q,
      e: Phaser.Input.Keyboard.KeyCodes.E,
      r: Phaser.Input.Keyboard.KeyCodes.R,
    });
    this.mouseDown = false;
    this.input.on('pointerdown', (p) => {
      if (p.leftButtonDown()) this.mouseDown = true;
    });
    this.input.on('pointerup', () => {
      this.mouseDown = false;
    });

    // Crosshair for the keyboard/mouse-controlled player, in that player's color.
    this.crosshair = this.add
      .text(0, 0, '+', { fontFamily: PIXEL_FONT_FAMILY, fontSize: '16px', color: PALETTE.uiText })
      .setDepth(10001);
    this.crosshair.setVisible(false);

    this.input.keyboard.on('keydown-F1', () => {
      this.deviceManager.toggleDebug();
    });
    this.input.keyboard.on('keydown-F3', () => {
      this.debugHitboxesVisible = !this.debugHitboxesVisible;
      this.hitboxOverlay.setVisible(this.debugHitboxesVisible);
    });

    if (this.input.gamepad) {
      this.input.gamepad.on('down', (pad, button) => {
        if (this.state.roundState === 'matchOver' && button.index === GAMEPAD_BUTTON_A) this._rematch();
      });
    }
    this.input.keyboard.on('keydown-SPACE', () => {
      if (this.state.roundState === 'matchOver') this._rematch();
    });
  }

  _rematch() {
    this.state = createInitialState((Date.now() ^ 0) >>> 0, this.characterIds, this.boostAllocations);
    this.accumulatorMs = 0;
  }

  _pointerScreen() {
    const p = this.input.activePointer;
    return { x: p.x, y: p.y };
  }

  update(time, delta) {
    this.accumulatorMs += delta;
    let ticks = 0;
    while (this.accumulatorMs >= MS_PER_TICK && ticks < MAX_TICKS_PER_FRAME) {
      this._tick();
      this.accumulatorMs -= MS_PER_TICK;
      ticks++;
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.accumulatorMs = 0; // avoid runaway catch-up

    this.arena.update(this.state.tick);
    this.playerRenderer.update(this.state);
    this.fxRenderer.update(this.state);
    updateHud(this.hud, this.state);
    updateDisconnectBanner(this.hud, this.deviceManager.disconnectedSlots);
    this.hitboxOverlay.update(this.state);
    this._updateCrosshair();
  }

  _tick() {
    const playersWorld = this.state.players.map((p) => ({ x: p.x, y: p.y }));
    const keys = {
      w: this.keys.w.isDown,
      a: this.keys.a.isDown,
      s: this.keys.s.isDown,
      d: this.keys.d.isDown,
      q: this.keys.q.isDown,
      e: this.keys.e.isDown,
      r: this.keys.r.isDown,
    };
    const gamepadList = this.input.gamepad?.gamepads || [];
    const frames = this.deviceManager.buildFrames(gamepadList, keys, this._pointerScreen(), this.mouseDown, playersWorld);

    const prevLogCount = this.state.logs.length;
    this.state = step(this.state, frames);
    if (this.state.logs.length > prevLogCount && this.state.pendingLogPrint) {
      printRoundLog(this.state.pendingLogPrint);
    }
  }

  _updateCrosshair() {
    const kmSlot = this.deviceManager.debugMode
      ? this.deviceManager.debugPlayerIndex
      : this.deviceManager.slots.findIndex((s) => s && s.kind === 'keyboardMouse');
    if (kmSlot === -1) {
      this.crosshair.setVisible(false);
      return;
    }
    const p = this.input.activePointer;
    this.crosshair.setPosition(p.x - 6, p.y - 10);
    this.crosshair.setVisible(true);
  }
}
