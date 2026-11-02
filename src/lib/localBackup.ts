import {
  getStorageLockManager,
  STORAGE_KEYS,
  withStorageLock
} from './storage';
import type { StorageLockManagerLike, StorageSnapshot } from './storage';

export const BACKUP_FORMAT = 'sandwich-qbano-local-backup';
export const BACKUP_VERSION = 1;

type RawStorage = Pick<Storage, 'getItem'>;
type MutableRawStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const STORAGE_KEY_LIST = Object.values(STORAGE_KEYS);

export type LocalBackupFile = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  values: Record<string, string | null>;
};

export type BackupWarning = {
  key: string;
  kind: 'invalid-json' | 'wrong-top-level';
};

export type LocalBackupPreview = {
  exportedAt: string;
  absentKeys: string[];
  warnings: BackupWarning[];
  snapshot: StorageSnapshot;
};

export const RESTORE_JOURNAL_KEY = 'qbano-local-restore-journal-v1';
const JOURNAL_FORMAT = 'sandwich-qbano-local-restore-journal';
const JOURNAL_VERSION = 1;

export type RestoreJournal = {
  format: typeof JOURNAL_FORMAT;
  version: typeof JOURNAL_VERSION;
  transactionId: string;
  createdAt: string;
  status: 'prepared' | 'applied';
  before: Record<string, string | null>;
  target: Record<string, string | null>;
};

export type RestoreJournalRead =
  | { kind: 'none' }
  | { kind: 'valid'; journal: RestoreJournal; raw: string }
  | { kind: 'malformed' }
  | { kind: 'unavailable' };

export type RestoreFailureReason =
  | 'backup-invalid' | 'locks-unavailable' | 'lock-failed' | 'journal-exists' | 'snapshot-changed' | 'storage-unavailable'
  | 'journal-write-failed' | 'target-write-failed' | 'target-verify-failed' | 'journal-update-failed'
  | 'journal-changed' | 'journal-invalid' | 'journal-remove-failed' | 'wrong-recovery-action';

export type RestoreResult =
  | { ok: true; journal: RestoreJournal }
  | { ok: false; reason: RestoreFailureReason };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: string[]): boolean => {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
};

const isRawValues = (value: unknown): value is Record<string, string | null> => {
  if (!isRecord(value) || !hasExactKeys(value, STORAGE_KEY_LIST)) return false;
  return STORAGE_KEY_LIST.every((key) => value[key] === null || typeof value[key] === 'string');
};

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

const isLocalBackupFile = (value: unknown): value is LocalBackupFile =>
  isRecord(value) && hasExactKeys(value, ['format', 'version', 'exportedAt', 'values']) &&
  value.format === BACKUP_FORMAT && value.version === BACKUP_VERSION &&
  isCanonicalTimestamp(value.exportedAt) && isRawValues(value.values);

export function parseLocalBackup(json: string): LocalBackupFile {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('invalid-json');
  }
  if (!isRecord(value) || !hasExactKeys(value, ['format', 'version', 'exportedAt', 'values'])) throw new Error('invalid-envelope');
  if (value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION) throw new Error('unsupported-backup');
  if (!isCanonicalTimestamp(value.exportedAt) || !isRawValues(value.values)) throw new Error('invalid-backup-shape');
  return value as LocalBackupFile;
}

export const readRawStorageSnapshot = (storage: RawStorage): StorageSnapshot => {
  const snapshot: StorageSnapshot = {};
  for (const key of STORAGE_KEY_LIST) snapshot[key] = storage.getItem(key);
  return snapshot;
};

const isExpectedArray = (key: string) =>
  key === STORAGE_KEYS.branches || key === STORAGE_KEYS.employees || key === STORAGE_KEYS.periods || key === STORAGE_KEYS.shifts;

export function previewLocalBackup(backup: LocalBackupFile, storage?: RawStorage): LocalBackupPreview {
  const absentKeys: string[] = [];
  const warnings: BackupWarning[] = [];
  for (const key of STORAGE_KEY_LIST) {
    const raw = backup.values[key];
    if (raw === null) {
      absentKeys.push(key);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      warnings.push({ key, kind: 'invalid-json' });
      continue;
    }
    const topLevelMatches = isExpectedArray(key)
      ? Array.isArray(parsed)
      : isRecord(parsed);
    if (!topLevelMatches) warnings.push({ key, kind: 'wrong-top-level' });
  }
  return { exportedAt: backup.exportedAt, absentKeys, warnings, snapshot: readRawStorageSnapshot(storage ?? localStorage) };
}

const isJournal = (value: unknown): value is RestoreJournal => {
  if (!isRecord(value) || !hasExactKeys(value, ['format', 'version', 'transactionId', 'createdAt', 'status', 'before', 'target'])) return false;
  return value.format === JOURNAL_FORMAT && value.version === JOURNAL_VERSION &&
    typeof value.transactionId === 'string' && value.transactionId.length > 0 &&
    isCanonicalTimestamp(value.createdAt) && (value.status === 'prepared' || value.status === 'applied') &&
    isRawValues(value.before) && isRawValues(value.target);
};

export function readRestoreJournal(storage?: RawStorage): RestoreJournalRead {
  let raw: string | null;
  try {
    raw = (storage ?? localStorage).getItem(RESTORE_JOURNAL_KEY);
  } catch {
    return { kind: 'unavailable' };
  }
  if (raw === null) return { kind: 'none' };
  try {
    const journal: unknown = JSON.parse(raw);
    return isJournal(journal) ? { kind: 'valid', journal, raw } : { kind: 'malformed' };
  } catch {
    return { kind: 'malformed' };
  }
}

const sameRawValues = (left: Record<string, string | null>, right: Record<string, string | null>) =>
  STORAGE_KEY_LIST.every((key) => left[key] === right[key]);

const writeRawValues = (storage: MutableRawStorage, values: Record<string, string | null>): boolean => {
  try {
    for (const key of STORAGE_KEY_LIST) {
      const value = values[key];
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
    return true;
  } catch {
    return false;
  }
};

const readRawValues = (storage: RawStorage): Record<string, string | null> | null => {
  try {
    return readRawStorageSnapshot(storage);
  } catch {
    return null;
  }
};

const saveAndVerifyJournal = (storage: MutableRawStorage, journal: RestoreJournal): string | null => {
  const raw = JSON.stringify(journal);
  try {
    storage.setItem(RESTORE_JOURNAL_KEY, raw);
    return storage.getItem(RESTORE_JOURNAL_KEY) === raw ? raw : null;
  } catch {
    return null;
  }
};

const applyAndVerify = (storage: MutableRawStorage, values: Record<string, string | null>): 'write-failed' | 'verify-failed' | null => {
  if (!writeRawValues(storage, values)) return 'write-failed';
  const actual = readRawValues(storage);
  if (!actual) return 'verify-failed';
  return sameRawValues(actual, values) ? null : 'verify-failed';
};

const errorResult = (reason: RestoreFailureReason): RestoreResult => ({ ok: false, reason });

export async function restoreLocalBackup(
  backup: LocalBackupFile,
  expectedSnapshot: StorageSnapshot,
  storage: MutableRawStorage | undefined = undefined,
  lockManager: StorageLockManagerLike | null = getStorageLockManager()
): Promise<RestoreResult> {
  if (!isLocalBackupFile(backup)) return errorResult('backup-invalid');
  if (!lockManager) return errorResult('locks-unavailable');
  let targetStorage: MutableRawStorage;
  try {
    targetStorage = storage ?? localStorage;
  } catch {
    return errorResult('storage-unavailable');
  }
  try {
    return await withStorageLock(async () => {
      let existingJournal: string | null;
      try {
        existingJournal = targetStorage.getItem(RESTORE_JOURNAL_KEY);
      } catch {
        return errorResult('storage-unavailable');
      }
      if (existingJournal !== null) return errorResult('journal-exists');

      const before = readRawValues(targetStorage);
      if (!before) return errorResult('storage-unavailable');
      if (!sameRawValues(before, expectedSnapshot)) return errorResult('snapshot-changed');

      const journal: RestoreJournal = {
        format: JOURNAL_FORMAT,
        version: JOURNAL_VERSION,
        transactionId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        createdAt: new Date().toISOString(),
        status: 'prepared',
        before,
        target: { ...backup.values }
      };
      if (!saveAndVerifyJournal(targetStorage, journal)) return errorResult('journal-write-failed');

      const applyError = applyAndVerify(targetStorage, journal.target);
      if (applyError === 'write-failed') return errorResult('target-write-failed');
      if (applyError === 'verify-failed') return errorResult('target-verify-failed');

      const applied: RestoreJournal = { ...journal, status: 'applied' };
      if (!saveAndVerifyJournal(targetStorage, applied)) return errorResult('journal-update-failed');
      return { ok: true, journal: applied };
    }, lockManager);
  } catch {
    return errorResult('lock-failed');
  }
}

export async function runRestoreRecovery(
  action: 'retry' | 'keep' | 'revert',
  expectedJournalRaw: string,
  storage: MutableRawStorage | undefined = undefined,
  lockManager: StorageLockManagerLike | null = getStorageLockManager()
): Promise<RestoreResult> {
  if (!lockManager) return errorResult('locks-unavailable');
  let targetStorage: MutableRawStorage;
  try {
    targetStorage = storage ?? localStorage;
  } catch {
    return errorResult('storage-unavailable');
  }
  try {
    return await withStorageLock(async () => {
      let currentRaw: string | null;
      try {
        currentRaw = targetStorage.getItem(RESTORE_JOURNAL_KEY);
      } catch {
        return errorResult('storage-unavailable');
      }
      if (currentRaw === null || currentRaw !== expectedJournalRaw) return errorResult('journal-changed');
      const parsed = readRestoreJournal(targetStorage);
      if (parsed.kind === 'unavailable') return errorResult('storage-unavailable');
      if (parsed.kind !== 'valid') return errorResult('journal-invalid');
      const { journal } = parsed;

      if (action === 'retry') {
        if (journal.status !== 'prepared') return errorResult('wrong-recovery-action');
        const applyError = applyAndVerify(targetStorage, journal.target);
        if (applyError === 'write-failed') return errorResult('target-write-failed');
        if (applyError === 'verify-failed') return errorResult('target-verify-failed');
        const applied: RestoreJournal = { ...journal, status: 'applied' };
        if (!saveAndVerifyJournal(targetStorage, applied)) return errorResult('journal-update-failed');
        return { ok: true, journal: applied };
      }

      if (action === 'keep') {
        if (journal.status !== 'applied') return errorResult('wrong-recovery-action');
        const actual = readRawValues(targetStorage);
        if (!actual) return errorResult('storage-unavailable');
        if (!sameRawValues(actual, journal.target)) return errorResult('target-verify-failed');
      }

      if (action === 'revert') {
        const applyError = applyAndVerify(targetStorage, journal.before);
        if (applyError === 'write-failed') return errorResult('target-write-failed');
        if (applyError === 'verify-failed') return errorResult('target-verify-failed');
      }

      try {
        targetStorage.removeItem(RESTORE_JOURNAL_KEY);
        if (targetStorage.getItem(RESTORE_JOURNAL_KEY) !== null) {
          // Best-effort re-block if a nonconforming storage implementation reports stale reads.
          try { targetStorage.setItem(RESTORE_JOURNAL_KEY, expectedJournalRaw); } catch { /* retain blocked state in caller */ }
          return errorResult('journal-remove-failed');
        }
      } catch {
        // removeItem may have mutated storage before throwing; preserve a recovery record if possible.
        try { targetStorage.setItem(RESTORE_JOURNAL_KEY, expectedJournalRaw); } catch { /* retain blocked state in caller */ }
        return errorResult('journal-remove-failed');
      }
      return { ok: true, journal };
    }, lockManager);
  } catch {
    return errorResult('lock-failed');
  }
}

// Values remain opaque: corrupt JSON and unrecognized fields must survive intact.
export function createLocalBackup(storage: RawStorage, date: Date = new Date()): LocalBackupFile {
  const values: Record<string, string | null> = {};
  for (const key of Object.values(STORAGE_KEYS)) values[key] = storage.getItem(key);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: date.toISOString(), values };
}

export function downloadLocalBackup(backup: LocalBackupFile): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  let requested = false;
  let link: HTMLAnchorElement | undefined;
  try {
    link = document.createElement('a');
    link.href = url;
    link.download = `qbano-copia-local-${backup.exportedAt.replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    requested = true;
  } finally {
    link?.remove();
    if (requested) {
      // Keep the URL alive while the browser begins processing the download.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else {
      URL.revokeObjectURL(url);
    }
  }
}

export function exportLocalBackup(): 'requested' | 'read-failed' | 'download-failed' {
  let backup: LocalBackupFile;
  try {
    backup = createLocalBackup(localStorage);
  } catch {
    return 'read-failed';
  }
  try {
    downloadLocalBackup(backup);
    return 'requested';
  } catch {
    return 'download-failed';
  }
}
