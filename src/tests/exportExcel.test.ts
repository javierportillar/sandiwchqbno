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
  const result = aggregateDailyAndPeriod({ shifts: [shift], employees: [employee], settings: defaultSettings, periodId: period.id, adjustments: {} });
  const workbook = buildPayrollWorkbook({ period, employees: [employee], branches: seededBranches, shifts: [shift], result });
  const buffer = await workbook.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);
  const sheet = restored.getWorksheet('Detalle')!;
  expect(sheet.getRow(1).values).toEqual(expect.arrayContaining(['Inicio 2', 'Salida 2']));
  expect(sheet.getRow(2).values).toEqual(expect.arrayContaining(['Avenida', '11:00', '14:00', '18:00', '00:00']));
  expect(sheet.getRow(2).getCell(2).value).toBe('Avenida');
  expect([4, 5, 6, 7].map((column) => sheet.getRow(2).getCell(column).value)).toEqual(['11:00', '14:00', '18:00', '00:00']);
});
