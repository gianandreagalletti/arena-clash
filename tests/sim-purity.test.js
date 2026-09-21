import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIM_DIR = path.join(__dirname, '..', 'src', 'sim');

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const FORBIDDEN_PATTERNS = [
  { name: 'Phaser import', re: /from\s+['"]phaser['"]|require\(\s*['"]phaser['"]\s*\)/ },
  { name: 'window reference', re: /\bwindow\./ },
  { name: 'document reference', re: /\bdocument\./ },
  { name: 'Math.random', re: /Math\.random\s*\(/ },
];

test('sim/ has zero Phaser/DOM/window dependencies and never calls Math.random', () => {
  const files = listJsFiles(SIM_DIR);
  assert.ok(files.length > 0, 'expected to find sim/ source files');

  const violations = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const { name, re } of FORBIDDEN_PATTERNS) {
      if (re.test(src)) {
        violations.push(`${path.relative(SIM_DIR, file)}: ${name}`);
      }
    }
  }

  assert.deepStrictEqual(violations, []);
});
