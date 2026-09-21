import Phaser from 'phaser';
import { ARENA_WIDTH_TILES, ARENA_HEIGHT_TILES, TILE_SIZE_PX } from './sim/config/balance.js';
import JoinScene from './render/scenes/JoinScene.js';
import GameScene from './render/scenes/GameScene.js';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: ARENA_WIDTH_TILES * TILE_SIZE_PX,
  height: ARENA_HEIGHT_TILES * TILE_SIZE_PX,
  backgroundColor: '#000000',
  input: {
    gamepad: true,
  },
  scene: [JoinScene, GameScene],
});
