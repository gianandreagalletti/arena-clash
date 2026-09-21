// Thin wrapper re-exporting the Berserker's data-only definition from balance.js
// (the single source of truth for numbers — architecture rule 8).
// Week 2 will add real ability1/ability2/ultimate logic here; for now they're
// empty stubs (see balance.js for the commented-out TODO number placeholders).

import { CHARACTERS } from '../config/balance.js';

export const berserker = CHARACTERS.berserker;

export default berserker;
