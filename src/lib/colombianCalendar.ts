export interface ColombianPublicHoliday {
  date: string;
  name: string;
  sourceDate: string;
  transferred: boolean;
}

export interface ColombianWorkdayInfo {
  isSunday: boolean;
  isSpecialDay: boolean;
  holidays: ColombianPublicHoliday[];
  premiumPercent: number | null;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function parseCivilDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(12, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

function formatCivilDate(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addDays(dateISO: string, days: number): string {
  const date = parseCivilDate(dateISO);
  if (!date) throw new RangeError('date must be a valid YYYY-MM-DD civil date.');
  date.setTime(date.getTime() + days * MILLISECONDS_PER_DAY);
  return formatCivilDate(date);
}

function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function mondayOnOrAfter(dateISO: string): string {
  const date = parseCivilDate(dateISO);
  if (!date) throw new RangeError('date must be a valid YYYY-MM-DD civil date.');
  const weekday = date.getUTCDay();
  return addDays(dateISO, (8 - weekday) % 7);
}

function publicHolidaysForYear(year: number): ColombianPublicHoliday[] {
  const holidays: ColombianPublicHoliday[] = [];
  const addHoliday = (sourceDate: string, name: string, transferToMonday: boolean) => {
    const date = transferToMonday ? mondayOnOrAfter(sourceDate) : sourceDate;
    holidays.push({ date, name, sourceDate, transferred: date !== sourceDate });
  };

  for (const [monthDay, name] of [
    ['01-01', 'Año Nuevo'],
    ['05-01', 'Día del Trabajo'],
    ['07-20', 'Día de la Independencia'],
    ['08-07', 'Batalla de Boyacá'],
    ['12-08', 'Inmaculada Concepción'],
    ['12-25', 'Navidad']
  ]) {
    addHoliday(`${year}-${monthDay}`, name, false);
  }

  for (const [monthDay, name] of [
    ['01-06', 'Día de los Reyes Magos'],
    ['03-19', 'Día de San José'],
    ['06-29', 'San Pedro y San Pablo'],
    ['08-15', 'Asunción de la Virgen'],
    ['10-12', 'Día de la Diversidad Étnica y Cultural'],
    ['11-01', 'Día de Todos los Santos'],
    ['11-11', 'Independencia de Cartagena']
  ]) {
    addHoliday(`${year}-${monthDay}`, name, true);
  }

  const easter = easterSunday(year);
  addHoliday(addDays(easter, -3), 'Jueves Santo', false);
  addHoliday(addDays(easter, -2), 'Viernes Santo', false);
  addHoliday(addDays(easter, 39), 'Ascensión del Señor', true);
  addHoliday(addDays(easter, 60), 'Corpus Christi', true);
  addHoliday(addDays(easter, 68), 'Sagrado Corazón de Jesús', true);
  return holidays;
}

export function getColombianPublicHolidays(dateISO: string): ColombianPublicHoliday[] {
  const date = parseCivilDate(dateISO);
  if (!date) return [];
  return publicHolidaysForYear(date.getUTCFullYear()).filter((holiday) => holiday.date === dateISO);
}

export function isColombianPublicHoliday(dateISO: string): boolean {
  return getColombianPublicHolidays(dateISO).length > 0;
}

/** Statutory surcharge reference for work on Sunday or a public holiday, by work date. */
export function getColombianRestDayPremiumPercent(dateISO: string): number | null {
  if (!parseCivilDate(dateISO)) return null;
  if (dateISO < '2025-07-01') return 75;
  if (dateISO < '2026-07-01') return 80;
  if (dateISO < '2027-07-01') return 90;
  return 100;
}

/** Ordinary weekly-hours reference during the statutory transition period. */
export function getColombianOrdinaryWeeklyHoursLimit(dateISO: string): number | null {
  if (!parseCivilDate(dateISO)) return null;
  if (dateISO < '2023-07-15') return 48;
  if (dateISO < '2024-07-15') return 47;
  if (dateISO < '2025-07-15') return 46;
  if (dateISO < '2026-07-15') return 44;
  return 42;
}

export function getColombianWorkdayInfo(dateISO: string): ColombianWorkdayInfo {
  const date = parseCivilDate(dateISO);
  if (!date) return { isSunday: false, isSpecialDay: false, holidays: [], premiumPercent: null };
  const isSunday = date.getUTCDay() === 0;
  const holidays = getColombianPublicHolidays(dateISO);
  const isSpecialDay = isSunday || holidays.length > 0;
  return {
    isSunday,
    isSpecialDay,
    holidays,
    premiumPercent: isSpecialDay ? getColombianRestDayPremiumPercent(dateISO) : null
  };
}

export function getColombianWorkdayRateLabel(dateISO: string): string | null {
  const info = getColombianWorkdayInfo(dateISO);
  if (!info.isSpecialDay || info.premiumPercent === null) return null;
  const dayName = info.holidays.length
    ? `Festivo: ${info.holidays.map(({ name }) => name).join(', ')}`
    : 'Domingo';
  return `${dayName} · recargo legal de referencia ${info.premiumPercent}%`;
}

/** Summarizes effective legal references from the civil dates that actually contributed work segments. */
export function getColombianWorkdayRateReferenceSummary(
  segments: readonly { date: string; isRestDay: boolean }[]
): string | null {
  const specialDates = [...new Set(segments.filter(({ isRestDay }) => isRestDay).map(({ date }) => date))].sort();
  const references = specialDates.flatMap((date) => {
    const label = getColombianWorkdayRateLabel(date);
    return label ? [`${date} — ${label}`] : [];
  });

  return references.length > 0 ? references.join('; ') : null;
}
