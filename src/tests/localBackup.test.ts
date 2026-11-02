// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_FORMAT, BACKUP_VERSION, createLocalBackup, downloadLocalBackup, exportLocalBackup, parseLocalBackup, restoreLocalBackup, RESTORE_JOURNAL_KEY } from '../lib/localBackup';
import { STORAGE_LOCK_NAME } from '../lib/storage';
import type { StorageLockManagerLike } from '../lib/storage';

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

function immediateLockManager() {
  const request = vi.fn(async (_name: string, _options: { mode: 'exclusive' }, callback: () => unknown) => await callback());
  return {
    lockManager: { request: request as unknown as StorageLockManagerLike['request'] },
    request
  };
}

function queuedLockManager() {
  type Task = { callback: () => unknown; resolve: (value: unknown) => void; reject: (error: unknown) => void; id: number };
  const queue: Task[] = [];
  let active = false;
  let nextId = 0;
  let currentId = -1;
  const events: string[] = [];
  const runNext = () => {
    if (active) return;
    const task = queue.shift();
    if (!task) return;
    active = true;
    currentId = task.id;
    events.push(`enter:${task.id}`);
    Promise.resolve().then(task.callback).then((value) => {
      events.push(`exit:${task.id}`);
      active = false;
      task.resolve(value);
      runNext();
    }, (error) => {
      events.push(`exit:${task.id}`);
      active = false;
      task.reject(error);
      runNext();
    });
  };
  const request = vi.fn((_name: string, _options: { mode: 'exclusive' }, callback: () => unknown) => new Promise<unknown>((resolve, reject) => {
    queue.push({ callback, resolve, reject, id: nextId++ });
    runNext();
  }));
  return {
    lockManager: { request: request as unknown as StorageLockManagerLike['request'] },
    request,
    events,
    isHeld: () => active,
    currentId: () => currentId
  };
}

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

  it('holds the exclusive storage lock for every snapshot read and starts download only after release', async () => {
    const events: string[] = [];
    let lockHeld = false;
    const request = vi.fn(async (_name: string, _options: { mode: 'exclusive' }, callback: () => unknown) => {
        events.push('lock-enter');
        lockHeld = true;
        try {
          return await callback();
        } finally {
          lockHeld = false;
          events.push('lock-exit');
        }
      });
    const lockManager = { request: request as unknown as StorageLockManagerLike['request'] };
    const getItem = vi.fn((key: string) => {
      expect(lockHeld).toBe(true);
      events.push(`read:${key}`);
      return rawValues[key] ?? null;
    });
    const createObjectURL = vi.fn((_blob: Blob) => {
      expect(lockHeld).toBe(false);
      events.push('download-start');
      return 'blob:backup';
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(window, 'setTimeout').mockReturnValue(1 as unknown as ReturnType<typeof window.setTimeout>);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await expect(exportLocalBackup(lockManager, { getItem })).resolves.toBe('requested');

    expect(request).toHaveBeenCalledWith(STORAGE_LOCK_NAME, { mode: 'exclusive' }, expect.any(Function));
    expect(getItem.mock.calls.map(([key]) => key)).toEqual(Object.keys(rawValues));
    expect(events).toEqual([
      'lock-enter', ...Object.keys(rawValues).map((key) => `read:${key}`), 'lock-exit', 'download-start'
    ]);
    expect(JSON.parse(await textOf(createObjectURL.mock.calls[0][0]))).toMatchObject({
      format: BACKUP_FORMAT,
      version: 1,
      values: rawValues
    });
  });

  it('fails closed without Web Locks and does not read or download', async () => {
    const getItem = vi.fn(() => null);
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });

    await expect(exportLocalBackup(null, { getItem })).resolves.toBe('locks-unavailable');
    expect(getItem).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('fails closed when the Web Lock request rejects and does not read or download', async () => {
    const getItem = vi.fn(() => null);
    const createObjectURL = vi.fn();
    const request = vi.fn(async () => { throw new Error('lock denied'); });
    const lockManager = { request: request as unknown as StorageLockManagerLike['request'] };
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });

    await expect(exportLocalBackup(lockManager, { getItem })).resolves.toBe('lock-failed');
    expect(request).toHaveBeenCalledOnce();
    expect(getItem).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('does not export a hybrid snapshot when a queued restore follows the export lock', async () => {
    const current = { ...rawValues };
    const target = Object.fromEntries(Object.keys(rawValues).map((key) => [key, `restored:${key}`]));
    const storageData = new Map(Object.entries(current));
    const lock = queuedLockManager();
    let restorePromise: ReturnType<typeof restoreLocalBackup> | undefined;
    let queuedRestore: ReturnType<typeof restoreLocalBackup> | undefined;
    const targetBackup = parseLocalBackup(JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: '2026-11-02T12:34:56.789Z',
      values: target
    }));
    const storage = {
      getItem: vi.fn((key: string) => {
        if (lock.currentId() === 0 && key !== RESTORE_JOURNAL_KEY) {
          expect(lock.isHeld()).toBe(true);
          if (!queuedRestore) {
            queuedRestore = restoreLocalBackup(targetBackup, current, storage, lock.lockManager);
          }
        }
        return storageData.get(key) ?? null;
      }),
      setItem: vi.fn((key: string, value: string) => { storageData.set(key, value); }),
      removeItem: vi.fn((key: string) => { storageData.delete(key); })
    };
    const createObjectURL = vi.fn((_blob: Blob) => {
      lock.events.push('download-start');
      return 'blob:backup';
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(window, 'setTimeout').mockReturnValue(1 as unknown as ReturnType<typeof window.setTimeout>);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const exportResult = await exportLocalBackup(lock.lockManager, storage);
    restorePromise = queuedRestore;
    expect(restorePromise).toBeDefined();
    const restoreResult = await restorePromise!;
    const serialized = JSON.parse(await textOf(createObjectURL.mock.calls[0][0]));

    expect(exportResult).toBe('requested');
    expect(restoreResult).toMatchObject({ ok: true });
    expect(serialized.values).toEqual(current);
    expect(Object.fromEntries(Object.keys(rawValues).map((key) => [key, storageData.get(key)]))).toEqual(target);
    expect(lock.events.indexOf('exit:0')).toBeLessThan(lock.events.indexOf('download-start'));
    expect(lock.events).toContain('enter:1');
  });

  it('reports an inaccessible read without requesting a download', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('private'); } });
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    await expect(exportLocalBackup(immediateLockManager().lockManager)).resolves.toBe('read-failed');
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('reports an inaccessible localStorage getter', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('denied'); });
    await expect(exportLocalBackup(immediateLockManager().lockManager)).resolves.toBe('read-failed');
  });

  it('reports a failed download and revokes the object URL', async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:backup', revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('download denied'); });
    await expect(exportLocalBackup(immediateLockManager().lockManager, { getItem: (key) => rawValues[key] ?? null })).resolves.toBe('download-failed');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('reports object URL creation failure', async () => {
    vi.stubGlobal('URL', { createObjectURL: () => { throw new Error('denied'); } });
    await expect(exportLocalBackup(immediateLockManager().lockManager, { getItem: () => null })).resolves.toBe('download-failed');
  });
});
