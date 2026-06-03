import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { adminApi } from '../api';
import { DEFAULT_MOTION_CONFIG } from '@rtpa/shared';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('adminApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('login POSTs password with credentials', async () => {
    await adminApi.login('hunter2');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ password: 'hunter2' });
  });

  it('me GETs /api/admin/me', async () => {
    await adminApi.me();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/me');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('logout POSTs /api/admin/logout (204, no json parse)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await adminApi.logout();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/logout');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('listEvents GETs /api/admin/events', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await adminApi.listEvents();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/events');
  });

  it('createEvent POSTs name', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await adminApi.createEvent('My Party');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/events');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'My Party' });
  });

  it('setUploadState POSTs upload-state with enabled', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await adminApi.setUploadState('e1', false);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/events/e1/upload-state');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ enabled: false });
  });

  it('setMotion PUTs motionConfig', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await adminApi.setMotion('e1', DEFAULT_MOTION_CONFIG);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/events/e1/motion');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ motionConfig: DEFAULT_MOTION_CONFIG });
  });

  it('setEventTheme PUTs themeId', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await adminApi.setEventTheme('e1', 'preset-neon-night');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/events/e1/theme');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ themeId: 'preset-neon-night' });
  });

  it('hidePhoto POSTs hidden flag', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await adminApi.hidePhoto('p1', true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/photos/p1/hide');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ hidden: true });
  });

  it('deletePhoto DELETEs', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await adminApi.deletePhoto('p1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/photos/p1');
    expect(init.method).toBe('DELETE');
  });

  it('createTheme POSTs name+tokens', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    const tokens = { background: { type: 'solid', value: '#000' } } as never;
    await adminApi.createTheme('Mine', tokens);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/themes');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'Mine', tokens });
  });

  it('saveSettings PUTs partial', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await adminApi.saveSettings({ publicBaseUrl: 'https://x.test' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/settings');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ publicBaseUrl: 'https://x.test' });
  });

  it('changePassword POSTs current+next', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await adminApi.changePassword('old', 'new');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/password');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ current: 'old', next: 'new' });
  });

  it('qrUrl and exportUrl build event urls', () => {
    expect(adminApi.qrUrl('e1')).toBe('/api/admin/events/e1/qr');
    expect(adminApi.exportUrl('e1')).toBe('/api/admin/events/e1/export');
  });

  it('throws ApiError on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 401 }));
    await expect(adminApi.me()).rejects.toMatchObject({ status: 401 });
  });
});
