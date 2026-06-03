import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { MotionConfig, ThemeTokens } from '@rtpa/shared';
import type { Tile as TileModel } from '../rotationEngine';
import { Tile } from '../Tile';
import { motionPropsFor, motionTravelPx } from '../motion';
import { enterVariant, leaveVariant } from '../animations';
import { resolveCaption } from '../../lib/caption';

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
export function tilePosition(tile: TileModel, reserveCaptionHeight: boolean) {
  const size = Math.round(tile.size);
  const inset = EDGE_MARGIN_PX + motionTravelPx(tile.motion);
  const aspect =
    tile.photo.width > 0 && tile.photo.height > 0 ? tile.photo.height / tile.photo.width : 1;
  const height = Math.round(size * aspect) + (reserveCaptionHeight ? CAPTION_ALLOWANCE_PX : 0);
  const left = `calc(${inset}px + ${tile.x} * (100% - ${size + inset * 2}px))`;
  const top = `calc(${inset}px + ${tile.y} * (100% - ${height + inset * 2}px))`;
  return { size, left, top };
}

interface CanvasTileProps {
  tile: TileModel;
  theme: ThemeTokens;
  speed: number;
  reserveCaptionHeight: boolean;
  reducedMotion: boolean;
}

/**
 * A single canvas tile. Memoized so the once-per-tick re-render of the parent does
 * NOT re-render unchanged tiles — that re-render was handing framer-motion a fresh
 * `animate` keyframe object every second, restarting the long glide loop so photos
 * only ever played its first second ("floating in place"). With stable props the
 * glide now runs uninterrupted, and each motion style's distinct path is visible.
 */
const CanvasTile = memo(function CanvasTile({
  tile,
  theme,
  speed,
  reserveCaptionHeight,
  reducedMotion,
}: CanvasTileProps) {
  const enter = enterVariant(tile.enter);
  const leave = leaveVariant(tile.leave);
  const glide = motionPropsFor(tile.motion, speed);
  const { size, left, top } = tilePosition(tile, reserveCaptionHeight);
  const positionStyle = {
    position: 'absolute' as const,
    left,
    top,
    width: `${size}px`,
    transformOrigin: 'center center' as const,
  };

  if (reducedMotion) {
    // Calm path: a gentle fade to/from its resting place, static tilt, no glide loop.
    return (
      <motion.div
        data-tile-id={tile.photo.id}
        style={positionStyle}
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
    // OUTER: owns positioning and the one-shot ENTER (initial→animate, always
    // upright) and LEAVE. The leave plays as soon as the engine flags the tile
    // `leaving`, with `exit` as the fallback for hard removals (hide/delete).
    <motion.div
      data-tile-id={tile.photo.id}
      style={positionStyle}
      initial={enter.initial}
      animate={tile.leaving ? leave.exit : enter.animate}
      exit={leave.exit}
      transition={tile.leaving ? undefined : enter.transition}
    >
      {/* MIDDLE: continuous GLIDE loop (the motion style). Composes with the parent
          instead of colliding. Paused (and scale reset) while leaving. */}
      <motion.div
        animate={tile.leaving ? { x: 0, y: 0, scale: 1 } : glide.animate}
        transition={tile.leaving ? { duration: 0.3 } : glide.transition}
      >
        {/* INNERMOST: static per-tile resting tilt (small, never inverted). */}
        <div style={{ transform: `rotate(${tile.rotation}deg)` }}>
          <Tile tile={tile} theme={theme} />
        </div>
      </motion.div>
    </motion.div>
  );
});

export function CanvasRenderer({ tiles, config, theme, reducedMotion = false }: CanvasRendererProps) {
  // Only below/above captions add vertical height to a tile; inside/bubble overlay
  // the photo, so they don't need the safe-band height reservation.
  const cap = resolveCaption(theme.caption);
  const reserveCaptionHeight = cap.enabled && (cap.position === 'below' || cap.position === 'above');

  return (
    <div
      data-testid="canvas-surface"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      <AnimatePresence>
        {tiles.map((tile) => (
          <CanvasTile
            key={tile.photo.id}
            tile={tile}
            theme={theme}
            speed={config.speed}
            reserveCaptionHeight={reserveCaptionHeight}
            reducedMotion={reducedMotion}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
