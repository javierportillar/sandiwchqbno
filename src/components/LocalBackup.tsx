import { ChangeEvent, useEffect, useId, useRef, useState } from 'react';
import {
  exportLocalBackup,
  parseLocalBackup,
  previewLocalBackup,
  readRestoreJournal,
  restoreLocalBackup,
  runRestoreRecovery
} from '../lib/localBackup';
import type { LocalBackupExportResult, LocalBackupFile, LocalBackupPreview, RestoreJournalRead, RestoreResult } from '../lib/localBackup';
import { getStorageLockManager } from '../lib/storage';

type BackupStatus = LocalBackupExportResult | null;
type PreviewState = { backup: LocalBackupFile; preview: LocalBackupPreview; selectionToken: number };
type RestoreReason = Extract<RestoreResult, { ok: false }>['reason'];

const EXPORT_MESSAGES: Record<Exclude<LocalBackupExportResult, 'requested'>, string> = {
  'locks-unavailable': 'Este navegador no ofrece Web Locks. No se generó ni descargó la copia.',
  'lock-failed': 'No se pudo adquirir el bloqueo exclusivo. No se generó ni descargó la copia; reintentá.',
  'read-failed': 'No se pudieron leer todas las claves locales; no se generó la copia.',
  'download-failed': 'No se pudo completar la solicitud de descarga. Comprueba las opciones del navegador.'
};

const KEY_LABELS: Record<string, string> = {
  'qbano-branches': 'Sedes',
  'qbano-employees': 'Empleados',
  'qbano-periods': 'Períodos',
  'qbano-shifts': 'Horarios',
  'qbano-settings': 'Configuración',
  'qbano-adjustments': 'Ajustes'
};

const ERROR_LABELS: Record<RestoreReason, string> = {
  'backup-invalid': 'La copia no cumple el formato v1 exacto. No se modificó ningún dato.',
  'locks-unavailable': 'Este navegador no ofrece Web Locks. La restauración está deshabilitada.',
  'lock-failed': 'No se pudo adquirir el bloqueo exclusivo. No se confirmó la restauración.',
  'journal-exists': 'Ya hay una recuperación pendiente. La aplicación quedó bloqueada para proteger los datos.',
  'snapshot-changed': 'Los datos cambiaron desde la vista previa. La restauración se detuvo sin sobrescribirlos.',
  'storage-unavailable': 'No se pudo leer el almacenamiento local. No se confirmó la operación.',
  'journal-write-failed': 'No se pudo guardar y verificar el registro de recuperación. No se inició la escritura de destino.',
  'target-write-failed': 'La escritura quedó incompleta. El registro se conserva para reintentar o revertir.',
  'target-verify-failed': 'La verificación exacta falló. El registro se conserva para recuperar los datos.',
  'journal-update-failed': 'No se pudo verificar el estado final del registro. No se informó éxito.',
  'journal-changed': 'El registro cambió en otra pestaña. No se aplicó esta acción.',
  'journal-invalid': 'El registro de recuperación no es válido. Se conserva y la aplicación sigue bloqueada.',
  'journal-remove-failed': 'No se pudo verificar la eliminación del registro. La recuperación sigue bloqueada.',
  'wrong-recovery-action': 'Esta acción no corresponde al estado actual del registro.'
};

function readFile(file: File, onLoad: (text: string) => void, onError: () => void): FileReader {
  const reader = new FileReader();
  reader.onload = () => onLoad(String(reader.result ?? ''));
  reader.onerror = onError;
  reader.readAsText(file);
  return reader;
}

function abortReader(reader: FileReader | null) {
  if (!reader) return;
  try { reader.abort(); } catch { /* A finished reader needs no further cleanup. */ }
}

export function LocalBackup({
  onRestoreStarted,
  onRestoreProblem,
  onRestoreComplete
}: {
  onRestoreStarted?: () => void;
  onRestoreProblem?: (reason: RestoreReason) => void;
  onRestoreComplete?: () => void;
}) {
  const [status, setStatus] = useState<BackupStatus>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const fileInputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const selectionToken = useRef(0);
  const activeReader = useRef<FileReader | null>(null);
  const lockAvailable = !!getStorageLockManager();

  useEffect(() => () => {
    selectionToken.current += 1;
    abortReader(activeReader.current);
    activeReader.current = null;
  }, []);

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    const token = ++selectionToken.current;
    abortReader(activeReader.current);
    activeReader.current = null;
    setPreviewState(null);
    setFileError(null);
    setRestoreError(null);
    if (!file) return;
    const isCurrentSelection = () => token === selectionToken.current;
    const onLoad = (text: string) => {
      if (!isCurrentSelection()) return;
      activeReader.current = null;
      let backup: LocalBackupFile;
      try {
        backup = parseLocalBackup(text);
      } catch {
        setFileError('El archivo no es una copia local v1 válida. No se modificó ningún dato.');
        return;
      }
      try {
        setPreviewState({ backup, preview: previewLocalBackup(backup), selectionToken: token });
      } catch {
        setFileError('No se pudo leer el almacenamiento actual para preparar la vista previa. No se modificó ningún dato.');
      }
    };
    const onError = () => {
      if (!isCurrentSelection()) return;
      activeReader.current = null;
      setFileError('No se pudo leer el archivo seleccionado. No se modificó ningún dato.');
    };
    try {
      activeReader.current = readFile(file, onLoad, onError);
    } catch {
      if (isCurrentSelection()) setFileError('No se pudo leer el archivo seleccionado. No se modificó ningún dato.');
    }
  };

  const cancelPreview = () => {
    selectionToken.current += 1;
    abortReader(activeReader.current);
    activeReader.current = null;
    setPreviewState(null);
    setFileError(null);
    setRestoreError(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const confirmRestore = async () => {
    if (!previewState || previewState.selectionToken !== selectionToken.current || busy) return;
    if (!getStorageLockManager()) {
      setRestoreError(ERROR_LABELS['locks-unavailable']);
      return;
    }
    setBusy(true);
    setRestoreError(null);
    onRestoreStarted?.();
    const result = await restoreLocalBackup(previewState.backup, previewState.preview.snapshot);
    setBusy(false);
    if (result.ok) {
      onRestoreComplete?.();
      return;
    }
    setRestoreError(ERROR_LABELS[result.reason]);
    if (result.reason !== 'locks-unavailable') onRestoreProblem?.(result.reason);
  };

  const exportBackup = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    setStatus(null);
    try {
      setStatus(await exportLocalBackup());
    } catch {
      setStatus('lock-failed');
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <section className="local-backup" aria-label="Copia de seguridad local">
      <h3>Copia de seguridad local</h3>
      <p>El archivo JSON no está cifrado y contiene datos de empleados y salarios. Guárdalo en un lugar seguro.</p>
      <p>La copia incluye solo lo persistido en este navegador; si falló un guardado, los cambios que solo están en memoria pueden faltar.</p>
      <p>Cerrá las otras pestañas de esta aplicación antes de restaurar, especialmente las abiertas con versiones anteriores.</p>
      <button className="subtle" type="button" onClick={() => void exportBackup()} disabled={exportBusy}>
        {exportBusy ? 'Preparando copia local…' : 'Exportar copia local (JSON)'}
      </button>
      {exportBusy && <p role="status">Esperando el bloqueo exclusivo para preparar una copia coherente…</p>}
      {status === 'requested' && <p role="status">Se solicitó la descarga. El navegador no puede garantizar que el archivo se haya guardado; compruébalo.</p>}
      {status && status !== 'requested' && <p role="alert">{EXPORT_MESSAGES[status]}</p>}

      <div className="local-backup-restore">
        <h4>Restaurar desde un archivo JSON</h4>
        <p>La importación conserva sin cambios el texto original de las seis claves. Revisá la vista previa antes de confirmar.</p>
        <label htmlFor={fileInputId}>Seleccionar archivo JSON de respaldo</label>
        <input ref={fileInput} id={fileInputId} type="file" accept="application/json,.json" onChange={selectFile} disabled={busy} />
        {!lockAvailable && <p role="note">La restauración requiere Web Locks y está deshabilitada en este navegador.</p>}
        {fileError && <p role="alert">{fileError}</p>}
        {restoreError && <p role="alert">{restoreError}</p>}
        {previewState && (
          <section className="local-backup-preview" aria-labelledby="local-backup-preview-title">
            <h5 id="local-backup-preview-title">Vista previa de la copia</h5>
            <p>Fecha de exportación (UTC): <time dateTime={previewState.preview.exportedAt}>{previewState.preview.exportedAt}</time></p>
            <p>Claves que se eliminarán porque están ausentes en la copia: {previewState.preview.absentKeys.length
              ? previewState.preview.absentKeys.map((key) => KEY_LABELS[key] ?? key).join(', ')
              : 'ninguna'}.</p>
            {previewState.preview.warnings.length > 0 ? (
              <div role="note">
                <p>Advertencias detectables; los valores se conservarán sin corregirlos:</p>
                <ul>
                  {previewState.preview.warnings.map(({ key, kind }) => (
                    <li key={`${key}-${kind}`}>{KEY_LABELS[key] ?? key}: {kind === 'invalid-json' ? 'el contenido no es JSON válido' : 'el nivel superior no tiene la forma habitual'}.</li>
                  ))}
                </ul>
              </div>
            ) : <p>No se detectaron advertencias de lectura estructural.</p>}
            <p>Confirmar reemplazará los seis valores locales; cancelar no escribe ni elimina nada.</p>
            <div className="local-backup-actions">
              <button type="button" className="subtle" onClick={cancelPreview} disabled={busy}>Cancelar</button>
              <button type="button" onClick={() => void confirmRestore()} disabled={busy || !lockAvailable}>
                {busy ? 'Restaurando…' : 'Confirmar y restaurar'}
              </button>
            </div>
            {busy && <p role="status">Protegiendo los datos actuales y verificando la restauración…</p>}
          </section>
        )}
      </div>
    </section>
  );
}

export function LocalRestoreRecovery({
  initial,
  onResolved = () => window.location.reload()
}: {
  initial: Exclude<RestoreJournalRead, { kind: 'none' }>;
  onResolved?: () => void;
}) {
  const [current, setCurrent] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lockAvailable = !!getStorageLockManager();

  const runAction = async (action: 'retry' | 'keep' | 'revert') => {
    if (busy || current.kind !== 'valid') return;
    setBusy(true);
    setError(null);
    const result = await runRestoreRecovery(action, current.raw);
    setBusy(false);
    if (!result.ok) {
      setError(ERROR_LABELS[result.reason]);
      return;
    }
    if (action === 'retry') {
      const updated = readRestoreJournal();
      if (updated.kind !== 'valid' || updated.journal.status !== 'applied') {
        setCurrent(updated.kind === 'none' ? { kind: 'malformed' } : updated);
        setError('La restauración no pudo volver a verificar el estado aplicado del registro.');
        return;
      }
      setCurrent(updated);
      setNotice('La copia se aplicó y verificó. Elegí conservarla o revertirla; la aplicación sigue bloqueada.');
      return;
    }
    onResolved();
  };

  return (
    <main className="app-shell">
      <section className="panel storage-error" role="alert" aria-labelledby="restore-recovery-title">
        <h1 id="restore-recovery-title">Recuperación de datos locales requerida</h1>
        <p>La edición está bloqueada hasta resolver o revisar el registro de recuperación. No borres los datos del navegador.</p>
        <p>El respaldo contiene datos locales sin cifrar. Cerrá las otras pestañas de esta aplicación, especialmente las abiertas con versiones anteriores, antes de continuar.</p>
        {current.kind === 'malformed' && <p>El registro de recuperación está dañado o tiene un formato desconocido. Se conserva y no se harán escrituras automáticas; contactá a soporte.</p>}
        {current.kind === 'unavailable' && <p>El navegador impidió leer el registro. No se puede confirmar si hay una operación parcial; la aplicación permanece bloqueada.</p>}
        {current.kind === 'valid' && (
          <>
            <p>Estado del registro: <strong>{current.journal.status === 'prepared' ? 'preparado; puede haber una escritura parcial' : 'aplicado y pendiente de confirmación'}</strong>.</p>
            {current.journal.status === 'prepared' ? (
              <div className="local-backup-actions">
                <button type="button" onClick={() => void runAction('retry')} disabled={busy || !lockAvailable}>Reintentar restauración</button>
                <button type="button" className="subtle" onClick={() => void runAction('revert')} disabled={busy || !lockAvailable}>Revertir a los datos anteriores</button>
              </div>
            ) : (
              <div className="local-backup-actions">
                <button type="button" onClick={() => void runAction('keep')} disabled={busy || !lockAvailable}>Conservar los datos restaurados</button>
                <button type="button" className="subtle" onClick={() => void runAction('revert')} disabled={busy || !lockAvailable}>Revertir a los datos anteriores</button>
              </div>
            )}
          </>
        )}
        {!lockAvailable && <p role="note">Web Locks no está disponible. Las acciones de recuperación están deshabilitadas; no se usará localStorage como si fuera un bloqueo.</p>}
        {busy && <p role="status">Verificando la recuperación…</p>}
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error} El registro no se eliminó y la aplicación sigue bloqueada.</p>}
      </section>
      {(current.kind === 'malformed' || current.kind === 'unavailable') && <section className="panel"><LocalBackup /></section>}
    </main>
  );
}
