import Phaser from 'phaser';
import { DeviceManager } from '../../input/deviceManager.js';
import { CHARACTERS, CHARACTER_IDS } from '../../sim/config/balance.js';
import { GAMEPAD_BUTTON_A, GAMEPAD_BUTTON_B, GAMEPAD_BUTTON_START } from '../../input/gamepad.js';
import { PALETTE } from '../art/palette.js';
import { PIXEL_FONT_FAMILY } from '../art/font.js';
import { drawPanel, pixelTextStyle } from '../ui/panel.js';

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
      .text(this.scale.width / 2, 36, 'ARENA CLASH', pixelTextStyle(PIXEL_FONT_FAMILY, 24, PALETTE.torchCore))
      .setOrigin(0.5);
    this.add
      .text(
        this.scale.width / 2,
        84,
        'GAMEPAD: A JOIN, B LEAVE\nKEYBOARD/MOUSE: ENTER/CLICK JOIN, ESC LEAVE',
        { ...pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.uiTextMuted), align: 'center' }
      )
      .setOrigin(0.5);
    this.add
      .text(
        this.scale.width / 2,
        118,
        'ALL 3 SLOTS FILLED: START/SPACE  ·  F1 DEBUG SOLO  ·  F2 GAMEPAD DEBUG',
        pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.uiTextMuted)
      )
      .setOrigin(0.5);

    const slotPanelW = 300;
    const slotPanelH = 34;
    this.slotBg = this.add.graphics();
    this.slotTexts = [0, 1, 2].map((i) =>
      this.add
        .text(this.scale.width / 2, 160 + i * (slotPanelH + 10) + slotPanelH / 2, '', pixelTextStyle(PIXEL_FONT_FAMILY, 10))
        .setOrigin(0.5)
    );
    this._slotPanelLayout = { w: slotPanelW, h: slotPanelH, top: 160, gap: 10 };

    this.statusText = this.add
      .text(this.scale.width / 2, this.scale.height - 30, '', pixelTextStyle(PIXEL_FONT_FAMILY, 10, PALETTE.torchCore))
      .setOrigin(0.5);

    this.debugOverlay = this.add
      .text(10, 10, '', pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.torchCore))
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

      const padIndex = pad.index; // 0-based, stored as-is
      const device = { kind: 'gamepad', padIndex };

      if (!this.prevPadState.has(padIndex)) {
        this.prevPadState.set(padIndex, {
          A: false,
          B: false,
          Start: false,
        });
      }
      const prev = this.prevPadState.get(padIndex);

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
      const detected = this.input.gamepad.gamepads.filter(p => p).length;
      lines.push(`=== Live Browser Gamepads: ${detected} ===`);
      for (const pad of this.input.gamepad.gamepads) {
        if (!pad) continue;
        lines.push(
          `[${pad.index}] ${pad.id}: A=${pad.buttons[0].pressed} B=${pad.buttons[1].pressed} ` +
          `Start=${pad.buttons[9].pressed}`
        );
      }
    }

    lines.push('=== Assigned Slots ===');
    for (let i = 0; i < 3; i++) {
      const device = this.deviceManager.slots[i];
      const charName = CHARACTERS[this.characterAssignment[i]].name;
      if (!device) {
        lines.push(`P${i + 1} [${charName}]: empty`);
      } else if (device.kind === 'gamepad') {
        const pad = this.input.gamepad?.gamepads?.[device.padIndex];
        const padInfo = pad ? `connected` : `NOT FOUND (idx=${device.padIndex})`;
        lines.push(`P${i + 1} [${charName}]: Gamepad ${device.padIndex} ${padInfo}`);
      } else {
        lines.push(`P${i + 1} [${charName}]: Keyboard/Mouse`);
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
    // Boost allocation happens between here and the Round 1 countdown.
    this.scene.start('BoostScene', {
      deviceManager: this.deviceManager,
      characterIds: this.characterAssignment,
    });
  }

  _refresh() {
    const { w, h, top, gap } = this._slotPanelLayout;
    const panelX = this.scale.width / 2 - w / 2;
    this.slotBg.clear();

    this.slotTexts.forEach((text, i) => {
      const device = this.deviceManager.slots[i];
      const charColor = CHARACTERS[this.characterAssignment[i]].color;
      const charName = CHARACTERS[this.characterAssignment[i]].name;
      const panelY = top + i * (h + gap);

      drawPanel(this.slotBg, panelX, panelY, w, h);

      const label = device
        ? device.kind === 'gamepad'
          ? `[${charName}] GAMEPAD ${device.padIndex + 1}` // 1-based display
          : `[${charName}] KEYBOARD/MOUSE`
        : `[${charName}] -- EMPTY --`;
      text.setText(`P${i + 1}  ${label}`);
      text.setColor(device ? charColor : PALETTE.uiTextMuted);
    });

    this.statusText.setText(
      this.deviceManager.allSlotsFilled() ? 'ALL SLOTS FILLED — PRESS START / SPACE' : 'WAITING FOR PLAYERS...'
    );
  }
}
