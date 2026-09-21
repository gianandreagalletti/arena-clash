// Pre-match boost allocation: pure point-spending logic for the boost screen.
// Lives in input/ (not sim/) — the sim only ever receives the final
// { hp, speed, shootDmg, slashDmg } point allocation via createInitialState.

import { BOOST_CATEGORIES, BOOST_POINTS_PER_PLAYER } from '../sim/config/balance.js';

export function createAllocation() {
  return { hp: 0, speed: 0, shootDmg: 0, slashDmg: 0 };
}

export function pointsSpent(allocation) {
  return BOOST_CATEGORIES.reduce((sum, category) => sum + allocation[category], 0);
}

export function pointsRemaining(allocation) {
  return BOOST_POINTS_PER_PLAYER - pointsSpent(allocation);
}

/** Adds one point to `category`. Returns a new allocation; no-ops when the budget is spent. */
export function addPoint(allocation, category) {
  if (pointsRemaining(allocation) <= 0) return allocation;
  return { ...allocation, [category]: allocation[category] + 1 };
}

/** Removes one point from `category`. Returns a new allocation; no-ops at zero. */
export function removePoint(allocation, category) {
  if (allocation[category] <= 0) return allocation;
  return { ...allocation, [category]: allocation[category] - 1 };
}

/** Moves the category cursor by `delta`, wrapping around. */
export function moveCursor(cursor, delta) {
  const n = BOOST_CATEGORIES.length;
  return (((cursor + delta) % n) + n) % n;
}

export const CATEGORY_LABELS = {
  hp: 'HP',
  speed: 'Speed',
  shootDmg: 'Shoot dmg',
  slashDmg: 'Slash dmg',
};
