import {
  aggregateDailyAndPeriod,
  applyOrdinaryVsExtra,
  classifySegments,
  splitShiftIntoSegments
} from '../lib/calculation';
import { defaultSettings, seededEmployees } from '../data/seed';
import { Shift } from '../types/payroll';

describe('motor de cálculo de nómina', () => {
  it('splitShiftIntoSegments divide turnos cruzando medianoche', () => {
    const shift: Shift = {
      id: 's1',
      employeeId: 'emp-1',
      payPeriodId: 'period-1',
      date: '2026-01-03',
      startTime: '20:00',
      endTime: '04:00',
      breakMinutes: 0
    };

    const segments = splitShiftIntoSegments(shift, defaultSettings);
    const totalHours = segments.reduce((sum, segment) => sum + segment.minutes / 60, 0);

    expect(segments.length).toBeGreaterThan(1);
    expect(totalHours).toBe(8);
  });

  it('classifySegments detecta RN para franjas nocturnas no dominicales', () => {
    const shift: Shift = {
      id: 's2',
      employeeId: 'emp-1',
      payPeriodId: 'period-1',
      date: '2026-01-02',
      startTime: '20:00',
      endTime: '22:00',
      breakMinutes: 0
    };

    const classified = classifySegments(splitShiftIntoSegments(shift, defaultSettings));
    const totals = applyOrdinaryVsExtra(classified, defaultSettings);

    expect(totals.ORD).toBe(0);
    expect(totals.RN).toBe(2);
  });

  it('applyOrdinaryVsExtra mueve excedentes a HED/HEN según corresponda', () => {
    const shift: Shift = {
      id: 's3',
      employeeId: 'emp-1',
      payPeriodId: 'period-1',
      date: '2026-01-01',
      startTime: '08:00',
      endTime: '20:00',
      breakMinutes: 0
    };

    const totals = applyOrdinaryVsExtra(
      classifySegments(splitShiftIntoSegments(shift, defaultSettings)),
      defaultSettings
    );

    // Jornada ordinaria 7h/día (pptx). 08:00-19:00 = 11h diurnas → 7 ORD + 4 HED.
    // 19:00-20:00 = 1h nocturna, ya sin cupo ordinario → 1 HEN.
    expect(totals.ORD).toBe(7);
    expect(totals.RN).toBe(0);
    expect(totals.HED).toBe(4);
    expect(totals.HEN).toBe(1);
  });

  it('turno partido con secondStart/secondEnd explícitos', () => {
    const shift: Shift = {
      id: 's10',
      employeeId: 'emp-1',
      payPeriodId: 'period-1',
      date: '2026-01-05',
      startTime: '11:00',
      endTime: '14:00',
      secondStart: '18:00',
      secondEnd: '22:00',
      breakMinutes: 0,
      templateId: 'partido'
    };

    const totals = applyOrdinaryVsExtra(
      classifySegments(splitShiftIntoSegments(shift, defaultSettings)),
      defaultSettings
    );

    // bloque1: 11-14(3h diurno) → ORD; bloque2: 18-19(1h diurno) → ORD, 19-22(3h noct) → RN
    expect(totals.ORD).toBe(4);
    expect(totals.RN).toBe(3);
    expect(totals.HED).toBe(0);
    expect(totals.HEN).toBe(0);
  });

  it('turno partido legacy sin secondStart/secondEnd usa heurístico', () => {
    const shift: Shift = {
      id: 's11',
      employeeId: 'emp-1',
      payPeriodId: 'period-1',
      date: '2026-01-05',
      startTime: '11:00',
      endTime: '22:00',
      breakMinutes: 240,
      templateId: 'partido'
    };

    const totals = applyOrdinaryVsExtra(
      classifySegments(splitShiftIntoSegments(shift, defaultSettings)),
      defaultSettings
    );

    expect(totals.ORD).toBe(4);
    expect(totals.RN).toBe(3);
    expect(totals.HED).toBe(0);
    expect(totals.HEN).toBe(0);
  });

  it('aggregateDailyAndPeriod acumula por empleado', () => {
    const shifts: Shift[] = [
      {
        id: 's4',
        employeeId: seededEmployees[0].id,
        payPeriodId: 'period-1',
        date: '2026-01-01',
        startTime: '08:00',
        endTime: '17:00',
        breakMinutes: 60
      },
      {
        id: 's5',
        employeeId: seededEmployees[0].id,
        payPeriodId: 'period-1',
        date: '2026-01-02',
        startTime: '12:00',
        endTime: '22:00',
        breakMinutes: 60
      }
    ];

    const result = aggregateDailyAndPeriod({
      shifts,
      employees: seededEmployees,
      settings: defaultSettings,
      periodId: 'period-1',
      adjustments: {
        [seededEmployees[0].id]: 1000
      }
    });

    const summary = result.summaries.find((item) => item.employeeId === seededEmployees[0].id);
    expect(summary).toBeDefined();
    expect(summary!.totals.ORD + summary!.totals.RN + summary!.totals.HED).toBeGreaterThan(0);
    expect(summary!.finalTotal).toBe(summary!.totalExtras + 1000);
  });
});
