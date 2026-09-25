import Phaser from 'phaser';
import { createInitialState } from '../../sim/state.js';
import { step } from '../../sim/step.js';
import { printRoundLog } from '../../sim/log.js';
import { TICK_RATE } from '../../sim/config/balance.js';
import { GAMEPAD_BUTTON_A } from '../../input/gamepad.js';
import { createArenaRenderer } from '../arenaRenderer.js';
import { createPlayerRenderer } from '../players/playerRenderer.js';
import { createDogRenderer } from '../dogRenderer.js';
import { createItemRenderer } from '../itemRenderer.js';
import { createFxRenderer } from '../fx/fxRenderer.js';
import { createHud, updateHud, updateDisconnectBanner } from '../hud.js';
import { createHitboxOverlay } from '../debug/hitboxOverlay.js';
import { screenToWorld, worldToScreenX, worldToScreenY } from '../coords.js';
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
    this.dogRenderer = createDogRenderer(this);
    this.itemRenderer = createItemRenderer(this);
    this.fxRenderer = createFxRenderer(this);
    this.frameEvents = { meleeSwings: [], novaBlasts: [], explosions: [] };
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
      f: Phaser.Input.Keyboard.KeyCodes.F,
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

  /** The crosshair as a world point, in tiles. The single source for both the sim and the drawn crosshair. */
  _aimWorld() {
    return screenToWorld(this.input.activePointer);
  }

  /** Which slot the keyboard/mouse drives, or -1. */
  _keyboardMouseSlot() {
    return this.deviceManager.debugMode
      ? this.deviceManager.debugPlayerIndex
      : this.deviceManager.slots.findIndex((s) => s && s.kind === 'keyboardMouse');
  }

  /** Aim-chain markers for the F3 overlay, or null when nobody is on mouse aim. */
  _aimDebugInfo() {
    const slot = this._keyboardMouseSlot();
    if (slot === -1) return null;
    return {
      player: this.state.players[slot],
      aimWorld: this._aimWorld(),
      pointer: this.input.activePointer,
    };
  }

  update(time, delta) {
    // Transient sim events (melee swings, nova blasts) only live for the tick
    // that produced them, and this loop can run several ticks per rendered
    // frame. Collect them all so no FX is silently dropped during catch-up.
    this.frameEvents = { meleeSwings: [], novaBlasts: [], explosions: [] };

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
    this.dogRenderer.update(this.state);
    this.itemRenderer.update(this.state);
    this.fxRenderer.update(this.state, this.frameEvents);
    updateHud(this.hud, this.state);
    updateDisconnectBanner(this.hud, this.deviceManager.disconnectedSlots);
    this.hitboxOverlay.update(this.state, this._aimDebugInfo());
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
      f: this.keys.f.isDown,
    };
    const gamepadList = this.input.gamepad?.gamepads || [];
    const frames = this.deviceManager.buildFrames(gamepadList, keys, this._aimWorld(), this.mouseDown, playersWorld);

    const prevLogCount = this.state.logs.length;
    this.state = step(this.state, frames);

    // Drain this tick's transient events before the next step() clears them.
    if (this.state.meleeSwings.length) this.frameEvents.meleeSwings.push(...this.state.meleeSwings);
    if (this.state.novaBlasts.length) this.frameEvents.novaBlasts.push(...this.state.novaBlasts);
    if (this.state.explosions.length) this.frameEvents.explosions.push(...this.state.explosions);

    if (this.state.logs.length > prevLogCount && this.state.pendingLogPrint) {
      printRoundLog(this.state.pendingLogPrint);
    }
  }

  _updateCrosshair() {
    if (this._keyboardMouseSlot() === -1) {
      this.crosshair.setVisible(false);
      return;
    }
    // Drawn by converting the SAME world point the sim aims at back to screen,
    // rather than from raw pointer pixels — so the crosshair and the shot can
    // never disagree, whatever happens to canvas scaling or the camera.
    const aim = this._aimWorld();
    this.crosshair.setPosition(worldToScreenX(aim.x) - 6, worldToScreenY(aim.y) - 10);
    this.crosshair.setVisible(true);
  }
}
