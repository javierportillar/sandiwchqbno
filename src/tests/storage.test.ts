// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadState, saveState } from '../lib/storage';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('local storage results', () => {
  it('distinguishes an absent key from an existing valid value', () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValueOnce(null).mockReturnValueOnce('[{"legacy":true}]') });
    expect(loadState('absent', [])).toEqual({ ok: true, value: [], source: 'absent', raw: null });
    expect(loadState('present', [])).toEqual({ ok: true, value: [{ legacy: true }], source: 'stored', raw: '[{"legacy":true}]' });
  });

  it.each(['', '{', 'undefined'])('reports invalid JSON rather than using a fallback: %s', (raw) => {
    vi.stubGlobal('localStorage', { getItem: () => raw });
    expect(loadState('key', [])).toEqual({ ok: false, error: 'invalid-json' });
  });

  it.each([
    ['null', []], ['{}', []], ['42', []], ['[]', {}], ['null', {}], ['"text"', {}]
  ])('rejects wrong top-level shape %s', (raw, fallback) => {
    vi.stubGlobal('localStorage', { getItem: () => raw });
    expect(loadState('key', fallback)).toEqual({ ok: false, error: 'invalid-shape' });
  });

  it('reports an inaccessible storage getter or getItem', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); } });
    expect(loadState('key', {})).toEqual({ ok: false, error: 'unavailable' });
  });

  it('reports an inaccessible localStorage property', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('denied'); });
    expect(loadState('key', {})).toEqual({ ok: false, error: 'unavailable' });
  });

  it('reports write failures without throwing', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } });
    expect(saveState('key', {})).toEqual({ ok: false });
  });
});
