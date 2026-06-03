import type { ThemeTokens } from '@rtpa/shared';
import type { Tile as TileModel } from './rotationEngine';
import { frameStyle } from '../lib/themeCss';

interface TileProps {
  tile: TileModel;
  theme: ThemeTokens;
}

export function Tile({ tile, theme }: TileProps) {
  const { photo } = tile;
  const { frame, caption } = theme;
  const isPolaroid = frame.style === 'polaroid';

  // Single source of truth for the frame: the shared frameStyle (the same one
  // the Plan 5 admin theme-builder preview uses) so the live display and the
  // admin preview render frames identically (WYSIWYG parity). Layer only the
  // box-model props the shared style does not cover.
  const containerStyle: React.CSSProperties = {
    ...frameStyle(theme),
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  };

  const mediaStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    height: 'auto',
    borderRadius: isPolaroid ? 0 : `${Math.max(0, frame.radius - frame.borderWidth)}px`,
  };

  return (
    <div data-testid="tile-frame" style={containerStyle}>
      {photo.mediaType === 'video' ? (
        <video
          style={mediaStyle}
          src={photo.displayUrl}
          poster={photo.thumbUrl}
          muted
          loop
          autoPlay
          playsInline
        />
      ) : (
        <img style={mediaStyle} src={photo.displayUrl} alt={photo.uploaderName} />
      )}
      {caption.enabled && (
        <div
          data-testid="tile-caption"
          style={{
            marginTop: 6,
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: 999,
            background: caption.bg,
            color: caption.color,
            fontFamily: theme.font,
            fontSize: 14,
          }}
        >
          {photo.uploaderName}
        </div>
      )}
    </div>
  );
}
