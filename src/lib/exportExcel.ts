import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { Branch, CalculationResult, Employee, PayPeriod, Shift } from '../types/payroll';

const HOURS_COLUMNS = [
  'ORD',
  'RN',
  'HED',
  'HEN',
  'DOMIN 0,8',
  'DOMIN 1,8',
  'RN DOMIN',
  'HED DOMIN',
  'HEN DOMIN'
] as const;

export const exportPayrollExcel = async (params: {
  period: PayPeriod;
  employees: Employee[];
  branches: Branch[];
  shifts: Shift[];
  result: CalculationResult;
}) => {
  const { period, employees, branches, shifts, result } = params;
  const workbook = new ExcelJS.Workbook();

  const branchMap = new Map(branches.map((b) => [b.id, b.name]));
  const employeeMap = new Map(employees.map((e) => [e.id, e]));

  const detalle = workbook.addWorksheet('Detalle');
  detalle.addRow([
    'Empleado',
    'Sede',
    'Fecha',
    'Inicio',
    'Salida',
    'Break(min)',
    ...HOURS_COLUMNS
  ]);

  for (const row of result.dayBreakdowns) {
    const employee = employeeMap.get(row.employeeId);
    const shift = shifts.find((s) => s.id === row.shift.id);
    const branchName = employee ? branchMap.get(employee.branchId) : '-';

    detalle.addRow([
      row.employeeName,
      branchName,
      row.date,
      shift?.startTime ?? '-',
      shift?.endTime ?? '-',
      shift?.breakMinutes ?? 0,
      row.breakdown.ordHours,
      row.breakdown.rnHours,
      row.breakdown.hedHours,
      row.breakdown.henHours,
      row.breakdown.dom08Hours,
      row.breakdown.dom18Hours,
      row.breakdown.rnDomHours,
      row.breakdown.hedDomHours,
      row.breakdown.henDomHours
    ]);
  }

  const resumen = workbook.addWorksheet('Resumen');
  resumen.addRow(['Empleado', 'Sede', ...HOURS_COLUMNS]);
  for (const summary of result.summaries) {
    const employee = employeeMap.get(summary.employeeId);
    const branchName = employee ? branchMap.get(employee.branchId) : '-';
    resumen.addRow([
      summary.employeeName,
      branchName,
      summary.totals.ORD,
      summary.totals.RN,
      summary.totals.HED,
      summary.totals.HEN,
      summary.totals.DOM08,
      summary.totals.DOM18,
      summary.totals.RN_DOM,
      summary.totals.HED_DOM,
      summary.totals.HEN_DOM
    ]);
  }

  const horasExtras = workbook.addWorksheet('Horas Extras');
  horasExtras.addRow(['Periodo', period.label]);
  horasExtras.addRow([]);
  horasExtras.addRow([
    'Empleado',
    'Tipo',
    'Can.',
    'Vr. Hora',
    'Subtotal'
  ]);

  for (const summary of result.summaries) {
    const types = [
      ['RN', summary.totals.RN, summary.subtotals.RN],
      ['HED', summary.totals.HED, summary.subtotals.HED],
      ['HEN', summary.totals.HEN, summary.subtotals.HEN],
      ['DOMIN 0,8', summary.totals.DOM08, summary.subtotals.DOM08],
      ['DOMIN 1,8', summary.totals.DOM18, summary.subtotals.DOM18],
      ['RN DOMIN', summary.totals.RN_DOM, summary.subtotals.RN_DOM],
      ['HED DOMIN', summary.totals.HED_DOM, summary.subtotals.HED_DOM],
      ['HEN DOMIN', summary.totals.HEN_DOM, summary.subtotals.HEN_DOM]
    ];

    for (const [type, quantity, subtotal] of types) {
      horasExtras.addRow([
        summary.employeeName,
        type,
        quantity,
        summary.vrHoraBase,
        subtotal
      ]);
    }

    horasExtras.addRow([
      summary.employeeName,
      'TOTAL HORAS EXTRAS',
      '',
      '',
      summary.totalExtras
    ]);
    horasExtras.addRow([
      summary.employeeName,
      'AJUSTE AL CIEN',
      '',
      '',
      summary.adjustment
    ]);
    horasExtras.addRow([
      summary.employeeName,
      'TOTAL',
      '',
      '',
      summary.finalTotal
    ]);
    horasExtras.addRow([]);
  }

  [detalle, resumen, horasExtras].forEach((sheet) => {
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = 16;
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  saveAs(blob, `nomina-qbano-${period.startDate}-${period.endDate}.xlsx`);
};
