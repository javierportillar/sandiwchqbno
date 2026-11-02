import { describe, expect, it } from 'vitest';
import { defaultSettings, seededBranches } from '../data/seed';
import { splitShiftIntoSegments } from '../lib/calculation';
import { listTemplatesForDate, resolveTemplateForDate } from '../lib/templates';
import type { DayScope, EmployeeRole, ShiftKind } from '../types/payroll';

type Reference = {
  branchId: string;
  id: string;
  role: EmployeeRole | undefined;
  dayScope: DayScope;
  kind: Exclude<ShiftKind, 'descanso'>;
  startTime: string;
  endTime: string;
  secondStart: string | undefined;
  secondEnd: string | undefined;
  breakMinutes: number;
  netMinutes: number;
};

// Literal seed/README times are provisional, pending confirmation. Net durations
// were contrasted with the PPTX; the PPTX is not a runtime test dependency.
const references: Reference[] = [
  { branchId: 'branch-unicentro', id: 'unicentro-ls-normal', role: undefined, dayScope: 'mon-sat', kind: 'normal', startTime: '14:00', endTime: '22:00', secondStart: undefined, secondEnd: undefined, breakMinutes: 0, netMinutes: 480 },
  { branchId: 'branch-unicentro', id: 'unicentro-ls-partido', role: undefined, dayScope: 'mon-sat', kind: 'partido', startTime: '11:00', endTime: '14:00', secondStart: '18:00', secondEnd: '22:00', breakMinutes: 0, netMinutes: 420 },
  { branchId: 'branch-unicentro', id: 'unicentro-ls-doblado', role: undefined, dayScope: 'mon-sat', kind: 'doblado', startTime: '11:00', endTime: '22:00', secondStart: undefined, secondEnd: undefined, breakMinutes: 0, netMinutes: 660 },
  { branchId: 'branch-unicentro', id: 'unicentro-dom-normal', role: undefined, dayScope: 'sun', kind: 'normal', startTime: '14:00', endTime: '22:00', secondStart: undefined, secondEnd: undefined, breakMinutes: 0, netMinutes: 480 },
  { branchId: 'branch-unicentro', id: 'unicentro-dom-partido', role: undefined, dayScope: 'sun', kind: 'partido', startTime: '10:00', endTime: '14:00', secondStart: '18:00', secondEnd: '22:00', breakMinutes: 0, netMinutes: 480 },
  { branchId: 'branch-unicentro', id: 'unicentro-dom-doblado', role: undefined, dayScope: 'sun', kind: 'doblado', startTime: '10:00', endTime: '22:00', secondStart: undefined, secondEnd: undefined, breakMinutes: 0, netMinutes: 720 },
  { branchId: 'branch-unico', id: 'unico-dj-normal', role: undefined, dayScope: 'sun-thu', kind: 'normal', startTime: '14:00', endTime: '21:00', secondStart: undefined, secondEnd: undefined, breakMinutes: 0, netMinutes: 420 },
  { branchId: 'branch-unico', id: 'unico-dj-partido', role: undefined, dayScope: 'sun-thu', kind: 'partido', startTime: '11:00', endTime: '14:00', secondStart: '18:00', secondEnd: '21:00', breakMinutes: 0, netMinutes: 360 },
  { branchId: 'branch-unico', id: 'unico-dj-doblado', role: undefined, dayScope: 'sun-thu', kind: 'doblado', startTime: '11:00', endTime: '21:00', secondStart: undefined, secondEnd: undefined, breakMinutes: 0, netMinutes: 600 },
  { branchId: 'branch-unico', id: 'unico-vs-normal', role: undefined, dayScope: 'fri-sat', kind: 'normal', startTime: '14:00', endTime: '21:30', secondStart: undefined, secondEnd: undefined, breakMinutes: 0, netMinutes: 450 },
  { branchId: 'branch-unico', id: 'unico-vs-partido', role: undefined, dayScope: 'fri-sat', kind: 'partido', startTime: '11:00', endTime: '14:00', secondStart: '18:00', secondEnd: '21:30', breakMinutes: 0, netMinutes: 390 },
  { branchId: 'branch-unico', id: 'unico-vs-doblado', role: undefined, dayScope: 'fri-sat', kind: 'doblado', startTime: '11:00', endTime: '21:30', secondStart: undefined, secondEnd: undefined, breakMinutes: 0, netMinutes: 630 },
  { branchId: 'branch-avenida', id: 'avenida-sala-normal', role: 'sala', dayScope: 'all', kind: 'normal', startTime: '14:00', endTime: '22:00', secondStart: undefined, secondEnd: undefined, breakMinutes: 0, netMinutes: 480 },
  { branchId: 'branch-avenida', id: 'avenida-sala-partido', role: 'sala', dayScope: 'all', kind: 'partido', startTime: '11:00', endTime: '14:00', secondStart: '18:00', secondEnd: '22:00', breakMinutes: 0, netMinutes: 420 },
  { branchId: 'branch-avenida', id: 'avenida-sala-doblado', role: 'sala', dayScope: 'all', kind: 'doblado', startTime: '11:00', endTime: '22:00', secondStart: undefined, secondEnd: undefined, breakMinutes: 0, netMinutes: 660 },
  { branchId: 'branch-avenida', id: 'avenida-domi-normal', role: 'domicilio', dayScope: 'all', kind: 'normal', startTime: '15:00', endTime: '22:00', secondStart: undefined, secondEnd: undefined, breakMinutes: 0, netMinutes: 420 },
  { branchId: 'branch-avenida', id: 'avenida-domi-partido', role: 'domicilio', dayScope: 'all', kind: 'partido', startTime: '12:00', endTime: '15:00', secondStart: '18:00', secondEnd: '22:00', breakMinutes: 0, netMinutes: 420 },
  { branchId: 'branch-avenida', id: 'avenida-domi-doblado', role: 'domicilio', dayScope: 'all', kind: 'doblado', startTime: '12:00', endTime: '22:00', secondStart: undefined, secondEnd: undefined, breakMinutes: 0, netMinutes: 600 }
];

// Sunday through Saturday, including both sides of every scope boundary.
const datesByScope: Record<DayScope, string[]> = {
  all: ['2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10'],
  'mon-sat': ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10'],
  sun: ['2026-01-04'],
  'sun-thu': ['2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'],
  'fri-sat': ['2026-01-09', '2026-01-10']
};

const minutes = (time: string) => {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
};

describe('provisional seed template reference', () => {
  it('contains exactly the 18 independently specified templates', () => {
    const actual = seededBranches.flatMap((branch) =>
      branch.shiftTemplates.map((template) => `${branch.id}/${template.id}`)
    );
    const expected = references.map(({ branchId, id }) => `${branchId}/${id}`);
    expect(expected).toHaveLength(18);
    expect(new Set(expected).size).toBe(18);
    expect(actual.sort()).toEqual(expected.sort());
  });

  it.each(references)('$id fixes its literal fields and net duration', (reference) => {
    const branch = seededBranches.find(({ id }) => id === reference.branchId);
    expect(branch).toBeDefined();
    const template = branch!.shiftTemplates.find(({ id }) => id === reference.id);
    expect(template).toBeDefined();
    expect({
      id: template!.id, role: template!.role, dayScope: template!.dayScope,
      kind: template!.kind, startTime: template!.startTime, endTime: template!.endTime,
      secondStart: template!.secondStart, secondEnd: template!.secondEnd,
      breakMinutes: template!.breakMinutes
    }).toEqual({
      id: reference.id, role: reference.role, dayScope: reference.dayScope,
      kind: reference.kind, startTime: reference.startTime, endTime: reference.endTime,
      secondStart: reference.secondStart, secondEnd: reference.secondEnd,
      breakMinutes: reference.breakMinutes
    });

    const first = minutes(template!.endTime) - minutes(template!.startTime);
    const second = template!.secondStart && template!.secondEnd
      ? minutes(template!.secondEnd) - minutes(template!.secondStart)
      : 0;
    expect(first + second - template!.breakMinutes).toBe(reference.netMinutes);
    const segments = splitShiftIntoSegments({
      id: 'reference', employeeId: 'reference', payPeriodId: 'reference',
      date: datesByScope[reference.dayScope][0],
      startTime: template!.startTime, endTime: template!.endTime,
      secondStart: template!.secondStart, secondEnd: template!.secondEnd,
      breakMinutes: template!.breakMinutes
    }, defaultSettings);
    expect(segments.reduce((sum, segment) => sum + segment.minutes, 0)).toBe(reference.netMinutes);
  });

  it.each(['branch-unicentro', 'branch-unico', 'branch-avenida'])(
    '%s resolves and lists the exact applicable templates for every day and role',
    (branchId) => {
      const branch = seededBranches.find(({ id }) => id === branchId);
      expect(branch).toBeDefined();
      for (const date of datesByScope.all) {
        for (const role of [undefined, 'sala', 'domicilio'] as const) {
          const applicable = references.filter((reference) =>
            reference.branchId === branchId && datesByScope[reference.dayScope].includes(date) &&
            (reference.role === undefined || reference.role === role)
          );
          expect(listTemplatesForDate(branch, date, role).map(({ id }) => id).sort(), `${date} ${role}`).toEqual(
            applicable.map(({ id }) => id).sort()
          );
          for (const kind of ['normal', 'partido', 'doblado', 'descanso'] as const) {
            expect(resolveTemplateForDate(branch, date, { role, kind })?.id, `${date} ${role} ${kind}`)
              .toBe(applicable.find((reference) => reference.kind === kind)?.id);
          }
        }
      }
    }
  );
});
