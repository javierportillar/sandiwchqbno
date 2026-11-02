// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  RESTORE_JOURNAL_KEY,
  parseLocalBackup,
  previewLocalBackup,
  readRestoreJournal,
  restoreLocalBackup,
  runRestoreRecovery
} from '../lib/localBackup';
import { STORAGE_KEYS } from '../lib/storage';
import type { LocalBackupFile } from '../lib/localBackup';
import type { StorageLockManagerLike } from '../lib/storage';

const keys = Object.values(STORAGE_KEYS);
const rawValues: Record<string, string | null> = {
  'qbano-branches': '{corrupt',
  'qbano-employees': '',
  'qbano-periods': '[{"legacy":true,"unknown":"keep"}]',
  'qbano-shifts': null,
  'qbano-settings': '{"oldSetting":1}',
  'qbano-adjustments': '{"legacy":{}}'
};

const backup: LocalBackupFile = {
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: '2026-11-02T12:34:56.789Z',
  values: { ...rawValues }
};

function memoryStorage(initial: Record<string, string | null> = {}) {
  const data = new Map(Object.entries(initial).filter((entry): entry is [string, string] => entry[1] !== null));
  const log: string[] = [];
  const storage = {
    getItem: vi.fn((key: string) => {
      log.push(`get:${key}`);
      return data.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      log.push(`set:${key}`);
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      log.push(`remove:${key}`);
      data.delete(key);
    })
  };
  return { storage, data, log };
}

function locks(log: string[] = []) {
  const calls = vi.fn((name: string, options: { mode: 'exclusive' }) => {
    log.push(`lock:${name}:${options.mode}`);
  });
  const request: StorageLockManagerLike['request'] = async (name, options, callback) => {
    calls(name, options);
    return await callback();
  };
  return Object.assign({ request }, { calls });
}

const snapshotOf = (values: Record<string, string | null>) => Object.fromEntries(keys.map((key) => [key, values[key] ?? null]));
const encode = (value: unknown) => JSON.stringify(value);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('local backup restore validation', () => {
  it.each([
    ['unknown envelope field', { ...backup, unexpected: true }],
    ['missing envelope field', { format: backup.format, version: backup.version, values: backup.values }],
    ['unsupported version', { ...backup, version: 2 }],
    ['unknown storage key', { ...backup, values: { ...backup.values, extra: 'raw' } }],
    ['missing storage key', { ...backup, values: Object.fromEntries(keys.slice(1).map((key) => [key, backup.values[key]])) }],
    ['non-string raw payload', { ...backup, values: { ...backup.values, 'qbano-shifts': 4 } }]
  ])('rejects %s before any write', (_label, value) => {
    expect(() => parseLocalBackup(encode(value))).toThrow();
  });

  it('accepts corrupt JSON, empty strings, nulls, and legacy raw values without normalization', () => {
    const parsed = parseLocalBackup(encode(backup));
    expect(parsed.values).toEqual(backup.values);
    expect(parsed.values['qbano-branches']).toBe('{corrupt');
    expect(parsed.values['qbano-employees']).toBe('');
    expect(parsed.values['qbano-shifts']).toBe(null);
    expect(parsed.values['qbano-settings']).toBe('{"oldSetting":1}');
  });

  it('previews the source timestamp, absent keys, parse failures and incompatible top-level JSON', () => {
    const malformedTopLevel = { ...backup, values: { ...backup.values, 'qbano-settings': '[]' } };
    const preview = previewLocalBackup(malformedTopLevel, memoryStorage(rawValues).storage);
    expect(preview.exportedAt).toBe(backup.exportedAt);
    expect(preview.absentKeys).toEqual(['qbano-shifts']);
    expect(preview.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'qbano-branches', kind: 'invalid-json' }),
      expect.objectContaining({ key: 'qbano-employees', kind: 'invalid-json' }),
      expect.objectContaining({ key: 'qbano-settings', kind: 'wrong-top-level' })
    ]));
    expect(preview.snapshot).toEqual(snapshotOf(rawValues));
  });
});

describe('journaled restore', () => {
  it('persists and reads back the journal before the first target mutation', async () => {
    const { storage, data, log } = memoryStorage(rawValues);
    const lockManager = locks(log);
    const result = await restoreLocalBackup(backup, snapshotOf(rawValues), storage, lockManager);
    expect(result.ok).toBe(true);
    const firstTargetMutation = log.findIndex((entry) => entry === 'set:qbano-branches' || entry === 'remove:qbano-branches');
    const journalWrite = log.indexOf(`set:${RESTORE_JOURNAL_KEY}`);
    const journalReadBack = log.indexOf(`get:${RESTORE_JOURNAL_KEY}`, journalWrite + 1);
    expect(journalWrite).toBeGreaterThan(-1);
    expect(journalReadBack).toBeGreaterThan(journalWrite);
    expect(firstTargetMutation).toBeGreaterThan(journalReadBack);
    expect(data.get('qbano-employees')).toBe('');
    expect(data.has('qbano-shifts')).toBe(false);
    expect(lockManager.calls).toHaveBeenCalledWith(expect.any(String), { mode: 'exclusive' });
  });

  it('aborts before target writes when the journal cannot be persisted or verified', async () => {
    const { storage, log } = memoryStorage(rawValues);
    storage.setItem.mockImplementation((key, value) => {
      log.push(`set:${key}`);
      if (key === RESTORE_JOURNAL_KEY) throw new DOMException('full', 'QuotaExceededError');
      void value;
      return undefined;
    });
    const result = await restoreLocalBackup(backup, snapshotOf(rawValues), storage, locks(log));
    expect(result.ok).toBe(false);
    expect(log.some((entry) => keys.some((key) => entry === `set:${key}` || entry === `remove:${key}`))).toBe(false);
  });

  it('refuses an existing journal without replacing it or writing target keys', async () => {
    const existing = '{keep-me}';
    const { storage, data } = memoryStorage({ ...rawValues, [RESTORE_JOURNAL_KEY]: existing });
    const result = await restoreLocalBackup(backup, snapshotOf(rawValues), storage, locks());
    expect(result.ok).toBe(false);
    expect(data.get(RESTORE_JOURNAL_KEY)).toBe(existing);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('detects a stale preview under the lock and creates no journal', async () => {
    const { storage, data } = memoryStorage(rawValues);
    data.set('qbano-branches', 'changed-in-another-tab');
    const result = await restoreLocalBackup(backup, snapshotOf(rawValues), storage, locks());
    expect(result.ok).toBe(false);
    expect(data.has(RESTORE_JOURNAL_KEY)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('fails closed when Web Locks are unavailable', async () => {
    const { storage } = memoryStorage(rawValues);
    const result = await restoreLocalBackup(backup, snapshotOf(rawValues), storage, null);
    expect(result).toMatchObject({ ok: false, reason: 'locks-unavailable' });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('rejects an invalid in-memory envelope before entering the lock or writing', async () => {
    const { storage } = memoryStorage(rawValues);
    const invalid = { ...backup, format: 'other-format' } as unknown as LocalBackupFile;
    const lockManager = locks();
    const result = await restoreLocalBackup(invalid, snapshotOf(rawValues), storage, lockManager);
    expect(result).toMatchObject({ ok: false, reason: 'backup-invalid' });
    expect(lockManager.calls).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('aborts before journaling if a target key cannot be read', async () => {
    const { storage } = memoryStorage(rawValues);
    storage.getItem.mockImplementation((key) => {
      if (key === 'qbano-branches') throw new Error('denied');
      return null;
    });
    const result = await restoreLocalBackup(backup, snapshotOf(rawValues), storage, locks());
    expect(result).toMatchObject({ ok: false, reason: 'storage-unavailable' });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('keeps a prepared journal after a partial target write failure', async () => {
    const { storage, data } = memoryStorage(rawValues);
    storage.setItem.mockImplementation((key, value) => {
      if (key === 'qbano-employees') throw new DOMException('full', 'QuotaExceededError');
      data.set(key, value);
    });
    const result = await restoreLocalBackup(backup, snapshotOf(rawValues), storage, locks());
    expect(result.ok).toBe(false);
    expect(readRestoreJournal(storage)).toMatchObject({ kind: 'valid', journal: { status: 'prepared' } });
    expect(data.get('qbano-branches')).toBe(backup.values['qbano-branches']);
  });

  it('blocks on a malformed journal and offers no destructive recovery path', () => {
    const { storage } = memoryStorage({ [RESTORE_JOURNAL_KEY]: '{bad' });
    expect(readRestoreJournal(storage)).toEqual({ kind: 'malformed' });
  });

  it('retries a prepared restore, then keeps or rolls back exact raw values', async () => {
    const { storage, data } = memoryStorage(rawValues);
    const originalSet = storage.setItem.getMockImplementation()!;
    storage.setItem.mockImplementation((key, value) => {
      if (key === 'qbano-employees') throw new DOMException('full', 'QuotaExceededError');
      originalSet(key, value);
    });
    const initial = await restoreLocalBackup(backup, snapshotOf(rawValues), storage, locks());
    expect(initial.ok).toBe(false);
    const prepared = readRestoreJournal(storage);
    if (prepared.kind !== 'valid') throw new Error('expected prepared journal');
    expect(prepared.journal.status).toBe('prepared');

    storage.setItem.mockImplementation(originalSet);
    const retry = await runRestoreRecovery('retry', prepared.raw, storage, locks());
    expect(retry.ok).toBe(true);
    const applied = readRestoreJournal(storage);
    expect(applied).toMatchObject({ kind: 'valid', journal: { status: 'applied' } });
    if (applied.kind !== 'valid') throw new Error('expected applied journal');

    const kept = await runRestoreRecovery('keep', applied.raw, storage, locks());
    expect(kept.ok).toBe(true);
    expect(readRestoreJournal(storage)).toEqual({ kind: 'none' });
    expect(snapshotOf(Object.fromEntries(data))).toEqual(snapshotOf(backup.values));
  });

  it('retains a journal and reports failure if recovery cannot write the preimage', async () => {
    const { storage, data } = memoryStorage(rawValues);
    const initial = await restoreLocalBackup(backup, snapshotOf(rawValues), storage, locks());
    expect(initial.ok).toBe(true);
    const journal = readRestoreJournal(storage);
    if (journal.kind !== 'valid') throw new Error('expected journal');
    storage.setItem.mockImplementation((key, value) => {
      if (key === 'qbano-periods') throw new DOMException('full', 'QuotaExceededError');
      data.set(key, value);
    });
    const recovery = await runRestoreRecovery('revert', journal.raw, storage, locks());
    expect(recovery.ok).toBe(false);
    expect(readRestoreJournal(storage).kind).toBe('valid');
  });

  it('rolls back an applied transaction to the exact preimage and removes the journal only after verification', async () => {
    const before = { ...rawValues };
    const target = { ...backup.values };
    const journal = {
      format: 'sandwich-qbano-local-restore-journal',
      version: 1,
      transactionId: 'rollback-test',
      createdAt: '2026-11-02T12:34:56.789Z',
      status: 'applied',
      before,
      target
    };
    const { storage, data, log } = memoryStorage({ ...target, [RESTORE_JOURNAL_KEY]: JSON.stringify(journal) });
    const result = await runRestoreRecovery('revert', JSON.stringify(journal), storage, locks());
    expect(result.ok).toBe(true);
    expect(readRestoreJournal(storage)).toEqual({ kind: 'none' });
    expect(snapshotOf(Object.fromEntries(data))).toEqual(snapshotOf(before));
    expect(log.lastIndexOf(`remove:${RESTORE_JOURNAL_KEY}`)).toBeGreaterThan(log.lastIndexOf('get:qbano-adjustments'));
  });

  it('retains the journal when its removal fails during keep confirmation', async () => {
    const initial = await restoreLocalBackup(backup, snapshotOf(rawValues), memoryStorage(rawValues).storage, locks());
    if (!initial.ok) throw new Error('expected applied restore');
    const { storage, data } = memoryStorage({ ...backup.values, [RESTORE_JOURNAL_KEY]: JSON.stringify(initial.journal) });
    storage.removeItem.mockImplementation(() => { throw new Error('denied'); });
    const result = await runRestoreRecovery('keep', JSON.stringify(initial.journal), storage, locks());
    expect(result).toMatchObject({ ok: false, reason: 'journal-remove-failed' });
    expect(data.has(RESTORE_JOURNAL_KEY)).toBe(true);
  });
});
