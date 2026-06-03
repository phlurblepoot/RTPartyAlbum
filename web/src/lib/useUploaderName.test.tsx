import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUploaderName, UPLOADER_NAME_KEY } from './useUploaderName';

describe('useUploaderName', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useUploaderName());
    expect(result.current.name).toBe('');
  });

  it('hydrates from localStorage', () => {
    localStorage.setItem(UPLOADER_NAME_KEY, 'Robin');
    const { result } = renderHook(() => useUploaderName());
    expect(result.current.name).toBe('Robin');
  });

  it('setName updates state and persists to localStorage', () => {
    const { result } = renderHook(() => useUploaderName());
    act(() => result.current.setName('Sam'));
    expect(result.current.name).toBe('Sam');
    expect(localStorage.getItem(UPLOADER_NAME_KEY)).toBe('Sam');
  });
});
