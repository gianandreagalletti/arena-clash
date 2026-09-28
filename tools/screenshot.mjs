#!/usr/bin/env node
// Headless screenshots of the running game, so UI work can be checked without
// a human at the keyboard.
//
//   npm run dev -- --port 5199        (in one terminal)
//   node tools/screenshot.mjs draft   (in another)
//
// Why it drives a LOCAL Chrome instead of Playwright's own browser: this
// environment cannot reach Playwright's CDN, so `playwright install` fails.
// playwright-core drives an already-installed Chrome/Edge and downloads
// nothing. Set CHROME_PATH to override the auto-detected binary.
//
// Shots that need a particular game state reach into the live Phaser scene via
// window.__ARENA_GAME__, which main.js only exposes in a dev build. Playing a
// whole round by hand just to reach the draft screen is not worth it.

import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CANDIDATE_BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const executablePath = CANDIDATE_BROWSERS.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Edge found. Set CHROME_PATH to a browser binary.');
  process.exit(1);
}

const shot = process.argv[2] || 'draft';
const url = process.env.GAME_URL || 'http://localhost:5199/';
const outDir = 'docs/screenshots';
mkdirSync(outDir, { recursive: true });

/** Phaser polls keys in update(), so a 10ms tap can fall between two frames. */
async function holdKey(page, key, ms = 200) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(350);
}

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  // The Google Font 404 is expected here: this environment has no network.
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500); // BootScene: texture generation + font
await page.click('canvas').catch(() => {});

// F1 = debug solo mode (skips the join screen), then ready up on the boost screen.
await holdKey(page, 'F1');
await holdKey(page, 'Enter');

const scene = await page.evaluate(() =>
  window.__ARENA_GAME__ ? window.__ARENA_GAME__.scene.getScenes(true).map((s) => s.scene.key).join(',') : 'no game handle'
);
if (!scene.includes('GameScene')) {
  console.error(`Expected GameScene, got: ${scene}`);
  await browser.close();
  process.exit(1);
}

if (shot === 'draft') {
  // Force a finished round so the draft opens, with a clear pick order.
  await page.evaluate(() => {
    const s = window.__ARENA_GAME__.scene.getScene('GameScene').state;
    s.roundState = 'playing';
    s.roundStartTick = s.tick;
    for (const p of s.players) p.invulnUntilTick = s.tick;
    s.players[0].statPicks.hp = 2;
    s.players[2].hp = 0;
    s.players[2].alive = false;
    s.players[2].deathTick = s.tick - 10;
    s.players[1].hp = 0;
    s.players[1].alive = false;
    s.players[1].deathTick = s.tick - 2;
  });
  await page.waitForTimeout(7000); // recap runs out, draft opens
  await page.screenshot({ path: `${outDir}/draft.png` });
  console.log(`-> ${outDir}/draft.png`);

  // The slot-replacement step, with both skill slots already full.
  await page.evaluate(() => {
    const s = window.__ARENA_GAME__.scene.getScene('GameScene').state;
    s.players[0].abilities.slots = ['roll', 'vanish'];
    s.draft.offers[0] = ['chargedShot', 'piercing', 'focus'];
  });
  await holdKey(page, 'Enter'); // past the stat step
  await holdKey(page, 'Enter'); // onto an active offer -> replace step
  await page.screenshot({ path: `${outDir}/draft-replace.png` });
  console.log(`-> ${outDir}/draft-replace.png`);
} else {
  await page.screenshot({ path: `${outDir}/${shot}.png` });
  console.log(`-> ${outDir}/${shot}.png`);
}

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
