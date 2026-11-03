import { describe, expect, it } from 'vitest';
import {
  classifyPayPeriod,
  getCalendarMonth,
  getHalfMonthRange,
  getPeriodRangeIssues
} from '../lib/periodCalendar';
import { getMondayWeekStart } from '../lib/scheduleWeek';
import type { PayPeriod } from '../types/payroll';

const period = (startDate: string, endDate: string, id = 'existing'): PayPeriod => ({
  id,
  companyId: 'company-qbano',
  startDate,
  endDate,
  label: `${startDate} — ${endDate}`
});

describe('payroll period calendar helpers', () => {
  it('classifies only exact first and second quincenas from civil-date boundaries', () => {
    expect(classifyPayPeriod(period('2024-02-01', '2024-02-15'))).toEqual({
      kind: 'period-1', label: 'Período 1', color: 'green'
    });
    expect(classifyPayPeriod(period('2024-02-16', '2024-02-29'))).toEqual({
      kind: 'period-2', label: 'Período 2', color: 'gold'
    });
    expect(classifyPayPeriod(period('2023-02-16', '2023-02-28'))).toEqual({
      kind: 'period-2', label: 'Período 2', color: 'gold'
    });
  });

  it('keeps cross-month, non-quincena, and invalid ranges in the neutral custom category', () => {
    for (const range of [
      period('2024-01-29', '2024-02-03'),
      period('2024-02-02', '2024-02-15'),
      period('2024-02-16', '2024-02-28'),
      period('2024-02-30', '2024-03-02'),
      period('2024-03-02', '2024-03-01')
    ]) {
      expect(classifyPayPeriod(range)).toEqual({
        kind: 'custom', label: 'Rango personalizado', color: 'slate'
      });
    }
  });

  it('builds complete Monday-to-Sunday rows, including visible dates from adjacent months', () => {
    const calendar = getCalendarMonth('2026-11');

    expect(calendar.startDate).toBe('2026-10-26');
    expect(calendar.endDate).toBe('2026-12-06');
    expect(calendar.days).toHaveLength(42);
    expect(calendar.days.slice(0, 7).map(({ date }) => date)).toEqual([
      '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'
    ]);
    expect(calendar.days.filter(({ inCurrentMonth }) => inCurrentMonth)).toHaveLength(30);
    for (let index = 0; index < calendar.days.length; index += 7) {
      expect(getMondayWeekStart(calendar.days[index].date)).toBe(calendar.days[index].date);
    }
  });

  it('handles leap February and the exact inclusive half-month boundaries', () => {
    const calendar = getCalendarMonth('2024-02');
    expect(calendar.days.filter(({ inCurrentMonth }) => inCurrentMonth)).toHaveLength(29);
    expect(calendar.days.find(({ date }) => date === '2024-02-29')?.inCurrentMonth).toBe(true);
    expect(getHalfMonthRange('2024-02', '1')).toEqual({ startDate: '2024-02-01', endDate: '2024-02-15' });
    expect(getHalfMonthRange('2024-02', '2')).toEqual({ startDate: '2024-02-16', endDate: '2024-02-29' });
  });

  it('uses the inclusive integrity rules for custom ranges and permits adjacent quincenas', () => {
    const januaryFirstHalf = period('2026-01-01', '2026-01-15');

    expect(getPeriodRangeIssues('2026-01-16', '2026-01-31', [januaryFirstHalf])).toEqual([]);
    expect(getPeriodRangeIssues('2026-01-15', '2026-01-20', [januaryFirstHalf]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'overlapping-periods' })]));
  });

  it('validates inclusive ranges across month boundaries without treating adjacent periods as overlaps', () => {
    const spanningPeriod = period('2024-01-29', '2024-03-03', 'spanning');

    expect(getPeriodRangeIssues('2024-03-04', '2024-03-10', [spanningPeriod])).toEqual([]);
    expect(getPeriodRangeIssues('2024-03-03', '2024-03-10', [spanningPeriod]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'overlapping-periods' })]));
  });
});
