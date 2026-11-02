import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { seededBranches, seededEmployees } from '../data/seed';
import { buildEmployeeWeekSchedule } from '../lib/scheduleWeek';
import { buildWeeklyScheduleWorkbook } from '../lib/exportWeeklySchedule';
import type { Employee, PayPeriod, Shift } from '../types/payroll';

const week = { startDate: '2026-01-12', endDateExclusive: '2026-01-19' };
const employee: Employee = {
  ...seededEmployees[0],
  id: 'weekly-export-employee',
  fullName: 'Ana Pérez',
  branchId: 'branch-avenida',
  active: true
};
const periods: PayPeriod[] = [
  { id: 'period-first', companyId: employee.companyId, startDate: '2026-01-12', endDate: '2026-01-15', label: 'Quincena inicial' },
  { id: 'period-second', companyId: employee.companyId, startDate: '2026-01-17', endDate: '2026-01-18', label: 'Quincena final' }
];
const shifts: Shift[] = [
  {
    id: 'split-shift', employeeId: employee.id, payPeriodId: 'period-first', date: '2026-01-12',
    startTime: '09:00', endTime: '12:00', secondStart: '14:00', secondEnd: '17:00',
    breakMinutes: 30, overrideBranchId: 'branch-unico'
  },
  { id: 'day-off', employeeId: employee.id, payPeriodId: 'period-first', date: '2026-01-13', restDay: true, breakMinutes: 0 },
  { id: 'partial-shift', employeeId: employee.id, payPeriodId: 'period-first', date: '2026-01-15', startTime: '09:00', breakMinutes: 0 },
  {
    id: 'missing-period-shift', employeeId: employee.id, payPeriodId: 'period-removed', date: '2026-01-16',
    startTime: '10:00', endTime: '13:00', secondStart: '15:00', secondEnd: '18:00',
    breakMinutes: 0, overrideBranchId: 'branch-avenida'
  },
  {
    id: 'sunday-shift', employeeId: employee.id, payPeriodId: 'period-second', date: '2026-01-17',
    startTime: '09:00', endTime: '12:00', secondStart: '13:00', secondEnd: '17:00', breakMinutes: 0
  }
];

function makeSchedules() {
  const incomplete = buildEmployeeWeekSchedule({ employee, week, periods, shifts, branches: seededBranches });
  const unknownEmployee: Employee = { ...employee, id: 'unknown-coverage', fullName: 'Bruno Díaz' };
  const unknownBase = buildEmployeeWeekSchedule({
    employee: unknownEmployee, week, periods, shifts: [], branches: seededBranches
  });
  const unknown = {
    ...unknownBase,
    calculation: { ...unknownBase.calculation, coverageStatus: 'unknown' as const }
  };
  return [incomplete, unknown];
}

function excelTimeFraction(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) {
    return (value.getUTCHours() * 60 + value.getUTCMinutes() + value.getUTCSeconds() / 60) / (24 * 60);
  }
  throw new TypeError('Expected a numeric Excel duration or its date representation after ExcelJS reload.');
}

describe('weekly schedule Excel report', () => {
  it('serializes and reloads a Spanish draft with every employee/date, statuses, hours and warnings', async () => {
    const schedules = makeSchedules();
    const before = JSON.stringify({ schedules, shifts, employees: [employee] });
    const workbook = buildWeeklyScheduleWorkbook({
      week, schedules, branches: seededBranches, periods, shifts, branchFilter: 'branch-avenida'
    });
    const builtSummary = workbook.getWorksheet('Resumen semanal')!;
    const builtDetail = workbook.getWorksheet('Detalle diario')!;
    expect(typeof builtSummary.getCell('C9').value).toBe('number');
    expect(builtSummary.getCell('C9').value).toBe(19 / 24);
    expect(builtSummary.getCell('C9').numFmt).toBe('[h]:mm');
    expect(typeof builtDetail.getCell('N9').value).toBe('number');
    expect(builtDetail.getCell('N9').value).toBe(6 / 24);
    expect(builtDetail.getCell('N9').numFmt).toBe('[h]:mm');
    const buffer = await workbook.xlsx.writeBuffer();
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(buffer);

    expect(restored.worksheets.map((sheet) => sheet.name)).toEqual(['Resumen semanal', 'Detalle diario']);
    const summary = restored.getWorksheet('Resumen semanal')!;
    const detail = restored.getWorksheet('Detalle diario')!;
    expect(summary.getCell('B2').value).toBeInstanceOf(Date);
    expect(summary.getCell('B2').value).toEqual(new Date('2026-01-12T00:00:00.000Z'));
    expect(summary.getCell('D2').value).toEqual(new Date('2026-01-18T00:00:00.000Z'));
    expect(summary.getCell('A2').value).toContain('Lunes');
    expect(summary.getCell('C2').value).toContain('Domingo');
    expect(summary.getCell('B3').value).toContain('Avenida');
    expect(summary.getCell('B4').value).toContain('Empleados incluidos tras aplicar el filtro de sede habitual: 2');
    expect(summary.getCell('B4').value).toContain('Los grupos colapsados no los excluyen');
    expect(summary.getCell('A5').value).toContain('borrador');
    expect(summary.getCell('A5').value).toContain('no son horas trabajadas');
    expect(summary.getCell('A6').value).toContain('provisionales');
    expect(summary.getCell('A8').value).toContain('Empleado');
    expect(summary.autoFilter).toBeTruthy();
    expect(detail.autoFilter).toBeTruthy();
    expect(summary.views[0]).toMatchObject({ state: 'frozen', ySplit: 8 });
    expect(detail.views[0]).toMatchObject({ state: 'frozen', ySplit: 8 });

    const summaryHeader = 8;
    const summaryRows = schedules.map((_, index) => summary.getRow(summaryHeader + index + 1));
    expect(summaryRows).toHaveLength(2);
    const weeklyHours = summaryRows[0].getCell(3);
    // ExcelJS reloads elapsed-time numeric cells as Date objects; the source values above
    // are numbers, and these round-trip to the same day fraction with the elapsed format intact.
    expect(excelTimeFraction(weeklyHours.value)).toBe(19 / 24);
    expect(weeklyHours.numFmt).toBe('[h]:mm');
    expect(summaryRows[0].getCell(4).value).toBe('Cobertura incompleta');
    expect(summaryRows[0].getCell(5).value).toBeGreaterThan(0);
    expect(String(summaryRows[0].getCell(6).value)).toContain('descanso heredado');
    expect(String(summaryRows[0].getCell(6).value)).toContain('tramo horario incompleto');
    expect(summaryRows[1].getCell(4).value).toBe('Cobertura no verificada');
    expect(String(summaryRows[1].getCell(6).value)).toContain('Cobertura semanal no verificada');

    const detailHeader = 8;
    const detailRows = detail.getRows(detailHeader + 1, schedules.length * 7)!;
    expect(detailRows).toHaveLength(14);
    expect(detailRows.filter((row) => row.getCell(1).value === employee.fullName)).toHaveLength(7);
    expect(detailRows.filter((row) => row.getCell(1).value === 'Bruno Díaz')).toHaveLength(7);
    const anaRows = detailRows.filter((row) => row.getCell(1).value === employee.fullName);
    const dates = anaRows.map((row) => (row.getCell(2).value as Date).toISOString().slice(0, 10));
    expect(dates).toEqual([
      '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15',
      '2026-01-16', '2026-01-17', '2026-01-18'
    ]);
    expect(anaRows.map((row) => row.getCell(3).value)).toEqual([
      'Requiere revisión', 'Día libre', 'Sin asignar', 'Requiere revisión',
      'Sin período de pago', 'Asignado', 'Sin asignar'
    ]);
    expect(anaRows[0].getCell(5).value).toBe('Único');
    expect(anaRows[0].getCell(6).value).toBe('Único');
    expect(anaRows[0].getCell(10).value).toBe('09:00');
    expect(anaRows[0].getCell(11).value).toBe('12:00');
    expect(anaRows[0].getCell(12).value).toBe('14:00');
    expect(anaRows[0].getCell(13).value).toBe('17:00');
    expect(anaRows[0].getCell(7).value).toBe('Quincena inicial');
    expect(anaRows[0].getCell(8).value).toBe('period-first');
    expect(anaRows[4].getCell(7).value).toBe('Sin período de pago');
    expect(anaRows[4].getCell(8).value).toBe('period-removed');
    expect(anaRows[4].getCell(5).value).toBe('Avenida');
    expect(anaRows[4].getCell(6).value).toBe('Avenida');
    expect(anaRows[4].getCell(10).value).toBe('10:00');
    expect(anaRows[4].getCell(11).value).toBe('13:00');
    expect(anaRows[4].getCell(12).value).toBe('15:00');
    expect(anaRows[4].getCell(13).value).toBe('18:00');
    expect(excelTimeFraction(anaRows[0].getCell(14).value)).toBe(6 / 24);
    expect(anaRows[0].getCell(14).numFmt).toBe('[h]:mm');
    expect(excelTimeFraction(anaRows[4].getCell(14).value)).toBe(6 / 24);
    expect(String(anaRows[0].getCell(15).value)).toContain('descanso heredado');
    expect(String(anaRows[3].getCell(15).value)).toContain('incompleto');
    expect(anaRows[1].getCell(3).value).toBe('Día libre');
    expect(excelTimeFraction(anaRows[1].getCell(14).value)).toBe(0);
    expect(anaRows[2].getCell(3).value).toBe('Sin asignar');
    expect(excelTimeFraction(anaRows[2].getCell(14).value)).toBe(0);
    expect(anaRows[2].getCell(15).value).toContain('asignación confirmada');

    const headings: string[] = [];
    [summary.getRow(summaryHeader), detail.getRow(detailHeader)].forEach((row) => {
      row.eachCell((cell) => headings.push(String(cell.value ?? '')));
    });
    expect(headings.join(' ').toLocaleLowerCase()).not.toMatch(/salario|subtotal|valor hora|liquidación|cop\b|\$/);
    expect(JSON.stringify({ schedules, shifts, employees: [employee] })).toBe(before);
  });

  it('shows only the clipped Sunday-to-Monday carry-in and keeps F3 day/week totals', async () => {
    const overnightShift: Shift = {
      id: 'sunday-overnight',
      employeeId: employee.id,
      payPeriodId: 'period-first',
      date: '2026-01-11',
      startTime: '23:00',
      endTime: '02:00',
      breakMinutes: 0
    };
    const schedule = buildEmployeeWeekSchedule({
      employee, week, periods, shifts: [overnightShift], branches: seededBranches
    });
    expect(schedule.calculation.byDate[0]).toEqual({ date: '2026-01-12', scheduledMinutes: 120 });
    expect(schedule.calculation.assignedMinutes).toBe(120);

    const workbook = buildWeeklyScheduleWorkbook({
      week, schedules: [schedule], branches: seededBranches, periods,
      shifts: [overnightShift], branchFilter: 'all'
    });
    const builtSummary = workbook.getWorksheet('Resumen semanal')!;
    const builtDetail = workbook.getWorksheet('Detalle diario')!;
    expect(builtSummary.getCell('C9').value).toBe(2 / 24);
    expect(builtSummary.getCell('C9').numFmt).toBe('[h]:mm');
    expect(builtDetail.getCell('N9').value).toBe(2 / 24);
    expect(builtDetail.getCell('N9').numFmt).toBe('[h]:mm');
    expect(builtDetail.getRow(9).getCell(3).value).toBe('Continuidad desde el día anterior');
    expect([10, 11, 12, 13].every((column) => {
      const value = builtDetail.getRow(9).getCell(column).value;
      return value === null || value === undefined || value === '';
    })).toBe(true);

    const buffer = await workbook.xlsx.writeBuffer();
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(buffer);
    const mondayRow = restored.getWorksheet('Detalle diario')!.getRow(9);
    expect(excelTimeFraction(mondayRow.getCell(14).value)).toBe(2 / 24);
    expect(mondayRow.getCell(14).numFmt).toBe('[h]:mm');
    expect(String(mondayRow.getCell(16).value)).toContain('00:00–02:00');
    expect(String(mondayRow.getCell(16).value)).toContain('recorte de 23:00–02:00');
    expect(String(mondayRow.getCell(16).value)).toContain('turno sunday-overnight');
    expect(String(mondayRow.getCell(16).value)).toContain('fecha de origen 2026-01-11');
  });

  it('communicates both an own-date assignment and prior-date continuity', () => {
    const ownDateShift: Shift = {
      id: 'monday-shift', employeeId: employee.id, payPeriodId: 'period-first', date: '2026-01-12',
      startTime: '09:00', endTime: '12:00', breakMinutes: 0
    };
    const overnightShift: Shift = {
      id: 'sunday-overnight-mixed', employeeId: employee.id, payPeriodId: 'period-first', date: '2026-01-11',
      startTime: '23:00', endTime: '02:00', breakMinutes: 0
    };
    const mixedShifts = [ownDateShift, overnightShift];
    const schedule = buildEmployeeWeekSchedule({
      employee, week, periods, shifts: mixedShifts, branches: seededBranches
    });
    const workbook = buildWeeklyScheduleWorkbook({
      week, schedules: [schedule], branches: seededBranches, periods,
      shifts: mixedShifts, branchFilter: 'all'
    });
    const mondayRow = workbook.getWorksheet('Detalle diario')!.getRow(9);

    expect(schedule.calculation.byDate[0]).toEqual({ date: '2026-01-12', scheduledMinutes: 300 });
    expect(mondayRow.getCell(3).value).toBe('Asignado + continuidad desde el día anterior');
    expect(mondayRow.getCell(14).value).toBe(5 / 24);
    expect(mondayRow.getCell(16).value).toContain('sunday-overnight-mixed');
  });
});
