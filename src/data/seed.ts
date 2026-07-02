import {
  Branch,
  Company,
  Employee,
  EmployeePayType,
  EmployeeType,
  PayPeriod,
  PayrollNominaConfig,
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
    defaultStartTime: '11:00',
    defaultEndTime: '22:00',
    timezone: 'America/Bogota'
  },
  {
    id: 'branch-unico',
    companyId: seededCompany.id,
    name: 'Único',
    defaultStartTime: '11:00',
    defaultEndTime: '21:00',
    timezone: 'America/Bogota'
  },
  {
    id: 'branch-avenida',
    companyId: seededCompany.id,
    name: 'Avenida',
    defaultStartTime: '11:00',
    defaultEndTime: '22:00',
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

export const defaultNominaConfig: PayrollNominaConfig = {
  salarioMinimoMensual: 1423500,
  auxilioTransporteMensual: 200000,
  horasMensualesBase: 220,
  diasMesBase: 30,
  usarUmbralAuxilio: false,
  umbralMultiploSMMLV: 2,
  porcentajeSaludEmpleado: 0.04,
  porcentajePensionEmpleado: 0.04,
  baseDeduccionesIncluyeAuxilio: false,
  baseDeduccionesIncluyeExtras: true,
  redondearAPesos: true
};

const makeEmployee = (
  id: string,
  fullName: string,
  branchId: string,
  payType: EmployeePayType,
  employeeType: EmployeeType,
  salary: number,
  documentId: string,
  customHourlyRate?: number
): Employee => ({
  id,
  companyId: seededCompany.id,
  branchId,
  branchHistory: [{ branchId, fromDate: '2026-01-01' }],
  fullName,
  documentId,
  baseMonthlySalary: salary,
  payType,
  employeeType,
  baseTemplateWeekday: 'normal',
  baseTemplateWeekend: 'normal',
  applyTransportAllowance: true,
  applyHealthPension: true,
  customHourlyRate,
  active: true
});

export const seededEmployees: Employee[] = [
  makeEmployee('emp-1', 'Laura Martínez', 'branch-unicentro', 'mensual_fijo', 'operativo', 1650000, '10101010'),
  makeEmployee('emp-2', 'Juan Camilo Rojas', 'branch-unico', 'mensual_fijo', 'domiciliario', 1550000, '20202020'),
  makeEmployee('emp-3', 'Valentina Pérez', 'branch-avenida', 'mensual_fijo', 'operativo', 1700000, '30303030'),
  makeEmployee('emp-4', 'Andrés Gómez', 'branch-unicentro', 'mensual_fijo', 'operativo', 1800000, '40404040'),
  makeEmployee('emp-5', 'María Fernanda Díaz', 'branch-unico', 'mensual_fijo', 'domiciliario', 1500000, '50505050', 7200),
  makeEmployee('emp-6', 'Camilo Torres', 'branch-avenida', 'mensual_fijo', 'operativo', 1450000, '60606060'),
  makeEmployee('emp-7', 'Natalia Cifuentes', 'branch-unicentro', 'mensual_fijo', 'operativo', 1900000, '70707070'),
  makeEmployee('emp-8', 'Sergio Pardo', 'branch-unico', 'mensual_fijo', 'domiciliario', 1600000, '80808080'),
  makeEmployee('emp-9', 'Daniela Rincón', 'branch-avenida', 'mensual_fijo', 'operativo', 1750000, '90909090'),
  makeEmployee('emp-10', 'Julián Suárez', 'branch-unicentro', 'mensual_fijo', 'operativo', 2000000, '100100100')
];

// Ejemplo de rotación con histórico de sede
seededEmployees[0].branchId = 'branch-unico';
seededEmployees[0].branchHistory = [
  { branchId: 'branch-unicentro', fromDate: '2025-10-01', toDate: '2025-12-31' },
  { branchId: 'branch-unico', fromDate: '2026-01-01' }
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

const periodId = 'period-2026-01-1';

export const seededShifts: Shift[] = [
  { id: 's-1', employeeId: 'emp-1', payPeriodId: periodId, date: '2026-01-01', startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
  { id: 's-2', employeeId: 'emp-1', payPeriodId: periodId, date: '2026-01-04', startTime: '09:00', endTime: '19:00', breakMinutes: 60 },
  { id: 's-3', employeeId: 'emp-2', payPeriodId: periodId, date: '2026-01-03', startTime: '20:00', endTime: '04:00', breakMinutes: 30 },
  { id: 's-4', employeeId: 'emp-2', payPeriodId: periodId, date: '2026-01-06', startTime: '12:00', endTime: '22:30', breakMinutes: 60 },
  { id: 's-5', employeeId: 'emp-3', payPeriodId: periodId, date: '2026-01-04', startTime: '10:00', endTime: '18:00', breakMinutes: 30 },
  { id: 's-6', employeeId: 'emp-3', payPeriodId: periodId, date: '2026-01-07', startTime: '08:00', endTime: '19:00', breakMinutes: 60 },
  { id: 's-7', employeeId: 'emp-4', payPeriodId: periodId, date: '2026-01-05', startTime: '09:00', endTime: '18:00', breakMinutes: 60 },
  { id: 's-8', employeeId: 'emp-4', payPeriodId: periodId, date: '2026-01-11', startTime: '15:00', endTime: '23:00', breakMinutes: 30 },
  { id: 's-9', employeeId: 'emp-5', payPeriodId: periodId, date: '2026-01-02', startTime: '08:00', endTime: '17:30', breakMinutes: 60 },
  { id: 's-10', employeeId: 'emp-5', payPeriodId: periodId, date: '2026-01-03', startTime: '14:00', endTime: '23:00', breakMinutes: 45 },
  { id: 's-11', employeeId: 'emp-6', payPeriodId: periodId, date: '2026-01-08', startTime: '10:00', endTime: '20:00', breakMinutes: 60 },
  { id: 's-12', employeeId: 'emp-6', payPeriodId: periodId, date: '2026-01-10', startTime: '20:30', endTime: '05:00', breakMinutes: 30 },
  { id: 's-13', employeeId: 'emp-7', payPeriodId: periodId, date: '2026-01-04', startTime: '08:00', endTime: '16:00', breakMinutes: 30 },
  { id: 's-14', employeeId: 'emp-7', payPeriodId: periodId, date: '2026-01-09', startTime: '09:00', endTime: '21:30', breakMinutes: 60 },
  { id: 's-15', employeeId: 'emp-8', payPeriodId: periodId, date: '2026-01-12', startTime: '11:00', endTime: '20:00', breakMinutes: 45 },
  { id: 's-16', employeeId: 'emp-8', payPeriodId: periodId, date: '2026-01-13', startTime: '18:00', endTime: '02:00', breakMinutes: 30 },
  { id: 's-17', employeeId: 'emp-9', payPeriodId: periodId, date: '2026-01-11', startTime: '10:00', endTime: '19:00', breakMinutes: 60 },
  { id: 's-18', employeeId: 'emp-9', payPeriodId: periodId, date: '2026-01-14', startTime: '08:00', endTime: '18:30', breakMinutes: 60 },
  { id: 's-19', employeeId: 'emp-10', payPeriodId: periodId, date: '2026-01-05', startTime: '09:00', endTime: '18:00', breakMinutes: 60 },
  { id: 's-20', employeeId: 'emp-10', payPeriodId: periodId, date: '2026-01-15', startTime: '12:00', endTime: '22:00', breakMinutes: 60 }
];
