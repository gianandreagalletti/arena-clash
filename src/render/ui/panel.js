// Shared pixel-UI panel: black fill + 2px border, square corners (no 9-slice
// needed since the brief explicitly wants square corners). Used by the HUD,
// join screen and boost screen so every panel in the game matches.

import Phaser from 'phaser';
import { PALETTE } from '../art/palette.js';

const BORDER_PX = 2;

function colorInt(hex) {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

/** Draws a panel into `graphics` (caller owns clear/positioning of the Graphics object). */
export function drawPanel(graphics, x, y, w, h) {
  graphics.fillStyle(colorInt(PALETTE.uiPanelBg), 0.82);
  graphics.fillRect(x, y, w, h);
  graphics.lineStyle(BORDER_PX, colorInt(PALETTE.uiPanelBorder), 1);
  graphics.strokeRect(x + BORDER_PX / 2, y + BORDER_PX / 2, w - BORDER_PX, h - BORDER_PX);
}

/** Common pixel-font text style factory, so every UI text object matches. */
export function pixelTextStyle(fontFamily, sizePx, color = PALETTE.uiText, extra = {}) {
  return {
    fontFamily,
    fontSize: `${sizePx}px`,
    color,
    resolution: 2,
    ...extra,
  };
}
