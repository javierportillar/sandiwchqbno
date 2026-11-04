import { defaultSettings, seededBranches } from '../data/seed';
import { calculateShiftTotals } from '../lib/calculation';
import { resolveTemplateForDate } from '../lib/templates';
import type {
  DayScope,
  EmployeeRole,
  HourTotals,
  Shift,
  ShiftKind
} from '../types/payroll';

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

type PayrollBreakdownCase = {
  name: string;
  branchId: string;
  date: string;
  kind: Exclude<ShiftKind, 'descanso'>;
  role?: EmployeeRole;
  expectedTemplateId: string;
  expectedKind: Exclude<ShiftKind, 'descanso'>;
  expectedDayScope: DayScope;
  expectedRole?: EmployeeRole;
  expected: Partial<HourTotals>;
};

const payrollBreakdownCases: PayrollBreakdownCase[] = [
  {
    name: 'Avenida Sala Partido',
    branchId: 'branch-avenida',
    role: 'sala',
    kind: 'partido',
    date: '2026-01-05', // Monday
    expectedTemplateId: 'avenida-sala-partido',
    expectedKind: 'partido',
    expectedDayScope: 'all',
    expectedRole: 'sala',
    expected: { ORD: 4, RN: 3 }
  },
  {
    name: 'Avenida Sala Normal',
    branchId: 'branch-avenida',
    role: 'sala',
    kind: 'normal',
    date: '2026-01-05',
    expectedTemplateId: 'avenida-sala-normal',
    expectedKind: 'normal',
    expectedDayScope: 'all',
    expectedRole: 'sala',
    expected: { ORD: 5, RN: 2, HEN: 1 }
  },
  {
    name: 'Avenida Sala Doblado',
    branchId: 'branch-avenida',
    role: 'sala',
    kind: 'doblado',
    date: '2026-01-05',
    expectedTemplateId: 'avenida-sala-doblado',
    expectedKind: 'doblado',
    expectedDayScope: 'all',
    expectedRole: 'sala',
    expected: { ORD: 7, HED: 1, HEN: 3 }
  },
  {
    name: 'Avenida Domicilio Partido',
    branchId: 'branch-avenida',
    role: 'domicilio',
    kind: 'partido',
    date: '2026-01-05',
    expectedTemplateId: 'avenida-domi-partido',
    expectedKind: 'partido',
    expectedDayScope: 'all',
    expectedRole: 'domicilio',
    expected: { ORD: 4, RN: 3 }
  },
  {
    name: 'Avenida Domicilio Normal',
    branchId: 'branch-avenida',
    role: 'domicilio',
    kind: 'normal',
    date: '2026-01-05',
    expectedTemplateId: 'avenida-domi-normal',
    expectedKind: 'normal',
    expectedDayScope: 'all',
    expectedRole: 'domicilio',
    expected: { ORD: 4, RN: 3 }
  },
  {
    name: 'Avenida Domicilio Doblado',
    branchId: 'branch-avenida',
    role: 'domicilio',
    kind: 'doblado',
    date: '2026-01-05',
    expectedTemplateId: 'avenida-domi-doblado',
    expectedKind: 'doblado',
    expectedDayScope: 'all',
    expectedRole: 'domicilio',
    expected: { ORD: 7, HEN: 3 }
  },
  {
    name: 'Unicentro Mon-Sat Partido',
    branchId: 'branch-unicentro',
    kind: 'partido',
    date: '2026-01-05',
    expectedTemplateId: 'unicentro-ls-partido',
    expectedKind: 'partido',
    expectedDayScope: 'mon-sat',
    expected: { ORD: 4, RN: 3 }
  },
  {
    name: 'Unicentro Mon-Sat Normal',
    branchId: 'branch-unicentro',
    kind: 'normal',
    date: '2026-01-05',
    expectedTemplateId: 'unicentro-ls-normal',
    expectedKind: 'normal',
    expectedDayScope: 'mon-sat',
    expected: { ORD: 5, RN: 2, HEN: 1 }
  },
  {
    name: 'Unicentro Mon-Sat Doblado',
    branchId: 'branch-unicentro',
    kind: 'doblado',
    date: '2026-01-05',
    expectedTemplateId: 'unicentro-ls-doblado',
    expectedKind: 'doblado',
    expectedDayScope: 'mon-sat',
    expected: { ORD: 7, HED: 1, HEN: 3 }
  },
  {
    name: 'Unicentro Sunday Partido',
    branchId: 'branch-unicentro',
    kind: 'partido',
    date: '2026-01-04', // Sunday
    expectedTemplateId: 'unicentro-dom-partido',
    expectedKind: 'partido',
    expectedDayScope: 'sun',
    expected: { DOM08: 5, RN_DOM: 2, HEN_DOM: 1 }
  },
  {
    name: 'Unicentro Sunday Normal',
    branchId: 'branch-unicentro',
    kind: 'normal',
    date: '2026-01-04',
    expectedTemplateId: 'unicentro-dom-normal',
    expectedKind: 'normal',
    expectedDayScope: 'sun',
    expected: { DOM08: 5, RN_DOM: 2, HEN_DOM: 1 }
  },
  {
    name: 'Unicentro Sunday Doblado',
    branchId: 'branch-unicentro',
    kind: 'doblado',
    date: '2026-01-04',
    expectedTemplateId: 'unicentro-dom-doblado',
    expectedKind: 'doblado',
    expectedDayScope: 'sun',
    expected: { DOM08: 7, HED_DOM: 2, HEN_DOM: 3 }
  },
  {
    name: 'Único Sun-Thu Partido',
    branchId: 'branch-unico',
    kind: 'partido',
    date: '2026-01-05',
    expectedTemplateId: 'unico-dj-partido',
    expectedKind: 'partido',
    expectedDayScope: 'sun-thu',
    expected: { ORD: 4, RN: 2 }
  },
  {
    name: 'Único Sun-Thu Normal',
    branchId: 'branch-unico',
    kind: 'normal',
    date: '2026-01-05',
    expectedTemplateId: 'unico-dj-normal',
    expectedKind: 'normal',
    expectedDayScope: 'sun-thu',
    expected: { ORD: 5, RN: 2 }
  },
  {
    name: 'Único Sun-Thu Doblado',
    branchId: 'branch-unico',
    kind: 'doblado',
    date: '2026-01-05',
    expectedTemplateId: 'unico-dj-doblado',
    expectedKind: 'doblado',
    expectedDayScope: 'sun-thu',
    expected: { ORD: 7, HED: 1, HEN: 2 }
  },
  {
    name: 'Único Fri-Sat Partido',
    branchId: 'branch-unico',
    kind: 'partido',
    date: '2026-01-09', // Friday
    expectedTemplateId: 'unico-vs-partido',
    expectedKind: 'partido',
    expectedDayScope: 'fri-sat',
    expected: { ORD: 4, RN: 2.5 }
  },
  {
    name: 'Único Fri-Sat Normal',
    branchId: 'branch-unico',
    kind: 'normal',
    date: '2026-01-09',
    expectedTemplateId: 'unico-vs-normal',
    expectedKind: 'normal',
    expectedDayScope: 'fri-sat',
    expected: { ORD: 5, RN: 2, HEN: 0.5 }
  },
  {
    name: 'Único Fri-Sat Doblado',
    branchId: 'branch-unico',
    kind: 'doblado',
    date: '2026-01-09',
    expectedTemplateId: 'unico-vs-doblado',
    expectedKind: 'doblado',
    expectedDayScope: 'fri-sat',
    expected: { ORD: 7, HED: 1, HEN: 2.5 }
  }
];

const shiftFromTemplate = (
  templateId: string,
  date: string,
  startTime: string,
  endTime: string,
  secondStart: string | undefined,
  secondEnd: string | undefined,
  breakMinutes: number
): Shift => ({
  id: `f5-${templateId}`,
  employeeId: 'f5-employee',
  payPeriodId: 'f5-period',
  date,
  startTime,
  endTime,
  secondStart,
  secondEnd,
  breakMinutes,
  templateId
});

describe('desgloses de nómina de las plantillas del README 4.2', () => {
  it.each(payrollBreakdownCases)(
    '$name',
    ({
      branchId,
      date,
      kind,
      role,
      expectedTemplateId,
      expectedKind,
      expectedDayScope,
      expectedRole,
      expected
    }) => {
      const branch = seededBranches.find((item) => item.id === branchId);
      expect(branch).toBeDefined();

      const template = resolveTemplateForDate(branch, date, { kind, role });
      expect(template).toBeDefined();
      expect(template).toMatchObject({
        id: expectedTemplateId,
        kind: expectedKind,
        dayScope: expectedDayScope
      });
      if (expectedRole) expect(template!.role).toBe(expectedRole);

      const shift = shiftFromTemplate(
        template!.id,
        date,
        template!.startTime,
        template!.endTime,
        template!.secondStart,
        template!.secondEnd,
        template!.breakMinutes
      );

      expect(calculateShiftTotals(shift, defaultSettings)).toEqual({
        ...ZERO_TOTALS,
        ...expected
      });
    }
  );

  it('reclasifica el festivo del 2 de noviembre en la semana de Cecilia sin alterar las 71 horas', () => {
    const schedule = [
      ['2026-11-02', '11:00', '21:00'],
      ['2026-11-03', '11:00', '21:00'],
      ['2026-11-04', '11:00', '21:00'],
      ['2026-11-05', '11:00', '21:00'],
      ['2026-11-06', '11:00', '21:30'],
      ['2026-11-07', '11:00', '21:30'],
      ['2026-11-08', '11:00', '21:00']
    ] as const;
    const totals = schedule.reduce((sum, [date, startTime, endTime], index) => {
      const shift: Shift = {
        id: `cecilia-${index}`,
        employeeId: 'cecilia',
        payPeriodId: 'november-period',
        date,
        startTime,
        endTime,
        breakMinutes: 0
      };
      const day = calculateShiftTotals(shift, defaultSettings);
      for (const key of Object.keys(sum) as Array<keyof HourTotals>) sum[key] += day[key];
      return sum;
    }, { ...ZERO_TOTALS });

    expect(totals).toEqual({
      ...ZERO_TOTALS,
      ORD: 35,
      HED: 5,
      HEN: 11,
      DOM08: 14,
      HED_DOM: 2,
      HEN_DOM: 4
    });
    expect(Object.values(totals).reduce((hours, value) => hours + value, 0)).toBe(71);
  });
});
