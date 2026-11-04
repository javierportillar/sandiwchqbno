import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { Branch, CalculationResult, Employee, PayPeriod, Shift } from '../types/payroll';

const HOURS_COLUMNS = [
  'ORD',
  'RN',
  'HED',
  'HEN',
  'DOMIN. DIURNO',
  'DOMIN. NOCTURNO',
  'RN DOMIN',
  'HED DOMIN',
  'HEN DOMIN'
] as const;

const RATE_REFERENCE_COLUMN = 4;
const RATE_REFERENCE_COLUMN_WIDTH = 56;
const RATE_REFERENCE_CHARACTERS_PER_LINE = 44;
const RATE_REFERENCE_LINE_HEIGHT = 16;

const getRateReferenceRowHeight = (reference: string) =>
  Math.max(20, Math.ceil(reference.length / RATE_REFERENCE_CHARACTERS_PER_LINE) * RATE_REFERENCE_LINE_HEIGHT);

export const getExportBranchId = (employee: Employee, shift?: Shift): string =>
  shift?.overrideBranchId ?? employee.branchId;

type ExportPayrollParams = {
  period: PayPeriod;
  employees: Employee[];
  branches: Branch[];
  shifts: Shift[];
  result: CalculationResult;
};

export const buildPayrollWorkbook = (params: ExportPayrollParams) => {
  const { period, employees, branches, result } = params;
  const workbook = new ExcelJS.Workbook();

  const branchMap = new Map(branches.map((b) => [b.id, b.name]));
  const employeeMap = new Map(employees.map((e) => [e.id, e]));

  const detalle = workbook.addWorksheet('Detalle');
  detalle.addRow([
    'Empleado',
    'Sede',
    'Fecha',
    'Día especial / recargo legal de referencia',
    'Inicio',
    'Salida',
    'Inicio 2',
    'Salida 2',
    'Pausa legacy (min), no descontada',
    ...HOURS_COLUMNS
  ]);

  for (const row of result.dayBreakdowns) {
    const employee = employeeMap.get(row.employeeId);
    const shift = row.shift;
    const branchName = employee ? branchMap.get(getExportBranchId(employee, row.shift)) : '-';

    const rateReference = row.breakdown.workdayRateReference ?? '—';
    const detailRow = detalle.addRow([
      row.employeeName,
      branchName,
      row.date,
      rateReference,
      shift?.startTime ?? '-',
      shift?.endTime ?? '-',
      shift?.secondStart ?? '-',
      shift?.secondEnd ?? '-',
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

    detailRow.getCell(RATE_REFERENCE_COLUMN).alignment = { vertical: 'middle', wrapText: true };
    if (rateReference !== '—') detailRow.height = getRateReferenceRowHeight(rateReference);
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
  horasExtras.addRow([
    'Referencia',
    'El recargo legal vigente se muestra por fecha en Detalle. Los subtotales monetarios aún usan multiplicadores provisionales configurados y no aplican automáticamente esa tasa variable.'
  ]);
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
      ['DOMIN. DIURNO', summary.totals.DOM08, summary.subtotals.DOM08],
      ['DOMIN. NOCTURNO', summary.totals.DOM18, summary.subtotals.DOM18],
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
  detalle.getColumn(RATE_REFERENCE_COLUMN).width = RATE_REFERENCE_COLUMN_WIDTH;
  detalle.getRow(1).getCell(RATE_REFERENCE_COLUMN).alignment = { vertical: 'middle', wrapText: true };

  return workbook;
};

export const exportPayrollExcel = async (params: ExportPayrollParams) => {
  const workbook = buildPayrollWorkbook(params);
  const { period } = params;
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  saveAs(blob, `nomina-qbano-${period.startDate}-${period.endDate}.xlsx`);
};
