// Thin wrapper re-exporting the Summoner's data-only definition from balance.js
// (the single source of truth for numbers — architecture rule 8).
// Characters differ only by HP and Speed; Shoot/Slash/Shield are shared and
// live in balance.js ACTIONS.

import { CHARACTERS } from '../config/balance.js';

export const summoner = CHARACTERS.summoner;

export default summoner;
