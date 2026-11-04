import {
  getColombianPublicHolidays,
  getColombianOrdinaryWeeklyHoursLimit,
  getColombianRestDayPremiumPercent,
  getColombianWorkdayInfo,
  getColombianWorkdayRateLabel,
  getColombianWorkdayRateReferenceSummary
} from '../lib/colombianCalendar';

describe('calendario laboral colombiano', () => {
  it('recognizes fixed, Emiliani-transferred and Easter-relative holidays', () => {
    expect(getColombianPublicHolidays('2026-07-20').map(({ name }) => name)).toContain('Día de la Independencia');
    expect(getColombianPublicHolidays('2026-03-23').map(({ name, transferred }) => [name, transferred])).toContainEqual([
      'Día de San José', true
    ]);
    expect(getColombianPublicHolidays('2026-04-03').map(({ name }) => name)).toContain('Viernes Santo');
    expect(getColombianPublicHolidays('2026-05-18').map(({ name }) => name)).toContain('Ascensión del Señor');
    expect(getColombianPublicHolidays('2026-06-08').map(({ name }) => name)).toContain('Corpus Christi');
    expect(getColombianPublicHolidays('2026-06-15').map(({ name }) => name)).toContain('Sagrado Corazón de Jesús');
  });

  it('recognizes the observed All Saints holiday on Monday, November 2, 2026', () => {
    expect(getColombianPublicHolidays('2026-11-01')).toEqual([]);
    expect(getColombianPublicHolidays('2026-11-02')).toMatchObject([
      { name: 'Día de Todos los Santos', sourceDate: '2026-11-01', transferred: true }
    ]);
    expect(getColombianWorkdayInfo('2026-11-02')).toMatchObject({ isSunday: false, isSpecialDay: true, premiumPercent: 90 });
    expect(getColombianWorkdayRateLabel('2026-11-02')).toBe('Festivo: Día de Todos los Santos · recargo legal de referencia 90%');
  });

  it.each([
    ['2025-06-30', 75],
    ['2025-07-01', 80],
    ['2026-06-30', 80],
    ['2026-07-01', 90],
    ['2027-06-30', 90],
    ['2027-07-01', 100]
  ])('returns the effective statutory surcharge reference for %s', (date, percent) => {
    expect(getColombianRestDayPremiumPercent(date)).toBe(percent);
  });

  it('summarizes only special civil work dates with their own effective rate', () => {
    expect(getColombianWorkdayRateReferenceSummary([
      { date: '2026-07-05', isRestDay: true },
      { date: '2026-11-07', isRestDay: false },
      { date: '2026-06-28', isRestDay: true },
      { date: '2026-07-05', isRestDay: true }
    ])).toBe([
      '2026-06-28 — Domingo · recargo legal de referencia 80%',
      '2026-07-05 — Domingo · recargo legal de referencia 90%'
    ].join('; '));
  });

  it.each([
    ['2023-07-14', 48],
    ['2023-07-15', 47],
    ['2024-07-15', 46],
    ['2025-07-15', 44],
    ['2026-07-15', 42]
  ])('returns the effective ordinary weekly-hours reference for %s', (date, hours) => {
    expect(getColombianOrdinaryWeeklyHoursLimit(date)).toBe(hours);
  });

  it('does not assign a Sunday surcharge to an ordinary weekday or invalid date', () => {
    expect(getColombianWorkdayInfo('2026-11-03')).toMatchObject({ isSpecialDay: false, premiumPercent: null });
    expect(getColombianRestDayPremiumPercent('2026-02-30')).toBeNull();
  });
});
