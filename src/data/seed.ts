import {
  Branch,
  Company,
  Employee,
  PayPeriod,
  PayrollSettings,
  Shift
} from '../types/payroll';

export const seededCompany: Company = {
  id: 'company-qbano',
  name: 'Sandwich Qbano'
};

export const seededBranches: Branch[] = [
  {
    id: 'branch-unicentro',
    companyId: seededCompany.id,
    name: 'Unicentro',
    defaultStartTime: '08:00',
    defaultEndTime: '17:00',
    timezone: 'America/Bogota',
    shiftTemplates: [
      {
        id: 'unicentro-ls-normal',
        kind: 'normal',
        label: 'Normal L-S',
        startTime: '14:00',
        endTime: '22:00',
        breakMinutes: 0,
        dayScope: 'mon-sat'
      },
      {
        id: 'unicentro-ls-partido',
        kind: 'partido',
        label: 'Partido L-S',
        startTime: '11:00',
        endTime: '14:00',
        secondStart: '18:00',
        secondEnd: '22:00',
        breakMinutes: 0,
        dayScope: 'mon-sat'
      },
      {
        id: 'unicentro-ls-doblado',
        kind: 'doblado',
        label: 'Doblado L-S',
        startTime: '11:00',
        endTime: '22:00',
        breakMinutes: 0,
        dayScope: 'mon-sat'
      },
      {
        id: 'unicentro-dom-normal',
        kind: 'normal',
        label: 'Normal DOM',
        startTime: '14:00',
        endTime: '22:00',
        breakMinutes: 0,
        dayScope: 'sun'
      },
      {
        id: 'unicentro-dom-partido',
        kind: 'partido',
        label: 'Partido DOM',
        startTime: '10:00',
        endTime: '14:00',
        secondStart: '18:00',
        secondEnd: '22:00',
        breakMinutes: 0,
        dayScope: 'sun'
      },
      {
        id: 'unicentro-dom-doblado',
        kind: 'doblado',
        label: 'Doblado DOM',
        startTime: '10:00',
        endTime: '22:00',
        breakMinutes: 0,
        dayScope: 'sun'
      }
    ]
  },
  {
    id: 'branch-unico',
    companyId: seededCompany.id,
    name: 'Único',
    defaultStartTime: '09:00',
    defaultEndTime: '18:00',
    timezone: 'America/Bogota',
    shiftTemplates: [
      {
        id: 'unico-dj-normal',
        kind: 'normal',
        label: 'Normal DOM-JUE',
        startTime: '14:00',
        endTime: '21:00',
        breakMinutes: 0,
        dayScope: 'sun-thu'
      },
      {
        id: 'unico-dj-partido',
        kind: 'partido',
        label: 'Partido DOM-JUE',
        startTime: '11:00',
        endTime: '14:00',
        secondStart: '18:00',
        secondEnd: '21:00',
        breakMinutes: 0,
        dayScope: 'sun-thu'
      },
      {
        id: 'unico-dj-doblado',
        kind: 'doblado',
        label: 'Doblado DOM-JUE',
        startTime: '11:00',
        endTime: '21:00',
        breakMinutes: 0,
        dayScope: 'sun-thu'
      },
      {
        id: 'unico-vs-normal',
        kind: 'normal',
        label: 'Normal VIE-SÁB',
        startTime: '14:00',
        endTime: '21:30',
        breakMinutes: 0,
        dayScope: 'fri-sat'
      },
      {
        id: 'unico-vs-partido',
        kind: 'partido',
        label: 'Partido VIE-SÁB',
        startTime: '11:00',
        endTime: '14:00',
        secondStart: '18:00',
        secondEnd: '21:30',
        breakMinutes: 0,
        dayScope: 'fri-sat'
      },
      {
        id: 'unico-vs-doblado',
        kind: 'doblado',
        label: 'Doblado VIE-SÁB',
        startTime: '11:00',
        endTime: '21:30',
        breakMinutes: 0,
        dayScope: 'fri-sat'
      }
    ]
  },
  {
    id: 'branch-avenida',
    companyId: seededCompany.id,
    name: 'Avenida',
    defaultStartTime: '10:00',
    defaultEndTime: '19:00',
    timezone: 'America/Bogota',
    shiftTemplates: [
      {
        id: 'avenida-sala-normal',
        kind: 'normal',
        label: 'Normal Sala',
        startTime: '14:00',
        endTime: '22:00',
        breakMinutes: 0,
        dayScope: 'all',
        role: 'sala'
      },
      {
        id: 'avenida-sala-partido',
        kind: 'partido',
        label: 'Partido Sala',
        startTime: '11:00',
        endTime: '14:00',
        secondStart: '18:00',
        secondEnd: '22:00',
        breakMinutes: 0,
        dayScope: 'all',
        role: 'sala'
      },
      {
        id: 'avenida-sala-doblado',
        kind: 'doblado',
        label: 'Doblado Sala',
        startTime: '11:00',
        endTime: '22:00',
        breakMinutes: 0,
        dayScope: 'all',
        role: 'sala'
      },
      {
        id: 'avenida-domi-normal',
        kind: 'normal',
        label: 'Normal Domicilio',
        startTime: '15:00',
        endTime: '22:00',
        breakMinutes: 0,
        dayScope: 'all',
        role: 'domicilio'
      },
      {
        id: 'avenida-domi-partido',
        kind: 'partido',
        label: 'Partido Domicilio',
        startTime: '12:00',
        endTime: '15:00',
        secondStart: '18:00',
        secondEnd: '22:00',
        breakMinutes: 0,
        dayScope: 'all',
        role: 'domicilio'
      },
      {
        id: 'avenida-domi-doblado',
        kind: 'doblado',
        label: 'Doblado Domicilio',
        startTime: '12:00',
        endTime: '22:00',
        breakMinutes: 0,
        dayScope: 'all',
        role: 'domicilio'
      }
    ]
  }
];

export const defaultSettings: PayrollSettings = {
  nocturnalStart: '19:00',
  nocturnalEnd: '06:00',
  dailyOrdinaryHours: 7,
  weeklyOrdinaryHours: 46,
  monthlyHoursBase: 220,
  multipliers: {
    RN: 0.35,
    HED: 0.25,
    HEN: 0.75,
    DOM_DIURNO: 0.8,
    DOM_NOCT: 1.8,
    RN_DOM: 1.15,
    HED_DOM: 2.05,
    HEN_DOM: 2.55
  }
};

export const seededEmployees: Employee[] = [
  {
    id: 'emp-1',
    companyId: seededCompany.id,
    branchId: 'branch-unicentro',
    fullName: 'Laura Martínez',
    documentId: '10101010',
    baseMonthlySalary: 1650000,
    active: true
  },
  {
    id: 'emp-2',
    companyId: seededCompany.id,
    branchId: 'branch-unico',
    fullName: 'Juan Camilo Rojas',
    documentId: '20202020',
    baseMonthlySalary: 1550000,
    active: true
  },
  {
    id: 'emp-3',
    companyId: seededCompany.id,
    branchId: 'branch-avenida',
    fullName: 'Valentina Pérez',
    documentId: '30303030',
    baseMonthlySalary: 1700000,
    active: true,
    role: 'sala'
  }
];

export const seededPayPeriods: PayPeriod[] = [
  {
    id: 'period-2026-01-1',
    companyId: seededCompany.id,
    startDate: '2026-01-01',
    endDate: '2026-01-15',
    label: '2026-01-01 a 2026-01-15'
  }
];

export const seededShifts: Shift[] = [
  {
    id: 's-1',
    employeeId: 'emp-1',
    payPeriodId: 'period-2026-01-1',
    date: '2026-01-01',
    startTime: '08:00',
    endTime: '17:00',
    breakMinutes: 60
  },
  {
    id: 's-2',
    employeeId: 'emp-1',
    payPeriodId: 'period-2026-01-1',
    date: '2026-01-02',
    startTime: '12:00',
    endTime: '22:00',
    breakMinutes: 60
  },
  {
    id: 's-3',
    employeeId: 'emp-2',
    payPeriodId: 'period-2026-01-1',
    date: '2026-01-03',
    startTime: '20:00',
    endTime: '04:00',
    breakMinutes: 30
  },
  {
    id: 's-4',
    employeeId: 'emp-3',
    payPeriodId: 'period-2026-01-1',
    date: '2026-01-04',
    startTime: '09:00',
    endTime: '19:00',
    breakMinutes: 60
  }
];
