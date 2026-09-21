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
      .text(this.scale.width / 2, 26, 'BOOST ALLOCATION', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    this.add
      .text(this.scale.width / 2, 56, `Spend ${BOOST_POINTS_PER_PLAYER} points — fixed for the whole match`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5);
    this.add
      .text(this.scale.width / 2, 76, 'Gamepad: D-pad/stick select · A add · B remove · Start ready', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#666666',
      })
      .setOrigin(0.5);
    this.add
      .text(this.scale.width / 2, 92, 'Keyboard: Up/Down select · Right add · Left remove · Enter ready', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#666666',
      })
      .setOrigin(0.5);

    const columnWidth = this.scale.width / 3;
    this.playerTexts = [0, 1, 2].map((i) =>
      this.add
        .text(columnWidth * i + columnWidth / 2, 140, '', {
          fontFamily: 'monospace',
          fontSize: '15px',
          color: '#ffffff',
          align: 'left',
        })
        .setOrigin(0.5, 0)
    );

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
    for (let i = 0; i < 3; i++) {
      const def = CHARACTERS[this.characterIds[i]];
      const allocation = this.allocations[i];
      const hasDevice = !!this._deviceForSlot(i);

      const lines = [`P${i + 1} ${def.name}`, `Points left: ${pointsRemaining(allocation)}`, ''];

      BOOST_CATEGORIES.forEach((category, c) => {
        const selected = !this.ready[i] && hasDevice && this.cursors[i] === c;
        const points = allocation[category];
        const bonusPct = Math.round(BOOST_BONUS_PER_POINT[category] * points * 100);
        const bar = '#'.repeat(points) + '.'.repeat(BOOST_POINTS_PER_PLAYER - points);
        lines.push(`${selected ? '>' : ' '} ${CATEGORY_LABELS[category].padEnd(10)} ${bar} +${bonusPct}%`);
      });

      lines.push('');
      if (!hasDevice) {
        lines.push('(no device — auto)');
      } else {
        lines.push(this.ready[i] ? 'READY' : 'not ready');
      }

      this.playerTexts[i].setText(lines.join('\n'));
      this.playerTexts[i].setColor(this.ready[i] ? '#66ff88' : def.color);
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
