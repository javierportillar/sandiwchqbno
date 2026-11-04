import { buildWeeklyPayrollWarnings } from '../lib/weeklyPayrollWarnings';
import { addDaysToDate } from '../lib/scheduleWeek';

function schedule(assignedMinutes: number, minutesByDay: number[], weekStart = '2026-11-02') {
  return {
    employee: { id: 'employee-1', fullName: 'Cecilia' },
    calculation: {
      assignedMinutes,
      week: { startDate: weekStart, endDateExclusive: addDaysToDate(weekStart, 7) },
      byDate: minutesByDay.map((scheduledMinutes, index) => ({
        date: addDaysToDate(weekStart, index),
        scheduledMinutes
      }))
    }
  };
}

describe('avisos semanales de referencia legal', () => {
  it('warns non-blockingly for work across all seven days and more than 42 scheduled hours', () => {
    const warnings = buildWeeklyPayrollWarnings([schedule(7 * 7 * 60, Array(7).fill(7 * 60))]);

    expect(warnings.map(({ code }) => code)).toEqual([
      'seven-consecutive-calendar-days',
      'weekly-hours-reference-exceeded'
    ]);
    expect(warnings[0]).toMatchObject({ employeeName: 'Cecilia', scheduledHours: 49, scheduledDays: 7 });
    expect(warnings[1].weeklyLimitHours).toBe(42);
  });

  it('does not warn at exactly 42 hours or when a date has no scheduled work', () => {
    const warnings = buildWeeklyPayrollWarnings([schedule(42 * 60, [7 * 60, 7 * 60, 7 * 60, 7 * 60, 7 * 60, 7 * 60, 0])]);

    expect(warnings.map(({ code }) => code)).toEqual([]);
  });

  it('uses the weekly limit effective at the end of a historical schedule week', () => {
    const historical = schedule(47 * 60, [8 * 60, 8 * 60, 8 * 60, 8 * 60, 8 * 60, 7 * 60, 0], '2025-07-07');

    expect(buildWeeklyPayrollWarnings([historical])).toMatchObject([
      { code: 'weekly-hours-reference-exceeded', weeklyLimitHours: 46 }
    ]);
  });
});
