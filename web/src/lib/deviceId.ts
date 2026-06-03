export const DEVICE_ID_KEY = 'rtpa_device_id';

let memoryId: string | null = null;

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // Private mode / restricted in-app webview: localStorage unavailable.
    // Fall back to a per-session in-memory id so uploads still work this visit.
    if (!memoryId) memoryId = crypto.randomUUID();
    return memoryId;
  }
}
