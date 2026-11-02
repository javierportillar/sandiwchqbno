// @vitest-environment jsdom
import { StrictMode, createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { defaultSettings, seededBranches, seededEmployees, seededPayPeriods, seededShifts } from '../data/seed';

const initial = {
  'qbano-branches': JSON.stringify(seededBranches),
  'qbano-employees': JSON.stringify(seededEmployees),
  'qbano-periods': JSON.stringify(seededPayPeriods),
  'qbano-shifts': JSON.stringify(seededShifts),
  'qbano-settings': JSON.stringify(defaultSettings),
  'qbano-adjustments': JSON.stringify({})
};
const keys = Object.keys(initial) as Array<keyof typeof initial>;

function fakeStorage(values: Record<string, string> = {}) {
  const data = new Map(Object.entries(values));
  const getItem = vi.fn((key: string) => data.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { data.set(key, value); });
  vi.stubGlobal('localStorage', { getItem, setItem });
  return { data, getItem, setItem };
}

const mount = async () => {
  await act(async () => { render(createElement(StrictMode, null, createElement(App))); });
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('storage protection in App', () => {
  it('initializes a new installation normally', async () => {
    const storage = fakeStorage();
    await mount();
    expect(screen.getByText('1. Dashboard')).toBeTruthy();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.data.size).toBe(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the UI and persistence closed until a non-StrictMode read completes', async () => {
    const storage = fakeStorage(initial);
    render(createElement(App));
    expect(screen.getByRole('status').textContent).toContain('Comprobando');
    expect(screen.queryByRole('button', { name: 'Empleados' })).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    await act(async () => {});
    expect(screen.getByText('1. Dashboard')).toBeTruthy();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('loads stored data and preserves legacy shift fields', async () => {
    const legacyShift = { ...seededShifts[0], breakMinutes: 240, templateId: 'partido', legacyField: 'keep' };
    const storage = fakeStorage({ ...initial, 'qbano-shifts': JSON.stringify([legacyShift]) });
    await mount();
    expect(screen.getByText('1. Dashboard')).toBeTruthy();
    expect(JSON.parse(storage.data.get('qbano-shifts')!)).toEqual([legacyShift]);
  });

  it.each(keys)('blocks all writes and hides fallback data when %s contains invalid JSON', async (key) => {
    const values = { ...initial, [key]: '{private-invalid-json' };
    const storage = fakeStorage(values);
    await mount();
    expect(screen.getByRole('alert').textContent).toContain('no se pueden interpretar');
    expect(screen.queryByText('1. Dashboard')).toBeNull();
    expect(screen.queryByText(/private-invalid-json/)).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(Object.fromEntries(storage.data)).toEqual(values);
  });

  it('does not persist an earlier missing key if a later key is corrupt', async () => {
    const values = { ...initial, 'qbano-adjustments': '{' };
    const storage = fakeStorage(values);
    storage.data.delete('qbano-branches');
    await mount();
    expect(screen.getByRole('alert').textContent).toContain('no se pueden interpretar');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.data.has('qbano-branches')).toBe(false);
    expect(storage.data.get('qbano-adjustments')).toBe('{');
  });

  it.each(keys)('blocks all writes for wrong top-level shape in %s', async (key) => {
    const raw = key === 'qbano-settings' || key === 'qbano-adjustments' ? '[]' : '{}';
    const values = { ...initial, [key]: raw };
    const storage = fakeStorage(values);
    await mount();
    expect(screen.getByRole('alert').textContent).toContain('formato inesperado');
    expect(screen.queryByText('1. Dashboard')).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(Object.fromEntries(storage.data)).toEqual(values);
  });

  it.each(keys)('blocks all writes if reading %s throws', async (key) => {
    const storage = fakeStorage(initial);
    storage.getItem.mockImplementation((current) => {
      if (current === key) throw new Error('private error');
      return storage.data.get(current) ?? null;
    });
    await mount();
    expect(screen.getByRole('alert').textContent).toContain('impidió leer');
    expect(screen.queryByText(/private error/)).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(Object.fromEntries(storage.data)).toEqual(initial);
  });

  it('blocks writes if only the second StrictMode read fails', async () => {
    const storage = fakeStorage(initial);
    let adjustmentsReads = 0;
    storage.getItem.mockImplementation((key) => {
      if (key === 'qbano-adjustments' && ++adjustmentsReads === 2) throw new Error('transient');
      return storage.data.get(key) ?? null;
    });
    await mount();
    expect(adjustmentsReads).toBe(2);
    expect(screen.getByRole('alert').textContent).toContain('impidió leer');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(Object.fromEntries(storage.data)).toEqual(initial);
  });

  it.each(keys.flatMap((key) => [1, 2].map((pass) => ({ key, pass }))))(
    'keeps the barrier closed if $key throws only on pass $pass',
    async ({ key, pass }) => {
      const storage = fakeStorage(initial);
      let reads = 0;
      storage.getItem.mockImplementation((current) => {
        if (current === key && ++reads === pass) throw new Error('transient');
        return storage.data.get(current) ?? null;
      });
      await mount();
      expect(reads).toBe(2);
      expect(screen.getByRole('alert').textContent).toContain('impidió leer');
      expect(screen.queryByRole('button', { name: 'Empleados' })).toBeNull();
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(Object.fromEntries(storage.data)).toEqual(initial);
    }
  );

  it.each([
    { pass: 1, value: '{', message: 'no se pueden interpretar' },
    { pass: 2, value: '{', message: 'no se pueden interpretar' },
    { pass: 1, value: '[]', message: 'formato inesperado' },
    { pass: 2, value: '[]', message: 'formato inesperado' }
  ])('blocks transient invalid data in pass $pass', async ({ pass, value, message }) => {
    const storage = fakeStorage(initial);
    let reads = 0;
    storage.getItem.mockImplementation((key) => {
      if (key === 'qbano-adjustments' && ++reads === pass) return value;
      return storage.data.get(key) ?? null;
    });
    await mount();
    expect(reads).toBe(2);
    expect(screen.getByRole('alert').textContent).toContain(message);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(Object.fromEntries(storage.data)).toEqual(initial);
  });

  it('does not carry a read failure into a later app session', async () => {
    const storage = fakeStorage(initial);
    storage.getItem.mockImplementationOnce(() => { throw new Error('transient'); });
    await mount();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(storage.setItem).not.toHaveBeenCalled();
    cleanup();
    await mount();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('1. Dashboard')).toBeTruthy();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('preserves an external change after the second read and before release', async () => {
    const storage = fakeStorage(initial);
    let reads = 0;
    storage.getItem.mockImplementation((key) => {
      const value = storage.data.get(key) ?? null;
      if (key === 'qbano-adjustments' && ++reads === 2) {
        queueMicrotask(() => storage.data.set('qbano-branches', '{external-corrupt'));
      }
      return value;
    });
    await mount();
    expect(storage.data.get('qbano-branches')).toBe('{external-corrupt');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it.each([
    { strict: false, raw: '[]' }, { strict: false, raw: '{external-corrupt' },
    { strict: true, raw: '[]' }, { strict: true, raw: '{external-corrupt' }
  ])('detects external changes before release (strict=$strict)', async ({ strict, raw }) => {
    const storage = fakeStorage(initial);
    let reads = 0;
    storage.getItem.mockImplementation((key) => {
      const value = storage.data.get(key) ?? null;
      if (key === 'qbano-adjustments' && ++reads === (strict ? 2 : 1)) {
        queueMicrotask(() => storage.data.set('qbano-branches', raw));
      }
      return value;
    });
    await act(async () => {
      render(strict ? createElement(StrictMode, null, createElement(App)) : createElement(App));
    });
    expect(screen.getByRole('alert').textContent).toContain('cambiaron fuera');
    expect(screen.queryByRole('button', { name: 'Empleados' })).toBeNull();
    expect(storage.data.get('qbano-branches')).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([
    { strict: false, raw: '[]' }, { strict: false, raw: '{external-corrupt' },
    { strict: true, raw: '[]' }, { strict: true, raw: '{external-corrupt' }
  ])('blocks changes after the last check but before content commit (strict=$strict)', async ({ strict, raw }) => {
    const storage = fakeStorage(initial);
    let reads = 0;
    storage.getItem.mockImplementation((key) => {
      const value = storage.data.get(key) ?? null;
      if (key === 'qbano-adjustments' && ++reads === (strict ? 3 : 2)) {
        queueMicrotask(() => storage.data.set('qbano-branches', raw));
      }
      return value;
    });
    await act(async () => {
      render(strict ? createElement(StrictMode, null, createElement(App)) : createElement(App));
    });
    expect(screen.getByRole('alert').textContent).toContain('cambiaron fuera');
    expect(screen.queryByRole('button', { name: 'Empleados' })).toBeNull();
    expect(storage.data.get('qbano-branches')).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks if the content-commit read fails (strict=%s)', async (strict) => {
    const storage = fakeStorage(initial);
    let reads = 0;
    storage.getItem.mockImplementation((key) => {
      if (key === 'qbano-branches' && ++reads === (strict ? 4 : 3)) throw new Error('private');
      return storage.data.get(key) ?? null;
    });
    await act(async () => {
      render(strict ? createElement(StrictMode, null, createElement(App)) : createElement(App));
    });
    expect(screen.getByRole('alert').textContent).toContain('impidió leer');
    expect(screen.queryByRole('button', { name: 'Empleados' })).toBeNull();
    expect(screen.queryByText(/private/)).toBeNull();
    expect(Object.fromEntries(storage.data)).toEqual(initial);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([
    { strict: false, key: 'qbano-employees', raw: '[]' },
    { strict: false, key: 'qbano-branches', raw: '{broken' },
    { strict: true, key: 'qbano-employees', raw: '{broken' },
    { strict: true, key: 'qbano-branches', raw: '[]' }
  ])('detects external change to $key before editing (strict=$strict)', async ({ strict, key, raw }) => {
    const storage = fakeStorage(initial);
    await act(async () => {
      render(strict ? createElement(StrictMode, null, createElement(App)) : createElement(App));
    });
    expect(storage.setItem).not.toHaveBeenCalled();
    storage.data.set(key, raw);
    fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Test User' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear empleado' }));
    expect(screen.getByRole('alert').textContent).toContain('cambiaron fuera');
    expect(screen.queryByRole('button', { name: 'Crear empleado' })).toBeNull();
    expect(storage.data.get(key)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('persists only the edited key in a new installation', async () => {
    const storage = fakeStorage();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Test User' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear empleado' }));
    expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual(['qbano-employees']);
    expect([...storage.data.keys()]).toEqual(['qbano-employees']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('blocks if a missing key appears before the first edit', async () => {
    const storage = fakeStorage();
    await mount();
    storage.data.set('qbano-employees', '[]');
    fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Test User' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear empleado' }));
    expect(screen.getByRole('alert').textContent).toContain('cambiaron fuera');
    expect(storage.data.get('qbano-employees')).toBe('[]');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('blocks if a snapshot recheck cannot read storage before an edit', async () => {
    const storage = fakeStorage(initial);
    await mount();
    storage.getItem.mockImplementation(() => { throw new Error('denied'); });
    fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Test User' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear empleado' }));
    expect(screen.getByRole('alert').textContent).toContain('impidió leer');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(Object.fromEntries(storage.data)).toEqual(initial);
  });

  it('blocks if a valid snapshot changes between StrictMode read passes', async () => {
    const storage = fakeStorage(initial);
    let reads = 0;
    storage.getItem.mockImplementation((key) => {
      const value = storage.data.get(key) ?? null;
      if (key === 'qbano-adjustments' && ++reads === 1) storage.data.set('qbano-branches', '[]');
      return value;
    });
    await mount();
    expect(screen.getByRole('alert').textContent).toContain('cambiaron fuera');
    expect(storage.data.get('qbano-branches')).toBe('[]');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('writes only actual edits and updates the expected snapshot after each save', async () => {
    const storage = fakeStorage(initial);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
    for (const name of ['First Test', 'Second Test']) {
      fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: name } });
      fireEvent.click(screen.getByRole('button', { name: 'Crear empleado' }));
    }
    expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual(['qbano-employees', 'qbano-employees']);
    expect(JSON.parse(storage.data.get('qbano-employees')!).slice(-2).map((employee: { fullName: string }) => employee.fullName))
      .toEqual(['First Test', 'Second Test']);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each(['qbano-shifts', null])('blocks on relevant storage event %s', async (key) => {
    const storage = fakeStorage(initial);
    await mount();
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key, newValue: '{private' })); });
    expect(screen.getByRole('alert').textContent).toContain('cambiaron fuera');
    expect(screen.queryByText(/private/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Empleados' })).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('ignores storage events for unrelated keys', async () => {
    const storage = fakeStorage(initial);
    await mount();
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'other' })); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Empleados' })).toBeTruthy();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('stops immediately after a failed edit write under StrictMode', async () => {
    const storage = fakeStorage(initial);
    storage.setItem.mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    await mount();
    expect(storage.setItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Test User' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear empleado' }));
    expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual(['qbano-employees']);
    expect(screen.getByRole('alert').textContent).toContain('No se puede asegurar');
    expect(screen.queryByRole('button', { name: 'Empleados' })).toBeNull();
    expect(Object.fromEntries(storage.data)).toEqual(initial);
  });

  it('blocks editing and subsequent writes when an update cannot be saved', async () => {
    const storage = fakeStorage(initial);
    await mount();
    storage.setItem.mockClear();
    storage.setItem.mockImplementation(() => { throw new Error('denied'); });
    fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Test User' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear empleado' }));
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toContain('No recargues');
    expect(screen.queryByRole('button', { name: 'Crear empleado' })).toBeNull();
    expect(storage.data.get('qbano-employees')).toBe(initial['qbano-employees']);
  });
});
