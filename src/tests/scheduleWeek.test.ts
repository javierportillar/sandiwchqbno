import { describe, expect, it } from 'vitest';
import type { Branch, Employee, PayPeriod, Shift } from '../types/payroll';
import {
  addDaysToDate,
  addWeeksToDate,
  buildEmployeeWeekSchedule,
  getInitialScheduleWeekStart,
  getMondayWeekStart,
  getScheduleWeekDates,
  resolvePayPeriodForDate
} from '../lib/scheduleWeek';

const employee: Employee = {
  id: 'employee-1', companyId: 'company-1', branchId: 'branch-1', fullName: 'Ada Lovelace',
  baseMonthlySalary: 0, active: true
};
const periods: PayPeriod[] = [
  { id: 'first-half', companyId: 'company-1', startDate: '2024-02-12', endDate: '2024-02-15', label: 'First half' },
  { id: 'second-half', companyId: 'company-1', startDate: '2024-02-16', endDate: '2024-02-18', label: 'Second half' }
];
const branches: Branch[] = [{
  id: 'branch-1', companyId: 'company-1', name: 'Avenida', defaultStartTime: '09:00', defaultEndTime: '17:00',
  timezone: 'America/Bogota', shiftTemplates: []
}];
const week = { startDate: '2024-02-12', endDateExclusive: '2024-02-19' };

function shift(id: string, date: string, payPeriodId: string, patch: Partial<Shift> = {}): Shift {
  return {
    id, employeeId: employee.id, payPeriodId, date, breakMinutes: 0,
    startTime: '09:00', endTime: '12:00', ...patch
  };
}

describe('civil week navigation and period resolution', () => {
  it('navigates month, year, and leap-day boundaries using civil dates', () => {
    expect(getMondayWeekStart('2024-02-29')).toBe('2024-02-26');
    expect(getScheduleWeekDates({ startDate: '2024-02-26', endDateExclusive: '2024-03-04' })).toEqual([
      '2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02', '2024-03-03'
    ]);
    expect(addDaysToDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(addWeeksToDate('2024-12-30', 1)).toBe('2025-01-06');
  });

  it('starts on a week containing existing schedule data instead of an empty future week', () => {
    const existing = shift('shift-1', '2024-02-16', 'second-half');
    expect(getInitialScheduleWeekStart(periods, [existing], '2026-11-02')).toBe('2024-02-12');
  });

  it('resolves each date to its own quincena and refuses missing or overlapping matches', () => {
    expect(resolvePayPeriodForDate('2024-02-15', periods)).toEqual({ status: 'available', period: periods[0] });
    expect(resolvePayPeriodForDate('2024-02-16', periods)).toEqual({ status: 'available', period: periods[1] });
    expect(resolvePayPeriodForDate('2024-02-19', periods)).toEqual({ status: 'missing' });

    const overlapping = [...periods, {
      id: 'overlap', companyId: 'company-1', startDate: '2024-02-15', endDate: '2024-02-16', label: 'Overlap'
    }];
    expect(resolvePayPeriodForDate('2024-02-15', overlapping)).toMatchObject({ status: 'overlap' });

    const schedule = buildEmployeeWeekSchedule({
      employee, week, periods: [periods[0]], shifts: [], branches
    });
    expect(schedule.days[4]).toMatchObject({ date: '2024-02-16', state: 'period-missing' });
  });
});

describe('weekly schedule adapter', () => {
  it('uses F3 totals across both pay periods in the same week', () => {
    const schedule = buildEmployeeWeekSchedule({
      employee,
      week,
      periods,
      branches,
      shifts: [
        shift('shift-15', '2024-02-15', 'first-half'),
        shift('shift-16', '2024-02-16', 'second-half', { startTime: '09:00', endTime: '15:00' })
      ]
    });

    expect(schedule.calculation.assignedMinutes).toBe(9 * 60);
    expect(schedule.days[3]).toMatchObject({ state: 'scheduled', periodResolution: { status: 'available', period: { id: 'first-half' } } });
    expect(schedule.days[4]).toMatchObject({ state: 'scheduled', periodResolution: { status: 'available', period: { id: 'second-half' } } });
  });

  it('keeps blank and explicit day-off states distinct in F3 coverage', () => {
    const dayOff = shift('off-12', '2024-02-12', 'first-half', {
      restDay: true, startTime: undefined, endTime: undefined
    });
    const partial = buildEmployeeWeekSchedule({ employee, week, periods, branches, shifts: [dayOff] });
    expect(partial.days[0].state).toBe('day-off');
    expect(partial.days[1].state).toBe('unassigned');
    expect(partial.calculation.coverageStatus).toBe('incomplete');

    const fullyConfirmed = buildEmployeeWeekSchedule({
      employee,
      week,
      periods,
      branches,
      shifts: [
        shift('work-12', '2024-02-12', 'first-half'),
        ...['2024-02-13', '2024-02-14', '2024-02-15', '2024-02-16', '2024-02-17', '2024-02-18'].map((date, index) =>
          shift(`off-${index}`, date, date <= '2024-02-15' ? 'first-half' : 'second-half', {
            restDay: true, startTime: undefined, endTime: undefined
          })
        )
      ]
    });
    expect(fullyConfirmed.calculation.coverageStatus).toBe('confirmed');
  });

  it('blocks duplicated and out-of-period legacy records without rewriting them', () => {
    const duplicated = [
      shift('dup-a', '2024-02-15', 'first-half'),
      shift('dup-b', '2024-02-15', 'first-half', { startTime: '10:00', endTime: '13:00' }),
      shift('wrong-period', '2024-02-16', 'first-half')
    ];
    const schedule = buildEmployeeWeekSchedule({ employee, week, periods, branches, shifts: duplicated });
    expect(schedule.days[3]).toMatchObject({ state: 'duplicate', shiftIds: ['dup-a', 'dup-b'] });
    expect(schedule.days[4]).toMatchObject({ state: 'period-mismatch', shiftIds: ['wrong-period'] });
    expect(schedule.calculation.needsReview).toBe(true);
  });

  it('preserves split intervals and reports legacy-break issues without deductions', () => {
    const split = shift('split', '2024-02-15', 'first-half', {
      endTime: '12:00', secondStart: '14:00', secondEnd: '18:00',
      breakMinutes: 30, overrideBranchId: 'branch-override', notes: 'legacy note'
    });
    const schedule = buildEmployeeWeekSchedule({ employee, week, periods, branches, shifts: [split] });
    expect(schedule.calculation.assignedMinutes).toBe(7 * 60);
    expect(schedule.issues.some((item) => item.code === 'break_not_deducted')).toBe(true);
    expect(schedule.days[3].shift).toEqual(split);
  });
});
