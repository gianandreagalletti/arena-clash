// Number formatters shared by every piece of player-facing text.
//
// They live in their own module because both helpContent.js (the Help screen)
// and abilityText.js (the draft screen AND the Help Abilities tab) need them.
// Putting them in either one would make the two import each other.
//
// No Phaser import, so this runs and is tested in Node.

import { TICK_RATE } from '../../sim/config/balance.js';

/** 120 -> "2 s", 30 -> "0.5 s" */
export function formatSeconds(ticks) {
  const seconds = ticks / TICK_RATE;
  const rounded = Math.round(seconds * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} s`;
}

/** 1.3 -> "+30%" (a multiplier expressed as its bonus) */
export function formatMultiplierBonus(mult) {
  return `${mult >= 1 ? '+' : ''}${Math.round((mult - 1) * 100)}%`;
}

/** 0.05 -> "+5%" (a per-stack fraction) */
export function formatFraction(fraction) {
  return `${fraction >= 0 ? '+' : ''}${Math.round(fraction * 100)}%`;
}

/** 1.5 -> "1.5 tiles", 1 -> "1 tile" */
export function formatTiles(tiles) {
  const rounded = Math.round(tiles * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${rounded === 1 ? 'tile' : 'tiles'}`;
}

/** 36.000000001 -> "36" */
export function formatNumber(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** ticks per action -> "2/s" */
export function formatRate(cooldownTicks) {
  const perSecond = TICK_RATE / cooldownTicks;
  const rounded = Math.round(perSecond * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}/s`;
}
