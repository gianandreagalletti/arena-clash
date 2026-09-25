// The one and only color table for the pixel-art pass. Every generated sprite
// pulls its colors from here — nothing in render/art/ or render/*.js should
// hardcode a hex color outside this file.

export const PALETTE = {
  outline: '#120C0A',

  floorA: '#16241C',
  floorB: '#1B2E22',
  floorCrack: '#0F1A14',

  wallBody: '#0F1A14',
  wallTop: '#2C4438',
  wallBase: '#08100C',

  platformFill: '#24382C',
  platformEdge: '#2C4438',

  coverFill: '#4C5A52',
  coverLight: '#6E7D73',
  coverDark: '#2E3A33',

  torchBase: '#FF6B35',
  torchMid: '#FF9D47',
  torchCore: '#FFE08A',
  torchBracket: '#4A3324',

  skin: '#F0C9A0',

  red: { accent: '#FF5A4E', body: '#D1382C', shade: '#8F2019', skin: '#F0C9A0' },
  blue: { accent: '#4EA8FF', body: '#2F74D6', shade: '#1C4A8F', skin: '#F0C9A0' },
  green: { accent: '#6BD66B', body: '#3FA34D', shade: '#256B32', skin: '#F0C9A0' },
  // Fully desaturated stand-in for eliminated players (spectator ghosts) —
  // skin included, so a ghost reads as grey all over, not just the outfit.
  ghost: { accent: '#9AA69E', body: '#6E7A72', shade: '#454E49', skin: '#B9BFB9' },

  shieldTint: '#8FD0F4',

  // --- Map items ---
  // One readable accent per pickup, plus the shared gold that marks anything
  // permanent (amulets) apart from anything temporary at a glance.
  itemGold: '#F2C14E',
  itemGoldDark: '#8A6A1F',
  itemMedkit: '#E5484D',
  itemOvercharge: '#FFE08A',
  itemAdrenaline: '#4EE0C0',
  itemBattery: '#4EA8FF',
  itemGrenade: '#5C7A3F',
  itemMine: '#7A4B4B',
  itemCloak: '#9B7BD4',
  itemMetal: '#C9D2CC',
  amuletGems: {
    amuletSpeed: '#4EE0C0',
    amuletVitality: '#FF7A8A',
    amuletBlade: '#FF9D47',
    amuletMarksman: '#6BD66B',
    amuletWard: '#4EA8FF',
    amuletFury: '#D46BD4',
    amuletHunter: '#FFE08A',
  },

  uiPanelBg: '#000000',
  uiPanelBorder: '#26382C',
  uiText: '#E7E6D6',
  uiTextMuted: '#92A294',
};

// Maps a player's character color (from balance.js CHARACTERS[x].color, a hex
// string) to one of the three palette-swap sets above. balance.js's own
// red/blue/green choice is the single source of truth for "which color is
// player N"; this table just needs to recognize those same three hexes.
const CHARACTER_COLOR_TO_PALETTE_KEY = {
  '#e74c3c': 'red',
  '#3498db': 'blue',
  '#2ecc71': 'green',
};

export function paletteKeyForCharacterColor(hexColor) {
  return CHARACTER_COLOR_TO_PALETTE_KEY[hexColor] || 'red';
}

export const PLAYER_PALETTE_KEYS = ['red', 'blue', 'green', 'ghost'];
