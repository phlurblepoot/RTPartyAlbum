import type {
  EventSummary, EventDetail, PhotoAdmin, MotionConfig, Theme, ThemeTokens, MediaLimits,
} from '@rtpa/shared';
import { ApiError } from '../api/client';

export { ApiError } from '../api/client';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function request<T>(url: string, init: RequestInit, parse: boolean): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (!res.ok) {
    let bodyText = '';
    try { bodyText = await res.text(); } catch { /* ignore */ }
    throw new ApiError(res.status, bodyText);
  }
  if (!parse) return undefined as T;
  return (await res.json()) as T;
}

function getJson<T>(url: string): Promise<T> {
  return request<T>(url, { method: 'GET' }, true);
}
function postJson<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, { method: 'POST', headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) }, true);
}
function postVoid(url: string, body?: unknown): Promise<void> {
  return request<void>(url, { method: 'POST', headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) }, false);
}
function putJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) }, true);
}
function del(url: string): Promise<void> {
  return request<void>(url, { method: 'DELETE' }, false);
}

export interface SettingsDto {
  publicBaseUrl: string;
  mediaLimits: MediaLimits;
}

export const adminApi = {
  // Auth
  login: (password: string) => postVoid('/api/admin/login', { password }),
  logout: () => postVoid('/api/admin/logout'),
  me: () => getJson<{ ok: true }>('/api/admin/me'),

  // Events
  listEvents: () => getJson<EventSummary[]>('/api/admin/events'),
  createEvent: (name: string) => postJson<EventDetail>('/api/admin/events', { name }),
  getEvent: (id: string) => getJson<EventDetail>(`/api/admin/events/${id}`),
  activateEvent: (id: string) => postJson<EventDetail>(`/api/admin/events/${id}/activate`),
  setUploadState: (id: string, enabled: boolean) =>
    postJson<EventDetail>(`/api/admin/events/${id}/upload-state`, { enabled }),
  endEvent: (id: string) => postJson<EventDetail>(`/api/admin/events/${id}/end`),
  setMotion: (id: string, motionConfig: MotionConfig) =>
    putJson<EventDetail>(`/api/admin/events/${id}/motion`, { motionConfig }),
  setEventTheme: (id: string, themeId: string) =>
    putJson<EventDetail>(`/api/admin/events/${id}/theme`, { themeId }),
  qrUrl: (id: string) => `/api/admin/events/${id}/qr`,
  exportUrl: (id: string) => `/api/admin/events/${id}/export`,

  // Photos
  listPhotos: (eventId: string) => getJson<PhotoAdmin[]>(`/api/admin/events/${eventId}/photos`),
  hidePhoto: (id: string, hidden: boolean) => postVoid(`/api/admin/photos/${id}/hide`, { hidden }),
  setPhotoPriority: (id: string, priority: boolean) =>
    postVoid(`/api/admin/photos/${id}/priority`, { priority }),
  deletePhoto: (id: string) => del(`/api/admin/photos/${id}`),

  // Themes
  listThemes: () => getJson<Theme[]>('/api/admin/themes'),
  createTheme: (name: string, tokens: ThemeTokens) =>
    postJson<Theme>('/api/admin/themes', { name, tokens }),
  updateTheme: (id: string, input: { name?: string; tokens?: ThemeTokens }) =>
    putJson<Theme>(`/api/admin/themes/${id}`, input),
  deleteTheme: (id: string) => del(`/api/admin/themes/${id}`),

  // Settings
  getSettings: () => getJson<SettingsDto>('/api/admin/settings'),
  saveSettings: (input: Partial<SettingsDto>) => putJson<SettingsDto>('/api/admin/settings', input),
  changePassword: (current: string, next: string) =>
    postVoid('/api/admin/password', { current, next }),
};

export type AdminApi = typeof adminApi;
