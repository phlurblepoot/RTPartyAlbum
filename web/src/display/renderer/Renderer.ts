import type { Tile } from '../rotationEngine';
import type { MotionConfig, ThemeTokens } from '@rtpa/shared';
import type { ReactNode } from 'react';

// Swappable renderer interface. The DOM renderer (CanvasRenderer) implements this;
// a PixiJS/WebGL renderer could replace it later without touching the engine.
export interface Renderer {
  renderTiles(tiles: Tile[], config: MotionConfig, theme: ThemeTokens): ReactNode;
}
