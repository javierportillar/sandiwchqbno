import type { Employee } from '../types/payroll';
import type { WeeklyScheduleResult } from './weeklySchedule';
import { addDaysToDate } from './scheduleWeek';
import { getColombianOrdinaryWeeklyHoursLimit } from './colombianCalendar';

export type WeeklyPayrollWarningCode = 'seven-consecutive-calendar-days' | 'weekly-hours-reference-exceeded';

export interface WeeklyPayrollWarning {
  code: WeeklyPayrollWarningCode;
  employeeId: string;
  employeeName: string;
  scheduledHours: number;
  scheduledDays: number;
  weeklyLimitHours?: number;
}

export function buildWeeklyPayrollWarnings(
  schedules: readonly {
    employee: Pick<Employee, 'id' | 'fullName'>;
    calculation: Pick<WeeklyScheduleResult, 'assignedMinutes' | 'byDate' | 'week'>;
  }[]
): WeeklyPayrollWarning[] {
  const warnings: WeeklyPayrollWarning[] = [];

  for (const { employee, calculation } of schedules) {
    const scheduledDays = calculation.byDate.filter(({ scheduledMinutes }) => scheduledMinutes > 0).length;
    const scheduledHours = calculation.assignedMinutes / 60;
    const weekEndDate = addDaysToDate(calculation.week.endDateExclusive, -1);
    const weeklyLimitHours = getColombianOrdinaryWeeklyHoursLimit(weekEndDate);

    if (scheduledDays === 7) {
      warnings.push({
        code: 'seven-consecutive-calendar-days',
        employeeId: employee.id,
        employeeName: employee.fullName,
        scheduledHours,
        scheduledDays
      });
    }

    if (weeklyLimitHours !== null && calculation.assignedMinutes > weeklyLimitHours * 60) {
      warnings.push({
        code: 'weekly-hours-reference-exceeded',
        employeeId: employee.id,
        employeeName: employee.fullName,
        scheduledHours,
        scheduledDays,
        weeklyLimitHours
      });
    }
  }

  return warnings;
}
