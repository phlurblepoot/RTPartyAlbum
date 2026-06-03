import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { adminApi, ApiError } from './api';
import { themeVars, backgroundStyle, frameStyle } from '../lib/themeCss';
import type { Theme, ThemeTokens } from '@rtpa/shared';

const SAMPLE = [
  { name: 'Alice', src: '/media/thumb/sample1.jpg' },
  { name: 'Bob', src: '/media/thumb/sample2.jpg' },
  { name: 'Cara', src: '/media/thumb/sample3.jpg' },
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
  // `themeVars` emits the `--rtpa-*` namespace; we additionally expose the
  // un-prefixed `--accent` consumed by the preview chrome.
  const previewStyle = {
    ...themeVars(tokens),
    ...backgroundStyle(tokens),
    '--accent': tokens.accent,
    fontFamily: tokens.font,
  } as CSSProperties;

  return (
    <div className="theme-editor">
      <div className="editor-controls">
        <label>Name<input value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} /></label>

        <label>Background type
          <select value={tokens.background.type} onChange={(e) => setBackground({ type: e.target.value as ThemeTokens['background']['type'] })}>
            <option value="solid">solid</option>
            <option value="gradient">gradient</option>
            <option value="image">image</option>
          </select>
        </label>
        <label>Background value<input value={tokens.background.value} onChange={(e) => setBackground({ value: e.target.value })} /></label>

        <label>Ambient
          <select value={tokens.ambient} onChange={(e) => setTokens({ ...tokens, ambient: e.target.value as ThemeTokens['ambient'] })}>
            <option value="none">none</option>
            <option value="bokeh">bokeh</option>
            <option value="particles">particles</option>
            <option value="glow">glow</option>
          </select>
        </label>

        <label>Frame style
          <select value={tokens.frame.style} onChange={(e) => setFrame({ style: e.target.value as ThemeTokens['frame']['style'] })}>
            <option value="thin">thin</option>
            <option value="polaroid">polaroid</option>
            <option value="rounded">rounded</option>
            <option value="none">none</option>
          </select>
        </label>
        <label>Border color<input type="color" value={tokens.frame.borderColor} onChange={(e) => setFrame({ borderColor: e.target.value })} /></label>
        <label>Border width<input type="number" min={0} max={40} value={tokens.frame.borderWidth} onChange={(e) => setFrame({ borderWidth: Number(e.target.value) })} /></label>
        <label>Radius<input type="number" min={0} max={64} value={tokens.frame.radius} onChange={(e) => setFrame({ radius: Number(e.target.value) })} /></label>
        <label>Shadow<input type="checkbox" checked={tokens.frame.shadow} onChange={(e) => setFrame({ shadow: e.target.checked })} /></label>

        <label>Caption enabled<input type="checkbox" checked={tokens.caption.enabled} onChange={(e) => setCaption({ enabled: e.target.checked })} /></label>
        <label>Caption bg<input type="color" value={tokens.caption.bg} onChange={(e) => setCaption({ bg: e.target.value })} /></label>
        <label>Caption color<input type="color" value={tokens.caption.color} onChange={(e) => setCaption({ color: e.target.value })} /></label>

        <label>Font<input value={tokens.font} onChange={(e) => setTokens({ ...tokens, font: e.target.value })} /></label>
        <label>Accent<input type="color" value={tokens.accent} onChange={(e) => setTokens({ ...tokens, accent: e.target.value })} /></label>

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
            <img src={s.src} alt={s.name} />
            {tokens.caption.enabled && (
              <figcaption style={{ background: tokens.caption.bg, color: tokens.caption.color }}>{s.name}</figcaption>
            )}
          </figure>
        ))}
      </div>
    </div>
  );
}
