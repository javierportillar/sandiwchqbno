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
    timezone: 'America/Bogota'
  },
  {
    id: 'branch-unico',
    companyId: seededCompany.id,
    name: 'Único',
    defaultStartTime: '09:00',
    defaultEndTime: '18:00',
    timezone: 'America/Bogota'
  },
  {
    id: 'branch-avenida',
    companyId: seededCompany.id,
    name: 'Avenida',
    defaultStartTime: '10:00',
    defaultEndTime: '19:00',
    timezone: 'America/Bogota'
  }
];

export const defaultSettings: PayrollSettings = {
  nocturnalStart: '19:00',
  nocturnalEnd: '06:00',
  dailyOrdinaryHours: 8,
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
    active: true
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
