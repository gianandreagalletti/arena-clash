import Phaser from 'phaser';
import { CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX } from '../coords.js';
import { PALETTE } from '../art/palette.js';
import { PIXEL_FONT_FAMILY } from '../art/font.js';
import { drawPanel, pixelTextStyle } from '../ui/panel.js';
import { HELP_CONTENT } from '../help/helpContent.js';
import { EdgeTracker } from '../../input/menuInput.js';
import { GAMEPAD_BUTTON_VIEW } from '../../input/bindings.js';

// Launched OVER the join or boost screen, which is paused underneath. Closing
// resumes it exactly as it was — the caller is never stopped, so slots and
// boost allocations survive untouched.
//
// This scene knows nothing about specific pickups: it iterates whatever
// render/help/helpContent.js hands it. Adding an item there needs no change here.

const MARGIN = 14;
const CONTENT_TOP = 96;
const CONTENT_BOTTOM = CANVAS_HEIGHT_PX - 34;
const ROW_ICON_X = MARGIN + 26;
const TEXT_X = MARGIN + 52;
const SCROLL_STEP = 14;
const BOB_TICKS = 24;

// Xbox-standard indices, alongside the View button from bindings.js.
const PAD_B = 1;
const PAD_LB = 4;
const PAD_RB = 5;
const PAD_DPAD_UP = 12;
const PAD_DPAD_DOWN = 13;
const PAD_DPAD_LEFT = 14;
const PAD_DPAD_RIGHT = 15;
const STICK_THRESHOLD = 0.5;

function pressed(pad, index) {
  return !!(pad.buttons[index] && pad.buttons[index].pressed);
}

export default class HelpScene extends Phaser.Scene {
  constructor() {
    super('HelpScene');
  }

  init({ returnTo }) {
    this.returnTo = returnTo;
  }

  create() {
    this.tabIndex = 0;
    this.scrollY = 0;
    this.maxScroll = 0;
    this.frameCounter = 0;
    this.edgeTracker = new EdgeTracker();
    this.closing = false;

    // Dimmed backdrop so the paused screen underneath reads as inactive.
    this.add.rectangle(0, 0, CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX, 0x000000, 0.85).setOrigin(0, 0).setDepth(0);

    const frame = this.add.graphics().setDepth(1);
    drawPanel(frame, MARGIN - 6, MARGIN - 6, CANVAS_WIDTH_PX - (MARGIN - 6) * 2, CANVAS_HEIGHT_PX - (MARGIN - 6) * 2);

    this.add
      .text(CANVAS_WIDTH_PX / 2, MARGIN + 4, 'HELP', pixelTextStyle(PIXEL_FONT_FAMILY, 16, PALETTE.torchCore))
      .setOrigin(0.5, 0)
      .setDepth(2);

    this.tabTexts = HELP_CONTENT.map((tab, i) =>
      this.add
        .text(0, MARGIN + 36, tab.title, pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.uiTextMuted))
        .setOrigin(0.5, 0)
        .setDepth(2)
    );
    this._layoutTabs();

    this.tabUnderline = this.add.graphics().setDepth(2);

    // Everything scrollable lives in this container, clipped to the content area.
    this.contentContainer = this.add.container(0, 0).setDepth(3);
    const maskShape = this.make.graphics({ x: 0, y: 0, add: false });
    maskShape.fillRect(MARGIN, CONTENT_TOP - 6, CANVAS_WIDTH_PX - MARGIN * 2, CONTENT_BOTTOM - CONTENT_TOP + 12);
    this.contentContainer.setMask(maskShape.createGeometryMask());

    this.scrollHint = this.add
      .text(CANVAS_WIDTH_PX - MARGIN, CONTENT_BOTTOM + 4, '', pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.uiTextMuted))
      .setOrigin(1, 0)
      .setDepth(2);

    this.add
      .text(
        MARGIN,
        CANVAS_HEIGHT_PX - MARGIN - 10,
        'LEFT/RIGHT or LB/RB: tab   ·   UP/DOWN: scroll   ·   ESC / B: close',
        pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.uiTextMuted)
      )
      .setDepth(2);

    this._wireKeyboard();
    this._buildTab();
  }

  _layoutTabs() {
    const slot = (CANVAS_WIDTH_PX - MARGIN * 2) / this.tabTexts.length;
    this.tabTexts.forEach((text, i) => text.setX(MARGIN + slot * i + slot / 2));
  }

  _wireKeyboard() {
    const keyboard = this.input.keyboard;
    keyboard.on('keydown-LEFT', () => this._changeTab(-1));
    keyboard.on('keydown-RIGHT', () => this._changeTab(1));
    keyboard.on('keydown-UP', () => this._scroll(-SCROLL_STEP * 2));
    keyboard.on('keydown-DOWN', () => this._scroll(SCROLL_STEP * 2));
    keyboard.on('keydown-ESC', () => this._close());
    keyboard.on('keydown-H', () => this._close()); // the key that opened it also closes it
  }

  update() {
    this.frameCounter += 1;
    this._pollGamepads();
    this._animateIcons();
  }

  _pollGamepads() {
    const pads = this.input.gamepad?.gamepads || [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const lx = pad.leftStick ? pad.leftStick.x : 0;
      const ly = pad.leftStick ? pad.leftStick.y : 0;
      const raw = {
        left: pressed(pad, PAD_DPAD_LEFT) || lx < -STICK_THRESHOLD || pressed(pad, PAD_LB),
        right: pressed(pad, PAD_DPAD_RIGHT) || lx > STICK_THRESHOLD || pressed(pad, PAD_RB),
        up: pressed(pad, PAD_DPAD_UP) || ly < -STICK_THRESHOLD,
        down: pressed(pad, PAD_DPAD_DOWN) || ly > STICK_THRESHOLD,
        close: pressed(pad, PAD_B) || pressed(pad, GAMEPAD_BUTTON_VIEW),
      };
      // EdgeTracker primes on first sight, so a button still held from the
      // screen underneath (View, to open this) cannot immediately close it.
      const edge = this.edgeTracker.edges(`pad${pad.index}`, raw);
      if (edge.left) this._changeTab(-1);
      if (edge.right) this._changeTab(1);
      if (edge.close) this._close();
      // Scrolling repeats while held, unlike the one-shot actions.
      if (raw.up) this._scroll(-SCROLL_STEP);
      if (raw.down) this._scroll(SCROLL_STEP);
    }
  }

  _changeTab(delta) {
    const count = HELP_CONTENT.length;
    this.tabIndex = (((this.tabIndex + delta) % count) + count) % count;
    this.scrollY = 0;
    this._buildTab();
  }

  _scroll(delta) {
    const next = Math.max(0, Math.min(this.maxScroll, this.scrollY + delta));
    if (next === this.scrollY) return;
    this.scrollY = next;
    this.contentContainer.setY(-this.scrollY);
  }

  _close() {
    if (this.closing) return; // one close per press, even if two devices fire
    this.closing = true;
    this.scene.stop();
    this.scene.resume(this.returnTo);
  }

  /** Icons keep the same idle bob they have on the map, so they read as the same object. */
  _animateIcons() {
    const bob = Math.floor(this.frameCounter / BOB_TICKS) % 2 === 0 ? 0 : -2;
    for (const icon of this.bobbingIcons || []) icon.setY(icon.baseY + bob);
  }

  // --- Content building ---

  _buildTab() {
    this.contentContainer.removeAll(true);
    this.contentContainer.setY(0);
    this.bobbingIcons = [];

    const tab = HELP_CONTENT[this.tabIndex];
    this.tabTexts.forEach((text, i) => {
      text.setColor(i === this.tabIndex ? PALETTE.torchCore : PALETTE.uiTextMuted);
    });
    this.tabUnderline.clear();
    const active = this.tabTexts[this.tabIndex];
    this.tabUnderline.fillStyle(Phaser.Display.Color.HexStringToColor(PALETTE.torchCore).color, 1);
    this.tabUnderline.fillRect(active.x - active.width / 2, active.y + 12, active.width, 2);

    let y = CONTENT_TOP;
    if (tab.header) y = this._addWrapped(tab.header, MARGIN, y, PALETTE.uiTextMuted, 8) + 8;

    if (tab.kind === 'controls') y = this._buildControls(tab, y);
    else if (tab.kind === 'combat') y = this._buildCombat(tab, y);
    else if (tab.kind === 'entries') y = this._buildEntries(tab, y);
    else if (tab.kind === 'legend') y = this._buildLegend(tab, y);

    if (tab.footer) y = this._addWrapped(tab.footer, MARGIN, y + 6, PALETTE.itemGold, 8);

    const visibleHeight = CONTENT_BOTTOM - CONTENT_TOP;
    this.maxScroll = Math.max(0, y - CONTENT_TOP - visibleHeight);
    this.scrollHint.setText(this.maxScroll > 0 ? 'UP/DOWN to scroll' : '');
  }

  _addText(text, x, y, color, size = 8) {
    const obj = this.add.text(x, y, text, pixelTextStyle(PIXEL_FONT_FAMILY, size, color));
    this.contentContainer.add(obj);
    return obj;
  }

  /** Adds word-wrapped text and returns the y just below it. */
  _addWrapped(text, x, y, color, size = 8) {
    const obj = this.add.text(x, y, text, {
      ...pixelTextStyle(PIXEL_FONT_FAMILY, size, color),
      wordWrap: { width: CANVAS_WIDTH_PX - x - MARGIN },
      lineSpacing: 4,
    });
    this.contentContainer.add(obj);
    return y + obj.height + 2;
  }

  _addIcon(textureKey, frame, x, y) {
    if (!this.textures.exists(textureKey)) return null;
    const sprite = frame ? this.add.sprite(x, y, textureKey, frame) : this.add.sprite(x, y, textureKey);
    sprite.baseY = y;
    this.contentContainer.add(sprite);
    this.bobbingIcons.push(sprite);
    return sprite;
  }

  _buildControls(tab, startY) {
    let y = startY;
    const col2 = MARGIN + 210;
    const col3 = MARGIN + 380;

    this._addText('ACTION', MARGIN, y, PALETTE.torchCore);
    this._addText('GAMEPAD', col2, y, PALETTE.torchCore);
    this._addText('KEYBOARD / MOUSE', col3, y, PALETTE.torchCore);
    y += 18;

    for (const binding of tab.bindings) {
      this._addText(binding.action, MARGIN, y, PALETTE.uiText);
      this._addText(binding.gamepad, col2, y, PALETTE.uiText);
      this._addText(binding.keyboard, col3, y, PALETTE.uiText);
      y += 16;
    }

    y += 10;
    this._addText('DEBUG', MARGIN, y, PALETTE.uiTextMuted);
    y += 14;
    for (const binding of tab.debugBindings) {
      this._addText(`${binding.keyboard}  ${binding.action}`, MARGIN, y, PALETTE.uiTextMuted);
      y += 13;
    }
    return y;
  }

  _buildCombat(tab, startY) {
    let y = startY;

    this._addText('ACTIONS', MARGIN, y, PALETTE.torchCore);
    y += 18;
    for (const row of tab.actionRows) {
      this._addIcon(row.textureKey, row.frame, ROW_ICON_X, y + 10);
      this._addText(row.name, TEXT_X, y, PALETTE.uiText, 10);
      this._addText(row.stats, TEXT_X + 90, y + 2, PALETTE.itemGold);
      y = this._addWrapped(row.text, TEXT_X, y + 16, PALETTE.uiTextMuted) + 8;
    }

    y += 6;
    this._addText('CHARACTERS', MARGIN, y, PALETTE.torchCore);
    y += 18;
    for (const row of tab.characterRows) {
      this._addIcon(row.textureKey, row.frame, ROW_ICON_X, y + 14);
      this._addText(row.name, TEXT_X, y, PALETTE.uiText, 10);
      this._addText(row.stats, TEXT_X + 110, y + 2, PALETTE.itemGold);
      y = this._addWrapped(row.text, TEXT_X, y + 16, PALETTE.uiTextMuted) + 10;
    }

    y += 6;
    this._addText('BOOSTS', MARGIN, y, PALETTE.torchCore);
    y += 16;
    return this._addWrapped(tab.boostLine, MARGIN, y, PALETTE.uiTextMuted);
  }

  _buildEntries(tab, startY) {
    let y = startY;
    for (const entry of tab.entries) {
      this._addIcon(entry.textureKey, entry.frame, ROW_ICON_X, y + 12);
      this._addText(entry.name, TEXT_X, y, PALETTE.uiText, 10);

      if (entry.usage) {
        const isInstant = entry.usage === 'INSTANT';
        this._addText(entry.usage, TEXT_X + 150, y + 2, isInstant ? PALETTE.uiTextMuted : PALETTE.torchCore);
      }

      y = this._addWrapped(entry.effect, TEXT_X, y + 16, PALETTE.uiText);
      if (entry.note) y = this._addWrapped(entry.note, TEXT_X, y + 1, PALETTE.uiTextMuted);

      if (entry.extraSprites) {
        let sx = TEXT_X;
        for (const extra of entry.extraSprites) {
          this._addIcon(extra.textureKey, null, sx + 10, y + 12);
          this._addText(extra.label, sx + 26, y + 8, PALETTE.uiTextMuted);
          sx += 26 + extra.label.length * 6 + 16;
        }
        y += 28;
      }
      y += 10;
    }
    return y;
  }

  _buildLegend(tab, startY) {
    let y = startY;
    for (const entry of tab.entries) {
      this._addText(entry.label, MARGIN, y, PALETTE.itemGold);
      y = this._addWrapped(entry.text, MARGIN + 150, y, PALETTE.uiTextMuted) + 6;
    }
    return y;
  }
}
