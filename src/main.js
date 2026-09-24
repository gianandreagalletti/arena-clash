import Phaser from 'phaser';
import { CANVAS_WIDTH_PX, CANVAS_HEIGHT_PX } from './render/coords.js';
import BootScene from './render/scenes/BootScene.js';
import JoinScene from './render/scenes/JoinScene.js';
import BoostScene from './render/scenes/BoostScene.js';
import GameScene from './render/scenes/GameScene.js';

new Phaser.Game({
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
  scene: [BootScene, JoinScene, BoostScene, GameScene],
});
