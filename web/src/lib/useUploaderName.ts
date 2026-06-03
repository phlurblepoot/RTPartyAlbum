import { useCallback, useState } from 'react';

export const UPLOADER_NAME_KEY = 'rtpa_uploader_name';

export function getStoredName(): string {
  try {
    return localStorage.getItem(UPLOADER_NAME_KEY) ?? '';
  } catch {
    // Private mode / restricted in-app webview: localStorage unavailable.
    return '';
  }
}

export function useUploaderName(): { name: string; setName: (next: string) => void } {
  const [name, setNameState] = useState<string>(() => getStoredName());

  const setName = useCallback((next: string) => {
    setNameState(next);
    try {
      localStorage.setItem(UPLOADER_NAME_KEY, next);
    } catch {
      // Private mode / restricted in-app webview: persist in-state only.
    }
  }, []);

  return { name, setName };
}
