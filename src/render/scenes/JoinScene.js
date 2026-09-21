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
      .text(this.scale.width / 2, 100, 'Once all 3 slots are filled, press Start / Space to begin  |  F1: debug solo mode', {
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

    this._wireGamepad();
    this._wireKeyboardMouse();

    this._refresh();
  }

  _wireGamepad() {
    if (!this.input.gamepad) return;
    this.input.gamepad.on('down', (pad, button) => {
      if (this.debugStarting) return;
      const device = { kind: 'gamepad', pad };
      if (button.index === GAMEPAD_BUTTON_A) {
        this.deviceManager.join(device);
        this._refresh();
      } else if (button.index === GAMEPAD_BUTTON_B) {
        this.deviceManager.leave(device);
        this._refresh();
      } else if (button.index === GAMEPAD_BUTTON_START) {
        this._tryStart();
      }
    });
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
