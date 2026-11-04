import { describe, expect, it } from 'vitest';
import { defaultSettings, seededEmployees } from '../data/seed';
import { aggregateDailyAndPeriod } from '../lib/calculation';
import { validatePayPeriodRange, validatePayrollPeriodIntegrity } from '../lib/periodIntegrity';
import type { PayPeriod, Shift } from '../types/payroll';

const selectedPeriod: PayPeriod = {
  id: 'selected', companyId: 'company-qbano', startDate: '2026-01-01', endDate: '2026-01-15', label: 'Jan 1–15'
};
const otherPeriod: PayPeriod = {
  id: 'other', companyId: 'company-qbano', startDate: '2026-01-16', endDate: '2026-01-31', label: 'Jan 16–31'
};

const shift = (payPeriodId: string, date: string): Shift => ({
  id: 'shift-1', employeeId: seededEmployees[0].id, payPeriodId, date,
  startTime: '08:00', endTime: '16:00', breakMinutes: 0
});

const calculate = (period: PayPeriod, periods: PayPeriod[], shifts: Shift[]) => aggregateDailyAndPeriod({
  shifts,
  employees: seededEmployees,
  settings: defaultSettings,
  periodId: period.id,
  period,
  periods,
  adjustments: {}
});

describe('payroll period integrity', () => {
  it('keeps calculations valid for matching shifts and adjacent periods', () => {
    const assigned = shift(selectedPeriod.id, '2026-01-02'); // Jan 1 is now classified as a Colombian public holiday.
    const shiftSnapshot = structuredClone(assigned);
    expect(validatePayPeriodRange(otherPeriod, [selectedPeriod])).toEqual([]);
    expect(validatePayrollPeriodIntegrity(selectedPeriod, [selectedPeriod, otherPeriod], [assigned])).toEqual([]);

    const result = calculate(selectedPeriod, [selectedPeriod, otherPeriod], [assigned]);
    expect(result.dayBreakdowns).toHaveLength(1);
    expect(result.dayBreakdowns[0].breakdown.shiftId).toBe(assigned.id);
    expect(result.dayBreakdowns[0].breakdown.ordHours).toBeGreaterThan(0);
    expect(assigned).toEqual(shiftSnapshot);
  });

  it('rejects a shift dated inside the selected range but tagged to another period without reassigning it', () => {
    const mismatched = shift(otherPeriod.id, '2026-01-10');
    const snapshot = structuredClone(mismatched);
    expect(validatePayrollPeriodIntegrity(selectedPeriod, [selectedPeriod, otherPeriod], [mismatched]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'shift-period-mismatch', shiftId: mismatched.id })]));
    expect(() => calculate(selectedPeriod, [selectedPeriod, otherPeriod], [mismatched]))
      .toThrow(/cae dentro del período/);
    expect(mismatched).toEqual(snapshot);
  });

  it('rejects a selected-period shift whose date is outside the selected range', () => {
    const outside = shift(selectedPeriod.id, '2026-01-16');
    const snapshot = structuredClone(outside);
    expect(validatePayrollPeriodIntegrity(selectedPeriod, [selectedPeriod, otherPeriod], [outside]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'shift-outside-period', shiftId: outside.id })]));
    expect(() => calculate(selectedPeriod, [selectedPeriod, otherPeriod], [outside]))
      .toThrow(/queda fuera de/);
    expect(outside).toEqual(snapshot);
  });

  it('rejects overlapping periods both when proposing and calculating', () => {
    const overlapping: PayPeriod = {
      ...otherPeriod, id: 'overlap', startDate: '2026-01-15', endDate: '2026-01-20', label: 'Jan 15–20'
    };
    const periods = [selectedPeriod, overlapping];
    const periodSnapshot = structuredClone(periods);
    expect(validatePayPeriodRange(overlapping, [selectedPeriod]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'overlapping-periods' })]));
    expect(validatePayrollPeriodIntegrity(selectedPeriod, periods, []))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'overlapping-periods' })]));
    expect(() => calculate(selectedPeriod, periods, []))
      .toThrow(/se superpone/);
    expect(periods).toEqual(periodSnapshot);
  });

  it('rejects a duplicate period ID when validating a new period', () => {
    const candidate: PayPeriod = {
      ...selectedPeriod, startDate: '2026-02-01', endDate: '2026-02-15', label: 'Feb 1–15'
    };

    expect(validatePayPeriodRange(candidate, [selectedPeriod]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'duplicate-period-id', periodId: candidate.id })]));
  });
});
