// Restyled HUD: pixel-font panels, segmented HP bar + number, ult bar, round
// pips. Same information as the placeholder HUD, just repainted. Reads state
// only; all Text/Graphics objects are created once and updated in place.

import Phaser from 'phaser';
import {
  TICK_RATE,
  ROUNDS_TO_WIN_MATCH,
  CHARACTERS,
  PICKUPS,
  AMULET_IDS,
  abilityConfig,
} from '../sim/config/balance.js';
import { CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX } from './coords.js';
import { PALETTE, paletteKeyForCharacterColor } from './art/palette.js';
import { PIXEL_FONT_FAMILY } from './art/font.js';
import { drawPanel, pixelTextStyle } from './ui/panel.js';
import { slotLabel } from './help/abilityText.js';

const PANEL_W = 168;
const PANEL_H = 90; // item slot, timed effects, skill slots and the amulet row
const PANEL_MARGIN = 8;
const HP_SEGMENTS = 10;
const SLOT_SIZE = 12;
const SKILL_ICON_SIZE = 14;

/** The timed effects a panel can show, with the field holding their expiry tick. */
const TIMED_EFFECTS = [
  { key: 'overchargeUntilTick', label: 'DMG', color: PALETTE.itemOvercharge, durationTicks: PICKUPS.temporary.overcharge.durationTicks },
  { key: 'adrenalineUntilTick', label: 'SPD', color: PALETTE.itemAdrenaline, durationTicks: PICKUPS.temporary.adrenaline.durationTicks },
  { key: 'cloakUntilTick', label: 'CLK', color: PALETTE.itemCloak, durationTicks: PICKUPS.temporary.cloak.durationTicks },
];

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
  // Two ability slots: an icon box each, with the name + cooldown text to the
  // right of them. The icons are created once and only re-textured.
  const skillIcons = [0, 1].map((slot) =>
    scene.add
      .image(x + 8 + slot * (SKILL_ICON_SIZE + 4), y + 60, 'ability-roll')
      .setOrigin(0, 0)
      .setDisplaySize(SKILL_ICON_SIZE, SKILL_ICON_SIZE)
      .setScrollFactor(0)
      .setDepth(10001)
      .setVisible(false)
  );
  const cooldownTexts = [0, 1].map(() =>
    scene.add
      .text(0, 0, '', pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.uiText))
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(10002)
      .setVisible(false)
  );
  const skillText = scene.add
    .text(x + 8 + 2 * (SKILL_ICON_SIZE + 4) + 4, y + 62, '', pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.uiText))
    .setScrollFactor(0)
    .setDepth(10001);
  const amuletText = scene.add
    .text(x + 6, y + 78, '', pixelTextStyle(PIXEL_FONT_FAMILY, 8, PALETTE.itemGold))
    .setScrollFactor(0)
    .setDepth(10001);

  return { x, y, graphics, nameText, hpText, shieldText, skillIcons, cooldownTexts, skillText, amuletText };
}

function drawHpBar(graphics, x, y, w, fraction) {
  const segW = (w - (HP_SEGMENTS - 1)) / HP_SEGMENTS;
  for (let i = 0; i < HP_SEGMENTS; i++) {
    const filled = i < Math.round(fraction * HP_SEGMENTS);
    graphics.fillStyle(filled ? colorInt('#D1382C') : 0x000000, filled ? 1 : 0.6);
    graphics.fillRect(x + i * (segW + 1), y, segW, 6);
  }
}

function drawUltBar(graphics, x, y, w, fraction, ready, tick) {
  graphics.fillStyle(0x000000, 0.6);
  graphics.fillRect(x, y, w, 4);
  // A ready ability blinks torch-orange: everyone needs to know when the
  // Berserker can nova.
  const blinking = ready && Math.floor(tick / 12) % 2 === 0;
  graphics.fillStyle(colorInt(blinking ? PALETTE.torchBase : PALETTE.torchCore), 1);
  graphics.fillRect(x, y, w * fraction, 4);
}

/** The ability a character has, if any, as {label, ready} — or null. */
function abilityStatus(state, player) {
  const def = CHARACTERS[player.characterId];

  if (def.nova) {
    const ready = player.ultCharge >= def.nova.ultCost;
    if (player.charging === 'nova') return { label: 'NOVA CHARGING', ready: true };
    return { label: ready ? 'NOVA READY' : `NOVA ${Math.floor(player.ultCharge)}/${def.nova.ultCost}`, ready };
  }

  if (def.dog) {
    const dog = state.dogs.find((d) => d.ownerId === player.id && d.alive);
    if (dog) {
      return { label: `DOG ${Math.ceil(dog.hp)}/${dog.maxHp}`, ready: false, barFraction: dog.hp / dog.maxHp };
    }
    const waitTicks = player.dogReadyAtTick - state.tick;
    if (waitTicks > 0) return { label: `DOG ${Math.ceil(waitTicks / TICK_RATE)}s`, ready: false };
    return { label: 'DOG READY', ready: true };
  }

  return null;
}

/** The single item slot: an empty pixel frame, or the held item's color. */
function drawItemSlot(graphics, x, y, item) {
  graphics.fillStyle(0x000000, 0.6);
  graphics.fillRect(x, y, SLOT_SIZE, SLOT_SIZE);
  if (item) {
    graphics.fillStyle(colorInt(item === 'grenade' ? PALETTE.itemGrenade : PALETTE.itemMine), 1);
    graphics.fillRect(x + 2, y + 2, SLOT_SIZE - 4, SLOT_SIZE - 4);
  }
  graphics.lineStyle(1, colorInt(item ? PALETTE.itemGold : PALETTE.uiPanelBorder), 1);
  graphics.strokeRect(x, y, SLOT_SIZE, SLOT_SIZE);
}

/**
 * The two ability slots: icon, frame, and a cooldown shade that drains top-down.
 *
 * The slot NUMBER is the input binding (1/2 on the keyboard, the two shoulder
 * buttons on a pad), so an empty slot still draws its frame — the position has
 * to stay fixed or the binding stops matching what you see.
 */
function drawSkillSlots(panel, state, player) {
  const names = [];
  let cooldownLabels = 0;

  player.abilities.slots.forEach((abilityId, slot) => {
    const x = panel.x + 8 + slot * (SKILL_ICON_SIZE + 4);
    const y = panel.y + 60;
    const icon = panel.skillIcons[slot];

    panel.graphics.fillStyle(0x000000, 0.6);
    panel.graphics.fillRect(x, y, SKILL_ICON_SIZE, SKILL_ICON_SIZE);

    if (!abilityId) {
      icon.setVisible(false);
      panel.cooldownTexts[slot].setVisible(false);
      panel.graphics.lineStyle(1, colorInt(PALETTE.uiPanelBorder), 1);
      panel.graphics.strokeRect(x, y, SKILL_ICON_SIZE, SKILL_ICON_SIZE);
      return;
    }

    icon.setTexture(`ability-${abilityId}`);
    icon.setDisplaySize(SKILL_ICON_SIZE, SKILL_ICON_SIZE);
    icon.setVisible(true);

    const config = abilityConfig(player.characterId, abilityId);
    const cooldownTicks = player.skillCooldowns[slot];
    const maxTicks = config && config.cooldownTicks ? config.cooldownTicks : 1;
    const cooling = cooldownTicks > 0;

    if (cooling) {
      // Shade from the top down by how much cooldown is LEFT, so the icon
      // uncovers as it comes back. Rounded to whole pixels.
      const shadeH = Math.ceil(Math.min(1, cooldownTicks / maxTicks) * SKILL_ICON_SIZE);
      panel.graphics.fillStyle(0x000000, 0.72);
      panel.graphics.fillRect(x, y, SKILL_ICON_SIZE, shadeH);
      icon.setAlpha(0.55);
      // Seconds left sit ON the icon rather than in the name row: two names
      // plus two "12s" suffixes do not fit the panel width at 8px.
      panel.cooldownTexts[slot]
        .setPosition(x + SKILL_ICON_SIZE / 2, y + SKILL_ICON_SIZE / 2)
        .setText(String(Math.ceil(cooldownTicks / TICK_RATE)))
        .setVisible(true);
      cooldownLabels += 1;
    } else {
      icon.setAlpha(1);
      panel.cooldownTexts[slot].setVisible(false);
    }

    // Ready slots get a torch-orange frame; cooling ones stay muted.
    panel.graphics.lineStyle(1, colorInt(cooling ? PALETTE.uiPanelBorder : PALETTE.torchCore), 1);
    panel.graphics.strokeRect(x, y, SKILL_ICON_SIZE, SKILL_ICON_SIZE);

    names.push(slotLabel(player.characterId, abilityId, 0));
  });

  panel.skillText.setText(names.join('  '));
  panel.skillText.setColor(names.length ? PALETTE.uiText : PALETTE.uiTextMuted);
  if (cooldownLabels === 0) panel.cooldownTexts.forEach((t) => t.setVisible(false));
}

/** Active timed effects, each as a small block with a bar that drains as it expires. */
function drawTimedEffects(graphics, x, y, state, player) {
  let offset = 0;
  for (const effect of TIMED_EFFECTS) {
    const remaining = player.effects[effect.key] - state.tick;
    if (remaining <= 0) continue;
    const fraction = Math.max(0, Math.min(1, remaining / effect.durationTicks));
    const ex = x + offset;
    graphics.fillStyle(colorInt(effect.color), 1);
    graphics.fillRect(ex, y, 10, 4);
    graphics.fillStyle(0x000000, 0.7);
    graphics.fillRect(ex, y + 4, 10, 3);
    graphics.fillStyle(colorInt(effect.color), 1);
    graphics.fillRect(ex, y + 4, 10 * fraction, 3);
    offset += 13;
  }
}

/** One mini gem per amulet type held, with a xN counter past the first. */
function drawAmuletRow(graphics, texts, x, y, player) {
  let offset = 0;
  const parts = [];
  for (const id of AMULET_IDS) {
    const count = player.amulets[id];
    if (!count) continue;
    graphics.fillStyle(colorInt(PALETTE.itemGold), 1);
    graphics.fillRect(x + offset, y, 7, 7);
    graphics.fillStyle(colorInt(PALETTE.amuletGems[id]), 1);
    graphics.fillRect(x + offset + 2, y + 2, 3, 3);
    if (count > 1) parts.push(`x${count}`);
    else parts.push('');
    offset += 9;
  }
  // Counters are drawn as one compact string beside the gems.
  texts.setPosition(x + offset + 2, y - 1);
  texts.setText(parts.filter(Boolean).join(' '));
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

    const ability = abilityStatus(state, player);

    panel.graphics.clear();
    drawPanel(panel.graphics, panel.x, panel.y, PANEL_W, PANEL_H);
    drawHpBar(panel.graphics, panel.x + 6, panel.y + 16, PANEL_W - 12, Math.max(0, player.hp / player.maxHp));
    drawUltBar(
      panel.graphics,
      panel.x + 6,
      panel.y + 26,
      PANEL_W - 12,
      player.ultCharge / 100,
      !!(ability && ability.ready),
      state.tick
    );
    drawRoundPips(panel.graphics, panel.x + 6, panel.y + 34, player.roundsWon);

    // A live dog gets its own mini HP bar next to the round pips.
    if (ability && ability.barFraction !== undefined) {
      const barX = panel.x + 6 + ROUNDS_TO_WIN_MATCH * 10 + 6;
      const barW = 40;
      panel.graphics.fillStyle(0x000000, 0.6);
      panel.graphics.fillRect(barX, panel.y + 36, barW, 4);
      panel.graphics.fillStyle(colorInt(def.color), 1);
      panel.graphics.fillRect(barX, panel.y + 36, barW * ability.barFraction, 4);
    }

    panel.nameText.setText(`P${i + 1} ${def.name}`);
    panel.nameText.setColor(def.color);
    panel.hpText.setText(`${Math.ceil(player.hp)}/${Math.round(player.maxHp)}`);

    let shieldLabel;
    if (state.tick < player.shieldActiveUntilTick) shieldLabel = 'SHIELD UP';
    else if (state.tick < player.shieldReadyAtTick) {
      shieldLabel = `SHIELD ${Math.ceil((player.shieldReadyAtTick - state.tick) / TICK_RATE)}s`;
    } else shieldLabel = 'SHIELD OK';
    panel.shieldText.setText(ability ? `${shieldLabel}  ${ability.label}` : shieldLabel);
    panel.shieldText.setColor(ability && ability.ready ? PALETTE.torchCore : PALETTE.uiTextMuted);

    // Pickups row: held item, active timed effects, amulets owned.
    drawItemSlot(panel.graphics, panel.x + 6, panel.y + 48, player.item);
    drawTimedEffects(panel.graphics, panel.x + 24, panel.y + 50, state, player);
    drawSkillSlots(panel, state, player);

    drawAmuletRow(panel.graphics, panel.amuletText, panel.x + 6, panel.y + 78, player);
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
      // Amulets are permanent, so the recap is where players take stock of
      // who is quietly pulling ahead.
      const amuletLines = state.players
        .map((p) => {
          const held = AMULET_IDS.filter((id) => p.amulets[id] > 0)
            .map((id) => `${id.replace('amulet', '').toUpperCase()}${p.amulets[id] > 1 ? `x${p.amulets[id]}` : ''}`)
            .join(' ');
          return held ? `P${p.id + 1}: ${held}` : null;
        })
        .filter(Boolean);
      if (amuletLines.length) bannerLines.push('', 'AMULETS', ...amuletLines);
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
