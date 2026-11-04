import { describe, expect, it } from 'vitest';
import { seededBranches, seededEmployees } from '../data/seed';
import { buildEmployeeWeekSchedule } from '../lib/scheduleWeek';
import { buildWeeklyScheduleSummary } from '../lib/weeklyScheduleSummary';
import type { Employee, PayPeriod, Shift } from '../types/payroll';

const week = { startDate: '2026-01-12', endDateExclusive: '2026-01-19' };
const periods: PayPeriod[] = [
  { id: 'summary-first', companyId: 'company-qbano', startDate: '2026-01-01', endDate: '2026-01-15', label: '1–15' },
  { id: 'summary-second', companyId: 'company-qbano', startDate: '2026-01-16', endDate: '2026-01-31', label: '16–31' }
];

function makeShift(id: string, employee: Employee, date: string, patch: Partial<Shift> = {}): Shift {
  return {
    id,
    employeeId: employee.id,
    payPeriodId: periods[0].id,
    date,
    startTime: '09:00',
    endTime: '12:00',
    breakMinutes: 0,
    ...patch
  };
}

function makeSchedules(employees: readonly Employee[], shifts: readonly Shift[]) {
  return employees.map((employee) => buildEmployeeWeekSchedule({
    employee, week, periods, branches: seededBranches, shifts
  }));
}

describe('weekly schedule summary', () => {
  it('aggregates active, scheduled, unassigned, branch, weekday, and gross-hour metrics', () => {
    const active = { ...seededEmployees[0], id: 'summary-active', fullName: 'Active employee' };
    const inactive = { ...seededEmployees[1], id: 'summary-inactive', fullName: 'Inactive employee', active: false };
    const unassigned = { ...seededEmployees[2], id: 'summary-unassigned', fullName: 'Unassigned employee', active: true };
    const employees = [active, inactive, unassigned];
    const shifts = [
      makeShift('monday-home-branch', active, '2026-01-12', { breakMinutes: 45 }),
      makeShift('tuesday-override', active, '2026-01-13', {
        startTime: '14:00', endTime: '16:00', overrideBranchId: 'branch-avenida'
      }),
      makeShift('tuesday-inactive', inactive, '2026-01-13')
    ];
    const summary = buildWeeklyScheduleSummary({
      week, employees, schedules: makeSchedules(employees, shifts), branches: seededBranches, shifts
    });

    expect(summary).toMatchObject({
      registeredEmployeeCount: 3,
      activeEmployeeCount: 2,
      scheduledEmployeeCount: 2,
      unassignedActiveEmployeeCount: 1,
      shiftCount: 3,
      scheduledMinutes: 8 * 60,
      unattributedMinutes: 0
    });
    expect(summary.branches).toEqual([
      { branchId: 'branch-unicentro', branchName: 'Unicentro', scheduledMinutes: 180, scheduledEmployeeCount: 1, shareOfTotalHours: 180 / 480 },
      { branchId: 'branch-unico', branchName: 'Único', scheduledMinutes: 180, scheduledEmployeeCount: 1, shareOfTotalHours: 180 / 480 },
      { branchId: 'branch-avenida', branchName: 'Avenida', scheduledMinutes: 120, scheduledEmployeeCount: 1, shareOfTotalHours: 120 / 480 }
    ]);
    expect(summary.days).toHaveLength(7);
    expect(summary.days[0]).toMatchObject({
      date: '2026-01-12', scheduledMinutes: 180, minutesByBranch: { 'branch-unicentro': 180 }
    });
    expect(summary.days[1]).toMatchObject({
      date: '2026-01-13', scheduledMinutes: 300,
      minutesByBranch: { 'branch-unicentro': 0, 'branch-unico': 180, 'branch-avenida': 120 }
    });
    expect(summary.days[6]).toMatchObject({ date: '2026-01-18', scheduledMinutes: 0 });
  });

  it('does not double-count overlapping shifts assigned to different branches', () => {
    const employee = { ...seededEmployees[0], id: 'cross-branch-overlap' };
    const shifts = [
      makeShift('overlap-unicentro', employee, '2026-01-12', { startTime: '09:00', endTime: '13:00' }),
      makeShift('overlap-avenida', employee, '2026-01-12', {
        startTime: '11:00', endTime: '15:00', overrideBranchId: 'branch-avenida'
      })
    ];
    const summary = buildWeeklyScheduleSummary({
      week,
      employees: [employee],
      schedules: makeSchedules([employee], shifts),
      branches: seededBranches,
      shifts
    });

    expect(summary.scheduledMinutes).toBe(6 * 60);
    expect(summary.days[0].scheduledMinutes).toBe(6 * 60);
    expect(summary.days[0].unattributedMinutes).toBe(6 * 60);
    expect(summary.unattributedMinutes).toBe(6 * 60);
    expect(summary.branches.every((branch) => branch.scheduledMinutes === 0)).toBe(true);
  });

  it('attributes unknown branch hours to review while reconciling known branch shares', () => {
    const employee = { ...seededEmployees[0], id: 'unknown-branch-summary' };
    const shifts = [
      makeShift('known-branch-shift', employee, '2026-01-12'),
      makeShift('stale-branch-shift', employee, '2026-01-13', { overrideBranchId: 'branch-retired' })
    ];
    const summary = buildWeeklyScheduleSummary({
      week,
      employees: [employee],
      schedules: makeSchedules([employee], shifts),
      branches: seededBranches,
      shifts
    });

    expect(summary.branches).toHaveLength(3);
    expect(summary.scheduledMinutes).toBe(6 * 60);
    expect(summary.unattributedMinutes).toBe(3 * 60);
    expect(summary.branches.reduce((sum, branch) => sum + branch.scheduledMinutes, 0) + summary.unattributedMinutes)
      .toBe(summary.scheduledMinutes);
    expect(summary.branches.reduce((sum, branch) => sum + branch.shareOfTotalHours, 0)
      + summary.unattributedMinutes / summary.scheduledMinutes).toBe(1);
    expect(summary.branches[0]).toMatchObject({ scheduledMinutes: 3 * 60, shareOfTotalHours: 0.5 });
    expect(summary.days[1]).toMatchObject({
      scheduledMinutes: 3 * 60,
      minutesByBranch: { 'branch-unicentro': 0, 'branch-unico': 0, 'branch-avenida': 0 },
      unattributedMinutes: 3 * 60
    });
  });

  it('counts a unique overnight carry-in shift that overlaps the selected week', () => {
    const employee = { ...seededEmployees[0], id: 'carry-in-summary' };
    const carryIn = makeShift('sunday-carry-in', employee, '2026-01-11', {
      startTime: '22:00', endTime: '02:00'
    });
    const shifts = [carryIn, { ...carryIn }];
    const summary = buildWeeklyScheduleSummary({
      week,
      employees: [employee],
      schedules: makeSchedules([employee], shifts),
      branches: seededBranches,
      shifts
    });

    expect(summary.shiftCount).toBe(1);
    expect(summary.scheduledMinutes).toBe(2 * 60);
    expect(summary.days[0].scheduledMinutes).toBe(2 * 60);
    expect(summary.branches[0].scheduledMinutes).toBe(2 * 60);
  });
});
