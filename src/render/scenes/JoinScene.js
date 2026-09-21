import Phaser from 'phaser';
import { DeviceManager } from '../../input/deviceManager.js';
import { CHARACTERS, CHARACTER_IDS } from '../../sim/config/balance.js';
import { GAMEPAD_BUTTON_A, GAMEPAD_BUTTON_B, GAMEPAD_BUTTON_START } from '../../input/gamepad.js';

const SLOT_CHARACTERS = readCharacterAssignment();

// Hardcoded character selection this week: ?p1=sniper&p2=berserker&p3=summoner (falls back to defaults).
function readCharacterAssignment() {
  const params = new URLSearchParams(window.location.search);
  const fallback = ['sniper', 'berserker', 'summoner'];
  return [0, 1, 2].map((i) => {
    const v = params.get(`p${i + 1}`);
    return CHARACTER_IDS.includes(v) ? v : fallback[i];
  });
}

export default class JoinScene extends Phaser.Scene {
  constructor() {
    super('JoinScene');
  }

  create() {
    this.deviceManager = new DeviceManager();
    this.characterAssignment = SLOT_CHARACTERS;

    this.add
      .text(this.scale.width / 2, 40, 'ARENA CLASH', { fontFamily: 'monospace', fontSize: '36px', color: '#fff' })
      .setOrigin(0.5);
    this.add
      .text(this.scale.width / 2, 80, 'Gamepad: A to join, B to leave  |  Keyboard/Mouse: Enter/Click to join, Esc to leave', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5);
    this.add
      .text(this.scale.width / 2, 100, 'Once all 3 slots are filled, press Start / Space to begin  |  F1: debug solo  |  F2: gamepad debug', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#666666',
      })
      .setOrigin(0.5);

    this.slotTexts = [0, 1, 2].map((i) =>
      this.add
        .text(this.scale.width / 2, 180 + i * 60, '', { fontFamily: 'monospace', fontSize: '22px', color: '#ffffff' })
        .setOrigin(0.5)
    );

    this.statusText = this.add
      .text(this.scale.width / 2, this.scale.height - 40, '', { fontFamily: 'monospace', fontSize: '14px', color: '#ffcc66' })
      .setOrigin(0.5);

    this.debugOverlay = this.add
      .text(10, 10, '', { fontFamily: 'monospace', fontSize: '12px', color: '#ffff00' })
      .setScrollFactor(0)
      .setDepth(100);
    this.debugOverlayVisible = false;

    // Track button state for edge-detection (previous frame).
    this.prevPadState = new Map();

    this._wireKeyboardMouse();

    this.input.keyboard.on('keydown-F2', () => {
      this.debugOverlayVisible = !this.debugOverlayVisible;
    });

    this._refresh();
  }

  update() {
    this._pollGamepads();
    if (this.debugOverlayVisible) {
      this._updateDebugOverlay();
    } else {
      this.debugOverlay.setText('');
    }
  }

  _pollGamepads() {
    if (!this.input.gamepad || !this.input.gamepad.gamepads) return;

    for (const pad of this.input.gamepad.gamepads) {
      if (!pad) continue;

      const padId = pad.index;
      const device = { kind: 'gamepad', pad };

      if (!this.prevPadState.has(padId)) {
        this.prevPadState.set(padId, {
          A: false,
          B: false,
          Start: false,
        });
      }
      const prev = this.prevPadState.get(padId);

      // Detect button transitions (false -> true).
      const now_A = pad.buttons[GAMEPAD_BUTTON_A].pressed;
      const now_B = pad.buttons[GAMEPAD_BUTTON_B].pressed;
      const now_Start = pad.buttons[GAMEPAD_BUTTON_START].pressed;

      if (now_A && !prev.A) {
        this.deviceManager.join(device);
        this._refresh();
      }
      if (now_B && !prev.B) {
        this.deviceManager.leave(device);
        this._refresh();
      }
      if (now_Start && !prev.Start) {
        this._tryStart();
      }

      prev.A = now_A;
      prev.B = now_B;
      prev.Start = now_Start;
    }
  }

  _updateDebugOverlay() {
    const lines = [];
    if (!this.input.gamepad || !this.input.gamepad.gamepads) {
      lines.push('Gamepad support: not available');
    } else {
      lines.push(`Detected ${this.input.gamepad.gamepads.filter(p => p).length} pad(s)`);
      for (const pad of this.input.gamepad.gamepads) {
        if (!pad) continue;
        lines.push(
          `Pad ${pad.index} (${pad.id}): A=${pad.buttons[0].pressed} B=${pad.buttons[1].pressed} ` +
          `Start=${pad.buttons[9].pressed} LStick=(${pad.axes[0].toFixed(2)},${pad.axes[1].toFixed(2)}) ` +
          `RStick=(${pad.axes[2].toFixed(2)},${pad.axes[3].toFixed(2)})`
        );
      }
    }
    this.debugOverlay.setText(lines.join('\n'));
  }

  _wireKeyboardMouse() {
    const kmDevice = { kind: 'keyboardMouse' };

    this.input.keyboard.on('keydown-ENTER', () => {
      this.deviceManager.join(kmDevice);
      this._refresh();
    });
    this.input.keyboard.on('keydown-ESC', () => {
      this.deviceManager.leave(kmDevice);
      this._refresh();
    });
    this.input.keyboard.on('keydown-SPACE', () => this._tryStart());
    this.input.on('pointerdown', () => {
      this.deviceManager.join(kmDevice);
      this._refresh();
    });

    this.input.keyboard.on('keydown-F1', () => {
      this.deviceManager.toggleDebug();
      if (this.deviceManager.debugMode) {
        this._startMatch();
      } else {
        this._refresh();
      }
    });
  }

  _tryStart() {
    if (this.deviceManager.allSlotsFilled()) this._startMatch();
  }

  _startMatch() {
    this.scene.start('GameScene', {
      deviceManager: this.deviceManager,
      characterIds: this.characterAssignment,
    });
  }

  _refresh() {
    this.slotTexts.forEach((text, i) => {
      const device = this.deviceManager.slots[i];
      const charName = CHARACTERS[this.characterAssignment[i]].name;
      const label = device
        ? device.kind === 'gamepad'
          ? `P${i + 1} [${charName}]: Gamepad ${device.pad.index + 1}`
          : `P${i + 1} [${charName}]: Keyboard/Mouse`
        : `P${i + 1} [${charName}]: -- empty --`;
      text.setText(label);
      text.setColor(device ? '#66ff88' : '#888888');
    });

    this.statusText.setText(
      this.deviceManager.allSlotsFilled() ? 'All slots filled — press Start / Space' : 'Waiting for players...'
    );
  }
}
