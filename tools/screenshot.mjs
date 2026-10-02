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
} else if (shot === 'phase2') {
  // Everything Phase 2 added, staged directly into sim state: HUD slot icons
  // (one ready, one cooling), a viper, an armed and an unarmed trap, poison
  // bubbles, a held Charged Shot, and a piercing round mid-flight.
  await page.evaluate(() => {
    const s = window.__ARENA_GAME__.scene.getScene('GameScene').state;
    s.roundState = 'playing';
    s.roundStartTick = s.tick;
    for (const p of s.players) p.invulnUntilTick = s.tick;

    // Slot order is NOT character order — look each one up by characterId, or a
    // summon ends up owned by a character whose ability pool has no such entry.
    const by = (id) => s.players.find((p) => p.characterId === id);
    const summoner = by('summoner');
    const berserker = by('berserker');
    const sniper = by('sniper');

    summoner.abilities.slots = ['viper', 'thornTrap'];
    summoner.abilities.passives = ['alphaDog'];
    summoner.skillCooldowns = [0, 300]; // slot 1 ready, slot 2 cooling
    summoner.x = 6;
    summoner.y = 5;

    berserker.abilities.slots = ['charge', 'whirlwind'];
    berserker.abilities.passives = ['greatsword'];
    berserker.skillCooldowns = [120, 0];
    berserker.x = 12;
    berserker.y = 9;
    berserker.poisonUntilTick = s.tick + 300;
    summoner.poisonUntilTick = s.tick + 300; // out in the open, easiest to read

    sniper.abilities.slots = ['roll', 'chargedShot'];
    sniper.abilities.passives = ['piercing', 'focus'];
    sniper.skillCooldowns = [0, 0];
    sniper.x = 18;
    sniper.y = 5;
    sniper.aimX = -1;
    sniper.aimY = 0;
    sniper.chargingSkill = { slot: 1, startTick: s.tick - 70 }; // nearly full charge

    s.vipers.push({
      id: s.nextViperId++, kind: 'viper', ownerId: summoner.id,
      x: 8.5, y: 6.5, radiusTiles: 0.3, hp: 18, maxHp: 30, alive: true,
      biteCooldownTicks: 0, expiresAtTick: s.tick + 600,
    });
    s.traps.push({
      id: s.nextTrapId++, ownerId: summoner.id, x: 6, y: 10, radiusTiles: 0.9,
      armedAtTick: s.tick - 60, expiresAtTick: s.tick + 600,
      enterDamage: 10, slowMult: 0.5, insideIds: [],
    });
    s.traps.push({
      id: s.nextTrapId++, ownerId: summoner.id, x: 9, y: 11, radiusTiles: 0.9,
      armedAtTick: s.tick + 120, expiresAtTick: s.tick + 700,
      enterDamage: 10, slowMult: 0.5, insideIds: [],
    });
    s.projectiles.push({
      id: s.nextProjectileId++, kind: 'projectile', ownerId: sniper.id,
      x: 15, y: 5, vx: -0.18, vy: 0, radius: 0.12, damage: 14,
      remainingRangeTiles: null, ageTicks: 0, explodeRadiusTiles: 0, abilityId: null,
      piercing: true, secondHitMult: 0.6, hitIds: [],
    });
  });
  // Charging and dashing are states the sim ENDS on the very next tick when no
  // button is held, and the sim runs before the renderer every frame — so a
  // value written from here is always gone by the time anything draws it.
  // Re-pinning it right before playerRenderer runs is the only way to hold the
  // pose still for a photo. Harness-only.
  await page.evaluate(() => {
    const scene = window.__ARENA_GAME__.scene.getScene('GameScene');
    const orig = scene.playerRenderer.update.bind(scene.playerRenderer);
    scene.playerRenderer.update = (state) => {
      const sniper = state.players.find((p) => p.characterId === 'sniper');
      // Set it, draw, put it back: the sim must never see the pinned value, or
      // it releases the shot every single tick and fills the arena with rounds.
      const saved = sniper.chargingSkill;
      sniper.chargingSkill = { slot: 1, startTick: state.tick - 70 };
      // A viper hunts, so left alone it ends up standing on top of whoever it
      // is biting. Pinned in the open, you can actually see the sprite and bar.
      const viper = state.vipers[0];
      if (viper) {
        viper.x = 16;
        viper.y = 12;
      }
      orig(state);
      sniper.chargingSkill = saved;
    };
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const s = window.__ARENA_GAME__.scene.getScene('GameScene').state;
    s.projectiles.length = 0; // clear anything fired before the pin was in place
    const sniper = s.players.find((p) => p.characterId === 'sniper');
    sniper.skillCooldowns = [0, 0];
  });
  await page.waitForTimeout(80);
  await page.screenshot({ path: `${outDir}/phase2-abilities.png` });
  console.log(`-> ${outDir}/phase2-abilities.png`);

  // Whirlwind: the sim clears state.meleeSwings every tick and GameScene rebuilds
  // frameEvents at the top of every frame, so a swing pushed from here would be
  // wiped before the FX layer ever saw it. Injecting on the FX call itself is the
  // only point where a synthetic swing survives — harness-only, so it stays here
  // rather than in the game.
  await page.evaluate(() => {
    const scene = window.__ARENA_GAME__.scene.getScene('GameScene');
    const s = scene.state;
    const sniper = s.players.find((p) => p.characterId === 'sniper');
    // A fresh piercing round in a known spot, so the spark lands where expected.
    s.projectiles.length = 0;
    s.projectiles.push({
      id: s.nextProjectileId++, kind: 'projectile', ownerId: sniper.id,
      x: 20, y: 3, vx: -0.18, vy: 0, radius: 0.12, damage: 14,
      remainingRangeTiles: null, ageTicks: 0, explodeRadiusTiles: 0, abilityId: null,
      piercing: true, secondHitMult: 0.6, hitIds: [],
    });
  });
  // Let it fly a moment first: the three trail segments are the previous
  // frames' positions, so a round photographed on its spawn frame has no tail.
  await page.waitForTimeout(260);

  await page.evaluate(() => {
    const scene = window.__ARENA_GAME__.scene.getScene('GameScene');
    const orig = scene.fxRenderer.update.bind(scene.fxRenderer);
    let injected = false;
    scene.fxRenderer.update = (state, events) => {
      if (!injected) {
        injected = true;
        const b = state.players.find((p) => p.characterId === 'berserker');
        events.meleeSwings.push({
          playerId: b.id, x: b.x, y: b.y, aimX: 1, aimY: 0,
          arcDegrees: 360, reachTiles: b.slashReachTiles, tick: state.tick,
        });
        // Land a pass-through too, so the piercing spark is in the same shot.
        const proj = state.projectiles[0];
        if (proj) proj.hitIds.push('player:9');
      }
      orig(state, events);
    };
  });
  await page.waitForTimeout(70); // ~4 ticks into the 8-tick ring
  await page.screenshot({ path: `${outDir}/phase2-whirlwind.png` });
  console.log(`-> ${outDir}/phase2-whirlwind.png`);
} else {
  await page.screenshot({ path: `${outDir}/${shot}.png` });
  console.log(`-> ${outDir}/${shot}.png`);
}

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
