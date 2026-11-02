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

function setup(shifts: Shift[], person: Employee = employee, selectedPeriod = period) {
  const data = new Map(Object.entries({
    'qbano-branches': JSON.stringify(seededBranches), 'qbano-employees': JSON.stringify([person]),
    'qbano-periods': JSON.stringify([selectedPeriod]), 'qbano-shifts': JSON.stringify(shifts),
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
