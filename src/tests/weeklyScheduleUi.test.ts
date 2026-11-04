// @vitest-environment jsdom
import { createElement, StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveAs } from 'file-saver';
import ExcelJS from 'exceljs';
import App from '../App';
import { defaultSettings, seededBranches, seededEmployees } from '../data/seed';
import type { Employee, Shift } from '../types/payroll';

vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

const employee: Employee = { ...seededEmployees[0], id: 'week-employee', fullName: 'Test Employee', role: 'sala' };
const firstHalf = { id: 'p1', companyId: 'company-qbano', startDate: '2026-01-01', endDate: '2026-01-15', label: 'Primera quincena' };
const secondHalf = { id: 'p2', companyId: 'company-qbano', startDate: '2026-01-16', endDate: '2026-01-31', label: 'Segunda quincena' };

function makeShift(id: string, date: string, payPeriodId: string, patch: Partial<Shift> = {}): Shift {
  return {
    id, employeeId: employee.id, payPeriodId, date, startTime: '09:00', endTime: '12:00',
    breakMinutes: 0, ...patch
  };
}

function setup(shifts: Shift[], periods = [firstHalf, secondHalf], employees: readonly Employee[] = [employee]) {
  const data = new Map(Object.entries({
    'qbano-branches': JSON.stringify(seededBranches),
    'qbano-employees': JSON.stringify(employees),
    'qbano-periods': JSON.stringify(periods),
    'qbano-shifts': JSON.stringify(shifts),
    'qbano-settings': JSON.stringify(defaultSettings),
    'qbano-adjustments': '{}'
  }));
  const setItem = vi.fn((key: string, value: string) => { data.set(key, value); });
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem });
  return { data, setItem };
}

function readArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new TypeError('Expected an ArrayBuffer from the downloaded workbook.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read the exported workbook.'));
    reader.readAsArrayBuffer(blob);
  });
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

afterEach(() => { cleanup(); vi.mocked(saveAs).mockReset(); vi.unstubAllGlobals(); });

describe('week-first schedule interface', () => {
  it('shows F3 assigned hours from both quincenas in one week', async () => {
    setup([
      makeShift('jan-15', '2026-01-15', firstHalf.id),
      makeShift('jan-16', '2026-01-16', secondHalf.id, { startTime: '09:00', endTime: '14:00' })
    ]);
    await mount();
    openWeekSchedule();

    expect(within(screen.getByRole('navigation', { name: 'Navegación de semanas' })).getByText('2026-01-12 — 2026-01-18')).toBeTruthy();
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

  it('previews safe dates, protects explicit days off and review shifts, and resolves crossed pay periods', async () => {
    const dayOff = makeShift('protected-day-off', '2026-01-13', firstHalf.id, {
      restDay: true, startTime: undefined, endTime: undefined
    });
    const existing = makeShift('protected-shift', '2026-01-14', firstHalf.id, {
      startTime: '10:00', endTime: '14:00', breakMinutes: 15
    });
    const store = setup([dayOff, existing], [firstHalf, secondHalf], [{ ...employee, habitualShiftKind: 'normal' }]);
    await mount();
    openWeekSchedule();

    expect((screen.getByLabelText('Tipo de turno') as HTMLSelectElement).value).toBe('normal');
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Previsualizar carga semanal' }));
    expect(screen.getByText('Se reemplazarán 0 turno(s) y se crearán 5 nuevo(s). 2 fecha(s) protegida(s); 2 omitida(s) en total.')).toBeTruthy();
    expect(screen.getByText(/Semana 2026-01-12 — 2026-01-18 · Test Employee · destino: Unicentro/)).toBeTruthy();
    expect(screen.queryByText(/No hay período de pago/)).toBeNull();
    expect(store.data.get('qbano-shifts')).toContain('protected-day-off');
    expect(JSON.parse(store.data.get('qbano-shifts')!)).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar 5 cambio(s)' }));
    await waitFor(() => expect(JSON.parse(store.data.get('qbano-shifts')!).length).toBe(7));
    const records = JSON.parse(store.data.get('qbano-shifts')!) as Shift[];
    expect(records.find((shift) => shift.id === dayOff.id)).toEqual(dayOff);
    expect(records.find((shift) => shift.id === existing.id)).toEqual(existing);
    expect(records.find((shift) => shift.date === '2026-01-15')).toMatchObject({
      payPeriodId: firstHalf.id, templateId: 'unicentro-ls-normal'
    });
    expect(records.find((shift) => shift.date === '2026-01-16')).toMatchObject({
      payPeriodId: secondHalf.id, templateId: 'unicentro-ls-normal'
    });
    expect(records.find((shift) => shift.date === '2026-01-18')).toMatchObject({
      payPeriodId: secondHalf.id, templateId: 'unicentro-dom-normal'
    });
    expect(await screen.findByText(/Carga aplicada a Test Employee/)).toBeTruthy();
  });

  it('previews the selected destination and replaces a scheduled shift with one apply action', async () => {
    const dayOff = makeShift('protected-free-day', '2026-01-13', firstHalf.id, {
      restDay: true, startTime: undefined, endTime: undefined
    });
    const existing = makeShift('replace-this-shift', '2026-01-14', firstHalf.id, {
      startTime: '10:00', endTime: '14:00'
    });
    const store = setup([dayOff, existing], [firstHalf, secondHalf], [{ ...employee, habitualShiftKind: 'normal' }]);
    await mount();
    openWeekSchedule();

    fireEvent.change(screen.getByLabelText('Sede de destino para turnos nuevos y reemplazados'), {
      target: { value: 'branch-avenida' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Previsualizar carga semanal' }));

    expect(screen.getByText('Se reemplazarán 1 turno(s) y se crearán 5 nuevo(s). 1 fecha(s) protegida(s); 1 omitida(s) en total.')).toBeTruthy();
    expect(screen.getAllByText('10:00–14:00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reemplazo').length).toBe(1);
    const replacedPreviewRow = Array.from(document.querySelectorAll<HTMLElement>('.weekly-load-change'))
      .find((row) => row.textContent?.includes('10:00–14:00'));
    expect(replacedPreviewRow?.textContent).toContain('Sede: Unicentro');
    expect(replacedPreviewRow?.textContent).toContain('Sede: Avenida');
    expect(store.data.get('qbano-shifts')).toContain('replace-this-shift');
    expect(JSON.parse(store.data.get('qbano-shifts')!)).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar 6 cambio(s)' }));
    await waitFor(() => expect(JSON.parse(store.data.get('qbano-shifts')!).length).toBe(7));

    const records = JSON.parse(store.data.get('qbano-shifts')!) as Shift[];
    expect(records.find((shift) => shift.id === dayOff.id)).toEqual(dayOff);
    expect(records.find((shift) => shift.id === existing.id)).toMatchObject({
      startTime: '14:00', endTime: '22:00', templateId: 'avenida-sala-normal', overrideBranchId: 'branch-avenida'
    });
    expect(records.filter((shift) => shift.date === '2026-01-14')).toHaveLength(1);
    expect(records.find((shift) => shift.date === '2026-01-15')).toMatchObject({
      templateId: 'avenida-sala-normal', overrideBranchId: 'branch-avenida'
    });
    expect(await screen.findByText(/1 turno\(s\) reemplazado\(s\)/)).toBeTruthy();
  });

  it('shows weekly employee, hour, branch, and weekday metrics and refreshes with the selected week', async () => {
    const inactiveEmployee: Employee = { ...seededEmployees[1], id: 'inactive-week-employee', fullName: 'Inactive Employee', active: false };
    const unassignedEmployee: Employee = { ...seededEmployees[2], id: 'unassigned-week-employee', fullName: 'Unassigned Employee', active: true };
    const shifts: Shift[] = [
      makeShift('unicentro-monday', '2026-01-12', firstHalf.id, { startTime: '09:00', endTime: '12:00' }),
      makeShift('avenida-tuesday', '2026-01-13', firstHalf.id, {
        startTime: '14:00', endTime: '16:00', overrideBranchId: 'branch-avenida', breakMinutes: 30
      }),
      {
        id: 'unico-tuesday', employeeId: inactiveEmployee.id, payPeriodId: firstHalf.id,
        date: '2026-01-13', startTime: '14:00', endTime: '17:00', breakMinutes: 0
      }
    ];
    setup(shifts, [firstHalf, secondHalf], [employee, inactiveEmployee, unassignedEmployee]);
    await mount();
    openWeekSchedule();

    const summary = screen.getByRole('region', { name: 'Resumen de la semana' });
    expect(within(summary).getByText('2026-01-12 — 2026-01-18')).toBeTruthy();
    expect(within(summary).getByText('8 h 00 min')).toBeTruthy();
    expect(within(summary).getByText('Empleados con turnos')).toBeTruthy();
    expect(within(summary).getByText('Activos sin asignación')).toBeTruthy();
    expect(within(summary).getByRole('img', { name: 'Columnas apiladas con horas programadas por día y sede' })).toBeTruthy();
    expect(within(summary).getByRole('img', { name: 'Barras horizontales con las horas semanales programadas por sede' })).toBeTruthy();
    expect(summary.querySelector('.weekly-summary-chart-scroll')).toBeTruthy();
    expect(summary.querySelector('.weekly-summary-table-scroll')).toBeTruthy();

    const branchTable = within(summary).getByRole('table', { name: 'Horas, empleados y proporción semanal por sede' });
    expect(within(branchTable).getByRole('row', { name: /Unicentro 3 h 00 min 1 38%/ })).toBeTruthy();
    expect(within(branchTable).getByRole('row', { name: /Único 3 h 00 min 1 38%/ })).toBeTruthy();
    expect(within(branchTable).getByRole('row', { name: /Avenida 2 h 00 min 1 25%/ })).toBeTruthy();

    const dailyTable = within(summary).getByRole('table', { name: 'Horas programadas por día y sede' });
    expect(within(dailyTable).getByRole('row', { name: /mar · 2026-01-13 0 h 00 min 3 h 00 min 2 h 00 min 5 h 00 min/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente a 2026-01-12' }));
    expect(within(summary).getByText('2026-01-19 — 2026-01-25')).toBeTruthy();
    expect(summary.querySelectorAll('.weekly-summary-kpi')[2].querySelector('strong')?.textContent).toBe('0 h 00 min');
  });

  it('persists an employee habitual shift and exposes it as a suggestion rather than assigning it', async () => {
    const store = setup([], [firstHalf, secondHalf], [employee]);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Empleados' }));
    fireEvent.change(screen.getByLabelText('Turno habitual de Test Employee'), { target: { value: 'partido' } });

    await waitFor(() => {
      const savedEmployees = JSON.parse(store.data.get('qbano-employees')!) as Employee[];
      expect(savedEmployees[0].habitualShiftKind).toBe('partido');
    });
    expect(JSON.parse(store.data.get('qbano-shifts')!)).toHaveLength(0);
  });

  it('makes the reviewed week selectable in Cálculo without coupling it to the payroll period', async () => {
    setup([
      makeShift('week-anchor', '2026-01-15', firstHalf.id),
      makeShift('next-week-shift', '2026-01-20', secondHalf.id, { startTime: '09:00', endTime: '14:00' })
    ]);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Cálculo' }));

    const payrollPeriod = screen.getByLabelText('Período de nómina a calcular') as HTMLSelectElement;
    const weekNavigation = screen.getByRole('navigation', { name: 'Semana revisada en Cálculo' });
    const weeklyHours = document.querySelector('.week-calculation-table-wrap') as HTMLElement;
    expect(payrollPeriod.value).toBe(firstHalf.id);
    expect(within(weekNavigation).getByText('2026-01-19 — 2026-01-25')).toBeTruthy();
    expect(within(weeklyHours).getByText('5 h 00 min')).toBeTruthy();

    fireEvent.change(payrollPeriod, { target: { value: secondHalf.id } });
    expect(payrollPeriod.value).toBe(secondHalf.id);
    expect(within(weekNavigation).getByText('2026-01-19 — 2026-01-25')).toBeTruthy();
    expect(within(weeklyHours).getByText('5 h 00 min')).toBeTruthy();

    fireEvent.click(within(weekNavigation).getByRole('button', { name: /^Semana anterior/ }));
    expect(within(weekNavigation).getByText('2026-01-12 — 2026-01-18')).toBeTruthy();
    expect(within(weeklyHours).getByText('3 h 00 min')).toBeTruthy();
    expect(payrollPeriod.value).toBe(secondHalf.id);

    fireEvent.change(payrollPeriod, { target: { value: firstHalf.id } });
    expect(payrollPeriod.value).toBe(firstHalf.id);
    expect(within(weekNavigation).getByText('2026-01-12 — 2026-01-18')).toBeTruthy();
    expect(within(weeklyHours).getByText('3 h 00 min')).toBeTruthy();
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

  it('exports the displayed week and announces a successful download request', async () => {
    setup([makeShift('export-shift', '2026-01-15', firstHalf.id)]);
    await mount();
    openWeekSchedule();

    fireEvent.click(screen.getByRole('button', { name: 'Exportar horario semanal a Excel' }));

    expect(await screen.findByText(/Se solicitó la descarga del borrador semanal/)).toBeTruthy();
    await waitFor(() => expect(saveAs).toHaveBeenCalledOnce());
    expect(vi.mocked(saveAs).mock.calls[0][1]).toBe('horario-semanal-2026-01-12-a-2026-01-18.xlsx');
  });

  it('announces a retryable accessible failure when the browser download API throws', async () => {
    vi.mocked(saveAs).mockImplementationOnce(() => { throw new Error('Browser download rejected'); });
    setup([makeShift('export-failure-shift', '2026-01-15', firstHalf.id)]);
    await mount();
    openWeekSchedule();

    const exportButton = screen.getByRole('button', { name: 'Exportar horario semanal a Excel' });
    fireEvent.click(exportButton);

    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo exportar el horario semanal');
    expect((exportButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(exportButton);
    expect(await screen.findByText(/Se solicitó la descarga del borrador semanal/)).toBeTruthy();
  });

  it('exports employees in the active home-branch filter even when that group is collapsed', async () => {
    const homeEmployee: Employee = { ...employee, branchId: 'branch-avenida', active: true };
    const collapsedCoworker: Employee = {
      ...homeEmployee, id: 'collapsed-coworker', fullName: 'Collapsed Coworker'
    };
    const otherBranchEmployee: Employee = {
      ...homeEmployee, id: 'other-branch-employee', fullName: 'Other Branch Employee', branchId: 'branch-unicentro'
    };
    setup(
      [makeShift('scope-anchor', '2026-01-15', firstHalf.id)],
      [firstHalf, secondHalf],
      [homeEmployee, collapsedCoworker, otherBranchEmployee]
    );
    await mount();
    openWeekSchedule();

    fireEvent.change(screen.getByLabelText('Filtrar sede'), { target: { value: 'branch-avenida' } });
    const branchToggle = screen.getByRole('button', { name: /2 empleados/ });
    expect(screen.getByRole('heading', { name: 'Test Employee' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Collapsed Coworker' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Other Branch Employee' })).toBeNull();
    fireEvent.click(branchToggle);
    expect(branchToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('heading', { name: 'Test Employee' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Collapsed Coworker' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Exportar horario semanal a Excel' }));
    expect(await screen.findByText(/Se solicitó la descarga del borrador semanal/)).toBeTruthy();
    await waitFor(() => expect(saveAs).toHaveBeenCalledOnce());
    const blob = vi.mocked(saveAs).mock.calls[0][0] as Blob;
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(await readArrayBuffer(blob));

    const summary = restored.getWorksheet('Resumen semanal')!;
    expect(summary.getCell('B4').value).toContain('2');
    expect([summary.getCell('A9').value, summary.getCell('A10').value]).toEqual([
      'Test Employee', 'Collapsed Coworker'
    ]);
    expect([summary.getCell('A9').value, summary.getCell('A10').value]).not.toContain('Other Branch Employee');
  });
});
