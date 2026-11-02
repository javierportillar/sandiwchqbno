// @vitest-environment jsdom
import { createElement, StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { LocalBackup } from '../components/LocalBackup';
import { BACKUP_FORMAT, BACKUP_VERSION } from '../lib/localBackup';
import { defaultSettings, seededBranches, seededEmployees, seededPayPeriods, seededShifts } from '../data/seed';

const initial: Record<string, string> = {
  'qbano-branches': JSON.stringify(seededBranches),
  'qbano-employees': JSON.stringify(seededEmployees),
  'qbano-periods': JSON.stringify(seededPayPeriods),
  'qbano-shifts': JSON.stringify(seededShifts),
  'qbano-settings': JSON.stringify(defaultSettings),
  'qbano-adjustments': '{"period":{"employee":15}}',
  'other-app-secret': 'not-exported'
};
const backupValues = Object.fromEntries(Object.entries(initial).filter(([key]) => key !== 'other-app-secret'));

function setup(values = initial, stubDownloadTimer = true) {
  const data = new Map(Object.entries(values));
  const getItem = vi.fn((key: string) => data.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { data.set(key, value); });
  const removeItem = vi.fn((key: string) => { data.delete(key); });
  vi.stubGlobal('localStorage', { getItem, setItem, removeItem });
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:backup');
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
  if (stubDownloadTimer) vi.spyOn(window, 'setTimeout').mockReturnValue(1 as unknown as ReturnType<typeof window.setTimeout>);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return { data, getItem, setItem, removeItem, createObjectURL, click };
}

function installWebLocks() {
  const request = vi.fn(async (_name: string, _options: { mode: 'exclusive' }, callback: () => unknown) => await callback());
  vi.stubGlobal('navigator', { locks: { request } });
  return request;
}

const mount = async () => {
  installWebLocks();
  await act(async () => { render(createElement(StrictMode, null, createElement(App))); });
};
const textOf = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

class DeferredFileReader {
  static readers: DeferredFileReader[] = [];
  result: string | ArrayBuffer | null = null;
  fileName = '';
  onload: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
  onerror: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
  onabort: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;

  readAsText(file: Blob) {
    this.fileName = (file as File).name;
    DeferredFileReader.readers.push(this);
  }

  abort() {
    this.onabort?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
  }

  resolve(text: string) {
    this.result = text;
    this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
  }
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('backup controls', () => {
  it('offers a clear export in Configuración with privacy warning and download feedback', async () => {
    const storage = setup();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Configuración' }));
    expect(screen.getByText(/no está cifrado/)).toBeTruthy();
    expect(screen.getByText(/solo están en memoria pueden faltar/)).toBeTruthy();
    expect(screen.queryByText(/Se solicitó la descarga/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar copia local (JSON)' }));
    expect(screen.getByRole('status').textContent).toContain('Se solicitó la descarga');
    expect(storage.click).toHaveBeenCalledOnce();
    const backup = JSON.parse(await textOf(storage.createObjectURL.mock.calls[0][0]));
    expect(backup.values['qbano-adjustments']).toBe(initial['qbano-adjustments']);
    expect(backup.values).not.toHaveProperty('other-app-secret');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(Object.fromEntries(storage.data)).toEqual(initial);
  });

  it('exports corrupt persisted data from the storage error screen without modifying it', async () => {
    const values = { ...initial, 'qbano-branches': '{corrupt-private' };
    const storage = setup(values);
    await mount();
    expect(screen.getByRole('alert').textContent).toContain('no se pueden interpretar');
    expect(screen.getByText(/no está cifrado/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar copia local (JSON)' }));
    expect(screen.getByRole('status').textContent).toContain('Se solicitó');
    const backup = JSON.parse(await textOf(storage.createObjectURL.mock.calls[0][0]));
    expect(backup.values['qbano-branches']).toBe('{corrupt-private');
    expect(Object.fromEntries(storage.data)).toEqual(values);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('reports an unavailable read on the error screen without a download', async () => {
    const storage = setup();
    storage.getItem.mockImplementation(() => { throw new Error('private'); });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Exportar copia local (JSON)' }));
    expect(screen.getByRole('status').textContent).toContain('no se generó la copia');
    expect(storage.createObjectURL).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('reports download errors without showing a success message', async () => {
    const storage = setup();
    storage.click.mockImplementation(() => { throw new Error('private'); });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Configuración' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exportar copia local (JSON)' }));
    expect(screen.getByRole('status').textContent).toContain('No se pudo completar la solicitud de descarga');
    expect(screen.queryByText(/Se solicitó la descarga/)).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('exports persisted values, not an edit that failed to save', async () => {
    const storage = setup();
    storage.setItem.mockImplementation(() => { throw new Error('quota'); });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Unsaved User' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear empleado' }));
    expect(screen.getByRole('alert').textContent).toContain('No se puede asegurar');
    fireEvent.click(screen.getByRole('button', { name: 'Exportar copia local (JSON)' }));
    const backup = JSON.parse(await textOf(storage.createObjectURL.mock.calls[0][0]));
    expect(backup.values['qbano-employees']).toBe(initial['qbano-employees']);
    expect(JSON.stringify(backup)).not.toContain('Unsaved User');
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(Object.fromEntries(storage.data)).toEqual(initial);
  });

  it('cancels the preview without writing or removing any local value', async () => {
    const storage = setup(initial, false);
    const values = {
      ...backupValues,
      'qbano-branches': '{corrupt-raw',
      'qbano-settings': '[]',
      'qbano-adjustments': null
    };
    const file = new File([JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: '2026-11-02T12:34:56.789Z',
      values
    })], 'backup.json', { type: 'application/json' });
    render(createElement(LocalBackup));
    const input = screen.getByLabelText('Seleccionar archivo JSON de respaldo');
    expect(input.tabIndex).toBe(0);
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole('heading', { name: 'Vista previa de la copia' })).toBeTruthy();
    expect(screen.getByText(/2026-11-02T12:34:56.789Z/)).toBeTruthy();
    expect(screen.getByText(/Ajustes/)).toBeTruthy();
    expect(screen.getByText(/el contenido no es JSON válido/)).toBeTruthy();
    expect(screen.getByText(/nivel superior no tiene la forma habitual/)).toBeTruthy();
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    expect(cancel.tabIndex).toBe(0);
    fireEvent.click(cancel);
    expect(screen.queryByRole('heading', { name: 'Vista previa de la copia' })).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(Object.fromEntries(storage.data)).toEqual(initial);
  });

  it('previews then confirms the exact raw import under Web Locks', async () => {
    const storage = setup(initial, false);
    const request = installWebLocks();
    const onRestoreStarted = vi.fn();
    const onRestoreComplete = vi.fn();
    const target = { ...backupValues, 'qbano-branches': '{corrupt-import', 'qbano-settings': '', 'qbano-adjustments': null };
    const file = new File([JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: '2026-10-31T00:00:00.000Z',
      values: target
    })], 'backup.json', { type: 'application/json' });
    render(createElement(LocalBackup, { onRestoreStarted, onRestoreComplete }));
    fireEvent.change(screen.getByLabelText('Seleccionar archivo JSON de respaldo'), { target: { files: [file] } });
    expect(await screen.findByRole('heading', { name: 'Vista previa de la copia' })).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Confirmar y restaurar' });
    expect(confirm.tabIndex).toBe(0);
    expect(confirm.hasAttribute('disabled')).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(onRestoreComplete).toHaveBeenCalledOnce());
    expect(onRestoreStarted).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(expect.any(String), { mode: 'exclusive' }, expect.any(Function));
    expect(storage.data.get('qbano-branches')).toBe('{corrupt-import');
    expect(storage.data.get('qbano-settings')).toBe('');
    expect(storage.data.has('qbano-adjustments')).toBe(false);
    expect(storage.data.has('qbano-local-restore-journal-v1')).toBe(true);
  });

  it('invalidates old previews and ignores a slower file read after the newer file resolves', async () => {
    const storage = setup(initial, false);
    installWebLocks();
    DeferredFileReader.readers = [];
    vi.stubGlobal('FileReader', DeferredFileReader);
    const onRestoreComplete = vi.fn();
    const valuesA = { ...backupValues, 'qbano-employees': '[{"fullName":"Backup A"}]' };
    const valuesB = { ...backupValues, 'qbano-employees': '[{"fullName":"Backup B"}]' };
    const textA = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: '2026-10-30T00:00:00.000Z',
      values: valuesA
    });
    const textB = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: '2026-10-31T00:00:00.000Z',
      values: valuesB
    });
    const fileA = new File([textA], 'backup-a.json', { type: 'application/json' });
    const fileB = new File([textB], 'backup-b.json', { type: 'application/json' });

    render(createElement(LocalBackup, { onRestoreComplete }));
    const input = screen.getByLabelText('Seleccionar archivo JSON de respaldo');
    fireEvent.change(input, { target: { files: [fileA] } });
    const readerA = DeferredFileReader.readers.find((reader) => reader.fileName === 'backup-a.json')!;
    fireEvent.change(input, { target: { files: [fileB] } });
    expect(DeferredFileReader.readers.map((reader) => reader.fileName)).toEqual(['backup-a.json', 'backup-b.json']);

    expect(screen.queryByRole('heading', { name: 'Vista previa de la copia' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirmar y restaurar' })).toBeNull();
    const readerB = DeferredFileReader.readers.find((reader) => reader.fileName === 'backup-b.json')!;
    act(() => { readerB.resolve(textB); });
    expect(await screen.findByText(/2026-10-31T00:00:00.000Z/)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Confirmar y restaurar' });
    expect(confirm.hasAttribute('disabled')).toBe(false);

    act(() => { readerA.resolve(textA); });
    expect(screen.getByText(/2026-10-31T00:00:00.000Z/)).toBeTruthy();
    expect(screen.queryByText(/2026-10-30T00:00:00.000Z/)).toBeNull();
    fireEvent.click(confirm);
    await waitFor(() => expect(onRestoreComplete).toHaveBeenCalledOnce());
    expect(storage.data.get('qbano-employees')).toBe(valuesB['qbano-employees']);
  });

  it('disables confirmation without Web Locks rather than falling back to localStorage writes', async () => {
    const storage = setup(initial, false);
    const file = new File([JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: '2026-11-02T12:34:56.789Z',
      values: backupValues
    })], 'backup.json', { type: 'application/json' });
    render(createElement(LocalBackup));
    fireEvent.change(screen.getByLabelText('Seleccionar archivo JSON de respaldo'), { target: { files: [file] } });
    expect((await screen.findByRole('button', { name: 'Confirmar y restaurar' })).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/requiere Web Locks y está deshabilitada/)).toBeTruthy();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
