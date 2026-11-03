import type { Branch, Employee, ScheduledShiftKind, Shift, ShiftTemplate } from '../types/payroll';
import type { EmployeeWeekSchedule } from './scheduleWeek';
import { resolveTemplateForDate } from './templates';
import { buildScheduleCellKey } from './scheduleWeek';

export interface WeeklyLoadAssignment {
  date: string;
  payPeriodId: string;
  branchId: string;
  template: ShiftTemplate;
  replaces?: Shift;
}

export type WeeklyLoadMode = 'fill-unassigned' | 'replace-scheduled';

export type WeeklyLoadSkipReason =
  | 'existing-assignment'
  | 'pending-branch'
  | 'period-missing'
  | 'period-overlap'
  | 'period-mismatch'
  | 'duplicate'
  | 'review'
  | 'day-off-preserved'
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
  mode: WeeklyLoadMode;
  assignments: WeeklyLoadAssignment[];
  skipped: WeeklyLoadSkip[];
}

export function buildWeeklyLoadPlan(input: {
  schedule: EmployeeWeekSchedule;
  branches: readonly Branch[];
  kind: ScheduledShiftKind;
  branchId: string;
  mode?: WeeklyLoadMode;
  pendingBranches?: Readonly<Record<string, string>>;
}): WeeklyLoadPlan {
  const { schedule, branches, kind, branchId, mode = 'fill-unassigned', pendingBranches = {} } = input;
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
    if (day.state === 'day-off') {
      pushSkip('day-off-preserved');
      continue;
    }
    const replacement = mode === 'replace-scheduled' && day.state === 'scheduled' &&
      day.shiftIds.length === 1 && day.shift?.id === day.shiftIds[0]
      ? day.shift
      : undefined;
    if (!replacement && (day.shiftIds.length > 0 || day.state === 'scheduled')) {
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
    assignments.push({
      date: day.date,
      payPeriodId: period.id,
      branchId,
      template,
      ...(replacement ? { replaces: replacement } : {})
    });
  }

  return {
    employeeId: employee.id,
    weekStartDate: schedule.week.startDate,
    kind,
    branchId,
    mode,
    assignments,
    skipped
  };
}

/** Compare a user-reviewed plan with a freshly generated one before applying it. */
export function weeklyLoadPlansMatch(reviewed: WeeklyLoadPlan, current: WeeklyLoadPlan): boolean {
  return JSON.stringify(reviewed) === JSON.stringify(current);
}
