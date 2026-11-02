// @vitest-environment jsdom
import { createElement, StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
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

function setup(values = initial) {
  const data = new Map(Object.entries(values));
  const getItem = vi.fn((key: string) => data.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { data.set(key, value); });
  const removeItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem, setItem, removeItem });
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:backup');
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
  vi.spyOn(window, 'setTimeout').mockReturnValue(1 as unknown as ReturnType<typeof window.setTimeout>);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  return { data, getItem, setItem, removeItem, createObjectURL, click };
}

const mount = async () => {
  await act(async () => { render(createElement(StrictMode, null, createElement(App))); });
};
const textOf = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

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
});
