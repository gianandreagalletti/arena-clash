import Phaser from 'phaser';
import {
  CHARACTERS,
  BOOST_CATEGORIES,
  BOOST_BONUS_PER_POINT,
  BOOST_POINTS_PER_PLAYER,
} from '../../sim/config/balance.js';
import {
  createAllocation,
  addPoint,
  removePoint,
  moveCursor,
  pointsRemaining,
  CATEGORY_LABELS,
} from '../../input/boostAllocation.js';
import { EdgeTracker, readGamepadMenuRaw, readKeyboardMenuRaw } from '../../input/menuInput.js';
import { PALETTE } from '../art/palette.js';
import { PIXEL_FONT_FAMILY } from '../art/font.js';
import { drawPanel, pixelTextStyle } from '../ui/panel.js';

function colorInt(hex) {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

// Shared pre-match screen: all 3 players spend their points at the same time,
// everyone's allocation visible to everyone. Runs between the join screen and
// the Round 1 countdown.
export default class BoostScene extends Phaser.Scene {
  constructor() {
    super('BoostScene');
  }

  init({ deviceManager, characterIds }) {
    this.deviceManager = deviceManager;
    this.characterIds = characterIds;
  }

  create() {
    this.allocations = [createAllocation(), createAllocation(), createAllocation()];
    this.cursors = [0, 0, 0];
    this.ready = [false, false, false];
    this.started = false;
    this.edgeTracker = new EdgeTracker();

    // Slots with no device (e.g. F1 debug solo mode) can't spend points, so
    // they start ready at zero rather than blocking the match forever.
    for (let i = 0; i < 3; i++) {
      if (!this._deviceForSlot(i)) this.ready[i] = true;
    }

    this.add
      .text(this.scale.width / 2, 22, 'BOOST ALLOCATION', pixelTextStyle(PIXEL_FONT_FAMILY, 20, PALETTE.torchCore))
      .setOrigin(0.5);
    this.add
      .text(
        this.scale.width / 2,
        50,
        `SPEND ${BOOST_POINTS_PER_PLAYER} POINTS — FIXED FOR THE WHOLE MATCH`,
        pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.uiTextMuted)
      )
      .setOrigin(0.5);
    this.add
      .text(
        this.scale.width / 2,
        70,
        'GAMEPAD: D-PAD/STICK SELECT · A ADD · B REMOVE · START READY',
        pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.uiTextMuted)
      )
      .setOrigin(0.5);
    this.add
      .text(
        this.scale.width / 2,
        86,
        'KEYBOARD: UP/DOWN SELECT · RIGHT ADD · LEFT REMOVE · ENTER READY',
        pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.uiTextMuted)
      )
      .setOrigin(0.5);

    const columnWidth = this.scale.width / 3;
    const panelW = columnWidth - 20;
    const panelH = 190;
    const panelTop = 112;
    this.panelBg = this.add.graphics();

    this.playerHeaderTexts = [0, 1, 2].map((i) =>
      this.add
        .text(columnWidth * i + columnWidth / 2, panelTop + 8, '', pixelTextStyle(PIXEL_FONT_FAMILY, 10))
        .setOrigin(0.5, 0)
    );
    this.playerPointsTexts = [0, 1, 2].map((i) =>
      this.add
        .text(columnWidth * i + columnWidth / 2, panelTop + 26, '', pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.uiTextMuted))
        .setOrigin(0.5, 0)
    );
    this.categoryLabelTexts = [0, 1, 2].map((i) =>
      [0, 1, 2, 3].map((c) =>
        this.add
          .text(columnWidth * i + 14, panelTop + 46 + c * 30, '', pixelTextStyle(PIXEL_FONT_FAMILY, 8))
          .setOrigin(0, 0)
      )
    );
    this.categoryBarBg = this.add.graphics();
    this.statusTexts = [0, 1, 2].map((i) =>
      this.add
        .text(columnWidth * i + columnWidth / 2, panelTop + panelH - 20, '', pixelTextStyle(PIXEL_FONT_FAMILY, 10))
        .setOrigin(0.5, 0)
    );

    this._layout = { columnWidth, panelW, panelH, panelTop };

    this.arrowKeys = this.input.keyboard.createCursorKeys();
    this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    this._refresh();
  }

  /** The device driving slot `i`, or null if nobody is on it. */
  _deviceForSlot(i) {
    if (this.deviceManager.debugMode) {
      return i === this.deviceManager.debugPlayerIndex ? { kind: 'keyboardMouse' } : null;
    }
    return this.deviceManager.slots[i];
  }

  update() {
    const gamepadList = this.input.gamepad?.gamepads || [];

    for (let i = 0; i < 3; i++) {
      const device = this._deviceForSlot(i);
      if (!device) continue;

      let raw;
      let deviceKey;
      if (device.kind === 'gamepad') {
        const pad = gamepadList[device.padIndex];
        if (!pad || !pad.connected) continue;
        raw = readGamepadMenuRaw(pad);
        deviceKey = `pad${device.padIndex}`;
      } else {
        raw = readKeyboardMenuRaw(this.arrowKeys, this.enterKey);
        deviceKey = 'keyboardMouse';
      }

      const edge = this.edgeTracker.edges(deviceKey, raw);

      if (edge.ready) this.ready[i] = !this.ready[i];
      if (this.ready[i]) continue; // locked in; un-ready to keep editing

      if (edge.up) this.cursors[i] = moveCursor(this.cursors[i], -1);
      if (edge.down) this.cursors[i] = moveCursor(this.cursors[i], 1);

      const category = BOOST_CATEGORIES[this.cursors[i]];
      if (edge.add) this.allocations[i] = addPoint(this.allocations[i], category);
      if (edge.remove) this.allocations[i] = removePoint(this.allocations[i], category);
    }

    this._refresh();

    if (!this.started && this.ready.every(Boolean)) {
      this.started = true;
      this._startMatch();
    }
  }

  _refresh() {
    const { columnWidth, panelW, panelH, panelTop } = this._layout;
    this.panelBg.clear();
    this.categoryBarBg.clear();

    for (let i = 0; i < 3; i++) {
      const def = CHARACTERS[this.characterIds[i]];
      const allocation = this.allocations[i];
      const hasDevice = !!this._deviceForSlot(i);
      const panelX = columnWidth * i + 10;

      drawPanel(this.panelBg, panelX, panelTop, panelW, panelH);

      this.playerHeaderTexts[i].setText(`P${i + 1} ${def.name.toUpperCase()}`);
      this.playerHeaderTexts[i].setColor(this.ready[i] ? '#66FF88' : def.color);
      this.playerPointsTexts[i].setText(
        hasDevice ? `POINTS LEFT: ${pointsRemaining(allocation)}` : 'NO DEVICE — AUTO'
      );

      BOOST_CATEGORIES.forEach((category, c) => {
        const selected = !this.ready[i] && hasDevice && this.cursors[i] === c;
        const points = allocation[category];
        const bonusPct = Math.round(BOOST_BONUS_PER_POINT[category] * points * 100);

        const label = this.categoryLabelTexts[i][c];
        label.setText(`${selected ? '>' : ' '} ${CATEGORY_LABELS[category]} +${bonusPct}%`);
        label.setColor(selected ? PALETTE.torchCore : PALETTE.uiText);

        const barY = panelTop + 60 + c * 30;
        const barX = columnWidth * i + 14;
        const segW = 12;
        const segGap = 1;
        for (let s = 0; s < BOOST_POINTS_PER_PLAYER; s++) {
          const filled = s < points;
          this.categoryBarBg.fillStyle(filled ? colorInt(def.color) : 0x000000, filled ? 1 : 0.6);
          this.categoryBarBg.fillRect(barX + s * (segW + segGap), barY, segW, 6);
        }
      });

      this.statusTexts[i].setText(hasDevice ? (this.ready[i] ? 'READY' : 'NOT READY') : 'READY (AUTO)');
      this.statusTexts[i].setColor(this.ready[i] ? '#66FF88' : PALETTE.uiTextMuted);
    }
  }

  _startMatch() {
    this.scene.start('GameScene', {
      deviceManager: this.deviceManager,
      characterIds: this.characterIds,
      boostAllocations: this.allocations,
    });
  }
}
