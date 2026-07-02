export type BranchName = 'Unicentro' | 'Único' | 'Avenida';

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

export interface Employee {
  id: string;
  companyId: string;
  branchId: string;
  fullName: string;
  documentId?: string;
  baseMonthlySalary: number;
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
  restDay?: boolean;
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

export type AppTab =
  | 'dashboard'
  | 'empleados'
  | 'horarios'
  | 'calculo'
  | 'configuracion';
