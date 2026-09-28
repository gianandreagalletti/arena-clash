// The between-round draft screen — Phase 1: pixel text and rectangles only,
// no new sprites.
//
// The sim owns the draft (systems/draft.js): this is a view of state.draft plus
// a local cursor. Nothing here changes the game — when the active player
// confirms, the overlay hands GameScene a `draftPick` which goes into that
// player's InputFrame like any other input, so a replay still reproduces it.
//
// Navigation is UI-only and deliberately NOT in the InputFrame: moving a
// cursor is not a game action.

import Phaser from 'phaser';
import { CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX } from './coords.js';
import { PALETTE } from './art/palette.js';
import { PIXEL_FONT_FAMILY } from './art/font.js';
import { drawPanel, pixelTextStyle } from './ui/panel.js';
import { abilityText } from './help/abilityText.js';
import { EdgeTracker } from '../input/menuInput.js';
import {
  BOOST_CATEGORIES,
  BOOST_BONUS_PER_POINT,
  CHARACTERS,
  DRAFT,
  TICK_RATE,
  abilityConfig,
} from '../sim/config/balance.js';
import { CATEGORY_LABELS } from '../input/boostAllocation.js';

const DEPTH = 15000;
const COLUMN_TOP = 108;
const STRIP_TOP = 44;

// Xbox-standard indices used for confirm/back/navigation here.
const PAD_A = 0;
const PAD_B = 1;
const PAD_DPAD_UP = 12;
const PAD_DPAD_DOWN = 13;
const PAD_DPAD_LEFT = 14;
const PAD_DPAD_RIGHT = 15;
const STICK_THRESHOLD = 0.5;

function pressed(pad, index) {
  return !!(pad.buttons && pad.buttons[index] && pad.buttons[index].pressed);
}

function colorInt(hex) {
  return Phaser.Display.Color.HexStringToColor(hex).color;
}

export function createDraftOverlay(scene) {
  const root = scene.add.container(0, 0).setDepth(DEPTH).setVisible(false);
  const graphics = scene.add.graphics();
  root.add(graphics);

  const texts = [];
  function addText(x, y, content, color, size = 8, wrapWidth = 0) {
    const style = pixelTextStyle(PIXEL_FONT_FAMILY, size, color);
    if (wrapWidth) style.wordWrap = { width: wrapWidth };
    const obj = scene.add.text(x, y, content, style);
    root.add(obj);
    texts.push(obj);
    return obj;
  }
  function clearTexts() {
    for (const t of texts) t.destroy();
    texts.length = 0;
  }

  const edges = new EdgeTracker();
  // Local cursor state, reset whenever the active player changes.
  let ui = null;
  let pendingPick = null;
  let arrowKeys = null;
  let confirmKey = null;
  let backKey = null;

  function ensureKeys() {
    if (arrowKeys) return;
    arrowKeys = scene.input.keyboard.createCursorKeys();
    confirmKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    backKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
  }

  function resetCursor(playerId) {
    ui = { playerId, step: 'stat', statIndex: 0, offerIndex: 0, slotIndex: 0 };
  }

  /** Steps this player still has to go through, given what they picked. */
  function needsReplaceStep(state, player) {
    const abilityId = state.draft.offers[player.id][ui.offerIndex];
    if (!abilityId) return false;
    const config = abilityConfig(player.characterId, abilityId);
    return config.type === 'active' && player.abilities.slots.indexOf(null) === -1;
  }

  function submit(state, player) {
    const offers = state.draft.offers[player.id];
    const abilityId = offers.length > 0 ? offers[ui.offerIndex] : null;
    pendingPick = {
      stat: BOOST_CATEGORIES[ui.statIndex],
      abilityId,
      replaceSlot: needsReplaceStep(state, player) ? ui.slotIndex : null,
    };
  }

  function move(state, player, dx, dy) {
    const offers = state.draft.offers[player.id];
    if (ui.step === 'stat') {
      const n = BOOST_CATEGORIES.length;
      ui.statIndex = (ui.statIndex + (dx + dy) + n) % n;
    } else if (ui.step === 'ability') {
      const n = Math.max(1, offers.length);
      ui.offerIndex = (ui.offerIndex + (dx + dy) + n) % n;
    } else if (ui.step === 'replace') {
      ui.slotIndex = (ui.slotIndex + (dx + dy) + 2) % 2;
    }
  }

  function confirm(state, player) {
    const offers = state.draft.offers[player.id];
    if (ui.step === 'stat') {
      // Nothing left to offer: the stat point is the whole pick.
      if (offers.length === 0) return submit(state, player);
      ui.step = 'ability';
      return undefined;
    }
    if (ui.step === 'ability') {
      if (needsReplaceStep(state, player)) {
        ui.step = 'replace';
        return undefined;
      }
      return submit(state, player);
    }
    return submit(state, player);
  }

  function back() {
    if (ui.step === 'replace') ui.step = 'ability';
    else if (ui.step === 'ability') ui.step = 'stat';
  }

  /** Reads the device driving the active player. Only that device may navigate. */
  function readInput(scene_, deviceManager, playerId) {
    const device = deviceManager.debugMode
      ? { kind: 'keyboardMouse' }
      : deviceManager.slots[playerId];
    if (!device) return null;

    if (device.kind === 'keyboardMouse') {
      ensureKeys();
      return {
        key: 'keyboardMouse',
        raw: {
          left: arrowKeys.left.isDown,
          right: arrowKeys.right.isDown,
          up: arrowKeys.up.isDown,
          down: arrowKeys.down.isDown,
          confirm: confirmKey.isDown,
          back: backKey.isDown,
        },
      };
    }

    const pad = (scene_.input.gamepad?.gamepads || [])[device.padIndex];
    if (!pad || !pad.connected) return null;
    const lx = pad.leftStick ? pad.leftStick.x : 0;
    const ly = pad.leftStick ? pad.leftStick.y : 0;
    return {
      key: `pad${device.padIndex}`,
      raw: {
        left: pressed(pad, PAD_DPAD_LEFT) || lx < -STICK_THRESHOLD,
        right: pressed(pad, PAD_DPAD_RIGHT) || lx > STICK_THRESHOLD,
        up: pressed(pad, PAD_DPAD_UP) || ly < -STICK_THRESHOLD,
        down: pressed(pad, PAD_DPAD_DOWN) || ly > STICK_THRESHOLD,
        confirm: pressed(pad, PAD_A),
        back: pressed(pad, PAD_B),
      },
    };
  }

  return {
    /** The pick to inject into this tick's InputFrame, consumed once. */
    consumePick() {
      const pick = pendingPick;
      pendingPick = null;
      return pick;
    },

    update(state, deviceManager) {
      if (state.roundState !== 'draft' || !state.draft) {
        if (root.visible) {
          root.setVisible(false);
          clearTexts();
          graphics.clear();
          ui = null;
        }
        return;
      }

      root.setVisible(true);
      const activeId = state.draft.order[state.draft.turn];
      if (!ui || ui.playerId !== activeId) resetCursor(activeId);

      // --- Input ---
      const active = state.players[activeId];
      const input = readInput(scene, deviceManager, activeId);
      if (input) {
        // EdgeTracker primes on first sight, so a button still held from the
        // round that just ended cannot instantly confirm a pick.
        const edge = edges.edges(input.key, input.raw);
        if (edge.left) move(state, active, -1, 0);
        if (edge.right) move(state, active, 1, 0);
        if (edge.up) move(state, active, 0, -1);
        if (edge.down) move(state, active, 0, 1);
        if (edge.confirm) confirm(state, active);
        if (edge.back) back();
      }

      draw(state, activeId);
    },
  };

  // --- Drawing ---

  function draw(state, activeId) {
    clearTexts();
    graphics.clear();

    // Fully opaque: there is no game to watch during the draft, and at 0.88 the
    // HUD underneath bled through and fought with the columns for attention.
    graphics.fillStyle(0x000000, 1);
    graphics.fillRect(0, 0, CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX);

    addText(CANVAS_WIDTH_PX / 2, 12, 'DRAFT', PALETTE.torchCore, 16).setOrigin(0.5, 0);

    drawPickOrderStrip(state, activeId);

    const columnWidth = CANVAS_WIDTH_PX / 3;
    for (let i = 0; i < state.players.length; i++) {
      drawPlayerColumn(state, state.players[i], columnWidth * i + 8, columnWidth - 16, i === activeId);
    }

    let hint;
    if (ui.step === 'stat') {
      hint = 'UP/DOWN choose a stat  ·  ENTER / A confirm';
    } else if (ui.step === 'ability') {
      hint = 'UP/DOWN choose an ability  ·  ENTER / A confirm  ·  ESC / B back';
    } else {
      // Name what is coming in: "choose which skill to replace" alone left the
      // player guessing what they were replacing it with.
      const incoming = state.draft.offers[activeId][ui.offerIndex];
      const name = incoming ? abilityText(state.players[activeId].characterId, incoming).name : '';
      hint = `REPLACE WHICH SKILL WITH ${name.toUpperCase()}?  ·  UP/DOWN choose  ·  ENTER / A confirm  ·  ESC / B back`;
    }
    addText(CANVAS_WIDTH_PX / 2, CANVAS_HEIGHT_PX - 18, hint, PALETTE.uiTextMuted, 8).setOrigin(0.5, 0);
  }

  function drawPickOrderStrip(state, activeId) {
    const { order, turn, turnEndsAtTick } = state.draft;
    const stripW = 420;
    const x = CANVAS_WIDTH_PX / 2 - stripW / 2;
    drawPanel(graphics, x, STRIP_TOP, stripW, 40);

    // The seconds sit on their own row under the bar: at the right edge of the
    // name row they collided with the third player's label.
    const remaining = Math.max(0, turnEndsAtTick - state.tick);
    const slot = stripW / order.length;
    order.forEach((playerId, index) => {
      const player = state.players[playerId];
      const def = CHARACTERS[player.characterId];
      const isActive = playerId === activeId;
      const done = state.draft.picks[playerId] !== null;
      const label = `${index + 1}. P${playerId + 1} ${def.name.toUpperCase()}${done ? ' OK' : ''}`;
      const color = isActive ? PALETTE.torchCore : done ? PALETTE.uiTextMuted : def.color;
      addText(x + slot * index + slot / 2, STRIP_TOP + 7, label, color, 8).setOrigin(0.5, 0);
    });

    // Turn timer: drains left to right over the turn.
    const fraction = Math.max(0, Math.min(1, remaining / DRAFT.turnTimeTicks));
    graphics.fillStyle(0x000000, 0.7);
    graphics.fillRect(x + 8, STRIP_TOP + 22, stripW - 16, 5);
    graphics.fillStyle(colorInt(fraction < 0.25 ? PALETTE.itemMedkit : PALETTE.torchCore), 1);
    graphics.fillRect(x + 8, STRIP_TOP + 22, (stripW - 16) * fraction, 5);
    addText(
      CANVAS_WIDTH_PX / 2,
      STRIP_TOP + 30,
      `${Math.ceil(remaining / TICK_RATE)}s LEFT`,
      fraction < 0.25 ? PALETTE.itemMedkit : PALETTE.uiTextMuted,
      8
    ).setOrigin(0.5, 0);
  }

  function drawPlayerColumn(state, player, x, width, isActive) {
    const def = CHARACTERS[player.characterId];
    const panelH = CANVAS_HEIGHT_PX - COLUMN_TOP - 34;
    drawPanel(graphics, x, COLUMN_TOP, width, panelH);
    if (isActive) {
      graphics.lineStyle(2, colorInt(PALETTE.torchCore), 1);
      graphics.strokeRect(x + 1, COLUMN_TOP + 1, width - 2, panelH - 2);
    }

    let y = COLUMN_TOP + 8;
    addText(x + 8, y, `P${player.id + 1} ${def.name.toUpperCase()}`, def.color, 10);
    y += 20;

    // Current stats, pre-match points plus anything drafted since.
    addText(x + 8, y, 'STATS', PALETTE.uiTextMuted, 8);
    y += 13;
    BOOST_CATEGORIES.forEach((category, index) => {
      const base = player.boosts[category];
      const drafted = player.statPicks[category];
      const total = base + drafted;
      const bonus = Math.round(BOOST_BONUS_PER_POINT[category] * total * 100);
      const selected = isActive && ui.step === 'stat' && ui.statIndex === index;
      const marker = selected ? '>' : ' ';
      const suffix = drafted > 0 ? ` (+${drafted})` : '';
      addText(
        x + 8,
        y,
        `${marker} ${CATEGORY_LABELS[category]}  ${total}${suffix}  +${bonus}%`,
        selected ? PALETTE.torchCore : PALETTE.uiText,
        8
      );
      y += 12;
    });

    y += 6;
    addText(x + 8, y, 'SKILLS', PALETTE.uiTextMuted, 8);
    y += 13;
    for (let slot = 0; slot < DRAFT.activeSlots; slot++) {
      const abilityId = player.abilities.slots[slot];
      const info = abilityId ? abilityText(player.characterId, abilityId) : null;
      const selected = isActive && ui.step === 'replace' && ui.slotIndex === slot;
      const marker = selected ? '>' : ' ';
      addText(
        x + 8,
        y,
        `${marker} ${slot + 1}. ${info ? info.name : '(empty)'}`,
        selected ? PALETTE.itemMedkit : info ? PALETTE.uiText : PALETTE.uiTextMuted,
        8
      );
      y += 12;
    }

    y += 4;
    const passives = player.abilities.passives.map((id) => abilityText(player.characterId, id).name);
    addText(x + 8, y, `PASSIVES: ${passives.length ? passives.join(', ') : '—'}`, PALETTE.uiTextMuted, 8, width - 16);
    y += passives.length > 2 ? 26 : 14;

    // Offers — everyone's are visible from the start, by design.
    y += 4;
    addText(x + 8, y, 'OFFERS', PALETTE.uiTextMuted, 8);
    y += 13;

    const offers = state.draft.offers[player.id] || [];
    if (offers.length === 0) {
      addText(x + 8, y, 'Nothing left to learn — stat point only.', PALETTE.uiTextMuted, 8, width - 16);
      return;
    }

    offers.forEach((abilityId, index) => {
      const info = abilityText(player.characterId, abilityId);
      const selected = isActive && ui.step === 'ability' && ui.offerIndex === index;
      const owned = state.draft.picks[player.id] && state.draft.picks[player.id].abilityId === abilityId;
      const marker = selected ? '>' : owned ? '*' : ' ';
      // Short cooldown form: "14s" rather than "14 s cooldown", which ran past
      // the panel edge on the longer ability names.
      const cooldown = info.cooldownLabel ? ` ${info.cooldownLabel.replace(' cooldown', '')}` : '';

      const header = addText(
        x + 8,
        y,
        `${marker} ${info.name} [${info.typeLabel}]${cooldown}`,
        selected ? PALETTE.torchCore : owned ? PALETTE.itemGold : PALETTE.uiText,
        8,
        width - 16
      );
      const body = addText(x + 16, y + header.height + 2, info.effect, PALETTE.uiTextMuted, 8, width - 26);

      // Advance by what the text ACTUALLY measured: a three-line effect (the
      // Viper) used to run straight into the next offer under a fixed step.
      const rowHeight = header.height + body.height + 10;
      if (selected) {
        graphics.fillStyle(colorInt(PALETTE.torchCore), 0.14);
        graphics.fillRect(x + 4, y - 2, width - 8, rowHeight - 2);
      }
      y += rowHeight;
    });
  }
}
