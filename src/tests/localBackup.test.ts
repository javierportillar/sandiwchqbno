// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_FORMAT, BACKUP_VERSION, createLocalBackup, downloadLocalBackup, exportLocalBackup } from '../lib/localBackup';

const date = new Date('2026-11-02T12:34:56.789Z');
const rawValues: Record<string, string | null> = {
  'qbano-branches': '{broken\n"raw":',
  'qbano-employees': '[ {"name":"Ángel", "salary":123, "unknown":"✓"} ]',
  'qbano-periods': null,
  'qbano-shifts': '[{"breakMinutes":240,"templateId":"partido","legacy":{"x":1}}]',
  'qbano-settings': '',
  'qbano-adjustments': '{ "period": { "employee": 42 } }'
};

const textOf = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('local backup format', () => {
  it('exports exactly the six raw values, including corrupt, absent, legacy and adjustments', () => {
    const data = { ...rawValues, 'other-app-secret': 'not exported' };
    const getItem = vi.fn((key: string) => data[key as keyof typeof data] ?? null);
    const backup = createLocalBackup({ getItem }, date);
    expect(backup).toEqual({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: '2026-11-02T12:34:56.789Z', values: rawValues });
    expect(backup.format).toBe('sandwich-qbano-local-backup');
    expect(backup.version).toBe(1);
    expect(getItem.mock.calls.map(([key]) => key)).toEqual(Object.keys(rawValues));
    expect(JSON.parse(JSON.stringify(backup)).values).toEqual(rawValues);
    expect(JSON.stringify(backup)).not.toContain('not exported');
  });

  it.each(Object.keys(rawValues))('aborts if reading %s throws', (failingKey) => {
    const getItem = vi.fn((key: string) => {
      if (key === failingKey) throw new Error('private');
      return rawValues[key] ?? null;
    });
    expect(() => createLocalBackup({ getItem }, date)).toThrow();
  });

  it('generates a dated JSON blob and requests a local download', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:backup');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const timer = vi.spyOn(window, 'setTimeout').mockReturnValue(1 as unknown as ReturnType<typeof window.setTimeout>);
    let filename = '';
    let href = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download;
      href = this.href;
    });
    const backup = createLocalBackup({ getItem: (key) => rawValues[key] ?? null }, date);
    downloadLocalBackup(backup);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await textOf(blob))).toEqual(backup);
    expect(filename).toBe('qbano-copia-local-2026-11-02T12-34-56-789Z.json');
    expect(href).toBe('blob:backup');
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    expect(timer).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('reports an inaccessible read without requesting a download', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('private'); } });
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    expect(exportLocalBackup()).toBe('read-failed');
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('reports an inaccessible localStorage getter', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('denied'); });
    expect(exportLocalBackup()).toBe('read-failed');
  });

  it('reports a failed download and revokes the object URL', () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => rawValues[key] ?? null });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:backup', revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('download denied'); });
    expect(exportLocalBackup()).toBe('download-failed');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('reports object URL creation failure', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('URL', { createObjectURL: () => { throw new Error('denied'); } });
    expect(exportLocalBackup()).toBe('download-failed');
  });
});
