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
