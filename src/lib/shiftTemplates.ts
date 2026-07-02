import { BranchShiftRule, EmployeeType, ShiftTemplateCode } from '../types/payroll';

const makeTemplates = (params: {
  partido: { startTime: string; endTime: string; breakMinutes?: number };
  normal: { startTime: string; endTime: string; breakMinutes?: number };
  doblado: { startTime: string; endTime: string; breakMinutes?: number };
  por_horas: { startTime: string; endTime: string; breakMinutes?: number };
}) => ({
  partido: {
    code: 'partido' as const,
    label: 'Turno Partido',
    startTime: params.partido.startTime,
    endTime: params.partido.endTime,
    breakMinutes: params.partido.breakMinutes ?? 0
  },
  normal: {
    code: 'normal' as const,
    label: 'Turno Normal',
    startTime: params.normal.startTime,
    endTime: params.normal.endTime,
    breakMinutes: params.normal.breakMinutes ?? 0
  },
  doblado: {
    code: 'doblado' as const,
    label: 'Turno Doblado',
    startTime: params.doblado.startTime,
    endTime: params.doblado.endTime,
    breakMinutes: params.doblado.breakMinutes ?? 0
  },
  por_horas: {
    code: 'por_horas' as const,
    label: 'Por horas',
    startTime: params.por_horas.startTime,
    endTime: params.por_horas.endTime,
    breakMinutes: params.por_horas.breakMinutes ?? 0
  }
});

const weekdayList = (...days: number[]) => days;

export const defaultBranchShiftRules: BranchShiftRule[] = [
  {
    id: 'rule-avenida-operativo-all',
    branchId: 'branch-avenida',
    employeeType: 'operativo',
    label: 'Todos los dias',
    weekdays: weekdayList(0, 1, 2, 3, 4, 5, 6),
    defaultTemplate: 'normal',
    templates: makeTemplates({
      partido: { startTime: '11:00', endTime: '22:00', breakMinutes: 240 },
      normal: { startTime: '14:00', endTime: '22:00' },
      doblado: { startTime: '11:00', endTime: '22:00' },
      por_horas: { startTime: '14:00', endTime: '22:00' }
    })
  },
  {
    id: 'rule-avenida-domi-all',
    branchId: 'branch-avenida',
    employeeType: 'domiciliario',
    label: 'Todos los dias',
    weekdays: weekdayList(0, 1, 2, 3, 4, 5, 6),
    defaultTemplate: 'normal',
    templates: makeTemplates({
      partido: { startTime: '12:00', endTime: '22:00', breakMinutes: 180 },
      normal: { startTime: '15:00', endTime: '22:00' },
      doblado: { startTime: '12:00', endTime: '22:00' },
      por_horas: { startTime: '15:00', endTime: '22:00' }
    })
  },
  {
    id: 'rule-unicentro-operativo-ls',
    branchId: 'branch-unicentro',
    employeeType: 'operativo',
    label: 'Lunes a sabado',
    weekdays: weekdayList(1, 2, 3, 4, 5, 6),
    defaultTemplate: 'normal',
    templates: makeTemplates({
      partido: { startTime: '11:00', endTime: '22:00', breakMinutes: 240 },
      normal: { startTime: '14:00', endTime: '22:00' },
      doblado: { startTime: '11:00', endTime: '22:00' },
      por_horas: { startTime: '14:00', endTime: '22:00' }
    })
  },
  {
    id: 'rule-unicentro-operativo-dom',
    branchId: 'branch-unicentro',
    employeeType: 'operativo',
    label: 'Domingo',
    weekdays: weekdayList(0),
    defaultTemplate: 'normal',
    templates: makeTemplates({
      partido: { startTime: '10:00', endTime: '22:00', breakMinutes: 240 },
      normal: { startTime: '14:00', endTime: '22:00' },
      doblado: { startTime: '10:00', endTime: '22:00' },
      por_horas: { startTime: '14:00', endTime: '22:00' }
    })
  },
  {
    id: 'rule-unico-operativo-dj',
    branchId: 'branch-unico',
    employeeType: 'operativo',
    label: 'Domingo a jueves',
    weekdays: weekdayList(0, 1, 2, 3, 4),
    defaultTemplate: 'normal',
    templates: makeTemplates({
      partido: { startTime: '11:00', endTime: '21:00', breakMinutes: 240 },
      normal: { startTime: '14:00', endTime: '21:00' },
      doblado: { startTime: '11:00', endTime: '21:00' },
      por_horas: { startTime: '14:00', endTime: '21:00' }
    })
  },
  {
    id: 'rule-unico-operativo-vs',
    branchId: 'branch-unico',
    employeeType: 'operativo',
    label: 'Viernes y sabado',
    weekdays: weekdayList(5, 6),
    defaultTemplate: 'normal',
    templates: makeTemplates({
      partido: { startTime: '11:00', endTime: '21:30', breakMinutes: 240 },
      normal: { startTime: '14:00', endTime: '21:30' },
      doblado: { startTime: '11:00', endTime: '21:30' },
      por_horas: { startTime: '14:00', endTime: '21:30' }
    })
  }
];

const safeTime = (time: string, fallback: string): string =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : fallback;

const safeBreak = (minutes: number): number => (Number.isFinite(minutes) && minutes >= 0 ? minutes : 0);

export const normalizeShiftRules = (raw: BranchShiftRule[]): BranchShiftRule[] => {
  return (raw ?? []).map((rule) => {
    const templateOrFallback = (code: ShiftTemplateCode, fallback: { startTime: string; endTime: string }) => {
      const fromRule = rule.templates?.[code];
      return {
        code,
        label:
          fromRule?.label ??
          (code === 'partido'
            ? 'Turno Partido'
            : code === 'normal'
              ? 'Turno Normal'
              : code === 'doblado'
                ? 'Turno Doblado'
                : 'Por horas'),
        startTime: safeTime(fromRule?.startTime ?? fallback.startTime, fallback.startTime),
        endTime: safeTime(fromRule?.endTime ?? fallback.endTime, fallback.endTime),
        breakMinutes: safeBreak(fromRule?.breakMinutes ?? 0)
      };
    };

    const fallbackTemplates =
      defaultBranchShiftRules.find((item) => item.id === rule.id)?.templates ??
      makeTemplates({
        partido: { startTime: '11:00', endTime: '22:00', breakMinutes: 240 },
        normal: { startTime: '14:00', endTime: '22:00' },
        doblado: { startTime: '11:00', endTime: '22:00' },
        por_horas: { startTime: '14:00', endTime: '22:00' }
      });

    return {
      ...rule,
      employeeType: (rule.employeeType ?? 'operativo') as EmployeeType,
      weekdays:
        Array.isArray(rule.weekdays) && rule.weekdays.length > 0
          ? rule.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
          : [0, 1, 2, 3, 4, 5, 6],
      defaultTemplate:
        rule.defaultTemplate === 'partido' ||
        rule.defaultTemplate === 'normal' ||
        rule.defaultTemplate === 'doblado' ||
        rule.defaultTemplate === 'por_horas'
          ? rule.defaultTemplate
          : 'normal',
      templates: {
        partido: templateOrFallback('partido', fallbackTemplates.partido),
        normal: templateOrFallback('normal', fallbackTemplates.normal),
        doblado: templateOrFallback('doblado', fallbackTemplates.doblado),
        por_horas: templateOrFallback('por_horas', fallbackTemplates.por_horas)
      }
    };
  });
};

export const getRuleForDate = (params: {
  rules: BranchShiftRule[];
  branchId: string;
  employeeType: EmployeeType;
  dateISO: string;
}): BranchShiftRule | undefined => {
  const date = new Date(`${params.dateISO}T12:00:00`);
  const weekday = date.getDay();

  const match = (employeeType: EmployeeType) =>
    params.rules.find(
      (rule) =>
        rule.branchId === params.branchId &&
        rule.employeeType === employeeType &&
        rule.weekdays.includes(weekday)
    );

  // Fallback: si no hay regla específica para domiciliario, usar operativo.
  return match(params.employeeType) ?? (params.employeeType === 'domiciliario' ? match('operativo') : undefined);
};

export const buildRuleSummaryLabel = (rule: BranchShiftRule) => {
  const weekdayText = rule.weekdays
    .slice()
    .sort((a, b) => a - b)
    .map((value) => ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'][value])
    .join(', ');

  return `${rule.label} (${weekdayText})`;
};
