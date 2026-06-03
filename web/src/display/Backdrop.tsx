import type { ThemeTokens } from '@rtpa/shared';
import { backgroundStyle } from '../lib/themeCss';
import './ambient.css';

interface BackdropProps {
  theme: ThemeTokens;
}

/**
 * Full-screen themed background behind all photo tiles.
 *
 * Background styling is delegated to `backgroundStyle` from `themeCss.ts` —
 * the same function the admin theme-builder preview uses — for WYSIWYG parity.
 * The plan defined a local backgroundStyle, but reusing the shared one avoids
 * duplication and ensures live display matches admin preview exactly.
 *
 * An ambient overlay layer is rendered behind the tiles (pointerEvents: none)
 * and keyed by theme.ambient via CSS class `ambient-<name>`.
 * Animations respect `prefers-reduced-motion` via the ambient.css media query.
 */
export function Backdrop({ theme }: BackdropProps) {
  return (
    <div
      data-testid="backdrop"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        ...backgroundStyle(theme),
      }}
    >
      {/* Ambient effect layer — sits above the background but below all tiles */}
      <div
        className={`ambient-layer ambient-${theme.ambient}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
      />
    </div>
  );
}
