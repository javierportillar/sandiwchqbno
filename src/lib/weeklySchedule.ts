import type { Shift } from '../types/payroll';

const MINUTES_PER_DAY = 24 * 60;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface WeeklyScheduleWeek {
  startDate: string;
  endDateExclusive: string;
}

export type WeeklyDayState = 'scheduled' | 'day-off' | 'unassigned';

export interface WeeklyScheduleInput {
  employeeId: string;
  week: WeeklyScheduleWeek;
  shifts: readonly Shift[];
  dayStates?: readonly { date: string; state: WeeklyDayState }[];
}

export type WeeklyScheduleIssueCode =
  | 'invalid_shift_date'
  | 'invalid_time'
  | 'partial_interval'
  | 'ambiguous_zero_length_interval'
  | 'invalid_break_minutes'
  | 'break_not_deducted'
  | 'rest_day_with_intervals'
  | 'duplicate_shift'
  | 'duplicate_shift_conflict'
  | 'overlapping_intervals'
  | 'invalid_day_state_date'
  | 'day_state_outside_week'
  | 'invalid_day_state'
  | 'duplicate_day_state'
  | 'missing_day_state'
  | 'unassigned_day_state'
  | 'day_state_inconsistent'
  | 'invalid_day_states';

export interface WeeklyScheduleIssue {
  code: WeeklyScheduleIssueCode;
  message: string;
  date?: string;
  shiftIds: string[];
}

export interface WeeklyScheduleDateTotal {
  date: string;
  scheduledMinutes: number;
}

export interface WeeklyScheduleResult {
  employeeId: string;
  week: WeeklyScheduleWeek;
  assignedMinutes: number;
  byDate: WeeklyScheduleDateTotal[];
  issues: WeeklyScheduleIssue[];
  needsReview: boolean;
  coverageStatus: 'unknown' | 'incomplete' | 'confirmed';
}

interface CivilDate {
  ordinal: number;
  date: string;
}

interface Interval {
  start: number;
  end: number;
  shiftId: string;
  intervalName: 'primary' | 'second';
}

interface ParsedShift {
  shift: Shift;
  date: string;
}

interface DayStateEntry {
  state: unknown;
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
  ) {
    return null;
  }

  return { ordinal: Math.floor(date.getTime() / MILLISECONDS_PER_DAY), date: value };
}

function dateFromOrdinal(ordinal: number): string {
  const date = new Date(ordinal * MILLISECONDS_PER_DAY);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getShiftId(shift: Shift): string {
  return typeof shift.id === 'string' && shift.id.length > 0 ? shift.id : '(unknown shift)';
}

function addIssue(
  issues: WeeklyScheduleIssue[],
  code: WeeklyScheduleIssueCode,
  message: string,
  date: string | undefined,
  shiftIds: readonly string[] = []
): void {
  issues.push({ code, message, ...(date === undefined ? {} : { date }), shiftIds: [...shiftIds] });
}

function normalizeInterval(
  shiftDate: string,
  shiftOrdinal: number,
  shiftId: string,
  intervalName: Interval['intervalName'],
  startValue: unknown,
  endValue: unknown,
  issues: WeeklyScheduleIssue[]
): Interval | null {
  const hasStart = startValue !== undefined;
  const hasEnd = endValue !== undefined;

  if (!hasStart && !hasEnd) return null;
  if (hasStart !== hasEnd) {
    addIssue(issues, 'partial_interval', `The ${intervalName} interval requires both start and end times.`, shiftDate, [shiftId]);
    return null;
  }

  const start = parseTime(startValue);
  const end = parseTime(endValue);
  if (start === null || end === null) {
    addIssue(issues, 'invalid_time', `The ${intervalName} interval must use strict 24-hour HH:mm times.`, shiftDate, [shiftId]);
    return null;
  }
  if (start === end) {
    addIssue(issues, 'ambiguous_zero_length_interval', `The ${intervalName} interval has equal endpoints and is ambiguous.`, shiftDate, [shiftId]);
    return null;
  }

  const absoluteStart = shiftOrdinal * MINUTES_PER_DAY + start;
  const absoluteEnd = shiftOrdinal * MINUTES_PER_DAY + end + (end < start ? MINUTES_PER_DAY : 0);
  return { start: absoluteStart, end: absoluteEnd, shiftId, intervalName };
}

function scheduleSignature(shift: Shift): string {
  return JSON.stringify({
    startTime: shift.startTime ?? null,
    endTime: shift.endTime ?? null,
    secondStart: shift.secondStart ?? null,
    secondEnd: shift.secondEnd ?? null,
    breakMinutes: shift.breakMinutes ?? null,
    restDay: shift.restDay ?? false
  });
}

function compareIssues(left: WeeklyScheduleIssue, right: WeeklyScheduleIssue): number {
  return (left.date ?? '').localeCompare(right.date ?? '') ||
    left.code.localeCompare(right.code) ||
    left.shiftIds.join('\u0000').localeCompare(right.shiftIds.join('\u0000'));
}

function calculateCoverage(
  dayStates: WeeklyScheduleInput['dayStates'],
  dates: readonly string[],
  totalsByDate: ReadonlyMap<string, number>,
  issues: WeeklyScheduleIssue[]
): WeeklyScheduleResult['coverageStatus'] {
  if (dayStates === undefined) return 'unknown';

  let incomplete = false;
  const entriesByDate = new Map<string, DayStateEntry[]>();

  if (!Array.isArray(dayStates)) {
    addIssue(issues, 'invalid_day_states', 'Day-state coverage must be an array when provided.', undefined);
    return 'incomplete';
  }

  const expectedDates = new Set(dates);
  for (const entry of dayStates as readonly { date: unknown; state: unknown }[]) {
    const parsedDate = parseCivilDate(entry?.date);
    if (!parsedDate) {
      addIssue(issues, 'invalid_day_state_date', 'A day-state date is not a valid YYYY-MM-DD civil date.', typeof entry?.date === 'string' ? entry.date : undefined);
      incomplete = true;
      continue;
    }

    if (!expectedDates.has(parsedDate.date)) {
      addIssue(issues, 'day_state_outside_week', 'A day-state date falls outside the requested week.', parsedDate.date);
      incomplete = true;
      continue;
    }

    if (!['scheduled', 'day-off', 'unassigned'].includes(String(entry.state))) {
      addIssue(issues, 'invalid_day_state', 'A day state must be scheduled, day-off, or unassigned.', parsedDate.date);
      incomplete = true;
    }

    const existing = entriesByDate.get(parsedDate.date) ?? [];
    existing.push({ state: entry.state });
    entriesByDate.set(parsedDate.date, existing);
  }

  for (const date of dates) {
    const entries = entriesByDate.get(date) ?? [];
    if (entries.length === 0) {
      addIssue(issues, 'missing_day_state', 'No day state was supplied for this date.', date);
      incomplete = true;
      continue;
    }
    if (entries.length > 1) {
      addIssue(issues, 'duplicate_day_state', 'More than one day state was supplied for this date.', date);
      incomplete = true;
    }

    for (const entry of entries) {
      if (entry.state === 'unassigned') {
        addIssue(issues, 'unassigned_day_state', 'An unassigned date does not confirm schedule coverage.', date);
        incomplete = true;
      } else if (entry.state === 'scheduled' || entry.state === 'day-off') {
        const hasMinutes = (totalsByDate.get(date) ?? 0) > 0;
        if ((entry.state === 'scheduled') !== hasMinutes) {
          addIssue(issues, 'day_state_inconsistent', 'The day state conflicts with the presence of scheduled work intervals.', date);
          incomplete = true;
        }
      }
    }
  }

  return incomplete ? 'incomplete' : 'confirmed';
}

/**
 * Sum gross, scheduled minutes for one employee across a seven-civil-day,
 * half-open week. This is deliberately independent of payroll classification
 * and never deducts breaks.
 */
export function calculateWeeklyScheduledMinutes(input: WeeklyScheduleInput): WeeklyScheduleResult {
  if (typeof input.employeeId !== 'string' || input.employeeId.trim().length === 0) {
    throw new RangeError('employeeId must be a non-empty string.');
  }

  const weekStart = parseCivilDate(input.week?.startDate);
  const weekEnd = parseCivilDate(input.week?.endDateExclusive);
  if (!weekStart || !weekEnd || weekEnd.ordinal - weekStart.ordinal !== 7) {
    throw new RangeError('week must be a valid half-open range of exactly seven civil dates.');
  }

  const dates = Array.from({ length: 7 }, (_, index) => dateFromOrdinal(weekStart.ordinal + index));
  const weekStartMinute = weekStart.ordinal * MINUTES_PER_DAY;
  const weekEndMinute = weekEnd.ordinal * MINUTES_PER_DAY;
  const issues: WeeklyScheduleIssue[] = [];
  const parsedShifts: ParsedShift[] = [];
  const intervals: Interval[] = [];

  for (const shift of input.shifts) {
    if (shift.employeeId !== input.employeeId) continue;

    const shiftId = getShiftId(shift);
    const parsedDate = parseCivilDate(shift.date);
    if (!parsedDate) {
      addIssue(issues, 'invalid_shift_date', 'The shift date must be a valid YYYY-MM-DD civil date.', shift.date, [shiftId]);
      continue;
    }

    // A valid time interval is shorter than 24 hours, so only the preceding
    // civil date can contribute an overnight interval to this week.
    if (parsedDate.ordinal < weekStart.ordinal - 1 || parsedDate.ordinal >= weekEnd.ordinal) continue;

    const shiftIssues: WeeklyScheduleIssue[] = [];
    const intervalList = [
      normalizeInterval(parsedDate.date, parsedDate.ordinal, shiftId, 'primary', shift.startTime, shift.endTime, shiftIssues),
      normalizeInterval(parsedDate.date, parsedDate.ordinal, shiftId, 'second', shift.secondStart, shift.secondEnd, shiftIssues)
    ].filter((interval): interval is Interval => interval !== null);

    if (typeof shift.breakMinutes !== 'number' || !Number.isFinite(shift.breakMinutes) || !Number.isInteger(shift.breakMinutes) || shift.breakMinutes < 0) {
      addIssue(shiftIssues, 'invalid_break_minutes', 'breakMinutes must be a finite, non-negative integer; it is not deducted.', parsedDate.date, [shiftId]);
    } else if (shift.breakMinutes > 0) {
      addIssue(shiftIssues, 'break_not_deducted', 'A positive legacy break is recorded for review and is not deducted from scheduled minutes.', parsedDate.date, [shiftId]);
    }

    const hasWeekOverlap = intervalList.some((interval) => interval.start < weekEndMinute && interval.end > weekStartMinute);
    const hasInvalidInterval = shiftIssues.some((issue) =>
      issue.code === 'partial_interval' || issue.code === 'invalid_time' || issue.code === 'ambiguous_zero_length_interval'
    );
    if (parsedDate.ordinal < weekStart.ordinal && !hasWeekOverlap && !hasInvalidInterval) continue;

    issues.push(...shiftIssues);
    if (shift.restDay === true && intervalList.length > 0) {
      addIssue(issues, 'rest_day_with_intervals', 'The shift is marked as a rest day but contains a valid work interval.', parsedDate.date, [shiftId]);
    }

    parsedShifts.push({ shift, date: parsedDate.date });
    intervals.push(...intervalList);
  }

  const duplicateGroups = new Map<string, ParsedShift[]>();
  for (const parsedShift of parsedShifts) {
    const key = JSON.stringify([parsedShift.shift.employeeId, parsedShift.date, parsedShift.shift.payPeriodId]);
    const group = duplicateGroups.get(key) ?? [];
    group.push(parsedShift);
    duplicateGroups.set(key, group);
  }

  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue;
    const shiftIds = group.map(({ shift }) => getShiftId(shift)).sort();
    const date = group[0].date;
    addIssue(issues, 'duplicate_shift', 'Multiple shift records exist for the same employee, civil date, and pay period.', date, shiftIds);
    if (new Set(group.map(({ shift }) => scheduleSignature(shift))).size > 1) {
      addIssue(issues, 'duplicate_shift_conflict', 'Duplicate shift records disagree on schedule, rest-day, or break fields; all valid intervals were retained for union.', date, shiftIds);
    }
  }

  const clippedIntervals: Interval[] = [];
  for (const interval of intervals) {
    const start = Math.max(interval.start, weekStartMinute);
    const end = Math.min(interval.end, weekEndMinute);
    if (start < end) clippedIntervals.push({ ...interval, start, end });
  }

  const sortedIntervals = [...clippedIntervals].sort((left, right) =>
    left.start - right.start || left.end - right.end || left.shiftId.localeCompare(right.shiftId) || left.intervalName.localeCompare(right.intervalName)
  );
  for (let leftIndex = 0; leftIndex < sortedIntervals.length; leftIndex += 1) {
    const left = sortedIntervals[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < sortedIntervals.length; rightIndex += 1) {
      const right = sortedIntervals[rightIndex];
      if (right.start >= left.end) break;
      if (left.start < right.end && right.start < left.end) {
        const overlapDate = dateFromOrdinal(Math.floor(Math.max(left.start, right.start) / MINUTES_PER_DAY));
        addIssue(
          issues,
          'overlapping_intervals',
          'Scheduled intervals overlap; their minutes are counted once by interval union.',
          overlapDate,
          [left.shiftId, right.shiftId].sort()
        );
      }
    }
  }

  const mergedIntervals: Array<{ start: number; end: number }> = [];
  for (const interval of sortedIntervals) {
    const last = mergedIntervals[mergedIntervals.length - 1];
    if (!last || interval.start > last.end) {
      mergedIntervals.push({ start: interval.start, end: interval.end });
    } else {
      last.end = Math.max(last.end, interval.end);
    }
  }

  const unionTotalsByDate = new Map(dates.map((date) => [date, 0]));
  for (const interval of mergedIntervals) {
    let cursor = interval.start;
    while (cursor < interval.end) {
      const dayOrdinal = Math.floor(cursor / MINUTES_PER_DAY);
      const dayEnd = Math.min(interval.end, (dayOrdinal + 1) * MINUTES_PER_DAY);
      const date = dateFromOrdinal(dayOrdinal);
      unionTotalsByDate.set(date, (unionTotalsByDate.get(date) ?? 0) + (dayEnd - cursor));
      cursor = dayEnd;
    }
  }

  const byDate = dates.map((date) => ({ date, scheduledMinutes: unionTotalsByDate.get(date) ?? 0 }));
  const assignedMinutes = byDate.reduce((sum, item) => sum + item.scheduledMinutes, 0);
  const coverageStatus = calculateCoverage(input.dayStates, dates, unionTotalsByDate, issues);
  issues.sort(compareIssues);

  return {
    employeeId: input.employeeId,
    week: { startDate: weekStart.date, endDateExclusive: weekEnd.date },
    assignedMinutes,
    byDate,
    issues,
    needsReview: issues.length > 0,
    coverageStatus
  };
}
