import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HELP_CONTENT,
  buildHelpContent,
  formatSeconds,
  formatMultiplierBonus,
  formatFraction,
  formatTiles,
  formatNumber,
} from '../src/render/help/helpContent.js';
import { PICKUPS } from '../src/sim/config/balance.js';
import { BINDINGS } from '../src/input/bindings.js';

function tabById(content, id) {
  const tab = content.find((t) => t.id === id);
  assert.ok(tab, `missing tab ${id}`);
  return tab;
}

/** Every string anywhere in the content tree. */
function allStrings(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((child) => allStrings(child, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((child) => allStrings(child, out));
  return out;
}

test('help: every pickup and amulet in balance.js has exactly one entry, and no entry is invented', () => {
  const pickupIds = Object.keys(PICKUPS.temporary.weights);
  const amuletIds = Object.keys(PICKUPS.amulets.weights);

  const pickupEntries = tabById(HELP_CONTENT, 'pickups').entries;
  const amuletEntries = tabById(HELP_CONTENT, 'amulets').entries;

  for (const id of pickupIds) {
    const matches = pickupEntries.filter((e) => e.id === id);
    assert.strictEqual(matches.length, 1, `pickup "${id}" should have exactly one Help entry`);
  }
  for (const id of amuletIds) {
    const matches = amuletEntries.filter((e) => e.id === id);
    assert.strictEqual(matches.length, 1, `amulet "${id}" should have exactly one Help entry`);
  }

  for (const entry of pickupEntries) {
    assert.ok(pickupIds.includes(entry.id), `Help documents "${entry.id}", which is not a real pickup`);
  }
  for (const entry of amuletEntries) {
    assert.ok(amuletIds.includes(entry.id), `Help documents "${entry.id}", which is not a real amulet`);
  }

  assert.strictEqual(pickupEntries.length, pickupIds.length);
  assert.strictEqual(amuletEntries.length, amuletIds.length);
});

test('help: text follows balance.js — retuning a value retunes the Help string', () => {
  const tweaked = structuredClone(PICKUPS);
  tweaked.temporary.medkit.heal = 999;
  tweaked.temporary.overcharge.mult = 2.5;
  tweaked.temporary.overcharge.durationTicks = 60 * 30;
  tweaked.amulets.perStack.speed = 0.42;

  const before = buildHelpContent();
  const after = buildHelpContent({ pickups: tweaked });

  const medkitBefore = tabById(before, 'pickups').entries.find((e) => e.id === 'medkit').effect;
  const medkitAfter = tabById(after, 'pickups').entries.find((e) => e.id === 'medkit').effect;
  assert.notStrictEqual(medkitAfter, medkitBefore);
  assert.ok(medkitAfter.includes('999'), `expected the new heal in "${medkitAfter}"`);

  const overchargeAfter = tabById(after, 'pickups').entries.find((e) => e.id === 'overcharge').effect;
  assert.ok(overchargeAfter.includes('+150%'), `expected +150% in "${overchargeAfter}"`);
  assert.ok(overchargeAfter.includes('30 s'), `expected 30 s in "${overchargeAfter}"`);

  const speedAfter = tabById(after, 'amulets').entries.find((e) => e.id === 'amuletSpeed').effect;
  assert.ok(speedAfter.includes('+42%'), `expected +42% in "${speedAfter}"`);
});

test('help: no string contains NaN, undefined, or an unfilled template placeholder', () => {
  for (const text of allStrings(HELP_CONTENT)) {
    assert.ok(!text.includes('NaN'), `"${text}" contains NaN`);
    assert.ok(!text.includes('undefined'), `"${text}" contains undefined`);
    assert.ok(!text.includes('${'), `"${text}" has an unfilled placeholder`);
    assert.ok(!/\[object Object\]/.test(text), `"${text}" stringified an object`);
  }
});

test('help: the controls tab shows the real bindings table', () => {
  const controls = tabById(HELP_CONTENT, 'controls');
  assert.deepStrictEqual(controls.bindings, BINDINGS);

  // The actions the acceptance criteria call out must all be present.
  for (const action of ['Move', 'Aim', 'Shoot (hold)', 'Slash', 'Shield', 'Ultimate', 'Use item', 'Help']) {
    assert.ok(
      controls.bindings.some((b) => b.action === action),
      `controls tab is missing "${action}"`
    );
  }
  assert.ok(controls.debugBindings.some((b) => b.keyboard === 'F3'));
});

test('help: usable pickups tell you which button to press, instant ones do not', () => {
  const entries = tabById(HELP_CONTENT, 'pickups').entries;
  const itemBinding = BINDINGS.find((b) => b.action === 'Use item');

  for (const id of ['grenade', 'mine']) {
    const entry = entries.find((e) => e.id === id);
    assert.ok(entry.usage.startsWith('PRESS'), `${id} should prompt a button, got "${entry.usage}"`);
    assert.ok(entry.usage.includes(itemBinding.gamepad), `${id} should name the gamepad button`);
    assert.ok(entry.usage.includes(itemBinding.keyboard), `${id} should name the keyboard key`);
  }

  for (const id of ['medkit', 'overcharge', 'adrenaline', 'shieldBattery', 'cloak']) {
    assert.strictEqual(entries.find((e) => e.id === id).usage, 'INSTANT');
  }
});

test('help: every entry names a texture key so nothing renders blank', () => {
  for (const entry of tabById(HELP_CONTENT, 'pickups').entries) {
    assert.ok(entry.textureKey && entry.textureKey.length > 0, `${entry.id} has no texture key`);
    assert.ok(entry.name && entry.effect, `${entry.id} is missing name or effect text`);
  }
  for (const entry of tabById(HELP_CONTENT, 'amulets').entries) {
    assert.strictEqual(entry.textureKey, `amulet-${entry.id}-0`);
  }
  for (const row of tabById(HELP_CONTENT, 'combat').characterRows) {
    assert.ok(row.textureKey.startsWith('player-'));
    assert.ok(row.frame, 'character rows need a frame name');
  }
});

test('help: formatters produce clean human strings', () => {
  assert.strictEqual(formatSeconds(120), '2 s');
  assert.strictEqual(formatSeconds(30), '0.5 s');
  assert.strictEqual(formatMultiplierBonus(1.3), '+30%');
  assert.strictEqual(formatFraction(0.05), '+5%');
  assert.strictEqual(formatFraction(0.08), '+8%');
  assert.strictEqual(formatTiles(1.5), '1.5 tiles');
  assert.strictEqual(formatTiles(1), '1 tile');
  // Float noise from the config must never reach the screen.
  assert.strictEqual(formatNumber(36.000000001), '36');
  assert.strictEqual(formatFraction(0.06000000000000001), '+6%');
});
