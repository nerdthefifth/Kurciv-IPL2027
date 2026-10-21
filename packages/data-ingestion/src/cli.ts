import { CURATED_PLAYERS } from './curated';
import { validateCuratedRows } from './players';
import { WORLD } from '@kurciv/config';

// Validates the curated seed: duplicates, ranges and role/style consistency.
const issues = validateCuratedRows(CURATED_PLAYERS, WORLD.startSeason);
for (const i of issues) console.log(`${i.level.toUpperCase()} row ${i.row} (${i.name}): ${i.message}`);
const errors = issues.filter((i) => i.level === 'error').length;
console.log(`${CURATED_PLAYERS.length} curated players, ${errors} errors, ${issues.length - errors} warnings.`);
process.exit(errors ? 1 : 0);
