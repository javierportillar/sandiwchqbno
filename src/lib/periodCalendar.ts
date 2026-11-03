import type { PayPeriod } from '../types/payroll';
import { validatePayPeriodRange } from './periodIntegrity';
import { addDaysToDate, getLocalTodayISO, getMondayWeekStart, isCivilDate } from './scheduleWeek';

export interface CalendarDay {
  date: string;
  inCurrentMonth: boolean;
}

export interface CalendarMonth {
  month: string;
  startDate: string;
  endDate: string;
  days: CalendarDay[];
}

export type HalfMonth = '1' | '2';

export type PayPeriodClassification = {
  kind: 'period-1' | 'period-2' | 'custom';
  label: 'Período 1' | 'Período 2' | 'Rango personalizado';
  color: 'green' | 'gold' | 'slate';
};

const parseMonth = (month: string): { year: number; monthNumber: number } | null => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 1 || monthNumber < 1 || monthNumber > 12) return null;
  return { year, monthNumber };
};

const daysInMonth = (year: number, month: number): number => {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
};

const CUSTOM_PERIOD: PayPeriodClassification = {
  kind: 'custom',
  label: 'Rango personalizado',
  color: 'slate'
};

/** Classify only exact calendar quincenas; every other range stays neutral. */
export const classifyPayPeriod = (
  period: Pick<PayPeriod, 'startDate' | 'endDate'>
): PayPeriodClassification => {
  if (!isCivilDate(period.startDate) || !isCivilDate(period.endDate) || period.startDate > period.endDate) {
    return CUSTOM_PERIOD;
  }

  const [startYear, startMonth, startDay] = period.startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = period.endDate.split('-').map(Number);
  if (startYear !== endYear || startMonth !== endMonth) return CUSTOM_PERIOD;

  if (startDay === 1 && endDay === 15) {
    return { kind: 'period-1', label: 'Período 1', color: 'green' };
  }
  if (startDay === 16 && endDay === daysInMonth(startYear, startMonth)) {
    return { kind: 'period-2', label: 'Período 2', color: 'gold' };
  }

  return CUSTOM_PERIOD;
};

const localDateForCivilDate = (value: string): Date => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(2000, month - 1, day, 12);
  date.setFullYear(year);
  return date;
};

export const getCurrentCalendarMonth = (): string => getLocalTodayISO().slice(0, 7);

/** Build complete Monday–Sunday rows using the app's civil-date helpers. */
export const getCalendarMonth = (month: string): CalendarMonth => {
  const parsed = parseMonth(month);
  if (!parsed) throw new RangeError('month must be a valid YYYY-MM value.');

  const firstOfMonth = `${month}-01`;
  const finalDay = daysInMonth(parsed.year, parsed.monthNumber);
  const firstWeekday = (localDateForCivilDate(firstOfMonth).getDay() + 6) % 7;
  const daysInGrid = Math.ceil((firstWeekday + finalDay) / 7) * 7;
  const gridStart = getMondayWeekStart(firstOfMonth);
  const days = Array.from({ length: daysInGrid }, (_, index) => {
    const date = addDaysToDate(gridStart, index);
    return { date, inCurrentMonth: date.slice(0, 7) === month };
  });

  return { month, startDate: days[0].date, endDate: days[days.length - 1].date, days };
};

export const getHalfMonthRange = (month: string, half: HalfMonth): { startDate: string; endDate: string } => {
  const parsed = parseMonth(month);
  if (!parsed) throw new RangeError('month must be a valid YYYY-MM value.');
  const lastDay = daysInMonth(parsed.year, parsed.monthNumber);
  return half === '1'
    ? { startDate: `${month}-01`, endDate: `${month}-15` }
    : { startDate: `${month}-16`, endDate: `${month}-${String(lastDay).padStart(2, '0')}` };
};

/** Reuse periodIntegrity as the authority for both previews and final creation. */
export const getPeriodRangeIssues = (
  startDate: string,
  endDate: string,
  periods: readonly PayPeriod[]
) => {
  let previewId = `calendar-preview-${startDate}-${endDate}`;
  let suffix = 1;
  while (periods.some((period) => period.id === previewId)) {
    previewId = `calendar-preview-${startDate}-${endDate}-${suffix++}`;
  }
  return validatePayPeriodRange({
    id: previewId,
    companyId: periods[0]?.companyId ?? 'company-preview',
    startDate,
    endDate,
    label: `${startDate} a ${endDate}`
  }, periods);
};

/** Return integrity problems for a persisted row, including duplicate IDs between old rows. */
export const getExistingPeriodIssues = (period: PayPeriod, index: number, periods: readonly PayPeriod[]) =>
  validatePayPeriodRange(period, periods.filter((_, otherIndex) => otherIndex !== index));

export const isValidPeriodDateRange = (period: PayPeriod): boolean =>
  isCivilDate(period.startDate) && isCivilDate(period.endDate) && period.startDate <= period.endDate;

export const formatCalendarDate = (date: string, options: Intl.DateTimeFormatOptions = {
  day: 'numeric', month: 'short', year: 'numeric'
}): string => {
  if (!isCivilDate(date)) return date;
  return new Intl.DateTimeFormat('es-CO', options).format(localDateForCivilDate(date));
};

export const formatCalendarMonth = (month: string): string => {
  const parsed = parseMonth(month);
  if (!parsed) throw new RangeError('month must be a valid YYYY-MM value.');
  const first = localDateForCivilDate(`${month}-01`);
  return new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(first);
};
