import type { PayPeriod, Shift } from '../types/payroll';

export type PeriodIntegrityIssueCode =
  | 'invalid-period-range'
  | 'invalid-existing-period'
  | 'overlapping-periods'
  | 'missing-selected-period'
  | 'duplicate-period-id'
  | 'shift-period-mismatch'
  | 'shift-outside-period';

export interface PeriodIntegrityIssue {
  code: PeriodIntegrityIssueCode;
  message: string;
  periodId?: string;
  relatedPeriodId?: string;
  shiftId?: string;
  date?: string;
}

const isValidISODate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
};

const isValidRange = (startDate: string, endDate: string): boolean =>
  isValidISODate(startDate) && isValidISODate(endDate) && startDate <= endDate;

const overlaps = (left: PayPeriod, right: PayPeriod): boolean =>
  left.startDate <= right.endDate && right.startDate <= left.endDate;

/** Validate a proposed period using inclusive date ranges. */
export const validatePayPeriodRange = (
  candidate: PayPeriod,
  existingPeriods: readonly PayPeriod[]
): PeriodIntegrityIssue[] => {
  const issues: PeriodIntegrityIssue[] = [];

  if (!isValidRange(candidate.startDate, candidate.endDate)) {
    issues.push({
      code: 'invalid-period-range',
      periodId: candidate.id,
      message: `El período ${candidate.id} (${candidate.startDate} a ${candidate.endDate}) tiene un rango inválido: usa fechas válidas y la fecha de inicio no puede ser posterior a la fecha de fin.`
    });
    return issues;
  }

  for (const existing of existingPeriods) {
    if (existing.id === candidate.id) {
      issues.push({
        code: 'duplicate-period-id',
        periodId: candidate.id,
        relatedPeriodId: existing.id,
        message: `Ya existe un período con el identificador ${candidate.id} (${existing.startDate} a ${existing.endDate}); no se puede crear otro con el mismo ID.`
      });
      continue;
    }
    if (!isValidRange(existing.startDate, existing.endDate)) {
      issues.push({
        code: 'invalid-existing-period',
        periodId: candidate.id,
        relatedPeriodId: existing.id,
        message: `El período ${existing.id} (${existing.startDate} a ${existing.endDate}) tiene fechas inválidas; no se puede descartar que se superponga con ${candidate.id} (${candidate.startDate} a ${candidate.endDate}).`
      });
      continue;
    }
    if (overlaps(candidate, existing)) {
      issues.push({
        code: 'overlapping-periods',
        periodId: candidate.id,
        relatedPeriodId: existing.id,
        message: `Los períodos ${candidate.id} (${candidate.startDate} a ${candidate.endDate}) y ${existing.id} (${existing.startDate} a ${existing.endDate}) se superponen.`
      });
    }
  }

  return issues;
};

/** Validate persisted period/shift assignments before either UI or payroll calculation proceeds. */
export const validatePayrollPeriodIntegrity = (
  selectedPeriod: PayPeriod,
  allPeriods: readonly PayPeriod[],
  shifts: readonly Shift[]
): PeriodIntegrityIssue[] => {
  const issues: PeriodIntegrityIssue[] = [];
  const matchingPeriods = allPeriods.filter((period) => period.id === selectedPeriod.id);

  if (matchingPeriods.length === 0) {
    issues.push({
      code: 'missing-selected-period',
      periodId: selectedPeriod.id,
      message: `No hay un período guardado con el ID seleccionado ${selectedPeriod.id} (${selectedPeriod.startDate} a ${selectedPeriod.endDate}).`
    });
  } else if (matchingPeriods.length > 1) {
    issues.push({
      code: 'duplicate-period-id',
      periodId: selectedPeriod.id,
      message: `Hay más de un período guardado con el identificador ${selectedPeriod.id}; no se puede determinar el rango de nómina.`
    });
  } else if (
    matchingPeriods[0].startDate !== selectedPeriod.startDate ||
    matchingPeriods[0].endDate !== selectedPeriod.endDate
  ) {
    issues.push({
      code: 'missing-selected-period',
      periodId: selectedPeriod.id,
      message: `El período ${selectedPeriod.id} tiene fechas seleccionadas ${selectedPeriod.startDate} a ${selectedPeriod.endDate}, que no coinciden con el rango guardado ${matchingPeriods[0].startDate} a ${matchingPeriods[0].endDate}.`
    });
  }

  issues.push(...validatePayPeriodRange(
    selectedPeriod,
    allPeriods.filter((period) => period.id !== selectedPeriod.id)
  ));

  const selectedRangeValid = isValidRange(selectedPeriod.startDate, selectedPeriod.endDate);
  for (const shift of shifts) {
    const validShiftDate = isValidISODate(shift.date);
    const insideSelectedPeriod = selectedRangeValid && validShiftDate &&
      shift.date >= selectedPeriod.startDate && shift.date <= selectedPeriod.endDate;

    if (shift.payPeriodId === selectedPeriod.id && (!validShiftDate || !insideSelectedPeriod)) {
      issues.push({
        code: 'shift-outside-period',
        periodId: selectedPeriod.id,
        shiftId: shift.id,
        date: shift.date,
        message: `El turno ${shift.id} (fecha ${shift.date}) tiene payPeriodId ${selectedPeriod.id}, pero queda fuera de las fechas de ese período (${selectedPeriod.startDate} a ${selectedPeriod.endDate}).`
      });
    } else if (insideSelectedPeriod && shift.payPeriodId !== selectedPeriod.id) {
      issues.push({
        code: 'shift-period-mismatch',
        periodId: selectedPeriod.id,
        relatedPeriodId: shift.payPeriodId,
        shiftId: shift.id,
        date: shift.date,
        message: `El turno ${shift.id} del ${shift.date} cae dentro del período ${selectedPeriod.id} (${selectedPeriod.startDate} a ${selectedPeriod.endDate}), pero su payPeriodId guardado es ${shift.payPeriodId}.`
      });
    }
  }

  return issues;
};

export class PeriodIntegrityError extends Error {
  readonly issues: PeriodIntegrityIssue[];

  constructor(issues: PeriodIntegrityIssue[]) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'PeriodIntegrityError';
    this.issues = issues;
  }
}
