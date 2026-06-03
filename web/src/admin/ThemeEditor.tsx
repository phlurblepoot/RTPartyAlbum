import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { adminApi, ApiError } from './api';
import { themeVars, backgroundStyle, frameStyle } from '../lib/themeCss';
import { resolveCaption } from '../lib/caption';
import { Caption } from '../display/Caption';
import type { Theme, ThemeTokens, CaptionBubble } from '@rtpa/shared';

// Stand-in "photos" for the live preview. Plain colors (no external image
// requests) so the preview always renders cleanly regardless of uploads.
const SAMPLE = [
  { name: 'Alice', color: '#cdd9e3' },
  { name: 'Bob', color: '#f1ccd0' },
  { name: 'Cara', color: '#d2e6cf' },
];

export function ThemeEditor({ theme, onSaved }: { theme: Theme; onSaved: (t: Theme) => void }) {
  const [name, setName] = useState(theme.name);
  const [tokens, setTokens] = useState<ThemeTokens>(theme.tokens);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = theme.isPreset;

  // Re-seed local state when a different theme is selected for editing.
  useEffect(() => {
    setName(theme.name);
    setTokens(theme.tokens);
    setError(null);
  }, [theme]);

  function setBackground(patch: Partial<ThemeTokens['background']>) {
    setTokens({ ...tokens, background: { ...tokens.background, ...patch } });
  }
  function setFrame(patch: Partial<ThemeTokens['frame']>) {
    setTokens({ ...tokens, frame: { ...tokens.frame, ...patch } });
  }
  function setCaption(patch: Partial<ThemeTokens['caption']>) {
    setTokens({ ...tokens, caption: { ...tokens.caption, ...patch } });
  }
  function setBubble(patch: Partial<CaptionBubble>) {
    setCaption({ bubble: { ...resolveCaption(tokens.caption).bubble, ...patch } });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await adminApi.updateTheme(theme.id, { name, tokens });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? `Save failed (${err.status})` : 'Save failed');
    } finally {
      setBusy(false);
    }
  }
  async function duplicate() {
    setBusy(true);
    setError(null);
    try {
      const created = await adminApi.createTheme(`${name} (copy)`, tokens);
      onSaved(created);
    } catch (err) {
      setError(err instanceof ApiError ? `Duplicate failed (${err.status})` : 'Duplicate failed');
    } finally {
      setBusy(false);
    }
  }

  // The live preview applies the theme's CSS custom properties + background.
  // The live preview applies the theme's CSS custom properties (the `--rtpa-*`
  // namespace from `themeVars`, including `--rtpa-accent`) + the background.
  const previewStyle = {
    ...themeVars(tokens),
    ...backgroundStyle(tokens),
    fontFamily: tokens.font,
  } as CSSProperties;

  // Resolved caption (defaults filled) drives both the controls and the preview.
  const cap = resolveCaption(tokens.caption);

  return (
    <div className="theme-editor">
      <div className="editor-controls">
        {readOnly && (
          <p className="readonly-note">This is a preset — Duplicate it to make an editable copy.</p>
        )}
        <label>Name<input value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} /></label>

        <label>Background type
          <select disabled={readOnly} value={tokens.background.type} onChange={(e) => setBackground({ type: e.target.value as ThemeTokens['background']['type'] })}>
            <option value="solid">solid</option>
            <option value="gradient">gradient</option>
            <option value="image">image</option>
          </select>
        </label>
        <label>Background value<input disabled={readOnly} value={tokens.background.value} onChange={(e) => setBackground({ value: e.target.value })} /></label>

        <label>Ambient
          <select disabled={readOnly} value={tokens.ambient} onChange={(e) => setTokens({ ...tokens, ambient: e.target.value as ThemeTokens['ambient'] })}>
            <option value="none">none</option>
            <option value="bokeh">bokeh</option>
            <option value="particles">particles</option>
            <option value="glow">glow</option>
          </select>
        </label>

        <label>Frame style
          <select disabled={readOnly} value={tokens.frame.style} onChange={(e) => setFrame({ style: e.target.value as ThemeTokens['frame']['style'] })}>
            <option value="thin">thin</option>
            <option value="polaroid">polaroid</option>
            <option value="rounded">rounded</option>
            <option value="none">none</option>
          </select>
        </label>
        <label>Border color<input type="color" disabled={readOnly} value={tokens.frame.borderColor} onChange={(e) => setFrame({ borderColor: e.target.value })} /></label>
        <label>Border width<input type="number" disabled={readOnly} min={0} max={40} value={tokens.frame.borderWidth} onChange={(e) => setFrame({ borderWidth: Number(e.target.value) })} /></label>
        <label>Radius<input type="number" disabled={readOnly} min={0} max={64} value={tokens.frame.radius} onChange={(e) => setFrame({ radius: Number(e.target.value) })} /></label>
        <label>Shadow<input type="checkbox" disabled={readOnly} checked={tokens.frame.shadow} onChange={(e) => setFrame({ shadow: e.target.checked })} /></label>

        <label>Caption enabled<input type="checkbox" disabled={readOnly} checked={tokens.caption.enabled} onChange={(e) => setCaption({ enabled: e.target.checked })} /></label>
        {cap.enabled && (
          <fieldset className="caption-controls">
            <legend>Caption</legend>
            <label>Background<input type="color" disabled={readOnly} value={tokens.caption.bg} onChange={(e) => setCaption({ bg: e.target.value })} /></label>
            <label>Text color<input type="color" disabled={readOnly} value={tokens.caption.color} onChange={(e) => setCaption({ color: e.target.value })} /></label>

            <label>Position
              <select disabled={readOnly} aria-label="caption position" value={cap.position} onChange={(e) => setCaption({ position: e.target.value as typeof cap.position })}>
                <option value="below">Below photo</option>
                <option value="above">Above photo</option>
                <option value="inside">Inside photo</option>
                <option value="bubble">Bubble over photo</option>
              </select>
            </label>

            {cap.position !== 'bubble' && (
              <>
                <label>Alignment
                  <select disabled={readOnly} aria-label="caption alignment" value={cap.align} onChange={(e) => setCaption({ align: e.target.value as typeof cap.align })}>
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </label>
                <label>Fine nudge ({cap.offsetPx}px)
                  <input type="range" disabled={readOnly} aria-label="caption offset" min={-150} max={150} step={1} value={cap.offsetPx} onChange={(e) => setCaption({ offsetPx: Number(e.target.value) })} />
                </label>
              </>
            )}

            {cap.position === 'inside' && (
              <label>Inside edge
                <select disabled={readOnly} aria-label="caption inside edge" value={cap.insideEdge} onChange={(e) => setCaption({ insideEdge: e.target.value as typeof cap.insideEdge })}>
                  <option value="bottom">Bottom</option>
                  <option value="top">Top</option>
                </select>
              </label>
            )}

            {cap.position === 'bubble' && (
              <div className="bubble-controls">
                <label>Horizontal ({cap.bubble.xPct}%)<input type="range" disabled={readOnly} aria-label="bubble x" min={0} max={100} step={1} value={cap.bubble.xPct} onChange={(e) => setBubble({ xPct: Number(e.target.value) })} /></label>
                <label>Vertical ({cap.bubble.yPct}%)<input type="range" disabled={readOnly} aria-label="bubble y" min={0} max={100} step={1} value={cap.bubble.yPct} onChange={(e) => setBubble({ yPct: Number(e.target.value) })} /></label>
                <label>Rotation ({cap.bubble.rotation}°)<input type="range" disabled={readOnly} aria-label="bubble rotation" min={-45} max={45} step={1} value={cap.bubble.rotation} onChange={(e) => setBubble({ rotation: Number(e.target.value) })} /></label>
                <label>Corner radius ({cap.bubble.radius}px)<input type="range" disabled={readOnly} aria-label="bubble radius" min={0} max={40} step={1} value={cap.bubble.radius} onChange={(e) => setBubble({ radius: Number(e.target.value) })} /></label>
                <label>Border width ({cap.bubble.borderWidth}px)<input type="range" disabled={readOnly} aria-label="bubble border width" min={0} max={12} step={1} value={cap.bubble.borderWidth} onChange={(e) => setBubble({ borderWidth: Number(e.target.value) })} /></label>
                <label>Border color<input type="color" disabled={readOnly} aria-label="bubble border color" value={cap.bubble.borderColor} onChange={(e) => setBubble({ borderColor: e.target.value })} /></label>
              </div>
            )}
          </fieldset>
        )}

        <label>Font<input disabled={readOnly} value={tokens.font} onChange={(e) => setTokens({ ...tokens, font: e.target.value })} /></label>
        <label>Accent<input type="color" disabled={readOnly} value={tokens.accent} onChange={(e) => setTokens({ ...tokens, accent: e.target.value })} /></label>

        {readOnly ? (
          <button type="button" disabled={busy} onClick={() => void duplicate()}>Duplicate</button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void save()}>Save</button>
        )}
        {error && <span role="alert" className="save-error">{error}</span>}
      </div>

      <div className="theme-preview" data-testid="theme-preview" style={previewStyle}>
        {SAMPLE.map((s) => {
          const showAbove = cap.enabled && cap.position === 'above';
          const showBelow = cap.enabled && cap.position === 'below';
          const showOverlay = cap.enabled && (cap.position === 'inside' || cap.position === 'bubble');
          return (
            <figure key={s.name} style={frameStyle(tokens)}>
              {showAbove && <Caption caption={cap} font={tokens.font} name={s.name} />}
              <div style={{ position: 'relative', lineHeight: 0 }}>
                <div style={{ background: s.color, height: 96, width: '100%', borderRadius: 2 }} aria-label={s.name} />
                {showOverlay && <Caption caption={cap} font={tokens.font} name={s.name} />}
              </div>
              {showBelow && <Caption caption={cap} font={tokens.font} name={s.name} />}
            </figure>
          );
        })}
      </div>
    </div>
  );
}
