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

    expect(totals.ORD).toBe(8);
    expect(totals.RN).toBe(0);
    expect(totals.HED).toBe(3);
    expect(totals.HEN).toBe(1);
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

  it('trata festivos como dominical para recargos', () => {
    const shifts: Shift[] = [
      {
        id: 's6',
        employeeId: seededEmployees[0].id,
        payPeriodId: 'period-2',
        date: '2026-01-01',
        startTime: '08:00',
        endTime: '12:00',
        breakMinutes: 0
      }
    ];

    const result = aggregateDailyAndPeriod({
      shifts,
      employees: seededEmployees,
      settings: defaultSettings,
      periodId: 'period-2',
      adjustments: {},
      holidayDates: ['2026-01-01']
    });

    const summary = result.summaries.find((item) => item.employeeId === seededEmployees[0].id);
    expect(summary).toBeDefined();
    expect(summary!.totals.DOM08).toBe(4);
    expect(summary!.totals.ORD).toBe(0);
  });

  it('aplica regla de turno partido como dos bloques reales de trabajo', () => {
    const shift: Shift = {
      id: 's7',
      employeeId: 'emp-1',
      payPeriodId: 'period-3',
      date: '2026-01-05',
      startTime: '11:00',
      endTime: '22:00',
      breakMinutes: 240,
      templateCode: 'partido'
    };

    const totals = applyOrdinaryVsExtra(
      classifySegments(splitShiftIntoSegments(shift, defaultSettings)),
      defaultSettings
    );

    // 11:00-14:00 + 18:00-22:00 = 7h trabajadas (4 diurnas + 3 nocturnas)
    expect(totals.ORD).toBe(4);
    expect(totals.RN).toBe(3);
    expect(totals.HED).toBe(0);
    expect(totals.HEN).toBe(0);
  });
});
