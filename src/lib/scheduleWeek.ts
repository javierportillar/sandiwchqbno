import type { Branch, Employee, PayPeriod, Shift } from '../types/payroll';
import { endsBeyondPeriodEnd, isEmptyShift, needsShiftReview } from './shiftSafety';
import {
  calculateWeeklyScheduledMinutes,
  type WeeklyDayState
} from './weeklySchedule';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ScheduleWeek {
  startDate: string;
  endDateExclusive: string;
}

export type PayPeriodResolution =
  | { status: 'available'; period: PayPeriod }
  | { status: 'missing' }
  | { status: 'overlap'; periods: PayPeriod[] };

export type WeekDayAssignmentState =
  | 'scheduled'
  | 'day-off'
  | 'unassigned'
  | 'review'
  | 'duplicate'
  | 'period-mismatch'
  | 'period-missing'
  | 'period-overlap';

export interface ScheduleWeekIssue {
  code: string;
  message: string;
  date?: string;
  shiftIds?: string[];
}

export interface EmployeeWeekDay {
  date: string;
  periodResolution: PayPeriodResolution;
  state: WeekDayAssignmentState;
  shift?: Shift;
  shiftIds: string[];
  branchId?: string;
  message?: string;
}

export interface EmployeeWeekSchedule {
  employee: Employee;
  week: ScheduleWeek;
  days: EmployeeWeekDay[];
  calculation: ReturnType<typeof calculateWeeklyScheduledMinutes>;
  issues: ScheduleWeekIssue[];
}

interface CivilDate {
  ordinal: number;
  value: string;
}

function parseCivilDate(value: unknown): CivilDate | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;

  return { ordinal: Math.floor(date.getTime() / MILLISECONDS_PER_DAY), value };
}

function dateFromOrdinal(ordinal: number): string {
  const date = new Date(ordinal * MILLISECONDS_PER_DAY);
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function isCivilDate(value: unknown): value is string {
  return parseCivilDate(value) !== null;
}

export function addDaysToDate(date: string, days: number): string {
  const parsed = parseCivilDate(date);
  if (!parsed || !Number.isInteger(days)) throw new RangeError('date and days must be a valid civil date and an integer.');
  return dateFromOrdinal(parsed.ordinal + days);
}

export function addWeeksToDate(weekStart: string, weeks: number): string {
  if (!Number.isInteger(weeks)) throw new RangeError('weeks must be an integer.');
  return addDaysToDate(weekStart, weeks * 7);
}

export function getMondayWeekStart(date: string): string {
  const parsed = parseCivilDate(date);
  if (!parsed) throw new RangeError('date must be a valid YYYY-MM-DD civil date.');
  const weekday = new Date(parsed.ordinal * MILLISECONDS_PER_DAY).getUTCDay();
  return dateFromOrdinal(parsed.ordinal - ((weekday + 6) % 7));
}

export function getScheduleWeekDates(week: ScheduleWeek): string[] {
  const start = parseCivilDate(week.startDate);
  const end = parseCivilDate(week.endDateExclusive);
  if (!start || !end || end.ordinal - start.ordinal !== 7) {
    throw new RangeError('week must be a valid half-open range of exactly seven civil dates.');
  }
  return Array.from({ length: 7 }, (_, index) => dateFromOrdinal(start.ordinal + index));
}

export function getLocalTodayISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getInitialScheduleWeekStart(
  periods: readonly PayPeriod[],
  shifts: readonly Shift[],
  referenceDate = getLocalTodayISO()
): string {
  const shiftDates = shifts
    .map((shift) => shift.date)
    .filter(isCivilDate)
    .filter((date) => {
      const resolution = resolvePayPeriodForDate(date, periods);
      return resolution.status === 'available' && shifts.some((shift) =>
        shift.date === date && resolution.period.id === shift.payPeriodId
      );
    });
  const fallbackShiftDates = shifts.map((shift) => shift.date).filter(isCivilDate);
  const availableShiftDates = shiftDates.length ? shiftDates : fallbackShiftDates;

  if (availableShiftDates.length) {
    const pastOrCurrent = availableShiftDates.filter((date) => date <= referenceDate);
    const candidates = [...(pastOrCurrent.length ? pastOrCurrent : availableShiftDates)].sort();
    const anchor = candidates[candidates.length - 1];
    return getMondayWeekStart(anchor);
  }

  const periodEnds = periods.map((period) => period.endDate).filter(isCivilDate).sort();
  if (periodEnds.length) {
    const pastOrCurrent = periodEnds.filter((date) => date <= referenceDate);
    return getMondayWeekStart(pastOrCurrent.length ? pastOrCurrent[pastOrCurrent.length - 1] : periodEnds[periodEnds.length - 1]);
  }

  return getMondayWeekStart(referenceDate);
}

export function resolvePayPeriodForDate(date: string, periods: readonly PayPeriod[]): PayPeriodResolution {
  if (!isCivilDate(date)) return { status: 'missing' };
  const matches = periods.filter((period) =>
    isCivilDate(period.startDate) && isCivilDate(period.endDate) &&
    period.startDate <= date && date <= period.endDate
  );
  if (matches.length === 0) return { status: 'missing' };
  if (matches.length > 1) return { status: 'overlap', periods: matches };
  return { status: 'available', period: matches[0] };
}

export function buildScheduleCellKey(employeeId: string, periodId: string, date: string): string {
  return JSON.stringify([periodId, employeeId, date]);
}

function hasIntervals(shift: Shift): boolean {
  return Boolean(shift.startTime || shift.endTime || shift.secondStart || shift.secondEnd);
}

function issue(
  code: string,
  message: string,
  date?: string,
  shiftIds?: string[]
): ScheduleWeekIssue {
  return { code, message, ...(date ? { date } : {}), ...(shiftIds?.length ? { shiftIds } : {}) };
}

function resolveDayAssignment(
  employee: Employee,
  date: string,
  periodResolution: PayPeriodResolution,
  employeeShifts: readonly Shift[],
  branches: readonly Branch[]
): { day: EmployeeWeekDay; coverageState: WeeklyDayState; issues: ScheduleWeekIssue[] } {
  const dateShifts = employeeShifts.filter((shift) => shift.date === date);
  const ids = dateShifts.map((shift) => shift.id);

  if (periodResolution.status === 'missing') {
    const storedAssignments = dateShifts.map((shift) => `${shift.id} (payPeriodId ${shift.payPeriodId})`).join(', ');
    const messages = dateShifts.length
      ? issue('period_missing', `Los turnos ${storedAssignments} del ${date} no tienen un período de pago para esta fecha; se conservan y no se puede asignar.`, date, ids)
      : issue('period_missing', 'No existe un período de pago para esta fecha; no se puede asignar.', date);
    return {
      day: { date, periodResolution, state: 'period-missing', shiftIds: ids, message: messages.message },
      coverageState: 'unassigned',
      issues: [messages]
    };
  }

  if (periodResolution.status === 'overlap') {
    const storedAssignments = dateShifts.map((shift) => `${shift.id} (payPeriodId ${shift.payPeriodId})`).join(', ');
    const affectedShifts = storedAssignments ? ` Los turnos ${storedAssignments} se conservan sin cambios.` : '';
    const messages = issue('period_overlap', `Hay períodos de pago superpuestos para ${date}; no se eligió ninguno y no se puede asignar.${affectedShifts}`, date, ids);
    return {
      day: { date, periodResolution, state: 'period-overlap', shiftIds: ids, message: messages.message },
      coverageState: 'unassigned',
      issues: [messages]
    };
  }

  const { period } = periodResolution;
  const mismatched = dateShifts.filter((shift) => shift.payPeriodId !== period.id);
  if (mismatched.length) {
    const storedAssignments = mismatched.map((shift) => `${shift.id} (payPeriodId ${shift.payPeriodId})`).join(', ');
    const messages = issue('period_mismatch', `El turno ${storedAssignments} del ${date} está asociado por fecha al período ${period.id}; no se modificó y esta fecha no es asignable.`, date, ids);
    return {
      day: { date, periodResolution, state: 'period-mismatch', shiftIds: ids, message: messages.message },
      coverageState: 'unassigned',
      issues: [messages]
    };
  }

  if (dateShifts.length > 1) {
    const messages = issue('duplicate_shift', 'Hay turnos duplicados para este empleado, fecha y período. Conserva una copia local y contacta a soporte; no se modificaron.', date, ids);
    return {
      day: { date, periodResolution, state: 'duplicate', shiftIds: ids, message: messages.message },
      coverageState: 'unassigned',
      issues: [messages]
    };
  }

  const shift = dateShifts[0];
  if (!shift || isEmptyShift(shift)) {
    return {
      day: { date, periodResolution, state: 'unassigned', ...(shift ? { shift } : {}), shiftIds: ids },
      coverageState: 'unassigned',
      issues: []
    };
  }

  const branchId = shift.overrideBranchId ?? employee.branchId;
  const branch = branches.find((candidate) => candidate.id === branchId);
  const template = branch?.shiftTemplates.find((candidate) => candidate.id === shift.templateId);
  const requiresReview = !branch || Boolean(shift.templateId && !template && shift.templateId !== 'partido') ||
    needsShiftReview(shift, template?.kind) || endsBeyondPeriodEnd(shift, period.endDate);

  if (requiresReview) {
    const message = endsBeyondPeriodEnd(shift, period.endDate)
      ? `El intervalo termina después del cierre del período (${period.endDate}); cálculo y exportación permanecen bloqueados hasta revisión.`
      : 'Este turno requiere revisión explícita antes de reemplazarlo o confirmar cobertura.';
    return {
      day: { date, periodResolution, state: 'review', shift, shiftIds: ids, branchId, message },
      coverageState: 'unassigned',
      issues: [issue('shift_review', message, date, ids)]
    };
  }

  if (shift.restDay) {
    return {
      day: { date, periodResolution, state: 'day-off', shift, shiftIds: ids, branchId },
      coverageState: 'day-off',
      issues: []
    };
  }

  if (hasIntervals(shift)) {
    return {
      day: { date, periodResolution, state: 'scheduled', shift, shiftIds: ids, branchId },
      coverageState: 'scheduled',
      issues: []
    };
  }

  return {
    day: { date, periodResolution, state: 'unassigned', shift, shiftIds: ids, branchId },
    coverageState: 'unassigned',
    issues: []
  };
}

export function buildEmployeeWeekSchedule(input: {
  employee: Employee;
  week: ScheduleWeek;
  periods: readonly PayPeriod[];
  shifts: readonly Shift[];
  branches: readonly Branch[];
}): EmployeeWeekSchedule {
  const dates = getScheduleWeekDates(input.week);
  const employeeShifts = input.shifts.filter((shift) => shift.employeeId === input.employee.id);
  const dayResults = dates.map((date) => resolveDayAssignment(
    input.employee,
    date,
    resolvePayPeriodForDate(date, input.periods),
    employeeShifts,
    input.branches
  ));
  const dayStates = dates.map((date, index) => ({ date, state: dayResults[index].coverageState }));
  const calculation = calculateWeeklyScheduledMinutes({
    employeeId: input.employee.id,
    week: input.week,
    shifts: employeeShifts,
    dayStates
  });

  return {
    employee: input.employee,
    week: input.week,
    days: dayResults.map(({ day }) => day),
    calculation,
    issues: [...calculation.issues, ...dayResults.flatMap(({ issues }) => issues)]
  };
}
