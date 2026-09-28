import Phaser from 'phaser';
import { CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX } from './render/coords.js';
import BootScene from './render/scenes/BootScene.js';
import JoinScene from './render/scenes/JoinScene.js';
import BoostScene from './render/scenes/BoostScene.js';
import GameScene from './render/scenes/GameScene.js';
import HelpScene from './render/scenes/HelpScene.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: CANVAS_WIDTH_PX,
  height: CANVAS_HEIGHT_PX,
  backgroundColor: '#000000',
  pixelArt: true, // disables antialiasing, enables roundPixels — required for crisp pixel art
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    gamepad: true,
  },
  scene: [BootScene, JoinScene, BoostScene, GameScene, HelpScene],
});

// Dev-only handle, so headless screenshot scripts can drive the running game
// (set up a board state, open the draft) without playing a round by hand.
// `import.meta.env.DEV` is false in the production bundle, so this never ships.
if (import.meta.env && import.meta.env.DEV) {
  window.__ARENA_GAME__ = game;
}
