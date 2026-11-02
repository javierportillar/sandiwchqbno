import { STORAGE_KEYS } from './storage';

export const BACKUP_FORMAT = 'sandwich-qbano-local-backup';
export const BACKUP_VERSION = 1;

type RawStorage = Pick<Storage, 'getItem'>;
export type LocalBackupFile = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  values: Record<string, string | null>;
};

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
