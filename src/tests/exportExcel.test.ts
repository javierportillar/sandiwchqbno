import { describe, expect, it } from 'vitest';
import { getExportBranchId } from '../lib/exportExcel';
import type { Employee, Shift } from '../types/payroll';

describe('exportación de detalle', () => {
  it('usa la sede override del turno y no la sede base del empleado', () => {
    const employee = {
      id: 'emp-1',
      companyId: 'company-1',
      branchId: 'branch-base',
      fullName: 'Laura',
      baseMonthlySalary: 1600000,
      active: true
    } satisfies Employee;
    const shift = {
      id: 'shift-1',
      employeeId: employee.id,
      payPeriodId: 'period-1',
      date: '2026-01-04',
      breakMinutes: 60,
      overrideBranchId: 'branch-override'
    } satisfies Shift;

    expect(getExportBranchId(employee, shift)).toBe('branch-override');
    expect(getExportBranchId(employee)).toBe('branch-base');
  });
});

import ExcelJS from 'exceljs';
import { buildPayrollWorkbook } from '../lib/exportExcel';
import { aggregateDailyAndPeriod } from '../lib/calculation';
import { defaultSettings, seededBranches, seededEmployees } from '../data/seed';

it('serializes both split intervals and the effective branch in a real workbook', async () => {
  const employee = { ...seededEmployees[0], role: 'sala' as const };
  const period = { id: 'period', companyId: employee.companyId, startDate: '2026-01-05', endDate: '2026-01-05', label: 'Period' };
  const shift: Shift = { id: 's', employeeId: employee.id, payPeriodId: period.id, date: period.startDate,
    startTime: '11:00', endTime: '14:00', secondStart: '18:00', secondEnd: '00:00', breakMinutes: 0, overrideBranchId: 'branch-avenida' };
  const result = aggregateDailyAndPeriod({ shifts: [shift], employees: [employee], settings: defaultSettings, periodId: period.id, period, periods: [period], adjustments: {} });
  const workbook = buildPayrollWorkbook({ period, employees: [employee], branches: seededBranches, shifts: [shift], result });
  const buffer = await workbook.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);
  const sheet = restored.getWorksheet('Detalle')!;
  expect(sheet.getRow(1).values).toEqual(expect.arrayContaining(['Inicio 2', 'Salida 2']));
  expect(sheet.getRow(2).values).toEqual(expect.arrayContaining(['Avenida', '11:00', '14:00', '18:00', '00:00']));
  expect(sheet.getRow(2).getCell(2).value).toBe('Avenida');
  expect([5, 6, 7, 8].map((column) => sheet.getRow(2).getCell(column).value)).toEqual(['11:00', '14:00', '18:00', '00:00']);
});

it('exports the effective holiday-rate reference by work date without implying it was used in provisional amounts', async () => {
  const employee = { ...seededEmployees[0], role: 'sala' as const };
  const period = { id: 'holiday-period', companyId: employee.companyId, startDate: '2026-11-02', endDate: '2026-11-02', label: 'Holiday' };
  const shift: Shift = {
    id: 'holiday-shift', employeeId: employee.id, payPeriodId: period.id, date: period.startDate,
    startTime: '11:00', endTime: '21:00', breakMinutes: 0
  };
  const result = aggregateDailyAndPeriod({ shifts: [shift], employees: [employee], settings: defaultSettings, periodId: period.id, period, periods: [period], adjustments: {} });
  const workbook = buildPayrollWorkbook({ period, employees: [employee], branches: seededBranches, shifts: [shift], result });
  const buffer = await workbook.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);

  const detail = restored.getWorksheet('Detalle')!;
  expect(detail.getRow(1).values).toEqual(expect.arrayContaining(['Día especial / recargo legal de referencia']));
  expect(detail.getRow(2).values).toEqual(expect.arrayContaining([
    '2026-11-02 — Festivo: Día de Todos los Santos · recargo legal de referencia 90%'
  ]));
  const hoursSheet = restored.getWorksheet('Horas Extras')!;
  expect(hoursSheet.getRow(1).getCell(2).value).toContain('aún usan multiplicadores provisionales');
});

it('exports overnight special-day references from each contributing civil date', async () => {
  const employee = { ...seededEmployees[0], role: 'sala' as const };
  const period = {
    id: 'overnight-period', companyId: employee.companyId,
    startDate: '2025-01-01', endDate: '2026-12-31', label: 'Overnight shifts'
  };
  const shifts: Shift[] = [
    {
      id: 'saturday-sunday', employeeId: employee.id, payPeriodId: period.id, date: '2026-11-07',
      startTime: '22:00', endTime: '02:00', breakMinutes: 0
    },
    {
      id: 'weekday-holiday', employeeId: employee.id, payPeriodId: period.id, date: '2026-04-30',
      startTime: '22:00', endTime: '02:00', breakMinutes: 0
    },
    {
      id: 'rate-boundary-holiday', employeeId: employee.id, payPeriodId: period.id, date: '2025-06-30',
      startTime: '22:00', endTime: '02:00', breakMinutes: 0
    },
    {
      id: 'sunday-to-holiday', employeeId: employee.id, payPeriodId: period.id, date: '2026-11-01',
      startTime: '22:00', endTime: '02:00', breakMinutes: 0
    }
  ];
  const result = aggregateDailyAndPeriod({
    shifts, employees: [employee], settings: defaultSettings, periodId: period.id, period, periods: [period], adjustments: {}
  });
  const workbook = buildPayrollWorkbook({ period, employees: [employee], branches: seededBranches, shifts, result });
  const buffer = await workbook.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);
  const detail = restored.getWorksheet('Detalle')!;
  const detailRowsByStartDate = new Map(
    [2, 3, 4, 5].map((rowNumber) => {
      const row = detail.getRow(rowNumber);
      return [String(row.getCell(3).value), row] as const;
    })
  );
  const referenceByStartDate = new Map(
    [...detailRowsByStartDate].map(([date, row]) => [date, row.getCell(4).value])
  );

  expect(referenceByStartDate.get('2026-11-07')).toBe(
    '2026-11-08 — Domingo · recargo legal de referencia 90%'
  );
  expect(referenceByStartDate.get('2026-04-30')).toBe(
    '2026-05-01 — Festivo: Día del Trabajo · recargo legal de referencia 80%'
  );
  expect(referenceByStartDate.get('2025-06-30')).toBe(
    '2025-06-30 — Festivo: San Pedro y San Pablo, Sagrado Corazón de Jesús · recargo legal de referencia 75%'
  );

  const multiDateRow = detailRowsByStartDate.get('2026-11-01')!;
  const multiDateReference = String(multiDateRow.getCell(4).value);
  expect(multiDateReference).toBe([
    '2026-11-01 — Domingo · recargo legal de referencia 90%',
    '2026-11-02 — Festivo: Día de Todos los Santos · recargo legal de referencia 90%'
  ].join('; '));
  expect(detail.getColumn(4).width).toBe(56);
  expect(multiDateRow.getCell(4).alignment).toMatchObject({ vertical: 'middle', wrapText: true });
  expect(multiDateRow.height).toBeGreaterThanOrEqual(Math.ceil(multiDateReference.length / 44) * 16);
});
