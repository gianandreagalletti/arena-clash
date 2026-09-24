import Phaser from 'phaser';
import { generateAllTextures } from '../art/textures.js';
import { PIXEL_FONT_LOAD_NAME } from '../art/font.js';

// Runs once before any real scene: waits for the pixel font (so no scene ever
// draws blurry/half-loaded text) and generates every texture from
// render/art/{palette,sprites}.js into the shared texture manager, keyed per
// the contract in render/art/textures.js — every later scene just reads them.
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Loading...', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#e7e6d6',
      })
      .setOrigin(0.5);
  }

  async create() {
    const { coverOverhangPx } = generateAllTextures(this);
    // Shared across scenes via the game-wide registry, so arenaRenderer.js
    // reads the exact same number textures.js used to generate the 'cover'
    // texture, instead of a second hardcoded copy of it.
    this.registry.set('coverOverhangPx', coverOverhangPx);

    await loadPixelFontWithTimeout();
    this.scene.start('JoinScene');
  }
}

function loadPixelFontWithTimeout(timeoutMs = 2000) {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const load = document.fonts.load(`16px "${PIXEL_FONT_LOAD_NAME}"`).catch(() => {});
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  return Promise.race([load, timeout]);
}
