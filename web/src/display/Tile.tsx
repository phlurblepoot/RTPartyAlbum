import type { ThemeTokens } from '@rtpa/shared';
import type { Tile as TileModel } from './rotationEngine';
import { frameStyle } from '../lib/themeCss';
import { resolveCaption } from '../lib/caption';
import { Caption } from './Caption';

interface TileProps {
  tile: TileModel;
  theme: ThemeTokens;
}

export function Tile({ tile, theme }: TileProps) {
  const { photo } = tile;
  const { frame } = theme;
  const isPolaroid = frame.style === 'polaroid';
  const caption = resolveCaption(theme.caption);
  // A bubble caption hangs over the photo's edge, so the frame must not clip it.
  const allowOverflow = caption.enabled && caption.position === 'bubble';

  // Single source of truth for the frame: the shared frameStyle (the same one
  // the Plan 5 admin theme-builder preview uses) so the live display and the
  // admin preview render frames identically (WYSIWYG parity). Layer only the
  // box-model props the shared style does not cover.
  const containerStyle: React.CSSProperties = {
    ...frameStyle(theme),
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    overflow: allowOverflow ? 'visible' : 'hidden',
  };

  const mediaStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    height: 'auto',
    borderRadius: isPolaroid ? 0 : `${Math.max(0, frame.radius - frame.borderWidth)}px`,
  };

  const showAbove = caption.enabled && caption.position === 'above';
  const showBelow = caption.enabled && caption.position === 'below';
  const showOverlay =
    caption.enabled && (caption.position === 'inside' || caption.position === 'bubble');

  const media =
    photo.mediaType === 'video' ? (
      <video style={mediaStyle} src={photo.displayUrl} poster={photo.thumbUrl} muted loop autoPlay playsInline />
    ) : (
      <img style={mediaStyle} src={photo.displayUrl} alt={photo.uploaderName} />
    );

  return (
    <div data-testid="tile-frame" style={containerStyle}>
      {showAbove && <Caption caption={caption} font={theme.font} name={photo.uploaderName} />}

      {/* Photo wrapper is the positioning context for inside/bubble overlays.
          Clipped for the inside band (so it follows the photo's rounded corners),
          visible for a bubble so it can hang over the edge. */}
      <div style={{ position: 'relative', lineHeight: 0, overflow: allowOverflow ? 'visible' : 'hidden' }}>
        {media}
        {showOverlay && <Caption caption={caption} font={theme.font} name={photo.uploaderName} />}
      </div>

      {showBelow && <Caption caption={caption} font={theme.font} name={photo.uploaderName} />}
    </div>
  );
}
