// One-line descriptions for all 15 abilities, built FROM balance.js.
//
// Lives apart from the draft screen on purpose: the draft screen and the Help
// screen both need this text, and it must never be written twice. No Phaser
// import, so it stays testable in Node like helpContent.js.
//
// Adding an ability: add its entry to balance.js ABILITIES and one line here.

import { ABILITIES, TICK_RATE, CHARACTERS, abilityConfig } from '../../sim/config/balance.js';
import { formatSeconds, formatTiles, formatNumber, formatMultiplierBonus } from './format.js';

/** 0.8 -> "20% less often"; 1.2 -> "20% more often". */
function formatRateChange(mult) {
  const pct = Math.abs(Math.round((mult - 1) * 100));
  return `${pct}% ${mult < 1 ? 'less' : 'more'} often`;
}

const EFFECTS = {
  summoner: {
    viper: (c) =>
      `Summons a viper (${formatNumber(c.hp)} HP, ${formatSeconds(c.lifetimeTicks)}) that hunts the nearest enemy, ` +
      `biting for ${formatNumber(c.biteDamage)} and poisoning for ${formatNumber(c.poisonDps)}/s over ${formatSeconds(c.poisonDurationTicks)}.`,
    thornTrap: (c) =>
      `Plants a trap that arms in ${formatSeconds(c.armTicks)}. Enemies entering take ${formatNumber(c.enterDamage)} ` +
      `and move at ${Math.round(c.slowMult * 100)}% speed while inside. Lasts ${formatSeconds(c.durationTicks)}.`,
    alphaDog: (c) =>
      `Your dog gets ${formatMultiplierBonus(c.hpMult)} HP and ${formatMultiplierBonus(c.biteMult)} bite damage.`,
    boneMeal: (c) => `You heal ${Math.round(c.healFraction * 100)}% of the damage your dog bites off.`,
    packLeader: (c) => `Your dog comes back ${Math.round((1 - c.respawnMult) * 100)}% sooner after it dies.`,
  },
  berserker: {
    longsword: (c) => `Slash reaches ${formatTiles(c.reachBonusTiles)} further.`,
    greatsword: (c) =>
      `Slash hits for ${formatMultiplierBonus(c.damageMult)} damage but swings ${formatRateChange(c.rateMult)}.`,
    charge: (c) =>
      `Dash ${formatTiles(c.distanceTiles)} and deal ${formatNumber(c.damage)} to everyone you run through. Cover stops you.`,
    whirlwind: (c) => `An instant 360 slash for ${formatNumber(c.damage)} to everything in reach.`,
    bloodthirst: (c) => `You heal ${Math.round(c.healFraction * 100)}% of the Slash damage you land.`,
  },
  sniper: {
    vanish: (c) =>
      `Turn faint for ${formatSeconds(c.durationTicks)}. Aim assist loses you; shooting or slashing ends it.`,
    roll: (c) => `Dash ${formatTiles(c.distanceTiles)} and take no damage at all while rolling.`,
    chargedShot: (c) =>
      `Hold to charge up to ${formatSeconds(c.maxChargeTicks)} for up to ${formatMultiplierBonus(c.maxMult)} damage. ` +
      `You move at ${Math.round(c.moveMult * 100)}% speed while charging.`,
    piercing: (c) => `Your shots carry through one target, hitting a second for ${Math.round(c.secondHitMult * 100)}%.`,
    focus: (c) => `Your shots fly ${formatMultiplierBonus(c.speedMult)} faster.`,
  },
};

/** { id, name, type, typeLabel, effect, cooldownLabel } for one ability. */
export function abilityText(characterId, abilityId) {
  const config = abilityConfig(characterId, abilityId);
  if (!config) return null;
  const describe = EFFECTS[characterId] && EFFECTS[characterId][abilityId];

  return {
    id: abilityId,
    name: config.name,
    type: config.type,
    typeLabel: config.type === 'active' ? 'ACTIVE' : 'PASSIVE',
    effect: describe ? describe(config) : '',
    cooldownLabel: config.cooldownTicks ? `${formatSeconds(config.cooldownTicks)} cooldown` : null,
  };
}

/** Every ability of one character, in pool order. */
export function abilityTextsFor(characterId) {
  return Object.keys(ABILITIES[characterId] || {}).map((id) => abilityText(characterId, id));
}

/**
 * The three characters' pools as Help-screen groups, each ability carrying the
 * icon key the HUD and the draft screen already use. Built from the same
 * `abilityText` the draft screen reads, so the two can never drift apart.
 */
export function buildAbilityGroups(characters = CHARACTERS) {
  return Object.keys(ABILITIES).map((characterId) => ({
    characterId,
    name: characters[characterId] ? characters[characterId].name : characterId,
    abilities: abilityTextsFor(characterId).map((ability) => ({
      ...ability,
      textureKey: `ability-${ability.id}`,
    })),
  }));
}

/** Short label for a slot in the HUD: "Charge 4s" while cooling, "Charge" when ready. */
export function slotLabel(characterId, abilityId, cooldownTicks) {
  if (!abilityId) return '—';
  const config = abilityConfig(characterId, abilityId);
  const name = config ? config.name : abilityId;
  if (cooldownTicks > 0) return `${name} ${Math.ceil(cooldownTicks / TICK_RATE)}s`;
  return name;
}
