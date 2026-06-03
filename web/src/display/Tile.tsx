import type { ThemeTokens } from '@rtpa/shared';
import type { Tile as TileModel } from './rotationEngine';

interface TileProps {
  tile: TileModel;
  theme: ThemeTokens;
}

export function Tile({ tile, theme }: TileProps) {
  const { photo } = tile;
  const { frame, caption } = theme;
  const isPolaroid = frame.style === 'polaroid';

  const frameStyle: React.CSSProperties = {
    boxSizing: 'border-box',
    border: frame.style === 'none' ? 'none' : `${frame.borderWidth}px solid ${frame.borderColor}`,
    borderRadius: `${frame.radius}px`,
    boxShadow: frame.shadow ? '0 10px 30px rgba(0,0,0,0.45)' : 'none',
    background: isPolaroid ? '#ffffff' : 'transparent',
    padding: isPolaroid ? '8px 8px 28px 8px' : 0,
    overflow: 'hidden',
    width: '100%',
  };

  const mediaStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    height: 'auto',
    borderRadius: isPolaroid ? 0 : `${Math.max(0, frame.radius - frame.borderWidth)}px`,
  };

  return (
    <div data-testid="tile-frame" style={frameStyle}>
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
