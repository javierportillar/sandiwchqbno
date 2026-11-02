import { describe, expect, it } from 'vitest';
import { seededBranches, seededEmployees, seededShifts } from '../data/seed';
import { calculateShiftTotals } from '../lib/calculation';
import { defaultSettings } from '../data/seed';
import { endsBeyondPeriodEnd, needsShiftReview, normalTemplateForEmployee, templateFields } from '../lib/shiftSafety';
import { resolveTemplateForDate } from '../lib/templates';
import type { Shift } from '../types/payroll';

const dates = { all: '2026-01-05', 'mon-sat': '2026-01-05', sun: '2026-01-04', 'sun-thu': '2026-01-08', 'fri-sat': '2026-01-09' };
const base: Shift = { id: 's', employeeId: 'e', payPeriodId: 'p', date: '2026-01-05', startTime: '11:00', endTime: '14:00', breakMinutes: 0 };

describe('shift assignment safety', () => {
  it('assigns each of the 18 resolved templates without an additional deduction', () => {
    const templates = seededBranches.flatMap((branch) => branch.shiftTemplates.map((template) => ({ branch, template })));
    expect(templates).toHaveLength(18);
    for (const { branch, template } of templates) {
      const resolved = resolveTemplateForDate(branch, dates[template.dayScope], { role: template.role, kind: template.kind });
      expect(resolved?.id).toBe(template.id);
      expect(templateFields(resolved!)).toEqual({
        templateId: template.id, startTime: template.startTime, endTime: template.endTime,
        secondStart: template.secondStart, secondEnd: template.secondEnd, breakMinutes: 0, restDay: false
      });
    }
  });

  it('sums two explicit intervals without counting the gap', () => {
    const totals = calculateShiftTotals({ ...base, secondStart: '18:00', secondEnd: '22:00' }, defaultSettings);
    expect(Object.values(totals).reduce((sum, value) => sum + value, 0)).toBe(7);
  });

  it.each([
    { ...base, breakMinutes: 60 },
    { ...base, templateId: 'partido', breakMinutes: 240 },
    { ...base, templateId: 'partido' },
    { ...base, secondStart: '18:00' },
    { ...base, startTime: undefined }
  ])('requires explicit review for ambiguous or incomplete historical shifts', (shift) => {
    const snapshot = JSON.stringify(shift);
    expect(needsShiftReview(shift)).toBe(true);
    expect(JSON.stringify(shift)).toBe(snapshot);
  });

  it('flags and preserves a legacy rest day with a positive break', () => {
    const shift: Shift = { ...base, startTime: undefined, endTime: undefined, restDay: true, breakMinutes: 30 };
    const snapshot = JSON.stringify(shift);

    expect(needsShiftReview(shift)).toBe(true);
    expect(JSON.stringify(shift)).toBe(snapshot);
  });

  it('accepts complete split shifts and zero-break example seeds', () => {
    expect(needsShiftReview({ ...base, secondStart: '18:00', secondEnd: '22:00' })).toBe(false);
    expect(seededShifts.every((shift) => shift.breakMinutes === 0)).toBe(true);
  });

  it('does not choose a fallback for Avenida without a role', () => {
    const branch = seededBranches.find((item) => item.id === 'branch-avenida');
    const employee = { ...seededEmployees[2], role: undefined };
    expect(normalTemplateForEmployee(branch, employee, '2026-01-05')).toBeUndefined();
  });
});

describe('stored interval validation', () => {
  it.each([
    { ...base, startTime: '8:00' },
    { ...base, startTime: '24:00' },
    { ...base, endTime: '14:60' },
    { ...base, endTime: '11:00' },
    { ...base, secondStart: '13:00', secondEnd: '18:00' },
    { ...base, secondStart: '18:00', secondEnd: '17:00' },
    { ...base, secondStart: '18:00', secondEnd: '18:00' },
    { ...base, secondStart: '18:00', secondEnd: '99:00' },
    { ...base, templateId: 'unicentro-ls-partido' }
  ])('blocks unsafe stored interval: $startTime–$endTime', (shift) => {
    expect(needsShiftReview(shift)).toBe(true);
  });

  it('requires both intervals for a template whose kind is partido even with an unrelated id', () => {
    expect(needsShiftReview({ ...base, templateId: 'custom-template' }, 'partido')).toBe(true);
  });

  it('accepts a single interval crossing midnight and counts its full duration', () => {
    const shift = { ...base, startTime: '20:00', endTime: '04:00' };
    expect(needsShiftReview(shift)).toBe(false);
    const totals = calculateShiftTotals(shift, defaultSettings);
    expect(Object.values(totals).reduce((sum, value) => sum + value, 0)).toBe(8);
  });

  it('accepts an explicit final midnight endpoint without treating it as 24 hours', () => {
    const shift = { ...base, secondStart: '18:00', secondEnd: '00:00' };
    expect(needsShiftReview(shift)).toBe(false);
    const totals = calculateShiftTotals(shift, defaultSettings);
    expect(Object.values(totals).reduce((sum, value) => sum + value, 0)).toBe(9);
    expect(needsShiftReview({ ...base, startTime: '20:00', endTime: '00:00' })).toBe(false);
  });

  it.each([
    { ...base, date: '2026-01-15', startTime: '20:00', endTime: '04:00' },
    { ...base, date: '2026-01-15', startTime: '20:00', endTime: '00:00' },
    { ...base, date: '2026-01-15', startTime: '11:00', endTime: '14:00', secondStart: '18:00', secondEnd: '00:00' }
  ])('identifies a scheduled interval ending after the period, including midnight: $startTime–$endTime', (shift) => {
    expect(endsBeyondPeriodEnd(shift, '2026-01-15')).toBe(true);
  });

  it.each([
    { ...base, date: '2026-01-14', startTime: '20:00', endTime: '04:00' },
    { ...base, date: '2026-01-15', startTime: '11:00', endTime: '14:00' }
  ])('keeps shifts ending on or before the period end eligible: $date $startTime–$endTime', (shift) => {
    expect(endsBeyondPeriodEnd(shift, '2026-01-15')).toBe(false);
  });
});
