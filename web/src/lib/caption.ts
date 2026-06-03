import type {
  ThemeTokens,
  CaptionPosition,
  CaptionAlign,
  CaptionInsideEdge,
  CaptionBubble,
} from '../api/types';

/** Caption tokens with every optional layout field resolved to a concrete value. */
export interface ResolvedCaption {
  enabled: boolean;
  bg: string;
  color: string;
  position: CaptionPosition;
  align: CaptionAlign;
  offsetPx: number;
  insideEdge: CaptionInsideEdge;
  bubble: CaptionBubble;
}

export const DEFAULT_BUBBLE: CaptionBubble = {
  xPct: 84,
  yPct: 6,
  rotation: -8,
  radius: 14,
  borderWidth: 2,
  borderColor: '#ffffff',
};

/**
 * Fill in defaults for the optional caption layout fields so the renderer and the
 * admin controls always have concrete values. Themes saved before these fields
 * existed (and the built-in presets) resolve to the original "below / left" look.
 */
export function resolveCaption(caption: ThemeTokens['caption']): ResolvedCaption {
  return {
    enabled: caption.enabled,
    bg: caption.bg,
    color: caption.color,
    position: caption.position ?? 'below',
    align: caption.align ?? 'left',
    offsetPx: caption.offsetPx ?? 0,
    insideEdge: caption.insideEdge ?? 'bottom',
    bubble: { ...DEFAULT_BUBBLE, ...(caption.bubble ?? {}) },
  };
}

const JUSTIFY: Record<CaptionAlign, 'flex-start' | 'center' | 'flex-end'> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
};

export function alignToJustify(align: CaptionAlign) {
  return JUSTIFY[align];
}
