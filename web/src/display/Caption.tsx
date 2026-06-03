import type { CSSProperties } from 'react';
import type { ResolvedCaption } from '../lib/caption';
import { alignToJustify } from '../lib/caption';

interface CaptionProps {
  caption: ResolvedCaption;
  font: string;
  name: string;
  /** Slightly smaller text for compact previews (admin swatch). */
  compact?: boolean;
}

/**
 * Renders the uploader-name caption for one photo according to the theme's
 * caption layout. Shared by the live canvas Tile and the admin previews so the
 * display and the editor always look identical (WYSIWYG).
 *
 * Placement contract:
 *  - 'below' / 'above': normal-flow pill — the parent puts it after / before the
 *    photo.
 *  - 'inside' / 'bubble': absolutely positioned — the parent must render this
 *    inside a `position: relative` wrapper around the photo.
 */
export function Caption({ caption, font, name, compact = false }: CaptionProps) {
  const fontSize = compact ? 9 : 14;
  const pad = compact ? '1px 6px' : '2px 10px';

  if (caption.position === 'bubble') {
    const b = caption.bubble;
    const style: CSSProperties = {
      position: 'absolute',
      left: `${b.xPct}%`,
      top: `${b.yPct}%`,
      transform: `translate(-50%, -50%) rotate(${b.rotation}deg)`,
      transformOrigin: 'center center',
      padding: compact ? '1px 7px' : '4px 12px',
      borderRadius: b.radius,
      background: caption.bg,
      color: caption.color,
      border: `${b.borderWidth}px solid ${b.borderColor}`,
      boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
      fontFamily: font,
      fontSize,
      fontWeight: 700,
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    };
    return (
      <div data-testid="tile-caption" data-caption-position="bubble" style={style}>
        {name}
      </div>
    );
  }

  if (caption.position === 'inside') {
    const style: CSSProperties = {
      position: 'absolute',
      left: 0,
      right: 0,
      [caption.insideEdge]: 0,
      display: 'flex',
      justifyContent: alignToJustify(caption.align),
      padding: compact ? '2px 6px' : '5px 12px',
      background: caption.bg,
      color: caption.color,
      fontFamily: font,
      fontSize,
      fontWeight: 600,
    };
    return (
      <div data-testid="tile-caption" data-caption-position="inside" style={style}>
        <span style={{ transform: `translateX(${caption.offsetPx}px)` }}>{name}</span>
      </div>
    );
  }

  // 'below' / 'above': a normal-flow pill, aligned within the photo's width and
  // fine-nudged by offsetPx.
  const rowStyle: CSSProperties = {
    display: 'flex',
    justifyContent: alignToJustify(caption.align),
    [caption.position === 'above' ? 'marginBottom' : 'marginTop']: 6,
  };
  const pillStyle: CSSProperties = {
    display: 'inline-block',
    transform: `translateX(${caption.offsetPx}px)`,
    padding: pad,
    borderRadius: 999,
    background: caption.bg,
    color: caption.color,
    fontFamily: font,
    fontSize,
    fontWeight: 600,
  };
  return (
    <div style={rowStyle}>
      <div data-testid="tile-caption" data-caption-position={caption.position} style={pillStyle}>
        {name}
      </div>
    </div>
  );
}
