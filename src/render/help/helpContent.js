// Everything the Help screen says, as plain data.
//
// Two rules make this worth having as its own module:
//   1. No Phaser import, so it runs (and is tested) in Node.
//   2. Every number is READ from balance.js, never typed into a string. Tune a
//      value and Help follows automatically — that is what `buildHelpContent`
//      being a function of its config buys us, and what tests/help.test.js
//      pins by building the content twice from two different configs.
//
// Adding a pickup later: add one entry to the relevant list below. The scene
// iterates blindly and knows nothing about specific items.

import { PICKUPS, ACTIONS, CHARACTERS, BOOST_BONUS_PER_POINT, BOOST_POINTS_PER_PLAYER, TICK_RATE } from '../../sim/config/balance.js';
import { BINDINGS, DEBUG_BINDINGS, shortLabelFor } from '../../input/bindings.js';

// --- Formatters (exported for the tests) ---

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
function formatRate(cooldownTicks) {
  const perSecond = TICK_RATE / cooldownTicks;
  const rounded = Math.round(perSecond * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}/s`;
}

// --- Content builders ---

function buildPickupEntries(pickups, itemButtonLabel) {
  const t = pickups.temporary;
  const pressItem = `PRESS ${itemButtonLabel}`;

  return [
    {
      id: 'medkit',
      name: 'Medkit',
      textureKey: 'pickup-medkit',
      usage: 'INSTANT',
      effect: `Heals ${formatNumber(t.medkit.heal)} HP, never past your maximum.`,
      note: null,
    },
    {
      id: 'overcharge',
      name: 'Overcharge',
      textureKey: 'pickup-overcharge',
      usage: 'INSTANT',
      effect: `${formatMultiplierBonus(t.overcharge.mult)} Shoot and Slash damage for ${formatSeconds(t.overcharge.durationTicks)}.`,
      note: 'Picking up another one refreshes the timer. It never stacks.',
    },
    {
      id: 'adrenaline',
      name: 'Adrenaline',
      textureKey: 'pickup-adrenaline',
      usage: 'INSTANT',
      effect: `${formatMultiplierBonus(t.adrenaline.mult)} movement speed for ${formatSeconds(t.adrenaline.durationTicks)}.`,
      note: 'Refreshes rather than stacking.',
    },
    {
      id: 'shieldBattery',
      name: 'Shield Battery',
      textureKey: 'pickup-shieldBattery',
      usage: 'INSTANT',
      effect: 'Clears your Shield cooldown immediately.',
      note: 'Does nothing while your Shield is already up.',
    },
    {
      id: 'cloak',
      name: 'Cloak',
      textureKey: 'pickup-cloak',
      usage: 'INSTANT',
      effect: `You turn faint for ${formatSeconds(t.cloak.durationTicks)}.`,
      note: 'Aim assist ignores you. Shooting or slashing ends it at once; taking damage does not.',
    },
    {
      id: 'grenade',
      name: 'Grenade',
      textureKey: 'pickup-grenade',
      usage: pressItem,
      effect: `Thrown along your aim, up to ${formatTiles(t.grenade.rangeTiles)}. Explodes after ${formatSeconds(t.grenade.fuseTicks)} for ${formatNumber(t.grenade.damage)} damage within ${formatTiles(t.grenade.radiusTiles)}.`,
      note: 'Stops on cover. A ring on the floor shows where it will land, blinking faster as the fuse runs out. One item slot — if it is full you cannot pick up another.',
    },
    {
      id: 'mine',
      name: 'Mine',
      textureKey: 'pickup-mine',
      usage: pressItem,
      effect: `Dropped at your feet. Triggers on an enemy within ${formatTiles(t.mine.triggerRadiusTiles)} for ${formatNumber(t.mine.damage)} damage within ${formatTiles(t.mine.radiusTiles)}.`,
      note: `Arms after ${formatSeconds(t.mine.armTicks)}. Only enemies set it off — never you. One item slot.`,
      extraSprites: [
        { textureKey: 'mine-unarmed', label: 'arming' },
        { textureKey: 'mine-armed', label: 'armed' },
      ],
    },
  ];
}

const AMULET_NAMES = {
  amuletSpeed: 'Amulet of Speed',
  amuletVitality: 'Amulet of Vitality',
  amuletBlade: 'Amulet of the Blade',
  amuletMarksman: 'Amulet of the Marksman',
  amuletWard: 'Amulet of the Ward',
  amuletFury: 'Amulet of Fury',
  amuletHunter: 'Amulet of the Hunter',
};

function buildAmuletEntries(pickups) {
  const per = pickups.amulets.perStack;

  const effects = {
    amuletSpeed: `${formatFraction(per.speed)} movement speed each.`,
    amuletVitality: `${formatFraction(per.hp)} maximum HP each.`,
    amuletBlade: `${formatFraction(per.slash)} Slash damage each.`,
    amuletMarksman: `${formatFraction(per.shoot)} Shoot damage each.`,
    amuletWard: `Shield cooldown −${formatSeconds(per.shieldCdTicks)} each (never below ${formatSeconds(pickups.amulets.shieldCooldownFloorTicks)}).`,
    amuletFury: `${formatFraction(per.ultGain)} ult charge from every source, each.`,
    amuletHunter: `+${formatTiles(per.pickupRadius)} pickup reach each.`,
  };

  return Object.keys(pickups.amulets.weights).map((id) => ({
    id,
    name: AMULET_NAMES[id] || id,
    textureKey: `amulet-${id}-0`,
    effect: effects[id],
  }));
}

function buildCombatRows(actions, characters, boostBonus, boostPoints) {
  const actionRows = [
    {
      id: 'shoot',
      name: 'Shoot',
      textureKey: 'proj-red',
      stats: `${formatNumber(actions.shoot.damage)} damage · ${formatRate(actions.shoot.cooldownTicks)} · unlimited range`,
      text: 'Your bread and butter. Flies straight until it hits someone, cover, or a wall.',
    },
    {
      id: 'slash',
      name: 'Slash',
      textureKey: 'slash-red-E-1',
      stats: `${formatNumber(actions.slash.damage)} damage · ${formatRate(actions.slash.cooldownTicks)} · ${formatTiles(actions.slash.reachTiles)} · ${actions.slash.arcDegrees}° arc`,
      text: 'Hits everything in a cone in front of you. Far stronger than Shoot up close.',
    },
    {
      id: 'shield',
      name: 'Shield',
      textureKey: 'shield-red-0',
      stats: `${formatSeconds(actions.shield.durationTicks)} · −${Math.round(actions.shield.damageReduction * 100)}% damage · ${formatSeconds(actions.shield.cooldownTicks)} cooldown`,
      text: 'You cannot Shoot, Slash or use items while it is up, but you can still move.',
    },
  ];

  const characterRows = [
    {
      id: 'sniper',
      name: characters.sniper.name,
      textureKey: 'player-red',
      frame: 'idle-down-0',
      stats: `${formatNumber(characters.sniper.hp)} HP · ${formatNumber(characters.sniper.speedTilesPerSec)} tiles/s`,
      text: `Hits for ${formatNumber(characters.sniper.shoot.damage)} at ${formatRate(characters.sniper.shoot.cooldownTicks)} with a faster round. Squishiest of the three — missing hurts.`,
    },
    {
      id: 'berserker',
      name: characters.berserker.name,
      textureKey: 'player-blue',
      frame: 'idle-down-0',
      stats: `${formatNumber(characters.berserker.hp)} HP · ${formatNumber(characters.berserker.speedTilesPerSec)} tiles/s`,
      text: `Nova: ${formatNumber(characters.berserker.nova.damage)} damage within ${formatTiles(characters.berserker.nova.radiusTiles)} after a ${formatSeconds(characters.berserker.nova.windupTicks)} windup. Costs ${formatNumber(characters.berserker.nova.ultCost)} ult charge. The ring on the floor is your warning — walk out of it.`,
    },
    {
      id: 'summoner',
      name: characters.summoner.name,
      textureKey: 'player-green',
      frame: 'idle-down-0',
      stats: `${formatNumber(characters.summoner.hp)} HP · ${formatNumber(characters.summoner.speedTilesPerSec)} tiles/s`,
      text: `Summons a dog: ${formatNumber(characters.summoner.dog.hp)} HP, bites for ${formatNumber(characters.summoner.dog.damage)}. One at a time, and it can be killed — ${formatSeconds(characters.summoner.dog.respawnCooldownTicks)} before you get another.`,
    },
  ];

  const boostLine =
    `Before the match you spend ${boostPoints} points: ` +
    `HP ${formatFraction(boostBonus.hp)}, Speed ${formatFraction(boostBonus.speed)}, ` +
    `Shoot ${formatFraction(boostBonus.shootDmg)}, Slash ${formatFraction(boostBonus.slashDmg)} per point. ` +
    'Fixed for the whole match.';

  return { actionRows, characterRows, boostLine };
}

function buildHudLegend() {
  return [
    { label: 'HP bar + number', text: 'Your health. The bar empties as you take damage.' },
    { label: 'SHIELD', text: 'OK when ready, UP while active, or the seconds left on its cooldown.' },
    { label: 'NOVA / DOG', text: 'Your character ability: charge needed, or your dog\'s HP and respawn timer.' },
    { label: 'Item slot', text: 'The grenade or mine you are carrying. Empty frame means nothing held.' },
    { label: 'Effect bars', text: 'One per active pickup effect. The bar drains as it runs out.' },
    { label: 'Amulet row', text: 'The gold gems you have collected, with ×N when you hold more than one.' },
    { label: 'Round pips', text: 'Rounds won. First to three takes the match.' },
  ];
}

/**
 * Builds the whole Help screen from a config. Defaults to the live balance
 * values; the tests pass a modified clone to prove the text follows the config
 * rather than being written by hand.
 */
export function buildHelpContent({
  pickups = PICKUPS,
  actions = ACTIONS,
  characters = CHARACTERS,
  boostBonus = BOOST_BONUS_PER_POINT,
  boostPoints = BOOST_POINTS_PER_PLAYER,
  bindings = BINDINGS,
  debugBindings = DEBUG_BINDINGS,
  itemButtonLabel = shortLabelFor('Use item'),
} = {}) {
  const combat = buildCombatRows(actions, characters, boostBonus, boostPoints);

  return [
    {
      id: 'controls',
      title: 'CONTROLS',
      kind: 'controls',
      bindings,
      debugBindings,
    },
    {
      id: 'combat',
      title: 'COMBAT',
      kind: 'combat',
      ...combat,
    },
    {
      id: 'pickups',
      title: 'PICKUPS',
      kind: 'entries',
      header: 'Appear on the map during a round. Walk over them to collect. Everything is lost at the end of the round.',
      entries: buildPickupEntries(pickups, itemButtonLabel),
    },
    {
      id: 'amulets',
      title: 'AMULETS',
      kind: 'entries',
      header:
        'Rare, gold outline. They stay with you for the whole match, even if you die. Duplicates stack, with no limit.',
      entries: buildAmuletEntries(pickups),
      footer: 'Your amulets show as gold gems on your HUD panel, with ×N when you hold more than one.',
    },
    {
      id: 'hud',
      title: 'HUD',
      kind: 'legend',
      header: 'What each part of your panel is telling you.',
      entries: buildHudLegend(),
    },
  ];
}

export const HELP_CONTENT = buildHelpContent();
