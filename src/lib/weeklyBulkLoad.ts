import type { Branch, Employee, ScheduledShiftKind, ShiftTemplate } from '../types/payroll';
import type { EmployeeWeekSchedule } from './scheduleWeek';
import { resolveTemplateForDate } from './templates';
import { buildScheduleCellKey } from './scheduleWeek';

export interface WeeklyLoadAssignment {
  date: string;
  payPeriodId: string;
  branchId: string;
  template: ShiftTemplate;
}

export type WeeklyLoadSkipReason =
  | 'existing-assignment'
  | 'pending-branch'
  | 'period-missing'
  | 'period-overlap'
  | 'period-mismatch'
  | 'duplicate'
  | 'review'
  | 'branch-unavailable'
  | 'template-unavailable';

export interface WeeklyLoadSkip {
  date: string;
  reason: WeeklyLoadSkipReason;
}

export interface WeeklyLoadPlan {
  employeeId: string;
  weekStartDate: string;
  kind: ScheduledShiftKind;
  branchId: string;
  assignments: WeeklyLoadAssignment[];
  skipped: WeeklyLoadSkip[];
}

export function buildWeeklyLoadPlan(input: {
  schedule: EmployeeWeekSchedule;
  branches: readonly Branch[];
  kind: ScheduledShiftKind;
  branchId: string;
  pendingBranches?: Readonly<Record<string, string>>;
}): WeeklyLoadPlan {
  const { schedule, branches, kind, branchId, pendingBranches = {} } = input;
  const employee: Employee = schedule.employee;
  const branch = branches.find((candidate) => candidate.id === branchId);
  const assignments: WeeklyLoadAssignment[] = [];
  const skipped: WeeklyLoadSkip[] = [];

  for (const day of schedule.days) {
    const pushSkip = (reason: WeeklyLoadSkipReason) => skipped.push({ date: day.date, reason });
    const period = day.periodResolution.status === 'available' ? day.periodResolution.period : undefined;

    if (day.periodResolution.status === 'missing') {
      pushSkip('period-missing');
      continue;
    }
    if (day.periodResolution.status === 'overlap') {
      pushSkip('period-overlap');
      continue;
    }
    if (day.state === 'period-mismatch') {
      pushSkip('period-mismatch');
      continue;
    }
    if (day.state === 'duplicate') {
      pushSkip('duplicate');
      continue;
    }
    if (day.state === 'review') {
      pushSkip('review');
      continue;
    }
    if (day.shiftIds.length > 0 || day.state === 'scheduled' || day.state === 'day-off') {
      pushSkip('existing-assignment');
      continue;
    }
    if (!period) {
      pushSkip('period-missing');
      continue;
    }
    const cellKey = buildScheduleCellKey(employee.id, period.id, day.date);
    if (pendingBranches[cellKey]) {
      pushSkip('pending-branch');
      continue;
    }
    if (!branch) {
      pushSkip('branch-unavailable');
      continue;
    }

    const template = resolveTemplateForDate(branch, day.date, { role: employee.role, kind });
    if (!template) {
      pushSkip('template-unavailable');
      continue;
    }
    assignments.push({ date: day.date, payPeriodId: period.id, branchId, template });
  }

  return {
    employeeId: employee.id,
    weekStartDate: schedule.week.startDate,
    kind,
    branchId,
    assignments,
    skipped
  };
}
