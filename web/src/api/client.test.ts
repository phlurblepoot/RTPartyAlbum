import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PublicEvent, Photo } from './types';
import { getPublicEvent, getPublicPhotos, uploadFiles } from './client';

const fakeEvent: PublicEvent = {
  code: 'PARTY1',
  name: 'Sam & Lee',
  status: 'active',
  uploadEnabled: true,
  theme: {
    id: 'preset-midnight-gala',
    name: 'Midnight Gala',
    isPreset: true,
    tokens: {
      background: { type: 'solid', value: '#10131c' },
      ambient: 'none',
      frame: { style: 'thin', borderColor: '#fff', borderWidth: 2, radius: 8, shadow: true },
      caption: { enabled: true, bg: '#000', color: '#fff' },
      font: 'Inter, sans-serif',
      accent: '#c9a227',
    },
  },
  motionConfig: {
    motionWeights: { drift: 5, current: 2, orbit: 1, mosaic: 2 },
    speed: 1,
    maxOnCanvas: 24,
    dwell: { enabled: true, durationMs: 45000, varianceMs: 15000 },
    enterWeights: { flyInEdge: 3, scalePop: 2, fadeGrow: 2, spinIn: 1, dropBounce: 2 },
    leaveWeights: { driftOffEdge: 3, shrinkFade: 3, spinOut: 1, slideAway: 2 },
    baseSize: 220,
    sizeVariance: 0.4,
  },
};

describe('getPublicEvent', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(fakeEvent), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it('fetches the by-code endpoint and returns the parsed event', async () => {
    const result = await getPublicEvent('PARTY1');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/events/by-code/PARTY1', expect.any(Object));
    expect(result).toEqual(fakeEvent);
  });

  it('throws with the status when the event is missing (404)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;
    await expect(getPublicEvent('NOPE')).rejects.toMatchObject({ status: 404 });
  });

  it('URL-encodes the code', async () => {
    await getPublicEvent('a b');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/events/by-code/a%20b', expect.any(Object));
  });
});

describe('getPublicPhotos', () => {
  it('fetches the photos endpoint and returns the array', async () => {
    const photos: Photo[] = [];
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(photos), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ) as unknown as typeof fetch;
    const result = await getPublicPhotos('PARTY1');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/events/by-code/PARTY1/photos', expect.any(Object));
    expect(result).toEqual(photos);
  });
});

describe('uploadFiles', () => {
  class MockXHR {
    static instances: MockXHR[] = [];
    upload = { onprogress: null as null | ((e: ProgressEvent) => void) };
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    status = 0;
    responseText = '';
    method = '';
    url = '';
    sentBody: FormData | null = null;
    constructor() {
      MockXHR.instances.push(this);
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    send(body: FormData) {
      this.sentBody = body;
    }
  }

  beforeEach(() => {
    MockXHR.instances = [];
    // @ts-expect-error overriding for test
    globalThis.XMLHttpRequest = MockXHR;
  });
  afterEach(() => vi.restoreAllMocks());

  it('POSTs multipart to the upload endpoint with name, deviceId, and files; reports progress; resolves photos', async () => {
    const onProgress = vi.fn();
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const responsePhotos: Photo[] = [];

    const promise = uploadFiles('PARTY1', {
      uploaderName: 'Robin',
      deviceId: 'dev-123',
      files: [file],
      onProgress,
    });

    const xhr = MockXHR.instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/events/by-code/PARTY1/upload');
    expect(xhr.sentBody?.get('uploaderName')).toBe('Robin');
    expect(xhr.sentBody?.get('deviceId')).toBe('dev-123');
    expect(xhr.sentBody?.getAll('files')).toHaveLength(1);

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
    expect(onProgress).toHaveBeenCalledWith(0.5);

    xhr.status = 200;
    xhr.responseText = JSON.stringify(responsePhotos);
    xhr.onload?.();

    await expect(promise).resolves.toEqual(responsePhotos);
  });

  it('rejects with status on a non-2xx response', async () => {
    const promise = uploadFiles('PARTY1', {
      uploaderName: 'Robin',
      deviceId: 'dev-123',
      files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })],
    });
    const xhr = MockXHR.instances[0];
    xhr.status = 403;
    xhr.responseText = 'uploads closed';
    xhr.onload?.();
    await expect(promise).rejects.toMatchObject({ status: 403 });
  });

  it('exposes the parsed server error code on rejection', async () => {
    const promise = uploadFiles('PARTY1', {
      uploaderName: 'Robin',
      deviceId: 'dev-123',
      files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })],
    });
    const xhr = MockXHR.instances[0];
    xhr.status = 403;
    xhr.responseText = JSON.stringify({ error: 'uploads_closed' });
    xhr.onload?.();
    await expect(promise).rejects.toMatchObject({ status: 403, code: 'uploads_closed' });
  });

  it('yields a null code for a non-JSON/empty error body', async () => {
    const promise = uploadFiles('PARTY1', {
      uploaderName: 'Robin',
      deviceId: 'dev-123',
      files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })],
    });
    const xhr = MockXHR.instances[0];
    xhr.status = 500;
    xhr.responseText = '';
    xhr.onload?.();
    await expect(promise).rejects.toMatchObject({ status: 500, code: null });
  });
});
