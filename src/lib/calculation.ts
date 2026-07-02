import {
  CalculationResult,
  ComputedDayBreakdown,
  Employee,
  EmployeePeriodSummary,
  HourTotals,
  PayrollSettings,
  Shift
} from '../types/payroll';

interface WorkSegment {
  date: string;
  isSunday: boolean;
  isNight: boolean;
  minutes: number;
}

interface ClassifiedSegment extends WorkSegment {
  ordinaryBucket: keyof HourTotals;
  extraBucket: keyof HourTotals;
}

interface AggregateInput {
  shifts: Shift[];
  employees: Employee[];
  settings: PayrollSettings;
  periodId: string;
  adjustments: Record<string, number>;
}

/** Identificador de plantilla para turno partido (dos bloques con break en medio) */
export const TEMPLATE_PARTIDO = 'partido';

const ZERO_TOTALS: HourTotals = {
  ORD: 0,
  RN: 0,
  HED: 0,
  HEN: 0,
  DOM08: 0,
  DOM18: 0,
  RN_DOM: 0,
  HED_DOM: 0,
  HEN_DOM: 0
};

const roundHours = (value: number) => Math.round(value * 100) / 100;
const roundMoney = (value: number) => Math.round(value);

const timeToMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const minutesToHours = (minutes: number) => roundHours(minutes / 60);

const formatDateFromUTC = (date: Date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const addDays = (dateISO: string, amount: number): string => {
  const date = new Date(`${dateISO}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDateFromUTC(date);
};

const isSundayDate = (dateISO: string): boolean => {
  const date = new Date(`${dateISO}T12:00:00Z`);
  return date.getUTCDay() === 0;
};

const isNightMinute = (
  minuteOfDay: number,
  nocturnalStart: number,
  nocturnalEnd: number
): boolean => {
  if (nocturnalStart < nocturnalEnd) {
    return minuteOfDay >= nocturnalStart && minuteOfDay < nocturnalEnd;
  }
  return minuteOfDay >= nocturnalStart || minuteOfDay < nocturnalEnd;
};

const applyBreakMinutes = (
  segments: WorkSegment[],
  breakMinutes: number
): WorkSegment[] => {
  const remaining = segments.map((seg) => ({ ...seg }));
  let pending = Math.max(0, breakMinutes);

  const consume = (matcher: (s: WorkSegment) => boolean) => {
    for (const segment of remaining) {
      if (!matcher(segment) || pending <= 0 || segment.minutes <= 0) {
        continue;
      }
      const used = Math.min(segment.minutes, pending);
      segment.minutes -= used;
      pending -= used;
      if (pending <= 0) {
        break;
      }
    }
  };

  // Simplificación MVP solicitada: descontar primero diurno ordinario.
  consume((s) => !s.isSunday && !s.isNight);
  consume((s) => !s.isNight);
  consume(() => true);

  return remaining.filter((s) => s.minutes > 0);
};

const splitShiftRangeIntoSegments = (
  startAbs: number,
  endAbs: number,
  shiftDate: string,
  settings: PayrollSettings
): WorkSegment[] => {
  const nocturnalStart = timeToMinutes(settings.nocturnalStart);
  const nocturnalEnd = timeToMinutes(settings.nocturnalEnd);
  const segments: WorkSegment[] = [];
  let current: WorkSegment | null = null;

  for (let absMinute = startAbs; absMinute < endAbs; absMinute += 1) {
    const dayOffset = Math.floor(absMinute / 1440);
    const minuteOfDay = ((absMinute % 1440) + 1440) % 1440;
    const localDate = addDays(shiftDate, dayOffset);
    const isSunday = isSundayDate(localDate);
    const isNight = isNightMinute(minuteOfDay, nocturnalStart, nocturnalEnd);

    if (
      current &&
      current.date === localDate &&
      current.isSunday === isSunday &&
      current.isNight === isNight
    ) {
      current.minutes += 1;
    } else {
      if (current) {
        segments.push(current);
      }
      current = {
        date: localDate,
        isSunday,
        isNight,
        minutes: 1
      };
    }
  }

  if (current) {
    segments.push(current);
  }

  return segments;
};

export const splitShiftIntoSegments = (
  shift: Shift,
  settings: PayrollSettings
): WorkSegment[] => {
  if (shift.restDay || !shift.startTime || !shift.endTime) {
    return [];
  }

  const start = timeToMinutes(shift.startTime);

  // Turno con dos tramos explícitos (secondStart/secondEnd definidos)
  if (shift.secondStart && shift.secondEnd) {
    const firstEnd = timeToMinutes(shift.endTime);
    const secondStartAbs = timeToMinutes(shift.secondStart);
    let secondEndAbs = timeToMinutes(shift.secondEnd);
    if (secondEndAbs <= secondStartAbs) {
      secondEndAbs += 1440;
    }

    const firstSegments = splitShiftRangeIntoSegments(start, firstEnd, shift.date, settings);
    const secondSegments = splitShiftRangeIntoSegments(secondStartAbs, secondEndAbs, shift.date, settings);

    return [...firstSegments, ...secondSegments];
  }

  // Fallback: turno sin tramos explícitos (único bloque)
  let end = timeToMinutes(shift.endTime);
  if (end <= start) {
    end += 1440;
  }

  const totalMinutes = end - start;

  // Fallback legacy para partido sin secondStart/secondEnd (heuristico)
  if (shift.templateId === TEMPLATE_PARTIDO && shift.breakMinutes > 0) {
    const workMinutes = totalMinutes - shift.breakMinutes;
    if (workMinutes <= 0) return [];
    const halfWork = Math.floor(workMinutes / 2);
    const internalFirstEnd = start + halfWork;
    const secondStartAbs = internalFirstEnd + shift.breakMinutes;

    const firstSegments = splitShiftRangeIntoSegments(start, internalFirstEnd, shift.date, settings);
    const secondSegments = splitShiftRangeIntoSegments(secondStartAbs, end, shift.date, settings);

    return [...firstSegments, ...secondSegments];
  }

  const segments = splitShiftRangeIntoSegments(start, end, shift.date, settings);
  return applyBreakMinutes(segments, shift.breakMinutes);
};

export const classifySegments = (segments: WorkSegment[]): ClassifiedSegment[] => {
  // Dominical nocturno → RN_DOM (recargo nocturno 35% + dominical 80% = 1.15).
  // DOM18 queda como columna de referencia para cálculo alternativo (factor 1.8 total).
  return segments.map((segment) => {
    const ordinaryBucket: keyof HourTotals = segment.isSunday
      ? segment.isNight
        ? 'RN_DOM'
        : 'DOM08'
      : segment.isNight
        ? 'RN'
        : 'ORD';

    const extraBucket: keyof HourTotals = segment.isSunday
      ? segment.isNight
        ? 'HEN_DOM'
        : 'HED_DOM'
      : segment.isNight
        ? 'HEN'
        : 'HED';

    return {
      ...segment,
      ordinaryBucket,
      extraBucket
    };
  });
};

export const applyOrdinaryVsExtra = (
  segments: ClassifiedSegment[],
  settings: PayrollSettings
): HourTotals => {
  const totals: HourTotals = { ...ZERO_TOTALS };
  let ordinaryRemaining = settings.dailyOrdinaryHours * 60;

  for (const segment of segments) {
    const ordinaryMinutes = Math.min(segment.minutes, Math.max(0, ordinaryRemaining));
    const extraMinutes = segment.minutes - ordinaryMinutes;

    totals[segment.ordinaryBucket] += minutesToHours(ordinaryMinutes);
    totals[segment.extraBucket] += minutesToHours(extraMinutes);

    ordinaryRemaining -= ordinaryMinutes;
  }

  return {
    ORD: roundHours(totals.ORD),
    RN: roundHours(totals.RN),
    HED: roundHours(totals.HED),
    HEN: roundHours(totals.HEN),
    DOM08: roundHours(totals.DOM08),
    DOM18: roundHours(totals.DOM18),
    RN_DOM: roundHours(totals.RN_DOM),
    HED_DOM: roundHours(totals.HED_DOM),
    HEN_DOM: roundHours(totals.HEN_DOM)
  };
};

const toComputedDayBreakdown = (
  shiftId: string,
  segments: ClassifiedSegment[],
  totals: HourTotals
): ComputedDayBreakdown => {
  return {
    shiftId,
    ordHours: totals.ORD,
    rnHours: totals.RN,
    hedHours: totals.HED,
    henHours: totals.HEN,
    dom08Hours: totals.DOM08,
    dom18Hours: totals.DOM18,
    rnDomHours: totals.RN_DOM,
    hedDomHours: totals.HED_DOM,
    henDomHours: totals.HEN_DOM,
    rawSegmentsJSON: JSON.stringify(segments)
  };
};

const sumTotals = (base: HourTotals, add: HourTotals): HourTotals => {
  const merged: HourTotals = {
    ORD: roundHours(base.ORD + add.ORD),
    RN: roundHours(base.RN + add.RN),
    HED: roundHours(base.HED + add.HED),
    HEN: roundHours(base.HEN + add.HEN),
    DOM08: roundHours(base.DOM08 + add.DOM08),
    DOM18: roundHours(base.DOM18 + add.DOM18),
    RN_DOM: roundHours(base.RN_DOM + add.RN_DOM),
    HED_DOM: roundHours(base.HED_DOM + add.HED_DOM),
    HEN_DOM: roundHours(base.HEN_DOM + add.HEN_DOM)
  };
  return merged;
};

const buildSubtotals = (
  totals: HourTotals,
  vrHoraBase: number,
  settings: PayrollSettings
): Record<keyof HourTotals, number> => {
  return {
    ORD: 0,
    RN: roundMoney(totals.RN * vrHoraBase * settings.multipliers.RN),
    HED: roundMoney(totals.HED * vrHoraBase * settings.multipliers.HED),
    HEN: roundMoney(totals.HEN * vrHoraBase * settings.multipliers.HEN),
    DOM08: roundMoney(totals.DOM08 * vrHoraBase * settings.multipliers.DOM_DIURNO),
    DOM18: roundMoney(totals.DOM18 * vrHoraBase * settings.multipliers.DOM_NOCT),
    RN_DOM: roundMoney(totals.RN_DOM * vrHoraBase * settings.multipliers.RN_DOM),
    HED_DOM: roundMoney(totals.HED_DOM * vrHoraBase * settings.multipliers.HED_DOM),
    HEN_DOM: roundMoney(totals.HEN_DOM * vrHoraBase * settings.multipliers.HEN_DOM)
  };
};

export const aggregateDailyAndPeriod = ({
  shifts,
  employees,
  settings,
  periodId,
  adjustments
}: AggregateInput): CalculationResult => {
  const activeEmployees = new Map(employees.map((e) => [e.id, e]));
  const dayBreakdowns: CalculationResult['dayBreakdowns'] = [];
  const periodTotals = new Map<string, HourTotals>();

  for (const shift of shifts) {
    if (shift.payPeriodId !== periodId || !activeEmployees.has(shift.employeeId)) {
      continue;
    }

    const split = splitShiftIntoSegments(shift, settings);
    const classified = classifySegments(split);
    const totals = applyOrdinaryVsExtra(classified, settings);

    const employee = activeEmployees.get(shift.employeeId);
    if (!employee) {
      continue;
    }

    dayBreakdowns.push({
      employeeId: employee.id,
      employeeName: employee.fullName,
      date: shift.date,
      shift,
      breakdown: toComputedDayBreakdown(shift.id, classified, totals)
    });

    const previous = periodTotals.get(employee.id) ?? { ...ZERO_TOTALS };
    periodTotals.set(employee.id, sumTotals(previous, totals));
  }

  const summaries: EmployeePeriodSummary[] = employees
    .filter((employee) => employee.active)
    .map((employee) => {
      const totals = periodTotals.get(employee.id) ?? { ...ZERO_TOTALS };
      const vrHoraBase = roundMoney(employee.baseMonthlySalary / settings.monthlyHoursBase);
      const adjustment = adjustments[employee.id] ?? 0;
      const subtotals = buildSubtotals(totals, vrHoraBase, settings);
      const totalExtras = Object.values(subtotals).reduce((sum, value) => sum + value, 0);
      const finalTotal = totalExtras + adjustment;

      return {
        employeeId: employee.id,
        employeeName: employee.fullName,
        branchName: '-',
        baseMonthlySalary: employee.baseMonthlySalary,
        vrHoraBase,
        adjustment,
        totals,
        subtotals,
        totalExtras,
        finalTotal
      };
    });

  return {
    dayBreakdowns: dayBreakdowns.sort((a, b) =>
      `${a.employeeName}-${a.date}`.localeCompare(`${b.employeeName}-${b.date}`)
    ),
    summaries
  };
};
