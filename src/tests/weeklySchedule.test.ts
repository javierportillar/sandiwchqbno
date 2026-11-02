import { describe, expect, it } from 'vitest';
import type { Shift } from '../types/payroll';
import { calculateWeeklyScheduledMinutes } from '../lib/weeklySchedule';

const week = { startDate: '2026-01-05', endDateExclusive: '2026-01-12' };

const shift = (overrides: Partial<Shift> = {}): Shift => ({
  id: 'shift-1',
  employeeId: 'employee-1',
  payPeriodId: 'period-1',
  date: '2026-01-05',
  startTime: '09:15',
  endTime: '12:00',
  breakMinutes: 0,
  ...overrides
});

const calculate = (
  shifts: readonly Shift[],
  options: {
    employeeId?: string;
    selectedWeek?: typeof week;
    dayStates?: readonly { date: string; state: 'scheduled' | 'day-off' | 'unassigned' }[];
  } = {}
) => calculateWeeklyScheduledMinutes({
  employeeId: options.employeeId ?? 'employee-1',
  week: options.selectedWeek ?? week,
  shifts,
  ...(options.dayStates === undefined ? {} : { dayStates: options.dayStates })
});

const dateTotals = (result: ReturnType<typeof calculate>) =>
  Object.fromEntries(result.byDate.map(({ date, scheduledMinutes }) => [date, scheduledMinutes]));

describe('calculateWeeklyScheduledMinutes', () => {
  it('counts a 09:15–12:00 shift as 165 gross scheduled minutes', () => {
    const result = calculate([shift()]);

    expect(result.assignedMinutes).toBe(165);
    expect(dateTotals(result)['2026-01-05']).toBe(165);
    expect(result.byDate).toHaveLength(7);
  });

  it('sums two explicit intervals without counting their gap', () => {
    const result = calculate([shift({
      startTime: '11:00', endTime: '14:00', secondStart: '18:00', secondEnd: '22:00'
    })]);

    expect(result.assignedMinutes).toBe(420);
  });

  it('keeps gross minutes and raises review for positive breaks without subtracting them', () => {
    const result = calculate([shift({ startTime: '09:00', endTime: '18:00', breakMinutes: 60 })]);

    expect(result.assignedMinutes).toBe(540);
    expect(result.issues.some((issue) => issue.code === 'break_not_deducted' && issue.shiftIds.includes('shift-1'))).toBe(true);
    expect(result.needsReview).toBe(true);
  });

  it('splits an overnight interval across its civil dates', () => {
    const result = calculate([shift({ startTime: '22:00', endTime: '02:00' })]);

    expect(result.assignedMinutes).toBe(240);
    expect(dateTotals(result)['2026-01-05']).toBe(120);
    expect(dateTotals(result)['2026-01-06']).toBe(120);
  });

  it('anchors an overnight second interval to the original shift date', () => {
    const result = calculate([shift({
      startTime: '09:00', endTime: '10:00', secondStart: '22:00', secondEnd: '02:00'
    })]);

    expect(result.assignedMinutes).toBe(300);
    expect(dateTotals(result)['2026-01-05']).toBe(180);
    expect(dateTotals(result)['2026-01-06']).toBe(120);
  });

  it('clips prior-date and end-of-week overnight shifts to the half-open week', () => {
    const result = calculate([
      shift({ id: 'prior-sunday', date: '2026-01-04', startTime: '22:00', endTime: '02:00' }),
      shift({ id: 'last-sunday', date: '2026-01-11', startTime: '22:00', endTime: '04:00' })
    ]);

    expect(result.assignedMinutes).toBe(240);
    expect(dateTotals(result)['2026-01-05']).toBe(120);
    expect(dateTotals(result)['2026-01-11']).toBe(120);
    expect(result.byDate.some(({ date }) => date === '2026-01-12')).toBe(false);
  });

  it('includes shifts from different pay periods', () => {
    const result = calculate([
      shift({ id: 'period-a', payPeriodId: 'a' }),
      shift({ id: 'period-b', payPeriodId: 'b', date: '2026-01-06', startTime: '13:00', endTime: '14:00' })
    ]);

    expect(result.assignedMinutes).toBe(225);
  });

  it('only aggregates shifts for the requested employee', () => {
    const result = calculate([shift(), shift({ id: 'other', employeeId: 'employee-2', startTime: '13:00', endTime: '15:00' })]);

    expect(result.assignedMinutes).toBe(165);
  });

  it('reports duplicate/conflicting records and unions their overlapping minutes', () => {
    const result = calculate([
      shift({ id: 'first', startTime: '09:00', endTime: '12:00' }),
      shift({ id: 'conflict', startTime: '10:00', endTime: '13:00' })
    ]);

    expect(result.assignedMinutes).toBe(240);
    expect(result.issues.some((issue) => issue.code === 'duplicate_shift_conflict' && issue.shiftIds.includes('first') && issue.shiftIds.includes('conflict'))).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'overlapping_intervals')).toBe(true);
    expect(result.needsReview).toBe(true);
  });

  it('reports exact duplicate records without double-counting them', () => {
    const result = calculate([
      shift({ id: 'duplicate-a', startTime: '09:00', endTime: '10:00' }),
      shift({ id: 'duplicate-b', startTime: '09:00', endTime: '10:00' })
    ]);

    expect(result.assignedMinutes).toBe(60);
    expect(result.issues.some((issue) => issue.code === 'duplicate_shift')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'overlapping_intervals')).toBe(true);
  });

  it('does not report adjacent endpoints as overlap', () => {
    const result = calculate([
      shift({ id: 'morning', startTime: '09:00', endTime: '10:00' }),
      shift({ id: 'next', payPeriodId: 'period-2', startTime: '10:00', endTime: '11:00' })
    ]);

    expect(result.assignedMinutes).toBe(120);
    expect(result.issues.some((issue) => issue.code === 'overlapping_intervals')).toBe(false);
  });

  it.each([
    { label: 'impossible calendar date', value: { date: '2026-02-30' }, code: 'invalid_shift_date', minutes: 0 },
    { label: 'non-padded calendar date', value: { date: '2026-1-05' }, code: 'invalid_shift_date', minutes: 0 },
    { label: 'invalid clock hour', value: { startTime: '24:00' }, code: 'invalid_time', minutes: 0 },
    { label: 'non-padded clock time', value: { startTime: '8:00' }, code: 'invalid_time', minutes: 0 },
    { label: 'invalid clock minute', value: { endTime: '14:60' }, code: 'invalid_time', minutes: 0 },
    { label: 'equal endpoints', value: { startTime: '09:00', endTime: '09:00' }, code: 'ambiguous_zero_length_interval', minutes: 0 },
    { label: 'partial split pair', value: { secondStart: '18:00' }, code: 'partial_interval', minutes: 165 },
    { label: 'partial primary pair', value: { startTime: '09:00', endTime: undefined }, code: 'partial_interval', minutes: 0 }
  ])('excludes invalid interval in $label and reports an issue', ({ value, code, minutes }) => {
    const result = calculate([shift(value)]);

    expect(result.assignedMinutes).toBe(minutes);
    expect(result.issues.some((issue) => issue.code === code && issue.shiftIds.includes('shift-1'))).toBe(true);
  });

  it('flags malformed break values without changing gross scheduled time', () => {
    const result = calculate([shift({ breakMinutes: -1 })]);

    expect(result.assignedMinutes).toBe(165);
    expect(result.issues.some((issue) => issue.code === 'invalid_break_minutes')).toBe(true);
  });

  it('treats a rest day without intervals as explicit non-work', () => {
    const result = calculate([shift({ startTime: undefined, endTime: undefined, restDay: true })]);

    expect(result.assignedMinutes).toBe(0);
    expect(result.issues.some((issue) => issue.code === 'rest_day_with_intervals')).toBe(false);
  });

  it('reports inconsistent rest-day intervals but still counts the interval once', () => {
    const result = calculate([shift({ startTime: '09:00', endTime: '10:00', restDay: true })]);

    expect(result.assignedMinutes).toBe(60);
    expect(result.issues.some((issue) => issue.code === 'rest_day_with_intervals')).toBe(true);
  });

  it('does not infer coverage when day states are omitted', () => {
    expect(calculate([shift()]).coverageStatus).toBe('unknown');
  });

  it('marks partial, missing, unassigned, and inconsistent coverage incomplete', () => {
    const partial = calculate([shift()], { dayStates: [{ date: '2026-01-05', state: 'scheduled' }] });
    expect(partial.coverageStatus).toBe('incomplete');
    expect(partial.issues.some((issue) => issue.code === 'missing_day_state')).toBe(true);

    const allDays = Array.from({ length: 7 }, (_, index) => ({
      date: `2026-01-${String(5 + index).padStart(2, '0')}`,
      state: index === 0 ? 'scheduled' as const : 'day-off' as const
    }));
    expect(calculate([shift()], { dayStates: allDays }).coverageStatus).toBe('confirmed');

    const inconsistent = allDays.map((item, index) => index === 0 ? { ...item, state: 'day-off' as const } : item);
    const inconsistentResult = calculate([shift()], { dayStates: inconsistent });
    expect(inconsistentResult.coverageStatus).toBe('incomplete');
    expect(inconsistentResult.issues.some((issue) => issue.code === 'day_state_inconsistent')).toBe(true);

    const unassigned = allDays.map((item, index) => index === 1 ? { ...item, state: 'unassigned' as const } : item);
    expect(calculate([shift()], { dayStates: unassigned }).coverageStatus).toBe('incomplete');
  });

  it('reports duplicate and invalid day-state dates as incomplete coverage', () => {
    const states = Array.from({ length: 7 }, (_, index) => ({
      date: `2026-01-${String(5 + index).padStart(2, '0')}`,
      state: index === 0 ? 'scheduled' as const : 'day-off' as const
    }));
    const duplicated = [...states, { ...states[0] }];

    const result = calculate([], { dayStates: [...duplicated, { date: '2026-02-30', state: 'day-off' }] });

    expect(result.coverageStatus).toBe('incomplete');
    expect(result.issues.some((issue) => issue.code === 'duplicate_day_state')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'invalid_day_state_date')).toBe(true);
  });

  it('reports invalid day-state values without confirming coverage', () => {
    const states = Array.from({ length: 7 }, (_, index) => ({
      date: `2026-01-${String(5 + index).padStart(2, '0')}`,
      state: (index === 0 ? 'scheduled' : 'day-off') as 'scheduled' | 'day-off' | 'unassigned'
    }));
    const invalidStates = states.map((item, index) => index === 3 ? { ...item, state: 'holiday' as 'scheduled' } : item);

    const result = calculate([], { dayStates: invalidStates });

    expect(result.coverageStatus).toBe('incomplete');
    expect(result.issues.some((issue) => issue.code === 'invalid_day_state' && issue.date === '2026-01-08')).toBe(true);
  });

  it('validates employee and exact seven-civil-day week boundaries', () => {
    expect(() => calculate([], { employeeId: '  ' })).toThrow(RangeError);
    expect(() => calculate([], { selectedWeek: { startDate: '2026-01-05', endDateExclusive: '2026-01-13' } })).toThrow(RangeError);
    expect(() => calculate([], { selectedWeek: { startDate: '2026-02-30', endDateExclusive: '2026-03-09' } })).toThrow(RangeError);
  });

  it('does not mutate shift or day-state inputs', () => {
    const inputShift = Object.freeze(shift({ secondStart: '18:00', secondEnd: '22:00', breakMinutes: 10 }));
    const states = Object.freeze(Array.from({ length: 7 }, (_, index) => Object.freeze({
      date: `2026-01-${String(5 + index).padStart(2, '0')}`,
      state: index === 0 ? 'scheduled' as const : 'day-off' as const
    })));
    const before = JSON.stringify({ inputShift, states });

    calculate([inputShift], { dayStates: states });

    expect(JSON.stringify({ inputShift, states })).toBe(before);
  });
});
