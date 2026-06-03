import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { adminApi, ApiError } from './api';
import { themeVars, backgroundStyle, frameStyle } from '../lib/themeCss';
import type { Theme, ThemeTokens } from '@rtpa/shared';

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
        <label>Caption bg<input type="color" disabled={readOnly} value={tokens.caption.bg} onChange={(e) => setCaption({ bg: e.target.value })} /></label>
        <label>Caption color<input type="color" disabled={readOnly} value={tokens.caption.color} onChange={(e) => setCaption({ color: e.target.value })} /></label>

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
        {SAMPLE.map((s) => (
          <figure key={s.name} style={frameStyle(tokens)}>
            <div style={{ background: s.color }} aria-label={s.name} />
            {tokens.caption.enabled && (
              <figcaption style={{ background: tokens.caption.bg, color: tokens.caption.color }}>{s.name}</figcaption>
            )}
          </figure>
        ))}
      </div>
    </div>
  );
}
