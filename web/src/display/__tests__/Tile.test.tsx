import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tile } from '../Tile';
import { makeTile } from '../rotationEngine';
import { makePhoto, testConfig, constRng } from './fixtures';
import { PRESET_THEME_TOKENS } from '../renderer/__tests__/testTheme';

describe('Tile', () => {
  it('renders an img for image media', () => {
    const tile = makeTile(makePhoto('p1', { mediaType: 'image' }), testConfig, 0, constRng(0.5));
    const { container } = render(<Tile tile={tile} theme={PRESET_THEME_TOKENS} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/media/display/p1.jpg');
  });

  it('renders a muted looping autoplay playsInline video for video media', () => {
    const tile = makeTile(
      makePhoto('v1', { mediaType: 'video', displayUrl: '/media/display/v1.mp4', durationMs: 5000 }),
      testConfig, 0, constRng(0.5),
    );
    const { container } = render(<Tile tile={tile} theme={PRESET_THEME_TOKENS} />);
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.getAttribute('playsinline')).not.toBeNull();
    expect(video.getAttribute('poster')).toBe('/media/thumb/v1.jpg');
  });

  it('shows uploader caption when theme caption enabled', () => {
    const tile = makeTile(makePhoto('p2', { uploaderName: 'Alice' }), testConfig, 0, constRng(0.5));
    render(<Tile tile={tile} theme={PRESET_THEME_TOKENS} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('hides caption when theme caption disabled', () => {
    const tile = makeTile(makePhoto('p3', { uploaderName: 'Bob' }), testConfig, 0, constRng(0.5));
    const theme = { ...PRESET_THEME_TOKENS, caption: { ...PRESET_THEME_TOKENS.caption, enabled: false } };
    render(<Tile tile={tile} theme={theme} />);
    expect(screen.queryByText('Bob')).toBeNull();
  });
});
