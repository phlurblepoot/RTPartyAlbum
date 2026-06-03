import { AnimatePresence, motion } from 'framer-motion';
import type { MotionConfig, ThemeTokens } from '@rtpa/shared';
import type { Tile as TileModel } from '../rotationEngine';
import { Tile } from '../Tile';
import { motionPropsFor } from '../motion';
import { enterVariant, leaveVariant } from '../animations';

interface CanvasRendererProps {
  tiles: TileModel[];
  config: MotionConfig;
  theme: ThemeTokens;
}

export function CanvasRenderer({ tiles, config, theme }: CanvasRendererProps) {
  return (
    <div
      data-testid="canvas-surface"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      <AnimatePresence>
        {tiles.map((tile) => {
          const enter = enterVariant(tile.enter);
          const leave = leaveVariant(tile.leave);
          const glide = motionPropsFor(tile.motion, config.speed);
          const size = Math.round(tile.size);
          // x/y are 0..1 (rotationEngine.makeTile). Anchor top-left but map the
          // normalized position into the safe band [0, canvas - size] so a tile
          // near x=1 / y=1 stays fully on-canvas instead of overflowing by `size`.
          const left = `calc(${tile.x} * (100% - ${size}px))`;
          const top = `calc(${tile.y} * (100% - ${size}px))`;
          return (
            // OUTER: the keyed AnimatePresence child. Owns positioning + the
            // one-shot ENTER (initial/animate) and EXIT (on removal). No glide here,
            // so the entrance settles and stays put instead of looping forever.
            <motion.div
              key={tile.photo.id}
              data-tile-id={tile.photo.id}
              style={{
                position: 'absolute',
                left,
                top,
                width: `${size}px`,
                transformOrigin: 'center center',
              }}
              initial={enter.initial}
              animate={enter.animate}
              exit={leave.exit}
              transition={enter.transition}
            >
              {/* MIDDLE: continuous GLIDE loop (x/y wander or orbit rotate). Its
                  transforms compose with the parent's instead of colliding, so the
                  infinite repeat never overrides the entrance's opacity/scale. */}
              <motion.div animate={glide.animate} transition={glide.transition}>
                {/* INNERMOST: static per-tile tilt. Lives on a plain div so it
                    neither fights orbit's animated rotate nor the entrance. */}
                <div style={{ transform: `rotate(${tile.rotation}deg)` }}>
                  <Tile tile={tile} theme={theme} />
                </div>
              </motion.div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
