import { describe, expect, it } from 'vitest';
import { seededBranches, seededEmployees } from '../data/seed';
import { buildEmployeeWeekSchedule } from '../lib/scheduleWeek';
import { buildWeeklyLoadPlan, weeklyLoadPlansMatch } from '../lib/weeklyBulkLoad';
import type { PayPeriod, Shift } from '../types/payroll';

const employee = { ...seededEmployees[0], id: 'bulk-employee', branchId: 'branch-unicentro' };
const week = { startDate: '2026-01-12', endDateExclusive: '2026-01-19' };
const firstPeriod: PayPeriod = {
  id: 'first-half', companyId: employee.companyId, startDate: '2026-01-01', endDate: '2026-01-15', label: '1–15'
};
const secondPeriod: PayPeriod = {
  id: 'second-half', companyId: employee.companyId, startDate: '2026-01-16', endDate: '2026-01-31', label: '16–31'
};

function makeSchedule(periods: PayPeriod[], shifts: Shift[] = []) {
  return buildEmployeeWeekSchedule({ employee, week, periods, shifts, branches: seededBranches });
}

describe('weekly bulk load planning', () => {
  it('resolves the selected shift type for each day and its own pay period across a week boundary', () => {
    const plan = buildWeeklyLoadPlan({
      schedule: makeSchedule([firstPeriod, secondPeriod]),
      branches: seededBranches,
      kind: 'normal',
      branchId: employee.branchId
    });

    expect(plan.assignments).toHaveLength(7);
    expect(plan.assignments.find((item) => item.date === '2026-01-15')).toMatchObject({
      payPeriodId: firstPeriod.id, template: { id: 'unicentro-ls-normal' }
    });
    expect(plan.assignments.find((item) => item.date === '2026-01-16')).toMatchObject({
      payPeriodId: secondPeriod.id, template: { id: 'unicentro-ls-normal' }
    });
    expect(plan.assignments.find((item) => item.date === '2026-01-18')).toMatchObject({
      payPeriodId: secondPeriod.id, template: { id: 'unicentro-dom-normal' }
    });
  });

  it('preserves existing work and an explicit day off', () => {
    const existing: Shift[] = [
      { id: 'work', employeeId: employee.id, payPeriodId: firstPeriod.id, date: '2026-01-14', startTime: '10:00', endTime: '14:00', breakMinutes: 0 },
      { id: 'free', employeeId: employee.id, payPeriodId: firstPeriod.id, date: '2026-01-13', restDay: true, breakMinutes: 0 }
    ];
    const plan = buildWeeklyLoadPlan({
      schedule: makeSchedule([firstPeriod, secondPeriod], existing),
      branches: seededBranches,
      kind: 'partido',
      branchId: employee.branchId
    });

    expect(plan.assignments).toHaveLength(5);
    expect(plan.assignments.some((item) => item.date === '2026-01-13' || item.date === '2026-01-14')).toBe(false);
    expect(plan.skipped.filter((item) => item.reason === 'existing-assignment')).toHaveLength(1);
    expect(plan.skipped).toContainEqual({ date: '2026-01-13', reason: 'day-off-preserved' });
  });

  it('replaces valid scheduled shifts and fills empty dates in one explicit batch', () => {
    const existing: Shift = {
      id: 'replace-me', employeeId: employee.id, payPeriodId: firstPeriod.id,
      date: '2026-01-14', startTime: '10:00', endTime: '14:00', breakMinutes: 0
    };
    const dayOff: Shift = {
      id: 'keep-free', employeeId: employee.id, payPeriodId: firstPeriod.id,
      date: '2026-01-13', restDay: true, breakMinutes: 0
    };
    const plan = buildWeeklyLoadPlan({
      schedule: makeSchedule([firstPeriod, secondPeriod], [existing, dayOff]),
      branches: seededBranches,
      kind: 'normal',
      branchId: employee.branchId,
      mode: 'replace-scheduled'
    });

    expect(plan.assignments).toHaveLength(6);
    expect(plan.assignments.filter((item) => item.replaces)).toHaveLength(1);
    expect(plan.assignments.find((item) => item.date === existing.date)).toMatchObject({
      replaces: existing,
      template: { id: 'unicentro-ls-normal' }
    });
    expect(plan.assignments.some((item) => item.date === dayOff.date)).toBe(false);
    expect(plan.skipped).toContainEqual({ date: dayOff.date, reason: 'day-off-preserved' });
  });

  it('rejects a reviewed plan if the schedule changed before apply', () => {
    const existing: Shift = {
      id: 'shift-before-preview', employeeId: employee.id, payPeriodId: firstPeriod.id,
      date: '2026-01-14', startTime: '10:00', endTime: '14:00', breakMinutes: 0
    };
    const reviewed = buildWeeklyLoadPlan({
      schedule: makeSchedule([firstPeriod, secondPeriod], [existing]),
      branches: seededBranches,
      kind: 'partido',
      branchId: employee.branchId,
      mode: 'replace-scheduled'
    });
    const unchanged = buildWeeklyLoadPlan({
      schedule: makeSchedule([firstPeriod, secondPeriod], [existing]),
      branches: seededBranches,
      kind: 'partido',
      branchId: employee.branchId,
      mode: 'replace-scheduled'
    });
    const changed = buildWeeklyLoadPlan({
      schedule: makeSchedule([firstPeriod, secondPeriod], [{ ...existing, startTime: '11:00' }]),
      branches: seededBranches,
      kind: 'partido',
      branchId: employee.branchId,
      mode: 'replace-scheduled'
    });

    expect(weeklyLoadPlansMatch(reviewed, unchanged)).toBe(true);
    expect(weeklyLoadPlansMatch(reviewed, changed)).toBe(false);
  });

  it('skips missing and overlapping periods rather than guessing a period', () => {
    const gapPeriods = [
      { ...firstPeriod, endDate: '2026-01-14' },
      { ...secondPeriod, startDate: '2026-01-17' }
    ];
    const gapPlan = buildWeeklyLoadPlan({ schedule: makeSchedule(gapPeriods), branches: seededBranches, kind: 'normal', branchId: employee.branchId, mode: 'replace-scheduled' });
    expect(gapPlan.skipped.filter((item) => item.reason === 'period-missing').map((item) => item.date)).toEqual(['2026-01-15', '2026-01-16']);

    const overlap = { ...secondPeriod, id: 'overlap', startDate: '2026-01-15', endDate: '2026-01-17' };
    const overlapPlan = buildWeeklyLoadPlan({ schedule: makeSchedule([firstPeriod, secondPeriod, overlap]), branches: seededBranches, kind: 'normal', branchId: employee.branchId, mode: 'replace-scheduled' });
    expect(overlapPlan.skipped.filter((item) => item.reason === 'period-overlap').map((item) => item.date)).toEqual(['2026-01-15', '2026-01-16', '2026-01-17']);
  });

  it('skips unavailable day-specific templates and unresolved branch drafts', () => {
    const noSundayBranch = seededBranches.map((branch) => branch.id === employee.branchId
      ? { ...branch, shiftTemplates: branch.shiftTemplates.filter((template) => template.dayScope !== 'sun') }
      : branch);
    const schedule = makeSchedule([firstPeriod, secondPeriod]);
    const pendingDay = '2026-01-17';
    const pendingKey = JSON.stringify([secondPeriod.id, employee.id, pendingDay]);
    const plan = buildWeeklyLoadPlan({
      schedule,
      branches: noSundayBranch,
      kind: 'normal',
      branchId: employee.branchId,
      mode: 'replace-scheduled',
      pendingBranches: { [pendingKey]: 'branch-avenida' }
    });

    expect(plan.skipped).toContainEqual({ date: '2026-01-18', reason: 'template-unavailable' });
    expect(plan.skipped).toContainEqual({ date: pendingDay, reason: 'pending-branch' });
    expect(plan.assignments.some((item) => item.date === pendingDay || item.date === '2026-01-18')).toBe(false);
  });

  it('does not bypass role compatibility, duplicate shifts, or period mismatches', () => {
    const noRoleEmployee = { ...employee, branchId: 'branch-avenida', role: undefined };
    const noRoleSchedule = buildEmployeeWeekSchedule({
      employee: noRoleEmployee, week, periods: [firstPeriod, secondPeriod], shifts: [], branches: seededBranches
    });
    const incompatiblePlan = buildWeeklyLoadPlan({
      schedule: noRoleSchedule, branches: seededBranches, kind: 'normal', branchId: noRoleEmployee.branchId
    });
    expect(incompatiblePlan.assignments).toHaveLength(0);
    expect(incompatiblePlan.skipped.every((item) => item.reason === 'template-unavailable')).toBe(true);

    const mismatch: Shift = {
      id: 'mismatch', employeeId: employee.id, payPeriodId: secondPeriod.id,
      date: '2026-01-15', startTime: '09:00', endTime: '12:00', breakMinutes: 0
    };
    const duplicateA: Shift = { ...mismatch, id: 'duplicate-a', payPeriodId: secondPeriod.id, date: '2026-01-17' };
    const duplicateB: Shift = { ...duplicateA, id: 'duplicate-b' };
    const guardedPlan = buildWeeklyLoadPlan({
      schedule: makeSchedule([firstPeriod, secondPeriod], [mismatch, duplicateA, duplicateB]),
      branches: seededBranches,
      kind: 'normal',
      branchId: employee.branchId,
      mode: 'replace-scheduled'
    });
    expect(guardedPlan.skipped).toContainEqual({ date: '2026-01-15', reason: 'period-mismatch' });
    expect(guardedPlan.skipped).toContainEqual({ date: '2026-01-17', reason: 'duplicate' });
    expect(guardedPlan.assignments.some((item) => item.date === '2026-01-15' || item.date === '2026-01-17')).toBe(false);

    const reviewShift: Shift = {
      id: 'review', employeeId: employee.id, payPeriodId: firstPeriod.id,
      date: '2026-01-12', startTime: '09:00', endTime: '12:00', breakMinutes: 15
    };
    const reviewPlan = buildWeeklyLoadPlan({
      schedule: makeSchedule([firstPeriod, secondPeriod], [reviewShift]),
      branches: seededBranches,
      kind: 'normal',
      branchId: employee.branchId,
      mode: 'replace-scheduled'
    });
    expect(reviewPlan.skipped).toContainEqual({ date: '2026-01-12', reason: 'review' });
    expect(reviewPlan.assignments.some((item) => item.date === '2026-01-12')).toBe(false);
  });
});
