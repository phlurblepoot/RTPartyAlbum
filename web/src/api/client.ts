import type { PublicEvent, Photo } from './types';

export class ApiError extends Error {
  status: number;
  body: string;
  code: string | null; // parsed { error } from the JSON body, or null
  constructor(status: number, body: string) {
    super(`API error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      this.code = typeof parsed.error === 'string' ? parsed.error : null;
    } catch {
      this.code = null;
    }
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new ApiError(res.status, await res.text().catch(() => ''));
  }
  return (await res.json()) as T;
}

export function getPublicEvent(code: string): Promise<PublicEvent> {
  return getJson<PublicEvent>(`/api/events/by-code/${encodeURIComponent(code)}`);
}

/** The currently-active event for the landing page, or null when none is active. */
export function getActiveEvent(): Promise<PublicEvent | null> {
  return getJson<PublicEvent | null>('/api/events/active');
}

export function getPublicPhotos(code: string): Promise<Photo[]> {
  return getJson<Photo[]>(`/api/events/by-code/${encodeURIComponent(code)}/photos`);
}

export interface UploadArgs {
  uploaderName: string;
  deviceId: string;
  files: File[];
  onProgress?: (fraction: number) => void;
}

export function uploadFiles(code: string, args: UploadArgs): Promise<Photo[]> {
  const { uploaderName, deviceId, files, onProgress } = args;
  return new Promise<Photo[]>((resolve, reject) => {
    const form = new FormData();
    // IMPORTANT: text fields MUST come before file fields.
    // The server's upload rate-limiter reads `deviceId` from the parsed multipart body,
    // which only works if the text fields arrive before the file fields in the stream.
    // FormData preserves append order, so we append uploaderName + deviceId first.
    form.append('uploaderName', uploaderName);
    form.append('deviceId', deviceId);
    for (const file of files) {
      form.append('files', file, file.name);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/events/by-code/${encodeURIComponent(code)}/upload`);

    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded / e.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Photo[]);
        } catch {
          reject(new ApiError(xhr.status, xhr.responseText));
        }
      } else {
        reject(new ApiError(xhr.status, xhr.responseText));
      }
    };

    xhr.onerror = () => reject(new ApiError(0, 'network error'));
    xhr.onabort = () => reject(new ApiError(0, 'aborted'));

    xhr.send(form);
  });
}
