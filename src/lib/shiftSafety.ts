import type { Branch, Employee, Shift, ShiftKind, ShiftTemplate } from '../types/payroll';
import { resolveTemplateForDate } from './templates';

const isTime = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

// A single interval ending before its start ends the next day. Split shifts
// have no per-segment dates, so only midnight as their final endpoint is unambiguous.
export function validShiftRanges(shift: Pick<Shift, 'startTime' | 'endTime' | 'secondStart' | 'secondEnd'>): boolean {
  const { startTime, endTime, secondStart, secondEnd } = shift;
  if (!isTime(startTime) || !isTime(endTime)) return false;
  const split = secondStart !== undefined || secondEnd !== undefined;
  if (!split) return startTime !== endTime;
  if (!isTime(secondStart) || !isTime(secondEnd)) return false;
  return startTime < endTime && endTime <= secondStart && secondStart !== secondEnd &&
    (secondEnd === '00:00' || secondStart < secondEnd);
}

const nextCalendarDate = (date: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
};

export function endsBeyondPeriodEnd(
  shift: Pick<Shift, 'date' | 'startTime' | 'endTime' | 'secondStart' | 'secondEnd' | 'restDay'>,
  periodEndDate: string
): boolean {
  if (shift.restDay || !validShiftRanges(shift) || !shift.startTime || !shift.endTime) return false;

  const intervals = [{ start: shift.startTime, end: shift.endTime }];
  if (shift.secondStart && shift.secondEnd) {
    intervals.push({ start: shift.secondStart, end: shift.secondEnd });
  }

  return intervals.some(({ start, end }) => {
    const endDate = end <= start ? nextCalendarDate(shift.date) : shift.date;
    return endDate > periodEndDate;
  });
}

export function isEmptyShift(shift: Shift): boolean {
  return !shift.restDay && !shift.templateId && shift.breakMinutes === 0 &&
    !shift.startTime && !shift.endTime && !shift.secondStart && !shift.secondEnd;
}

export function needsShiftReview(shift: Shift, templateKind?: ShiftKind): boolean {
  if (shift.breakMinutes > 0) return true;
  if (shift.templateId !== undefined && typeof shift.templateId !== 'string') return true;
  if (shift.restDay) return Boolean(shift.startTime || shift.endTime || shift.secondStart || shift.secondEnd || shift.templateId);
  const splitRequired = templateKind === 'partido' || shift.templateId === 'partido' || Boolean(shift.templateId?.endsWith('-partido'));
  return shift.breakMinutes !== 0 || !validShiftRanges(shift) ||
    (splitRequired && (!shift.secondStart || !shift.secondEnd));
}

export function duplicateShiftGroups(shifts: Shift[]): Shift[][] {
  const groups = new Map<string, Shift[]>();
  for (const shift of shifts) {
    const key = JSON.stringify([shift.employeeId, shift.payPeriodId, shift.date]);
    groups.set(key, [...(groups.get(key) ?? []), shift]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function templateFields(template: ShiftTemplate): Partial<Shift> {
  return {
    templateId: template.id, startTime: template.startTime, endTime: template.endTime,
    secondStart: template.secondStart, secondEnd: template.secondEnd,
    breakMinutes: 0, restDay: false
  };
}

export function normalTemplateForEmployee(branch: Branch | undefined, employee: Employee, date: string) {
  return resolveTemplateForDate(branch, date, { kind: 'normal', role: employee.role });
}
