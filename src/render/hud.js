// Restyled HUD: pixel-font panels, segmented HP bar + number, ult bar, round
// pips. Same information as the placeholder HUD, just repainted. Reads state
// only; all Text/Graphics objects are created once and updated in place.

import Phaser from 'phaser';
import { TICK_RATE, ROUNDS_TO_WIN_MATCH, CHARACTERS } from '../sim/config/balance.js';
import { CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX } from './coords.js';
import { PALETTE, paletteKeyForCharacterColor } from './art/palette.js';
import { PIXEL_FONT_FAMILY } from './art/font.js';
import { drawPanel, pixelTextStyle } from './ui/panel.js';

const PANEL_W = 168;
const PANEL_H = 52;
const PANEL_MARGIN = 8;
const HP_SEGMENTS = 10;

function colorInt(hex) {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

function makePlayerPanel(scene, index) {
  const x = PANEL_MARGIN;
  const y = PANEL_MARGIN + index * (PANEL_H + 6);

  const graphics = scene.add.graphics().setScrollFactor(0).setDepth(10000);
  const nameText = scene.add
    .text(x + 6, y + 4, '', pixelTextStyle(PIXEL_FONT_FAMILY, 8))
    .setScrollFactor(0)
    .setDepth(10001);
  const hpText = scene.add
    .text(x + PANEL_W - 6, y + 4, '', pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.uiText))
    .setOrigin(1, 0)
    .setScrollFactor(0)
    .setDepth(10001);
  const shieldText = scene.add
    .text(x + 6, y + 38, '', pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.uiTextMuted))
    .setScrollFactor(0)
    .setDepth(10001);

  return { x, y, graphics, nameText, hpText, shieldText };
}

function drawHpBar(graphics, x, y, w, fraction) {
  const segW = (w - (HP_SEGMENTS - 1)) / HP_SEGMENTS;
  for (let i = 0; i < HP_SEGMENTS; i++) {
    const filled = i < Math.round(fraction * HP_SEGMENTS);
    graphics.fillStyle(filled ? colorInt('#D1382C') : 0x000000, filled ? 1 : 0.6);
    graphics.fillRect(x + i * (segW + 1), y, segW, 6);
  }
}

function drawUltBar(graphics, x, y, w, fraction) {
  graphics.fillStyle(0x000000, 0.6);
  graphics.fillRect(x, y, w, 4);
  graphics.fillStyle(colorInt(PALETTE.torchCore), 1);
  graphics.fillRect(x, y, w * fraction, 4);
}

function drawRoundPips(graphics, x, y, wins) {
  for (let i = 0; i < ROUNDS_TO_WIN_MATCH; i++) {
    const filled = i < wins;
    graphics.fillStyle(filled ? colorInt(PALETTE.torchCore) : 0x000000, filled ? 1 : 0.6);
    graphics.fillRect(x + i * 10, y, 7, 7);
    graphics.lineStyle(1, colorInt(PALETTE.uiPanelBorder), 1);
    graphics.strokeRect(x + i * 10, y, 7, 7);
  }
}

export function createHud(scene) {
  const playerPanels = [0, 1, 2].map((i) => makePlayerPanel(scene, i));

  const bannerBg = scene.add.graphics().setScrollFactor(0).setDepth(10000);
  const bannerText = scene.add
    .text(CANVAS_WIDTH_PX / 2, CANVAS_HEIGHT_PX / 2, '', {
      ...pixelTextStyle(PIXEL_FONT_FAMILY, 16, PALETTE.torchCore),
      align: 'center',
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(10001);

  const disconnectBg = scene.add.graphics().setScrollFactor(0).setDepth(10000);
  const disconnectText = scene.add
    .text(CANVAS_WIDTH_PX / 2, 6, '', pixelTextStyle(PIXEL_FONT_FAMILY, 8, '#FF5A4E'))
    .setOrigin(0.5, 0)
    .setScrollFactor(0)
    .setDepth(10001);

  return { playerPanels, bannerBg, bannerText, disconnectBg, disconnectText };
}

export function updateHud(hud, state) {
  state.players.forEach((player, i) => {
    const panel = hud.playerPanels[i];
    const def = CHARACTERS[player.characterId];

    panel.graphics.clear();
    drawPanel(panel.graphics, panel.x, panel.y, PANEL_W, PANEL_H);
    drawHpBar(panel.graphics, panel.x + 6, panel.y + 16, PANEL_W - 12, Math.max(0, player.hp / player.maxHp));
    drawUltBar(panel.graphics, panel.x + 6, panel.y + 26, PANEL_W - 12, player.ultCharge / 100);
    drawRoundPips(panel.graphics, panel.x + 6, panel.y + 34, player.roundsWon);

    panel.nameText.setText(`P${i + 1} ${def.name}`);
    panel.nameText.setColor(def.color);
    panel.hpText.setText(`${Math.ceil(player.hp)}/${Math.round(player.maxHp)}`);

    let shieldLabel;
    if (state.tick < player.shieldActiveUntilTick) shieldLabel = 'SHIELD UP';
    else if (state.tick < player.shieldReadyAtTick) {
      shieldLabel = `SHIELD ${Math.ceil((player.shieldReadyAtTick - state.tick) / TICK_RATE)}s`;
    } else shieldLabel = 'SHIELD OK';
    panel.shieldText.setText(shieldLabel);
  });

  hud.bannerBg.clear();
  let bannerLines = null;

  if (state.roundState === 'countdown') {
    const secs = Math.ceil(state.roundStateTimerTicks / 60);
    bannerLines = [`ROUND ${state.roundNumber}`, String(secs)];
  } else if (state.roundState === 'recap') {
    const log = state.logs[state.logs.length - 1];
    if (log) {
      const scores = state.players.map((p) => p.roundsWon).join(' - ');
      bannerLines = [`ROUND ${log.roundNumber}`, `P${log.winnerId + 1} WINS!`, scores];
    }
  } else if (state.roundState === 'matchOver') {
    bannerLines = [`PLAYER ${state.matchWinner + 1} WINS!`, 'PRESS A / SPACE', 'TO REMATCH'];
  }

  if (bannerLines) {
    hud.bannerText.setText(bannerLines.join('\n'));
    const bounds = hud.bannerText.getBounds();
    drawPanel(hud.bannerBg, bounds.x - 12, bounds.y - 10, bounds.width + 24, bounds.height + 20);
  } else {
    hud.bannerText.setText('');
  }
}

/** Separate from updateHud because disconnected slots live on the device manager (input/), not sim state. */
export function updateDisconnectBanner(hud, disconnectedSlotIndices) {
  hud.disconnectBg.clear();
  const names = [...disconnectedSlotIndices].map((i) => `P${i + 1}`);
  if (names.length === 0) {
    hud.disconnectText.setText('');
    return;
  }
  hud.disconnectText.setText(`${names.join(', ')} CONTROLLER DISCONNECTED`);
  const bounds = hud.disconnectText.getBounds();
  drawPanel(hud.disconnectBg, bounds.x - 8, bounds.y - 4, bounds.width + 16, bounds.height + 8);
}
