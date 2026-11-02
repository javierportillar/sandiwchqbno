// @vitest-environment jsdom
import { StrictMode, createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { defaultSettings, seededBranches, seededEmployees, seededPayPeriods, seededShifts } from '../data/seed';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  RESTORE_JOURNAL_KEY,
  parseLocalBackup,
  previewLocalBackup,
  restoreLocalBackup
} from '../lib/localBackup';
import { STORAGE_LOCK_NAME } from '../lib/storage';
import type { StorageLockManagerLike } from '../lib/storage';

const initial = {
  'qbano-branches': JSON.stringify(seededBranches),
  'qbano-employees': JSON.stringify(seededEmployees),
  'qbano-periods': JSON.stringify(seededPayPeriods),
  'qbano-shifts': JSON.stringify(seededShifts),
  'qbano-settings': JSON.stringify(defaultSettings),
  'qbano-adjustments': JSON.stringify({})
};
const keys = Object.keys(initial) as Array<keyof typeof initial>;
let lockManagerInstalled = false;

function fakeStorage(values: Record<string, string> = {}) {
  const data = new Map(Object.entries(values));
  const getItem = vi.fn((key: string) => data.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { data.set(key, value); });
  const removeItem = vi.fn((key: string) => { data.delete(key); });
  vi.stubGlobal('localStorage', { getItem, setItem, removeItem });
  return { data, getItem, setItem, removeItem };
}

function installWebLocks() {
  const calls = vi.fn((name: string, options: { mode: 'exclusive' }) => ({ name, mode: options.mode }));
  vi.stubGlobal('navigator', {
    locks: {
      request: (name: string, options: { mode: 'exclusive' }, callback: () => unknown) => {
        calls(name, options);
        return Promise.resolve(callback());
      }
    }
  });
  lockManagerInstalled = true;
  return calls;
}

function installQueuedWebLocks() {
  let active = false;
  const pending: Array<() => void> = [];
  const request = vi.fn((_name: string, _options: { mode: 'exclusive' }, callback: () => unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const run = (insideAct = false) => {
        active = true;
        try {
          const result = insideAct ? act(() => callback()) : callback();
          Promise.resolve(result).then(resolve, reject).finally(() => {
            active = false;
            pending.shift()?.();
          });
        } catch (error) {
          reject(error);
          active = false;
          pending.shift()?.();
        }
      };
      if (active) pending.push(() => run(true));
      else run();
    })
  );
  const lockManager: StorageLockManagerLike = { request: request as unknown as StorageLockManagerLike['request'] };
  vi.stubGlobal('navigator', { locks: lockManager });
  lockManagerInstalled = true;
  return { lockManager, request };
}

const mount = async () => {
  if (!lockManagerInstalled) installWebLocks();
  await act(async () => { render(createElement(StrictMode, null, createElement(App))); });
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); lockManagerInstalled = false; });

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
    installWebLocks();
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

  it('coordinates app persistence with the same exclusive Web Lock used by restore', async () => {
    const storage = fakeStorage(initial);
    const lockCalls = installWebLocks();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Locked Writer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear empleado' }));
    await act(async () => {});
    expect(storage.setItem.mock.calls.map(([key]) => key)).toEqual(['qbano-employees']);
    expect(lockCalls.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(lockCalls.mock.calls.every(([name, options]) => name === STORAGE_LOCK_NAME && options.mode === 'exclusive')).toBe(true);
  });

  it('refuses a queued normal save after restore leaves a prepared journal before target writes', async () => {
    const storage = fakeStorage(initial);
    const { lockManager, request } = installQueuedWebLocks();
    await mount();
    const target = { ...initial, 'qbano-employees': '[{"fullName":"From backup"}]' };
    const backup = parseLocalBackup(JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: '2026-11-02T12:34:56.789Z',
      values: target
    }));
    const snapshot = previewLocalBackup(backup).snapshot;
    let queuedEdit = false;
    storage.setItem.mockImplementation((key, value) => {
      if (key === RESTORE_JOURNAL_KEY) {
        storage.data.set(key, value);
        if (!queuedEdit) {
          queuedEdit = true;
          fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
          fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Queued writer' } });
          fireEvent.click(screen.getByRole('button', { name: 'Crear empleado' }));
        }
        return;
      }
      if (key === 'qbano-branches') throw new DOMException('full', 'QuotaExceededError');
      storage.data.set(key, value);
    });

    const restoreResult = await restoreLocalBackup(backup, snapshot, undefined, lockManager);
    await act(async () => {});

    expect(restoreResult).toMatchObject({ ok: false, reason: 'target-write-failed' });
    expect(storage.data.get(RESTORE_JOURNAL_KEY)).toBeTruthy();
    expect(Object.fromEntries([...storage.data].filter(([key]) => key !== RESTORE_JOURNAL_KEY))).toEqual(initial);
    expect(screen.getByRole('heading', { name: 'Recuperación de datos locales requerida' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Crear empleado' })).toBeNull();
    expect(storage.setItem.mock.calls.some(([key]) => key === 'qbano-employees')).toBe(false);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.every(([name, options]) => name === STORAGE_LOCK_NAME && options.mode === 'exclusive')).toBe(true);
  });

  it('blocks editing and preserves a malformed journal discovered inside the save lock', async () => {
    const storage = fakeStorage(initial);
    installWebLocks();
    await mount();
    storage.data.set(RESTORE_JOURNAL_KEY, '{malformed-after-startup');
    fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Must not save' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear empleado' }));

    expect(screen.getByRole('heading', { name: 'Recuperación de datos locales requerida' })).toBeTruthy();
    expect(screen.getByText(/registro de recuperación está dañado/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Crear empleado' })).toBeNull();
    expect(storage.data.get(RESTORE_JOURNAL_KEY)).toBe('{malformed-after-startup');
    expect(Object.fromEntries([...storage.data].filter(([key]) => key !== RESTORE_JOURNAL_KEY))).toEqual(initial);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('never falls back to an unlocked normal save when Web Locks are unavailable', async () => {
    const storage = fakeStorage(initial);
    render(createElement(App));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Must stay in memory' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear empleado' }));

    expect(screen.getByRole('alert').textContent).toContain('bloqueo exclusivo');
    expect(screen.queryByRole('button', { name: 'Crear empleado' })).toBeNull();
    expect(Object.fromEntries(storage.data)).toEqual(initial);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('blocks normal startup for a malformed journal', async () => {
    const storage = fakeStorage({ ...initial, [RESTORE_JOURNAL_KEY]: '{malformed' });
    await mount();
    expect(screen.getByRole('heading', { name: 'Recuperación de datos locales requerida' })).toBeTruthy();
    expect(screen.getByText(/registro de recuperación está dañado/)).toBeTruthy();
    expect(screen.queryByText('1. Dashboard')).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('offers retry and rollback after a prepared partial transaction is found on startup', async () => {
    installWebLocks();
    const before = { ...initial, 'qbano-branches': '{before-raw' };
    const target = { ...initial, 'qbano-employees': '' };
    const journal = {
      format: 'sandwich-qbano-local-restore-journal',
      version: 1,
      transactionId: 'prepared-test',
      createdAt: '2026-11-02T12:34:56.789Z',
      status: 'prepared',
      before,
      target
    };
    const storage = fakeStorage({ ...target, 'qbano-branches': '{partial-target', [RESTORE_JOURNAL_KEY]: JSON.stringify(journal) });
    await mount();
    expect(screen.queryByText('1. Dashboard')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reintentar restauración' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Revertir a los datos anteriores' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar restauración' }));
    expect(await screen.findByText(/La copia se aplicó y verificó/)).toBeTruthy();
    expect(storage.data.get('qbano-branches')).toBe(target['qbano-branches']);
    expect(storage.data.get('qbano-employees')).toBe('');
    expect(JSON.parse(storage.data.get(RESTORE_JOURNAL_KEY)!).status).toBe('applied');
    expect(screen.getByRole('button', { name: 'Conservar los datos restaurados' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revertir a los datos anteriores' })).toBeTruthy();
    expect(screen.queryByText('1. Dashboard')).toBeNull();
  });

  it('keeps the app blocked and the journal when recovery fails partway through rollback', async () => {
    const lockCalls = installWebLocks();
    const before = { ...initial, 'qbano-branches': '{before-raw', 'qbano-employees': '', 'qbano-periods': '{old-periods' };
    const target = { ...initial };
    const journal = {
      format: 'sandwich-qbano-local-restore-journal',
      version: 1,
      transactionId: 'restore-test',
      createdAt: '2026-11-02T12:34:56.789Z',
      status: 'applied',
      before,
      target
    };
    const storage = fakeStorage({ ...target, [RESTORE_JOURNAL_KEY]: JSON.stringify(journal) });
    storage.setItem.mockImplementation((key, value) => {
      if (key === 'qbano-periods') throw new DOMException('full', 'QuotaExceededError');
      storage.data.set(key, value);
    });
    await mount();
    expect(screen.queryByText('1. Dashboard')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Revertir a los datos anteriores' }));
    expect(await screen.findByText(/La escritura quedó incompleta/)).toBeTruthy();
    expect(screen.queryByText('1. Dashboard')).toBeNull();
    expect(storage.data.get(RESTORE_JOURNAL_KEY)).toBe(JSON.stringify(journal));
    expect(storage.data.get('qbano-branches')).toBe(before['qbano-branches']);
    expect(lockCalls.mock.calls.every(([name, options]) => name === STORAGE_LOCK_NAME && options.mode === 'exclusive')).toBe(true);
    expect(storage.removeItem).not.toHaveBeenCalled();
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
