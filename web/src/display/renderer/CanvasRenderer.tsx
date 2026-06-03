import { AnimatePresence, motion } from 'framer-motion';
import type { MotionConfig, ThemeTokens } from '@rtpa/shared';
import type { Tile as TileModel } from '../rotationEngine';
import { Tile } from '../Tile';
import { motionPropsFor, motionTravelPx } from '../motion';
import { enterVariant, leaveVariant } from '../animations';

interface CanvasRendererProps {
  tiles: TileModel[];
  config: MotionConfig;
  theme: ThemeTokens;
  /**
   * When true (prefers-reduced-motion), tiles render with a quiet fade-in/out
   * and a static tilt — no looping glide and no entrance/exit choreography, but
   * still a gentle opacity transition (never an instant pop).
   */
  reducedMotion?: boolean;
}

/** Minimum gutter (px) every tile keeps from each canvas edge. */
export const EDGE_MARGIN_PX = 28;
/** Extra vertical room (px) reserved for the caption pill below a photo. */
export const CAPTION_ALLOWANCE_PX = 34;

/**
 * Place a tile inside a safe band that keeps it fully on-canvas. `x`/`y` are
 * 0..1 (rotationEngine.makeTile). The band insets from each edge by a fixed
 * margin PLUS the tile's glide travel, so a gliding tile never crosses the edge.
 * The vertical band reserves the tile's true rendered HEIGHT (width × aspect,
 * plus the caption), so portrait photos no longer overflow the bottom.
 */
export function tilePosition(tile: TileModel, captionEnabled: boolean) {
  const size = Math.round(tile.size);
  const inset = EDGE_MARGIN_PX + motionTravelPx(tile.motion);
  const aspect =
    tile.photo.width > 0 && tile.photo.height > 0 ? tile.photo.height / tile.photo.width : 1;
  const height = Math.round(size * aspect) + (captionEnabled ? CAPTION_ALLOWANCE_PX : 0);
  const left = `calc(${inset}px + ${tile.x} * (100% - ${size + inset * 2}px))`;
  const top = `calc(${inset}px + ${tile.y} * (100% - ${height + inset * 2}px))`;
  return { size, left, top };
}

export function CanvasRenderer({ tiles, config, theme, reducedMotion = false }: CanvasRendererProps) {
  const captionEnabled = theme.caption.enabled;

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
          const { size, left, top } = tilePosition(tile, captionEnabled);

          if (reducedMotion) {
            // Calm path: a gentle fade to/from its resting place, static tilt,
            // no glide loop. `exit` + the leaving-driven fade ensure removal is a
            // soft fade rather than an instant pop.
            return (
              <motion.div
                key={tile.photo.id}
                data-tile-id={tile.photo.id}
                style={{ position: 'absolute', left, top, width: `${size}px`, transformOrigin: 'center center' }}
                initial={{ opacity: 0 }}
                animate={tile.leaving ? { opacity: 0 } : { opacity: 1, rotate: tile.rotation }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
              >
                <Tile tile={tile} theme={theme} />
              </motion.div>
            );
          }

          return (
            // OUTER: the keyed AnimatePresence child. Owns positioning and the
            // one-shot ENTER (initial→animate) and LEAVE. The leave plays as soon
            // as the engine flags the tile `leaving` (driving `animate` to the
            // leave target), with `exit` as a fallback for hard removals (a photo
            // hidden/deleted, which drops straight out of the array). No glide
            // here, so the entrance settles and stays put instead of looping.
            <motion.div
              key={tile.photo.id}
              data-tile-id={tile.photo.id}
              style={{ position: 'absolute', left, top, width: `${size}px`, transformOrigin: 'center center' }}
              initial={enter.initial}
              animate={tile.leaving ? leave.exit : enter.animate}
              exit={leave.exit}
              transition={tile.leaving ? undefined : enter.transition}
            >
              {/* MIDDLE: continuous GLIDE loop (x/y wander or circular orbit). Its
                  transforms compose with the parent's instead of colliding, so the
                  infinite repeat never overrides the entrance/exit. Paused while
                  leaving so the exit reads cleanly. */}
              <motion.div
                animate={tile.leaving ? { x: 0, y: 0 } : glide.animate}
                transition={tile.leaving ? { duration: 0.3 } : glide.transition}
              >
                {/* INNERMOST: static per-tile tilt (small, never inverted). Lives on
                    a plain div so it neither fights the glide nor the entrance. */}
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
