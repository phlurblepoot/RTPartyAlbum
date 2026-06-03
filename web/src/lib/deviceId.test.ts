import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDeviceId, DEVICE_ID_KEY } from './deviceId';

describe('getDeviceId', () => {
  beforeEach(() => {
    localStorage.clear();
    let counter = 0;
    vi.spyOn(crypto, 'randomUUID').mockImplementation(
      () => `uuid-${++counter}` as `${string}-${string}-${string}-${string}-${string}`,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('generates and persists a uuid under the rtpa_device_id key', () => {
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull();
    const id = getDeviceId();
    expect(id).toBe('uuid-1');
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe('uuid-1');
  });

  it('returns the same id on subsequent calls (stable)', () => {
    const first = getDeviceId();
    const second = getDeviceId();
    expect(second).toBe(first);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing stored id', () => {
    localStorage.setItem(DEVICE_ID_KEY, 'preexisting');
    expect(getDeviceId()).toBe('preexisting');
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });
});
