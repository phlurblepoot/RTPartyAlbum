export type MediaType = 'image' | 'video';
export type EventStatus = 'active' | 'paused' | 'ended';

export type MotionStyle = 'drift' | 'current' | 'orbit' | 'mosaic';
export type EnterAnimation = 'flyInEdge' | 'scalePop' | 'fadeGrow' | 'spinIn' | 'dropBounce';
export type LeaveAnimation = 'driftOffEdge' | 'shrinkFade' | 'spinOut' | 'slideAway';

export interface MotionConfig {
  motionWeights: Record<MotionStyle, number>;
  speed: number;            // multiplier 0.25..3
  maxOnCanvas: number;      // hard cap
  dwell: { enabled: boolean; durationMs: number; varianceMs: number };
  enterWeights: Record<EnterAnimation, number>;
  leaveWeights: Record<LeaveAnimation, number>;
  baseSize: number;         // px, tile longest edge baseline
  sizeVariance: number;     // 0..1
}

export interface ThemeTokens {
  background: { type: 'solid' | 'gradient' | 'image'; value: string };
  ambient: 'none' | 'bokeh' | 'particles' | 'glow';
  frame: {
    style: 'thin' | 'polaroid' | 'rounded' | 'none';
    borderColor: string;
    borderWidth: number;
    radius: number;
    shadow: boolean;
  };
  caption: { enabled: boolean; bg: string; color: string };
  font: string;
  accent: string;
}

export interface Theme {
  id: string;
  name: string;
  isPreset: boolean;
  tokens: ThemeTokens;
}

export interface MediaLimits {
  photoMaxBytes: number;
  videoMaxBytes: number;
  videoMaxDurationSec: number;
}

export interface EventSummary {
  id: string;
  code: string;
  name: string;
  createdAt: string;       // ISO 8601
  isActive: boolean;
  uploadEnabled: boolean;
  status: EventStatus;
  themeId: string;
  photoCount: number;
}

export interface EventDetail extends EventSummary {
  motionConfig: MotionConfig;
}

// Public event view for upload + display pages
export interface PublicEvent {
  code: string;
  name: string;
  status: EventStatus;
  uploadEnabled: boolean;
  theme: Theme;
  motionConfig: MotionConfig;
}

export interface Photo {
  id: string;
  eventId: string;
  uploaderName: string;
  mediaType: MediaType;
  width: number;
  height: number;
  durationMs: number | null;
  createdAt: string;       // ISO 8601
  isHidden: boolean;
  isPriority: boolean;     // host-favorited: shown on the canvas more often
  displayUrl: string;      // image jpeg OR processed mp4
  thumbUrl: string;        // jpeg poster/thumbnail
}

export interface PhotoAdmin extends Photo {
  deviceId: string;
  userAgent: string;
  ipAddress: string;
}

export interface ServerToClientEvents {
  'photo:added': (photo: Photo) => void;
  'photo:hidden': (payload: { id: string }) => void;
  'photo:deleted': (payload: { id: string }) => void;
  'photo:updated': (photo: Photo) => void;
  'settings:updated': (motionConfig: MotionConfig) => void;
  'theme:updated': (theme: Theme) => void;
}

export interface ClientToServerEvents {
  join: (eventCode: string) => void;
}
