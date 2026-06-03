import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { downscaleImage } from './downscaleImage';

class MockImage {
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  width = 0;
  height = 0;
  private _src = '';
  set src(_value: string) {
    this._src = _value;
    // simulate async decode resolving with the dimensions assigned by the test
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this._src;
  }
}

let nextImageDims = { width: 0, height: 0 };

beforeEach(() => {
  // @ts-expect-error test override
  globalThis.Image = function () {
    const img = new MockImage();
    img.width = nextImageDims.width;
    img.height = nextImageDims.height;
    return img;
  };
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  globalThis.URL.revokeObjectURL = vi.fn();

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);

  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
  ) {
    cb(new Blob(['resized'], { type: 'image/jpeg' }));
  });
});

afterEach(() => vi.restoreAllMocks());

describe('downscaleImage', () => {
  it('passes videos through unchanged', async () => {
    const video = new File(['v'], 'clip.mp4', { type: 'video/mp4' });
    const out = await downscaleImage(video);
    expect(out).toBe(video);
  });

  it('passes non-image/non-video files through unchanged', async () => {
    const other = new File(['x'], 'note.txt', { type: 'text/plain' });
    const out = await downscaleImage(other);
    expect(out).toBe(other);
  });

  it('passes small images through unchanged (longest edge <= maxEdge)', async () => {
    nextImageDims = { width: 800, height: 600 };
    const img = new File(['i'], 'small.jpg', { type: 'image/jpeg' });
    const out = await downscaleImage(img, 1600, 0.85);
    expect(out).toBe(img);
  });

  it('resizes large images and returns a new jpeg File preserving the basename', async () => {
    nextImageDims = { width: 4000, height: 3000 };
    const img = new File(['i'], 'big.jpg', { type: 'image/jpeg' });
    const out = await downscaleImage(img, 1600, 0.85);
    expect(out).not.toBe(img);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('big.jpg');
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('passes HEIC through unchanged (browsers cannot canvas-decode it; server converts)', async () => {
    nextImageDims = { width: 4000, height: 3000 };
    const heic = new File(['i'], 'IMG_1234.HEIC', { type: '' });
    const out = await downscaleImage(heic, 1600, 0.85);
    expect(out).toBe(heic); // original passed straight through to upload
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  });
});
