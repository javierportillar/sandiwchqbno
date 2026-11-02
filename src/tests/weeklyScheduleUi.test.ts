// @vitest-environment jsdom
import { createElement, StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { defaultSettings, seededBranches, seededEmployees } from '../data/seed';
import type { Employee, Shift } from '../types/payroll';

const employee: Employee = { ...seededEmployees[0], id: 'week-employee', fullName: 'Test Employee', role: 'sala' };
const firstHalf = { id: 'p1', companyId: 'company-qbano', startDate: '2026-01-01', endDate: '2026-01-15', label: 'Primera quincena' };
const secondHalf = { id: 'p2', companyId: 'company-qbano', startDate: '2026-01-16', endDate: '2026-01-31', label: 'Segunda quincena' };

function makeShift(id: string, date: string, payPeriodId: string, patch: Partial<Shift> = {}): Shift {
  return {
    id, employeeId: employee.id, payPeriodId, date, startTime: '09:00', endTime: '12:00',
    breakMinutes: 0, ...patch
  };
}

function setup(shifts: Shift[], periods = [firstHalf, secondHalf]) {
  const data = new Map(Object.entries({
    'qbano-branches': JSON.stringify(seededBranches),
    'qbano-employees': JSON.stringify([employee]),
    'qbano-periods': JSON.stringify(periods),
    'qbano-shifts': JSON.stringify(shifts),
    'qbano-settings': JSON.stringify(defaultSettings),
    'qbano-adjustments': '{}'
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

function openWeekSchedule() {
  fireEvent.click(screen.getByRole('button', { name: 'Horarios' }));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('week-first schedule interface', () => {
  it('shows F3 assigned hours from both quincenas in one week', async () => {
    setup([
      makeShift('jan-15', '2026-01-15', firstHalf.id),
      makeShift('jan-16', '2026-01-16', secondHalf.id, { startTime: '09:00', endTime: '14:00' })
    ]);
    await mount();
    openWeekSchedule();

    expect(screen.getByText('2026-01-12 — 2026-01-18')).toBeTruthy();
    const card = screen.getByRole('heading', { name: 'Test Employee' }).closest('.employee-week-card') as HTMLElement;
    expect(within(card).getByText('8 h 00 min')).toBeTruthy();
    expect(within(card).getByText('Horas asignadas')).toBeTruthy();
    expect(within(card).getByText('Cobertura incompleta')).toBeTruthy();
    expect(card.querySelector('time[datetime="2026-01-15"]')).toBeTruthy();
    expect(card.querySelector('time[datetime="2026-01-16"]')).toBeTruthy();
  });

  it('saves a split custom interval to the date-resolved period and persists branch override', async () => {
    const existing = makeShift('existing', '2026-01-15', firstHalf.id, {
      secondStart: '14:00', secondEnd: '17:00', notes: 'keep me', overrideBranchId: 'branch-unico'
    });
    const store = setup([existing]);
    const original = store.data.get('qbano-shifts');
    await mount();
    openWeekSchedule();

    fireEvent.click(screen.getByRole('button', { name: 'Asignar turno a Test Employee, 2026-01-16' }));
    const branchSelect = screen.getByLabelText('Sede para Test Employee, 2026-01-16') as HTMLSelectElement;
    fireEvent.change(branchSelect, { target: { value: 'branch-avenida' } });
    expect(store.data.get('qbano-shifts')).toBe(original);

    const customize = screen.getByRole('button', { name: 'Personalizar turno de Test Employee, 2026-01-16' });
    expect(customize.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(customize);
    expect(customize.getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(screen.getByLabelText('Inicio del primer tramo — Test Employee, 2026-01-16'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('Fin del primer tramo — Test Employee, 2026-01-16'), { target: { value: '12:00' } });
    fireEvent.click(screen.getByLabelText('Agregar segundo tramo — Test Employee, 2026-01-16'));
    fireEvent.change(screen.getByLabelText('Inicio del segundo tramo — Test Employee, 2026-01-16'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('Fin del segundo tramo — Test Employee, 2026-01-16'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar tramos para Test Employee, 2026-01-16' }));

    const records = JSON.parse(store.data.get('qbano-shifts')!) as Shift[];
    expect(records).toHaveLength(2);
    expect(records.find((shift) => shift.id === existing.id)).toEqual(existing);
    expect(records.find((shift) => shift.date === '2026-01-16')).toMatchObject({
      employeeId: employee.id,
      payPeriodId: secondHalf.id,
      date: '2026-01-16',
      startTime: '09:00', endTime: '12:00', secondStart: '14:00', secondEnd: '18:00',
      breakMinutes: 0, overrideBranchId: 'branch-avenida'
    });
  });

  it('distinguishes an explicit day off from a blank day and exposes accessible disclosure state', async () => {
    const store = setup([makeShift('anchor', '2026-01-15', firstHalf.id)]);
    await mount();
    openWeekSchedule();

    const unassigned = screen.getByRole('button', { name: 'Asignar turno a Test Employee, 2026-01-13' });
    expect(unassigned.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(unassigned);
    expect(unassigned.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Sede para Test Employee, 2026-01-13')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Asignar día libre a Test Employee, 2026-01-13' }));

    const records = JSON.parse(store.data.get('qbano-shifts')!) as Shift[];
    expect(records.find((shift) => shift.date === '2026-01-13')).toMatchObject({
      payPeriodId: firstHalf.id, restDay: true, breakMinutes: 0
    });
    expect(records.find((shift) => shift.date === '2026-01-13')?.startTime).toBeUndefined();
    const dayOffRow = document.querySelector('time[datetime="2026-01-13"]')?.closest('li') as HTMLElement;
    const blankRow = document.querySelector('time[datetime="2026-01-14"]')?.closest('li') as HTMLElement;
    expect(within(dayOffRow).getByText('Día libre')).toBeTruthy();
    expect(within(blankRow).getByText('Sin asignar')).toBeTruthy();
  });

  it('keeps missing and overlapping pay-period dates non-assignable', async () => {
    const overlap = { id: 'overlap', companyId: 'company-qbano', startDate: '2026-01-15', endDate: '2026-01-16', label: 'Overlapping period' };
    setup([makeShift('anchor', '2026-01-15', firstHalf.id)], [firstHalf, secondHalf, overlap]);
    await mount();
    openWeekSchedule();

    expect(screen.getAllByText(/Períodos superpuestos/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Asignar turno a Test Employee, 2026-01-15' })).toBeNull();

    const gapPeriods = [
      { ...firstHalf, endDate: '2026-01-14' },
      { ...secondHalf, startDate: '2026-01-17' }
    ];
    cleanup();
    setup([makeShift('anchor-gap', '2026-01-15', firstHalf.id)], gapPeriods);
    await mount();
    openWeekSchedule();
    expect(screen.getAllByText('Sin período de pago').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Asignar turno a Test Employee, 2026-01-15' })).toBeNull();
  });

  it('keeps week and quincena/brush modes available', async () => {
    setup([makeShift('anchor', '2026-01-15', firstHalf.id)]);
    await mount();
    openWeekSchedule();
    expect(screen.getByRole('button', { name: 'Semana' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Quincena y pincel' }));
    expect(screen.getByText('Modo asignación')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Doblado' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sin modo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quincena y pincel' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('exposes week branch collapse state to assistive technology', async () => {
    setup([makeShift('anchor', '2026-01-15', firstHalf.id)]);
    await mount();
    openWeekSchedule();

    const branchToggle = screen.getByRole('button', { name: /1 empleado/ });
    expect(branchToggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(branchToggle);
    expect(branchToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('heading', { name: 'Test Employee' })).toBeNull();
  });
});
