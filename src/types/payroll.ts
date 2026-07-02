export type BranchName = 'Unicentro' | 'Único' | 'Avenida';
export type EmployeePayType = 'mensual_fijo' | 'por_horas' | 'por_dias';
export type EmployeeType = 'operativo' | 'domiciliario';
export type ShiftTemplateCode = 'partido' | 'normal' | 'doblado' | 'por_horas';

export interface Company {
  id: string;
  name: string;
}

export interface Branch {
  id: string;
  companyId: string;
  name: BranchName;
  defaultStartTime: string;
  defaultEndTime: string;
  timezone: 'America/Bogota';
}

export interface EmployeeBranchHistoryItem {
  branchId: string;
  fromDate: string;
  toDate?: string;
}

export interface Employee {
  id: string;
  companyId: string;
  branchId: string;
  branchHistory: EmployeeBranchHistoryItem[];
  fullName: string;
  documentId?: string;
  baseMonthlySalary: number;
  payType: EmployeePayType;
  employeeType: EmployeeType;
  baseTemplateWeekday?: ShiftTemplateCode;
  baseTemplateWeekend?: ShiftTemplateCode;
  applyTransportAllowance: boolean;
  applyHealthPension: boolean;
  customHourlyRate?: number;
  active: boolean;
}

export interface PayPeriod {
  id: string;
  companyId: string;
  startDate: string;
  endDate: string;
  label: string;
}

export interface Shift {
  id: string;
  employeeId: string;
  payPeriodId: string;
  date: string;
  startTime?: string;
  endTime?: string;
  breakMinutes: number;
  notes?: string;
  overrideBranchId?: string;
  templateCode?: ShiftTemplateCode;
  restDay?: boolean;
}

export interface ShiftTemplateDefinition {
  code: ShiftTemplateCode;
  label: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
}

export interface BranchShiftRule {
  id: string;
  branchId: string;
  employeeType: EmployeeType;
  label: string;
  weekdays: number[];
  defaultTemplate: ShiftTemplateCode;
  templates: Record<ShiftTemplateCode, ShiftTemplateDefinition>;
}

export interface ComputedDayBreakdown {
  shiftId: string;
  ordHours: number;
  rnHours: number;
  hedHours: number;
  henHours: number;
  dom08Hours: number;
  dom18Hours: number;
  rnDomHours: number;
  hedDomHours: number;
  henDomHours: number;
  rawSegmentsJSON: string;
}

export interface PayrollSettings {
  nocturnalStart: string;
  nocturnalEnd: string;
  dailyOrdinaryHours: number;
  weeklyOrdinaryHours: number;
  monthlyHoursBase: number;
  multipliers: {
    RN: number;
    HED: number;
    HEN: number;
    DOM_DIURNO: number;
    DOM_NOCT: number;
    RN_DOM: number;
    HED_DOM: number;
    HEN_DOM: number;
  };
}

export interface PayrollNominaConfig {
  salarioMinimoMensual: number;
  auxilioTransporteMensual: number;
  horasMensualesBase: number;
  diasMesBase: number;
  usarUmbralAuxilio: boolean;
  umbralMultiploSMMLV: number;
  porcentajeSaludEmpleado: number;
  porcentajePensionEmpleado: number;
  baseDeduccionesIncluyeAuxilio: boolean;
  baseDeduccionesIncluyeExtras: boolean;
  redondearAPesos: boolean;
}

export interface HourTotals {
  ORD: number;
  RN: number;
  HED: number;
  HEN: number;
  DOM08: number;
  DOM18: number;
  RN_DOM: number;
  HED_DOM: number;
  HEN_DOM: number;
}

export interface EmployeePeriodSummary {
  employeeId: string;
  employeeName: string;
  branchName: string;
  baseMonthlySalary: number;
  vrHoraBase: number;
  adjustment: number;
  totals: HourTotals;
  subtotals: Record<keyof HourTotals, number>;
  totalExtras: number;
  finalTotal: number;
}

export interface CalculationResult {
  dayBreakdowns: Array<{
    employeeId: string;
    employeeName: string;
    date: string;
    shift: Shift;
    breakdown: ComputedDayBreakdown;
  }>;
  summaries: EmployeePeriodSummary[];
}

export interface EmployeePeriodConcepts {
  otherEarnings: number;
  otherDeductions: number;
  extrasAdjustment: number;
}

export interface PayrollLiquidationSummary {
  employeeId: string;
  employeeName: string;
  branchName: string;
  payType: EmployeePayType;
  baseMonthlySalary: number;
  hourlyRateUsed: number;
  daysWorked: number;
  ordinaryHours: number;
  extraHours: number;
  baseQuincena: number;
  auxilioQuincena: number;
  extrasRecargos: number;
  extrasRecargosFinal: number;
  otherEarnings: number;
  totalDevengado: number;
  baseDeducciones: number;
  salud: number;
  pension: number;
  otherDeductions: number;
  totalDeducciones: number;
  netoPagar: number;
}

export type AppTab =
  | 'dashboard'
  | 'empleados'
  | 'horarios'
  | 'calculo'
  | 'nomina'
  | 'configuracion';
