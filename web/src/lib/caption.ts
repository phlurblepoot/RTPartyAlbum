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
  corner: 'top-right',
  offsetX: -6,
  offsetY: -6,
  width: 104,
  height: 40,
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
  // Build the bubble field-by-field (rather than spreading the stored object) so a
  // bubble saved under an older shape can't leak stale keys into the resolved value.
  const b = caption.bubble;
  return {
    enabled: caption.enabled,
    bg: caption.bg,
    color: caption.color,
    position: caption.position ?? 'below',
    align: caption.align ?? 'left',
    offsetPx: caption.offsetPx ?? 0,
    insideEdge: caption.insideEdge ?? 'bottom',
    bubble: {
      corner: b?.corner ?? DEFAULT_BUBBLE.corner,
      offsetX: b?.offsetX ?? DEFAULT_BUBBLE.offsetX,
      offsetY: b?.offsetY ?? DEFAULT_BUBBLE.offsetY,
      width: b?.width ?? DEFAULT_BUBBLE.width,
      height: b?.height ?? DEFAULT_BUBBLE.height,
      rotation: b?.rotation ?? DEFAULT_BUBBLE.rotation,
      radius: b?.radius ?? DEFAULT_BUBBLE.radius,
      borderWidth: b?.borderWidth ?? DEFAULT_BUBBLE.borderWidth,
      borderColor: b?.borderColor ?? DEFAULT_BUBBLE.borderColor,
    },
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
