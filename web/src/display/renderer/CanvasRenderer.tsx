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
          const motionProps = motionPropsFor(tile.motion, config.speed);
          // The animation helper functions return Record<string,unknown> which requires
          // an explicit cast to satisfy framer-motion's strict prop types at the
          // TypeScript level. The runtime values are always valid framer-motion targets.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const as = <T,>(v: unknown): T => v as T;
          return (
            <motion.div
              key={tile.photo.id}
              data-tile-id={tile.photo.id}
              style={{
                position: 'absolute',
                left: `${tile.x * 100}%`,
                top: `${tile.y * 100}%`,
                width: `${Math.round(tile.size)}px`,
                transformOrigin: 'center center',
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              initial={enter.initial as any}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              animate={as<any>({ ...enter.animate, ...motionProps.animate, rotate: tile.rotation })}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              exit={leave.exit as any}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              transition={as<any>({ ...enter.transition, ...motionProps.transition })}
            >
              <Tile tile={tile} theme={theme} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
