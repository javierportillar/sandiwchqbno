// @vitest-environment jsdom
import { createElement, StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { defaultSettings, seededBranches, seededEmployees } from '../data/seed';
import type { Employee, Shift } from '../types/payroll';

const period = { id: 'p', companyId: 'company-qbano', startDate: '2026-01-05', endDate: '2026-01-05', label: 'Jan 5' };
const boundaryPeriod = { ...period, startDate: '2026-01-01', endDate: '2026-01-15', label: 'Jan 1–15' };
const employee: Employee = { ...seededEmployees[0], id: 'test-employee', fullName: 'Test Employee', role: 'sala' };
const legacy: Shift = { id: 'legacy', employeeId: employee.id, payPeriodId: period.id, date: '2026-01-05', startTime: '11:00', endTime: '22:00', templateId: 'partido', breakMinutes: 240, notes: 'preserve legacy' };

function setup(shifts: Shift[], person: Employee = employee, selectedPeriod = period, periods = [selectedPeriod]) {
  const data = new Map(Object.entries({
    'qbano-branches': JSON.stringify(seededBranches), 'qbano-employees': JSON.stringify([person]),
    'qbano-periods': JSON.stringify(periods), 'qbano-shifts': JSON.stringify(shifts),
    'qbano-settings': JSON.stringify(defaultSettings), 'qbano-adjustments': '{}'
  }));
  const setItem = vi.fn((key: string, value: string) => { data.set(key, value); });
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem });
  return { data, setItem };
}
async function mount() {
  vi.stubGlobal('navigator', {
    locks: { request: async (_name: string, _options: { mode: 'exclusive' }, callback: () => unknown) => await callback() }
  });
  await act(async () => { render(createElement(StrictMode, null, createElement(App))); });
}
function openSchedule() {
  fireEvent.click(screen.getByRole('button', { name: 'Horarios' }));
  fireEvent.click(screen.getByRole('button', { name: 'Quincena y pincel' }));
}
function menu() { return within(document.querySelector('.mini-selector') as HTMLElement); }
function enterTimes(start: string, end: string) {
  fireEvent.change(screen.getByLabelText('Inicio del primer tramo'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('Fin del primer tramo'), { target: { value: end } });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('safe schedule editing', () => {
  it('keeps the concept-hours preview available for an integrity-valid period', async () => {
    const valid = { ...legacy, id: 'valid-shift', templateId: undefined, breakMinutes: 0 };
    setup([valid]);
    await mount();
    openSchedule();
    fireEvent.click(screen.getByTitle('11:00–22:00'));

    expect(screen.getByText(/Conceptos:/)).toBeTruthy();
    expect(screen.queryByText(/Conceptos de nómina no disponibles/)).toBeNull();
  });

  it('blocks payroll for a shift inside the selected dates but tagged to another period', async () => {
    const visible = { ...legacy, id: 'visible-shift', templateId: undefined, breakMinutes: 0 };
    const mismatched = { ...visible, id: 'mismatched-shift', payPeriodId: 'another-period' };
    const storedPeriod = { ...period, id: 'another-period', startDate: '2025-12-30', endDate: '2025-12-31', label: 'Stored period' };
    const store = setup([visible, mismatched], employee, period, [period, storedPeriod]);
    const original = store.data.get('qbano-shifts');
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));

    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('mismatched-shift');
    expect(screen.getByRole('alert').textContent).toContain('2026-01-05');
    expect(screen.getByRole('alert').textContent).toContain('another-period');
    expect(screen.getByRole('alert').textContent).toContain('no cambiar la fecha ni el payPeriodId');
    expect(screen.getByRole('button', { name: 'Ver turno mismatched-shift del 2026-01-05 en Horarios' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir Configuración y copias locales' })).toBeTruthy();

    openSchedule();
    fireEvent.click(screen.getByTitle('11:00–22:00'));
    expect(screen.getByText(/Conceptos de nómina no disponibles: revisa la integridad del período/)).toBeTruthy();
    expect(screen.queryByText(/Conceptos: ORD/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    const homeBranch = seededBranches.find((branch) => branch.id === employee.branchId)!;
    const otherBranch = seededBranches.find((branch) => branch.id !== homeBranch.id)!;
    const branchToggle = screen.getByRole('button', { name: new RegExp(homeBranch.name) });
    fireEvent.click(branchToggle);
    expect(branchToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.change(screen.getByLabelText('Filtrar sede'), { target: { value: otherBranch.id } });
    expect((screen.getByLabelText('Filtrar sede') as HTMLSelectElement).value).toBe(otherBranch.id);
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver turno mismatched-shift del 2026-01-05 en Horarios' }));
    expect(screen.getByRole('button', { name: 'Semana' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Filtrar sede') as HTMLSelectElement).value).toBe('all');
    expect(screen.getByRole('button', { name: new RegExp(homeBranch.name) }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/El turno mismatched-shift \(payPeriodId another-period\).*2026-01-05/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect((screen.getByLabelText('Periodo de pago') as HTMLSelectElement).value).toBe('another-period');
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Configuración y copias locales' }));
    expect(screen.getByRole('heading', { name: 'Copia de seguridad local' })).toBeTruthy();
    expect(screen.getByLabelText('Seleccionar archivo JSON de respaldo')).toBeTruthy();
    expect(store.data.get('qbano-shifts')).toBe(original);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'missing', storedPeriods: [] },
    {
      label: 'ambiguous',
      storedPeriods: [
        { ...period, id: 'another-period', startDate: '2025-12-30', endDate: '2025-12-31', label: 'Stored period A' },
        { ...period, id: 'another-period', startDate: '2025-12-28', endDate: '2025-12-29', label: 'Stored period B' }
      ]
    }
  ])('keeps mismatch recovery backup-only when the stored period ID is $label', async ({ storedPeriods }) => {
    const mismatched = { ...legacy, id: 'mismatched-shift', payPeriodId: 'another-period', templateId: undefined, breakMinutes: 0 };
    setup([mismatched], employee, period, [period, ...storedPeriods]);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));

    expect(screen.getByRole('alert').textContent).toContain('no identifica un único período guardado');
    expect(screen.queryByRole('button', { name: /Ver turno mismatched-shift/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abrir Dashboard y períodos' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir Configuración y copias locales' })).toBeTruthy();
  });

  it('keeps mismatch recovery backup-only when the referenced employee no longer exists', async () => {
    const orphanedShift = {
      ...legacy,
      id: 'orphaned-shift',
      employeeId: 'deleted-employee',
      payPeriodId: 'another-period',
      templateId: undefined,
      breakMinutes: 0
    };
    const storedPeriod = { ...period, id: 'another-period', startDate: '2025-12-30', endDate: '2025-12-31', label: 'Stored period' };
    const store = setup([orphanedShift], employee, period, [period, storedPeriod]);
    const originalShifts = store.data.get('qbano-shifts');
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));

    expect(screen.getByRole('alert').textContent).toContain('no existe un empleado único guardado con ID deleted-employee');
    expect(screen.queryByRole('button', { name: /Ver turno orphaned-shift/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ver período another-period en Dashboard' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Abrir Dashboard y períodos' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir Configuración y copias locales' })).toBeTruthy();
    expect(screen.getByText(/Para restaurar datos guardados, usá solo una copia JSON anterior/)).toBeTruthy();
    expect(store.data.get('qbano-shifts')).toBe(originalShifts);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('blocks payroll when another saved pay period overlaps the selected range', async () => {
    const overlapping = { ...period, id: 'overlap', startDate: '2026-01-05', endDate: '2026-01-06', label: 'Overlapping' };
    const store = setup([], employee, period, [period, overlapping]);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));

    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('se superpone');
    expect(screen.getByRole('alert').textContent).toContain('p (2026-01-05 a 2026-01-05)');
    expect(screen.getByRole('alert').textContent).toContain('overlap (2026-01-05 a 2026-01-06)');
    expect(screen.getByRole('alert').textContent).toContain('no editar ni eliminar los existentes');
    fireEvent.click(screen.getByRole('button', { name: 'Ver período overlap en Dashboard' }));
    expect((screen.getByLabelText('Periodo de pago') as HTMLSelectElement).value).toBe('overlap');
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: 'Abrir Configuración y copias locales' })).toBeTruthy();
    expect(store.data.get('qbano-periods')).toBe(JSON.stringify([period, overlapping]));
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('rejects creation of a custom period that overlaps an existing period accessibly', async () => {
    const store = setup([]);
    const originalPeriods = store.data.get('qbano-periods');
    await mount();
    fireEvent.change(screen.getByLabelText('Nuevo periodo: inicio'), { target: { value: '2026-01-05' } });
    fireEvent.change(screen.getByLabelText('Nuevo periodo: fin'), { target: { value: '2026-01-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear periodo personalizado' }));

    expect(screen.getByRole('alert').textContent).toContain('se superpone');
    expect(screen.getByRole('alert').textContent).toContain('El período no se creó');
    expect(screen.getByRole('alert').textContent).toContain('2026-01-05 a 2026-01-20');
    expect(store.data.get('qbano-periods')).toBe(originalPeriods);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('does not persist or select a new period when its generated ID already exists', async () => {
    const duplicateIdPeriod = { ...period, id: 'period-12345678', startDate: '2025-12-20', endDate: '2025-12-31', label: 'Existing period' };
    const store = setup([], employee, period, [period, duplicateIdPeriod]);
    const originalPeriods = store.data.get('qbano-periods');
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '12345678-0000-4000-8000-000000000000') });
    await mount();
    fireEvent.change(screen.getByLabelText('Nuevo periodo: inicio'), { target: { value: '2026-02-01' } });
    fireEvent.change(screen.getByLabelText('Nuevo periodo: fin'), { target: { value: '2026-02-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear periodo personalizado' }));

    expect(screen.getByRole('alert').textContent).toContain('Ya existe un período con el identificador period-12345678');
    expect(screen.getByRole('alert').textContent).toContain('El período no se creó');
    expect(store.data.get('qbano-periods')).toBe(originalPeriods);
    expect((screen.getByLabelText('Periodo de pago') as HTMLSelectElement).value).toBe(period.id);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it.each(['first-half', 'second-half'] as const)(
    'does not persist or select an overlapping %s quick period and announces the error',
    async (half) => {
      const firstHalf = { ...period, id: 'first-half', startDate: '2026-01-01', endDate: '2026-01-15', label: 'Jan 1–15' };
      const secondHalf = { ...period, id: 'second-half', startDate: '2026-01-16', endDate: '2026-01-31', label: 'Jan 16–31' };
      const periods = [firstHalf, secondHalf];
      const store = setup([], employee, firstHalf, periods);
      const originalPeriods = store.data.get('qbano-periods');
      vi.stubGlobal('prompt', vi.fn(() => '2026-01'));
      await mount();

      if (half === 'first-half') {
        fireEvent.change(screen.getByLabelText('Crear quincena rápida'), { target: { value: '2026-01' } });
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Crear segunda quincena (16-fin)' }));
      }

      const error = screen.getByRole('alert');
      expect(error.textContent).toContain('se superponen');
      expect(error.textContent).toContain(half === 'first-half' ? '2026-01-01 a 2026-01-15' : '2026-01-16 a 2026-01-31');
      expect(error.textContent).toContain('El período no se creó');
      expect(store.data.get('qbano-periods')).toBe(originalPeriods);
      expect((screen.getByLabelText('Periodo de pago') as HTMLSelectElement).value).toBe(firstHalf.id);
      expect(store.setItem).not.toHaveBeenCalled();
    }
  );

  it('blocks payroll for a legacy rest day with a positive break without changing it', async () => {
    const restDay: Shift = {
      ...legacy, startTime: undefined, endTime: undefined, templateId: undefined,
      restDay: true, breakMinutes: 30
    };
    const store = setup([restDay]);
    const original = store.data.get('qbano-shifts');
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));

    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('2026-01-05');
    expect(store.data.get('qbano-shifts')).toBe(original);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('exposes selector state and employee/date context for schedule controls', async () => {
    setup([]);
    await mount(); openSchedule();

    const cellButton = screen.getByRole('button', { name: 'Asignar turno para Test Employee, 2026-01-05' });
    expect(cellButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(cellButton);
    expect(cellButton.getAttribute('aria-expanded')).toBe('true');
    expect(menu().getByRole('button', { name: 'Normal para Test Employee, 2026-01-05' })).toBeTruthy();
    expect(menu().getByRole('button', { name: 'Personalizar turno de Test Employee, 2026-01-05' })).toBeTruthy();

    for (const branchOption of seededBranches) {
      expect(menu().getByRole('button', {
        name: `Cambiar sede a ${branchOption.name} para Test Employee, 2026-01-05`
      })).toBeTruthy();
    }

    const alternateBranch = seededBranches.find((branchOption) => branchOption.id !== employee.branchId)!;
    fireEvent.click(menu().getByRole('button', {
      name: `Cambiar sede a ${alternateBranch.name} para Test Employee, 2026-01-05`
    }));
    expect(menu().getByRole('button', {
      name: 'Cancelar cambio de sede para Test Employee, 2026-01-05'
    })).toBeTruthy();
    fireEvent.click(cellButton);
    expect(cellButton.getAttribute('aria-expanded')).toBe('false');
  });

  it('exposes branch collapse state to assistive technology', async () => {
    setup([]);
    await mount(); openSchedule();
    const branch = seededBranches.find((item) => item.id === employee.branchId)!;
    const branchToggle = screen.getByRole('button', { name: new RegExp(branch.name) });

    expect(branchToggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(branchToggle);
    expect(branchToggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('creates a custom shift only when complete, without a break deduction', async () => {
    const store = setup([]);
    await mount(); openSchedule();
    fireEvent.click(screen.getByTitle('Sin turno asignado'));
    fireEvent.click(menu().getByRole('button', { name: /^Personalizar turno de Test Employee, / }));
    enterTimes('08:00', '17:00');
    expect(store.setItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar tramos' }));
    const [shift] = JSON.parse(store.data.get('qbano-shifts')!);
    expect(shift).toMatchObject({ startTime: '08:00', endTime: '17:00', breakMinutes: 0 });
    expect(shift.secondStart).toBeUndefined();
  });

  it('allows a custom continuous shift that ends the following day', async () => {
    const store = setup([], employee, boundaryPeriod);
    await mount(); openSchedule();
    fireEvent.click(screen.getAllByTitle('Sin turno asignado')[0]);
    fireEvent.click(menu().getByRole('button', { name: /^Personalizar turno de Test Employee, / }));
    enterTimes('20:00', '04:00');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar tramos' }));
    const [shift] = JSON.parse(store.data.get('qbano-shifts')!);
    expect(shift).toMatchObject({ startTime: '20:00', endTime: '04:00', breakMinutes: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(false);
  });

  it('saves an explicitly split shift as two real intervals and zero break', async () => {
    const store = setup([]);
    await mount(); openSchedule();
    fireEvent.click(screen.getByTitle('Sin turno asignado'));
    fireEvent.click(menu().getByRole('button', { name: /^Personalizar turno de Test Employee, / }));
    enterTimes('11:00', '14:00');
    fireEvent.click(screen.getByLabelText('Agregar segundo tramo'));
    fireEvent.change(screen.getByLabelText('Inicio del segundo tramo'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByLabelText('Fin del segundo tramo'), { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar tramos' }));
    expect(JSON.parse(store.data.get('qbano-shifts')!)[0]).toMatchObject({ startTime: '11:00', endTime: '14:00', secondStart: '18:00', secondEnd: '22:00', breakMinutes: 0 });
  });

  it('omits a missing-role template during preload and explains why without storing fallback', async () => {
    const store = setup([], { ...employee, branchId: 'branch-avenida', role: undefined });
    await mount(); openSchedule();
    fireEvent.click(screen.getByRole('button', { name: /Precargar defaults/ }));
    expect(screen.getByRole('status').textContent).toContain('sin rol');
    expect(store.data.get('qbano-shifts')).toBe('[]');
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous legacy shift unchanged until complete explicit review and blocks payroll', async () => {
    const store = setup([legacy]);
    const original = store.data.get('qbano-shifts');
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('2026-01-05');
    openSchedule();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar turno de Test Employee, 2026-01-05' }));
    expect(menu().queryByText(/Conceptos:/)).toBeNull();
    fireEvent.click(menu().getByRole('button', { name: /^Personalizar turno de Test Employee, / }));
    expect((screen.getByLabelText('Inicio del primer tramo') as HTMLInputElement).value).toBe('');
    enterTimes('11:00', '14:00');
    fireEvent.click(screen.getByLabelText('Agregar segundo tramo'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar tramos' }));
    expect(store.data.get('qbano-shifts')).toBe(original);
    expect(store.setItem).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Inicio del segundo tramo'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByLabelText('Fin del segundo tramo'), { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar tramos' }));
    const [reviewed] = JSON.parse(store.data.get('qbano-shifts')!);
    expect(reviewed).toMatchObject({ id: 'legacy', notes: 'preserve legacy', breakMinutes: 0, startTime: '11:00', endTime: '14:00', secondStart: '18:00', secondEnd: '22:00' });
    expect(reviewed.templateId).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(false);
  });

  it('allows reviewing a legacy shift for an inactive employee without preloading new shifts', async () => {
    const store = setup([legacy], { ...employee, active: false });
    const original = store.data.get('qbano-shifts');
    await mount(); openSchedule();
    expect(screen.getByText(/Inactivo — visible para revisión/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revisar turno de Test Employee, 2026-01-05' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Precargar defaults/ }));
    expect(store.data.get('qbano-shifts')).toBe(original);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('never replaces a legacy shift with preload or brush without explicit review', async () => {
    const store = setup([legacy]);
    const original = store.data.get('qbano-shifts');
    await mount(); openSchedule();
    fireEvent.click(screen.getByRole('button', { name: /Precargar defaults/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Normal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revisar turno de Test Employee, 2026-01-05' }));
    expect(screen.getByRole('status').textContent).toContain('Revisa el turno');
    expect(store.data.get('qbano-shifts')).toBe(original);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('invalidates a previously computed result when a shift changes', async () => {
    const store = setup([]);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Calcular' }));
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(false);
    openSchedule();
    fireEvent.click(screen.getByTitle('Sin turno asignado'));
    fireEvent.click(menu().getByRole('button', { name: 'Normal para Test Employee, 2026-01-05' }));
    expect(JSON.parse(store.data.get('qbano-shifts')!)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(true);
  });

  it('preloads the correct normal template and does not change an existing shift', async () => {
    const old = { ...legacy, breakMinutes: 0, templateId: undefined };
    const store = setup([old]);
    const original = store.data.get('qbano-shifts');
    await mount(); openSchedule();
    fireEvent.click(screen.getByRole('button', { name: /Precargar defaults/ }));
    expect(store.data.get('qbano-shifts')).toBe(original);
    expect(store.setItem).not.toHaveBeenCalled();
    cleanup();
    const empty = setup([]);
    await mount(); openSchedule();
    fireEvent.click(screen.getByRole('button', { name: /Precargar defaults/ }));
    expect(JSON.parse(empty.data.get('qbano-shifts')!)[0]).toMatchObject({ templateId: 'unicentro-ls-normal', startTime: '14:00', endTime: '22:00', breakMinutes: 0 });
  });

  it('does not erase an existing shift when selecting a different branch without assignment', async () => {
    const current = { ...legacy, breakMinutes: 0, templateId: 'unicentro-ls-normal', startTime: '14:00', endTime: '22:00' };
    const store = setup([current]);
    const original = store.data.get('qbano-shifts');
    await mount(); openSchedule();
    fireEvent.click(screen.getByTitle('14:00–22:00'));
    fireEvent.click(menu().getByRole('button', { name: 'Cambiar sede a Avenida para Test Employee, 2026-01-05' }));
    expect(store.data.get('qbano-shifts')).toBe(original);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(menu().getByText(/cambio se guarda al asignar/)).toBeTruthy();
  });

  it('invalidates prior calculation during a branch draft and requires recalculation after cancel', async () => {
    const store = setup([]);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Calcular' }));
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(false);
    openSchedule();
    fireEvent.click(screen.getByTitle('Sin turno asignado'));
    fireEvent.click(menu().getByRole('button', { name: 'Cambiar sede a Avenida para Test Employee, 2026-01-05' }));
    expect(store.setItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(true);
    openSchedule();
    fireEvent.click(menu().getByRole('button', { name: 'Cancelar cambio de sede para Test Employee, 2026-01-05' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Calcular' }));
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(false);
  });

  it('does not preload or paint over a pending branch draft', async () => {
    const store = setup([]);
    await mount(); openSchedule();
    fireEvent.click(screen.getByTitle('Sin turno asignado'));
    fireEvent.click(menu().getByRole('button', { name: 'Cambiar sede a Avenida para Test Employee, 2026-01-05' }));
    fireEvent.click(screen.getByRole('button', { name: /Precargar defaults/ }));
    expect(store.data.get('qbano-shifts')).toBe('[]');
    fireEvent.click(within(document.querySelector('.brush-modes') as HTMLElement).getByRole('button', { name: 'Normal' }));
    fireEvent.click(screen.getByTitle('Sin turno asignado'));
    expect(store.data.get('qbano-shifts')).toBe('[]');
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('does not leak a branch draft to another period for the same employee and date', async () => {
    const store = setup([]);
    store.data.set('qbano-periods', JSON.stringify([period, { ...period, id: 'p2', label: 'Other period' }]));
    await mount(); openSchedule();
    fireEvent.click(screen.getByTitle('Sin turno asignado'));
    fireEvent.click(menu().getByRole('button', { name: 'Cambiar sede a Avenida para Test Employee, 2026-01-05' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    fireEvent.change(screen.getByLabelText('Periodo de pago'), { target: { value: 'p2' } });
    openSchedule();
    expect(screen.queryByText(/cambios de sede pendientes/)).toBeNull();
    fireEvent.click(screen.getByTitle('Sin turno asignado'));
    expect(menu().queryByText(/Sede seleccionada:/)).toBeNull();
    fireEvent.click(menu().getByRole('button', { name: 'Normal para Test Employee, 2026-01-05' }));
    expect(JSON.parse(store.data.get('qbano-shifts')!)[0]).toMatchObject({ payPeriodId: 'p2', templateId: 'unicentro-ls-normal' });
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    fireEvent.change(screen.getByLabelText('Periodo de pago'), { target: { value: 'p' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(true);
  });

  it('blocks and identifies duplicate shifts without exposing a misleading editable cell', async () => {
    const good = { ...legacy, id: 'valid-id', templateId: undefined, breakMinutes: 0 };
    const store = setup([legacy, good]);
    const original = store.data.get('qbano-shifts');
    await mount(); openSchedule();
    expect(screen.getByText('Duplicado')).toBeTruthy();
    expect(screen.getAllByText(/IDs: legacy, valid-id/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Revisar' })).toBeNull();
    expect(screen.getAllByText(/contacta a soporte/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(true);
    expect(store.data.get('qbano-shifts')).toBe(original);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it.each([
    { startTime: '11:00', endTime: '14:00', secondStart: '13:00', secondEnd: '22:00' },
    { startTime: 'broken', endTime: '14:00' },
    { startTime: '11:00', endTime: '14:00', templateId: 'unicentro-ls-partido' }
  ])('blocks stored invalid or incomplete ranges in payroll', async (patch) => {
    const shift = { ...legacy, templateId: undefined, breakMinutes: 0, ...patch };
    const store = setup([shift]);
    const original = store.data.get('qbano-shifts');
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('tramos reales');
    expect(store.data.get('qbano-shifts')).toBe(original);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('preserves a valid stored overnight shift and permits calculation', async () => {
    const shift = { ...legacy, templateId: undefined, breakMinutes: 0, startTime: '20:00', endTime: '04:00' };
    const store = setup([shift], employee, boundaryPeriod);
    const original = store.data.get('qbano-shifts');
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(false);
    expect(store.data.get('qbano-shifts')).toBe(original);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('blocks calculation and Excel export for an overnight shift crossing the period end', async () => {
    const shift = { ...legacy, templateId: undefined, breakMinutes: 0, date: '2026-01-15', startTime: '20:00', endTime: '04:00' };
    const store = setup([shift], employee, boundaryPeriod);
    const original = store.data.get('qbano-shifts');
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));

    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('más allá del cierre del período');
    expect(store.data.get('qbano-shifts')).toBe(original);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('allows an overnight shift ending within the selected period', async () => {
    const shift = { ...legacy, templateId: undefined, breakMinutes: 0, date: '2026-01-14', startTime: '20:00', endTime: '04:00' };
    setup([shift], employee, boundaryPeriod);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));

    const calculateButton = screen.getByRole('button', { name: 'Calcular' });
    expect(calculateButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(calculateButton);
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(false);
  });

  it('allows a daytime shift on the last date of the selected period', async () => {
    const shift = { ...legacy, templateId: undefined, breakMinutes: 0, date: '2026-01-15', startTime: '11:00', endTime: '14:00' };
    setup([shift], employee, boundaryPeriod);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));

    const calculateButton = screen.getByRole('button', { name: 'Calcular' });
    expect(calculateButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(calculateButton);
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(false);
  });

  it('blocks a shift whose date is outside its assigned period without altering it', async () => {
    const shift = { ...legacy, templateId: undefined, breakMinutes: 0, date: '2026-01-06', startTime: '08:00', endTime: '16:00' };
    const store = setup([shift]);
    const original = store.data.get('qbano-shifts');
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(true);
    const integrityAlert = screen.getAllByRole('alert').find((alert) => alert.textContent?.includes('payPeriodId p'))!;
    expect(integrityAlert.textContent).toContain('legacy');
    expect(integrityAlert.textContent).toContain('2026-01-06');
    expect(screen.getByRole('button', { name: 'Ver turno legacy del 2026-01-06 en Horarios' })).toBeTruthy();
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent).join(' ')).not.toContain('contacta a soporte');
    expect(store.data.get('qbano-shifts')).toBe(original);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('blocks a partido template without two intervals even when its ID has no partido suffix', async () => {
    const person = { ...employee };
    const store = setup([{ ...legacy, breakMinutes: 0, endTime: '14:00', templateId: 'opaque-template' }], person);
    const branches = structuredClone(seededBranches);
    const branch = branches.find((item) => item.id === person.branchId)!;
    branch.shiftTemplates.push({ ...branch.shiftTemplates.find((item) => item.kind === 'partido')!, id: 'opaque-template' });
    store.data.set('qbano-branches', JSON.stringify(branches));
    const original = store.data.get('qbano-shifts');
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: 'Calcular' }).hasAttribute('disabled')).toBe(true);
    expect(store.data.get('qbano-shifts')).toBe(original);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it('preserves the previous template origin when customizing a split shift ending at midnight', async () => {
    const original = { ...legacy, templateId: 'unicentro-ls-partido', breakMinutes: 0, endTime: '14:00', secondStart: '18:00', secondEnd: '22:00', templateOriginIds: ['earlier-template', 'earlier-template'] };
    const store = setup([original], employee, { ...period, endDate: '2026-01-06' });
    await mount(); openSchedule();
    fireEvent.click(screen.getByTitle('11:00–14:00 · 18:00–22:00'));
    fireEvent.click(menu().getByRole('button', { name: /^Personalizar turno de Test Employee, / }));
    fireEvent.change(screen.getByLabelText('Fin del segundo tramo'), { target: { value: '00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar tramos' }));
    expect(JSON.parse(store.data.get('qbano-shifts')!)[0]).toMatchObject({
      id: 'legacy', secondEnd: '00:00', breakMinutes: 0, notes: 'preserve legacy',
      templateOriginIds: ['earlier-template', 'earlier-template', 'unicentro-ls-partido']
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Calcular' }));
    expect(screen.getByText('11:00–14:00 · 18:00–00:00')).toBeTruthy();
  });

  it('retains a shift with the same ID in a different period during explicit editing', async () => {
    const current = { ...legacy, templateId: 'unicentro-ls-normal', breakMinutes: 0, startTime: '14:00', endTime: '22:00' };
    const other = { ...current, payPeriodId: 'other-period', notes: 'preserve other record' };
    const store = setup([current, other]);
    await mount(); openSchedule();
    fireEvent.click(screen.getByTitle('14:00–22:00'));
    fireEvent.click(menu().getByRole('button', { name: /^Personalizar turno de Test Employee, / }));
    fireEvent.change(screen.getByLabelText('Inicio del primer tramo'), { target: { value: '15:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar tramos' }));
    const records = JSON.parse(store.data.get('qbano-shifts')!);
    expect(records).toHaveLength(2);
    expect(records.find((shift: Shift) => shift.payPeriodId === 'other-period')).toEqual(other);
  });

  it('requires recalculation after changing adjustment or payroll settings', async () => {
    setup([]);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Calcular' }));
    const adjustmentRow = screen.getByText('AJUSTE AL CIEN').closest('tr')!;
    fireEvent.change(adjustmentRow.querySelector('input')!, { target: { value: '42' } });
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Calcular' }));
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Configuración' }));
    fireEvent.change(screen.getByLabelText('Horas ordinarias/día'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    expect(screen.getByRole('button', { name: /Exportar a Excel/ }).hasAttribute('disabled')).toBe(true);
  });

  it('shows both intervals and overridden branch in the computed result', async () => {
    const shift = { ...legacy, templateId: 'avenida-sala-partido', overrideBranchId: 'branch-avenida', breakMinutes: 0, endTime: '14:00', secondStart: '18:00', secondEnd: '22:00' };
    setup([shift]);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Calcular' }));
    const row = screen.getByText('11:00–14:00 · 18:00–22:00').closest('tr')!;
    expect(within(row).getByText('Avenida')).toBeTruthy();
  });

  it('resolves a template at an explicitly overridden branch', async () => {
    const store = setup([]);
    await mount(); openSchedule();
    fireEvent.click(screen.getByTitle('Sin turno asignado'));
    fireEvent.click(menu().getByRole('button', { name: 'Cambiar sede a Avenida para Test Employee, 2026-01-05' }));
    expect(store.data.get('qbano-shifts')).toBe('[]');
    expect(store.setItem).not.toHaveBeenCalled();
    fireEvent.click(menu().getByRole('button', { name: 'Normal para Test Employee, 2026-01-05' }));
    const [shift] = JSON.parse(store.data.get('qbano-shifts')!);
    expect(shift).toMatchObject({ overrideBranchId: 'branch-avenida', templateId: 'avenida-sala-normal', startTime: '14:00', endTime: '22:00', breakMinutes: 0 });
  });
});
