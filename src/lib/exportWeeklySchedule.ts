import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { Branch, PayPeriod, Shift } from '../types/payroll';
import type { EmployeeWeekSchedule, ScheduleWeekIssue } from './scheduleWeek';
import { addDaysToDate, getMondayWeekStart, isCivilDate } from './scheduleWeek';

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DURATION_FORMAT = '[h]:mm';
const PROVISIONAL_WARNING = 'Las plantillas son provisionales. “Horas asignadas” suma tramos programados sin descontar pausas ni aplicar cálculos de nómina.';
const SCHEDULE_DISCLAIMER = 'Este archivo es un borrador de programación: las horas programadas no son horas trabajadas ni horas de nómina o liquidación.';

const ISSUE_MESSAGES_ES: Record<string, string> = {
  invalid_shift_date: 'Hay un turno con una fecha inválida.',
  invalid_time: 'Hay una hora inválida en un turno.',
  partial_interval: 'Hay un tramo horario incompleto.',
  ambiguous_zero_length_interval: 'Hay un tramo con inicio y fin iguales; no se puede determinar su duración.',
  invalid_break_minutes: 'Hay un descanso con minutos inválidos; no se descuenta.',
  break_not_deducted: 'Hay un descanso heredado registrado; las horas asignadas no descuentan pausas.',
  rest_day_with_intervals: 'Un día marcado libre conserva tramos horarios y requiere revisión.',
  duplicate_shift: 'Hay turnos duplicados para el mismo día.',
  duplicate_shift_conflict: 'Los turnos duplicados tienen horarios o estados distintos.',
  overlapping_intervals: 'Hay tramos superpuestos; sus minutos se cuentan una sola vez.',
  invalid_day_state_date: 'Hay un estado de día con fecha inválida.',
  day_state_outside_week: 'Hay un estado de día fuera de esta semana.',
  invalid_day_state: 'Hay un estado de día inválido.',
  duplicate_day_state: 'Hay estados duplicados para una fecha.',
  missing_day_state: 'No hay un estado registrado para una fecha de la semana.',
  unassigned_day_state: 'Esta fecha no tiene una asignación confirmada.',
  day_state_inconsistent: 'El estado del día no coincide con los tramos registrados.',
  invalid_day_states: 'La lista de estados de día no es válida.',
  period_missing: 'No hay un período de pago vigente para esta fecha.',
  period_overlap: 'Hay períodos de pago superpuestos; no se eligió uno.',
  period_mismatch: 'El turno está asociado a un período distinto al que corresponde por fecha.',
  shift_review: 'Este turno requiere revisión antes de confirmar la cobertura.'
};

const DAY_STATE_LABELS: Record<EmployeeWeekSchedule['days'][number]['state'], string> = {
  scheduled: 'Asignado',
  'day-off': 'Día libre',
  unassigned: 'Sin asignar',
  review: 'Requiere revisión',
  duplicate: 'Turnos duplicados',
  'period-mismatch': 'Período inconsistente',
  'period-missing': 'Sin período de pago',
  'period-overlap': 'Períodos superpuestos'
};

const COVERAGE_LABELS: Record<EmployeeWeekSchedule['calculation']['coverageStatus'], string> = {
  confirmed: 'Cobertura confirmada',
  incomplete: 'Cobertura incompleta',
  unknown: 'Cobertura no verificada'
};

export interface WeeklyScheduleExportParams {
  week: { startDate: string; endDateExclusive: string };
  schedules: readonly EmployeeWeekSchedule[];
  branches: readonly Branch[];
  periods: readonly PayPeriod[];
  shifts: readonly Shift[];
  /** Home-branch filter currently applied in the weekly view; "all" means no filter. */
  branchFilter: string;
}

function assertWeek(week: WeeklyScheduleExportParams['week']): string[] {
  if (!isCivilDate(week.startDate) || !isCivilDate(week.endDateExclusive) ||
    getMondayWeekStart(week.startDate) !== week.startDate || addDaysToDate(week.startDate, 7) !== week.endDateExclusive) {
    throw new RangeError('The weekly export requires a Monday-to-Sunday civil-date range.');
  }
  return Array.from({ length: 7 }, (_, index) => addDaysToDate(week.startDate, index));
}

function excelDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function branchName(branchId: string | undefined, branches: readonly Branch[]): string {
  if (!branchId) return 'Sede no disponible';
  return branches.find((branch) => branch.id === branchId)?.name ?? `Sede no disponible (${branchId})`;
}

function shiftsForDay(
  schedule: EmployeeWeekSchedule,
  date: string,
  shifts: readonly Shift[]
): Shift[] {
  const day = schedule.days.find((candidate) => candidate.date === date);
  if (!day) return [];
  const ids = new Set(day.shiftIds);
  const matching = shifts.filter((shift) =>
    shift.employeeId === schedule.employee.id && shift.date === date && ids.has(shift.id)
  );
  if (matching.length > 0) return matching;
  return day.shift ? [day.shift] : [];
}

function dayStatus(
  schedule: EmployeeWeekSchedule,
  date: string,
  ownDateShifts: readonly Shift[],
  carryInEvidence: readonly string[],
  scheduledMinutes: number
): string {
  const day = schedule.days.find((candidate) => candidate.date === date);
  if (!day) throw new RangeError(`Schedule is missing the required date ${date}.`);
  const status = DAY_STATE_LABELS[day.state];
  if (scheduledMinutes <= 0 || carryInEvidence.length === 0) return status;
  return ownDateShifts.length === 0
    ? 'Continuidad desde el día anterior'
    : `${status} + continuidad desde el día anterior`;
}

function issueText(issue: ScheduleWeekIssue): string {
  const message = ISSUE_MESSAGES_ES[issue.code] ?? issue.message;
  const datePrefix = issue.date ? `${issue.date}: ` : '';
  const ids = issue.shiftIds?.length ? ` (turno(s): ${issue.shiftIds.join(', ')})` : '';
  return `${datePrefix}${message}${ids}`;
}

function scheduleWarnings(schedule: EmployeeWeekSchedule): string[] {
  const warnings = schedule.issues.map(issueText);
  if (schedule.calculation.coverageStatus === 'incomplete') {
    warnings.push('La cobertura semanal está incompleta: hay fechas sin asignación explícita.');
  } else if (schedule.calculation.coverageStatus === 'unknown') {
    warnings.push('Cobertura semanal no verificada.');
  }
  return warnings;
}

function dateWarnings(schedule: EmployeeWeekSchedule, date: string): string[] {
  const warnings = schedule.issues.filter((issue) => issue.date === date).map(issueText);
  const day = schedule.days.find((candidate) => candidate.date === date);
  if (day?.message && !schedule.issues.some((issue) => issue.date === date && issue.message === day.message)) {
    warnings.push(`${date}: ${day.message}`);
  }
  return warnings.length ? warnings : ['Sin avisos para esta fecha.'];
}

function validateScheduleDates(schedule: EmployeeWeekSchedule, dates: readonly string[], week: WeeklyScheduleExportParams['week']) {
  if (schedule.week.startDate !== week.startDate || schedule.week.endDateExclusive !== week.endDateExclusive) {
    throw new RangeError(`Schedule for ${schedule.employee.id} does not match the selected week.`);
  }
  const scheduleDates = schedule.days.map((day) => day.date);
  if (scheduleDates.length !== dates.length || dates.some((date, index) => scheduleDates[index] !== date)) {
    throw new RangeError(`Schedule for ${schedule.employee.id} must include each date of the selected week exactly once.`);
  }
  const totals = new Map(schedule.calculation.byDate.map((item) => [item.date, item.scheduledMinutes]));
  if (dates.some((date) => !Number.isFinite(totals.get(date)) || (totals.get(date) ?? -1) < 0)) {
    throw new RangeError(`Weekly scheduled-minute totals are incomplete for ${schedule.employee.id}.`);
  }
  if (!Number.isFinite(schedule.calculation.assignedMinutes) || schedule.calculation.assignedMinutes < 0) {
    throw new RangeError(`Weekly scheduled-minute total is invalid for ${schedule.employee.id}.`);
  }
}

function styleTitle(sheet: ExcelJS.Worksheet, endColumn: number) {
  sheet.mergeCells(1, 1, 1, endColumn);
  const title = sheet.getCell(1, 1);
  title.font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18304B' } };
  title.alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 30;
}

function styleMetadata(sheet: ExcelJS.Worksheet, endColumn: number) {
  sheet.mergeCells(3, 2, 3, endColumn);
  sheet.mergeCells(4, 2, 4, endColumn);
  for (const rowNumber of [2, 3, 4]) {
    const row = sheet.getRow(rowNumber);
    row.height = 22;
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
  }
  for (const address of ['A2', 'C2', 'A3', 'A4']) {
    sheet.getCell(address).font = { bold: true, color: { argb: 'FF18304B' } };
  }
  sheet.getCell('B2').numFmt = 'dd/mm/yyyy';
  sheet.getCell('D2').numFmt = 'dd/mm/yyyy';
  for (const rowNumber of [5, 6]) {
    sheet.mergeCells(rowNumber, 1, rowNumber, endColumn);
    const cell = sheet.getCell(rowNumber, 1);
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.font = { bold: rowNumber === 5, color: { argb: 'FF6B4300' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNumber === 5 ? 'FFFFF1CC' : 'FFFFF8E8' } };
    sheet.getRow(rowNumber).height = rowNumber === 5 ? 32 : 30;
  }
}

function styleTableHeader(sheet: ExcelJS.Worksheet, headerRow: number, columns: number, lastRow: number) {
  const row = sheet.getRow(headerRow);
  row.height = 34;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF31536F' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF18304B' } } };
  });
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: Math.max(headerRow, lastRow), column: columns }
  };
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
}

function addWeeklyMetadata(sheet: ExcelJS.Worksheet, params: WeeklyScheduleExportParams, dates: readonly string[]) {
  const filterBranch = params.branchFilter === 'all'
    ? 'Todas las sedes'
    : branchName(params.branchFilter, params.branches);
  sheet.getCell('A1').value = 'BORRADOR · Horario semanal';
  sheet.getCell('A2').value = 'Lunes (inicio)';
  sheet.getCell('B2').value = excelDate(dates[0]);
  sheet.getCell('C2').value = 'Domingo (fin)';
  sheet.getCell('D2').value = excelDate(dates[6]);
  sheet.getCell('A3').value = 'Filtro aplicado';
  sheet.getCell('B3').value = `Sede habitual: ${filterBranch}`;
  sheet.getCell('A4').value = 'Alcance';
  sheet.getCell('B4').value = `Empleados incluidos tras aplicar el filtro de sede habitual: ${params.schedules.length}. Los grupos colapsados no los excluyen.`;
  sheet.getCell('A5').value = `${SCHEDULE_DISCLAIMER} Puede contener avisos o cobertura no verificada.`;
  sheet.getCell('A6').value = PROVISIONAL_WARNING;
}

function branchValues(schedule: EmployeeWeekSchedule, dayShifts: readonly Shift[], branches: readonly Branch[]) {
  const home = branchName(schedule.employee.branchId, branches);
  const overrides = unique(dayShifts.map((shift) => shift.overrideBranchId ?? ''));
  const effectiveIds = unique(dayShifts.map((shift) => shift.overrideBranchId ?? schedule.employee.branchId));
  return {
    home,
    effective: effectiveIds.length ? effectiveIds.map((id) => branchName(id, branches)).join('\n') : home,
    override: overrides.length ? overrides.map((id) => branchName(id, branches)).join('\n') : 'Sin cambio'
  };
}

function periodValues(day: EmployeeWeekSchedule['days'][number], shifts: readonly Shift[], periods: readonly PayPeriod[]) {
  const resolved = day.periodResolution.status === 'available'
    ? [day.periodResolution.period]
    : day.periodResolution.status === 'overlap'
      ? day.periodResolution.periods
      : [];
  const storedIds = unique(shifts.map((shift) => shift.payPeriodId));
  const referenced = storedIds.map((id) => periods.find((period) => period.id === id)).filter((period): period is PayPeriod => Boolean(period));
  const labels = unique([
    ...resolved.map((period) => period.label),
    ...referenced.map((period) => period.label)
  ]);
  let label: string;
  if (day.periodResolution.status === 'missing') {
    label = labels.length ? `Sin período vigente · turno: ${labels.join(' / ')}` : 'Sin período de pago';
  } else if (day.periodResolution.status === 'overlap') {
    label = `Períodos superpuestos: ${labels.join(' / ') || 'sin etiqueta'}`;
  } else {
    label = labels.join(' / ') || 'Período sin etiqueta';
  }
  const ids = unique([...resolved.map((period) => period.id), ...storedIds]);
  return { label, ids: ids.join('\n') };
}

function timeValues(shifts: readonly Shift[], field: 'startTime' | 'endTime' | 'secondStart' | 'secondEnd'): string {
  return unique(shifts.map((shift) => shift[field] ?? '')).join('\n');
}

function parsedClockMinutes(value: string | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function clockFromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function carryInEvidenceForDay(
  schedule: EmployeeWeekSchedule,
  date: string,
  shifts: readonly Shift[]
): string[] {
  if (date !== schedule.week.startDate) return [];
  const sourceDate = addDaysToDate(date, -1);
  const priorDateShifts = shifts.filter((shift) =>
    shift.employeeId === schedule.employee.id && shift.date === sourceDate
  );
  return priorDateShifts.flatMap((shift) => [
    { label: 'tramo 1', start: shift.startTime, end: shift.endTime },
    { label: 'tramo 2', start: shift.secondStart, end: shift.secondEnd }
  ].flatMap(({ label, start, end }) => {
    const startMinutes = parsedClockMinutes(start);
    const endMinutes = parsedClockMinutes(end);
    // Match F3: only valid intervals ending after midnight contribute carry-in minutes.
    if (startMinutes === null || endMinutes === null || startMinutes === endMinutes || endMinutes >= startMinutes || endMinutes === 0) {
      return [];
    }
    return [`00:00–${clockFromMinutes(endMinutes)} (recorte de ${start}–${end}; ${label}; turno ${shift.id}; fecha de origen ${sourceDate})`];
  }));
}

function warningRowHeight(messages: readonly string[], lineWidth: number, lineHeight: number, minimum: number): number {
  const wrappedLines = messages.reduce((count, message) => count + Math.max(1, Math.ceil(message.length / lineWidth)), 0);
  return Math.min(400, Math.max(minimum, wrappedLines * lineHeight));
}

export function buildWeeklyScheduleWorkbook(params: WeeklyScheduleExportParams): ExcelJS.Workbook {
  const dates = assertWeek(params.week);
  params.schedules.forEach((schedule) => validateScheduleDates(schedule, dates, params.week));
  const branchMap = new Map(params.branches.map((branch) => [branch.id, branch.name]));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sandwich Qbano';
  workbook.subject = 'Borrador de programación semanal';
  workbook.title = `Horario semanal ${dates[0]} a ${dates[6]}`;

  const summary = workbook.addWorksheet('Resumen semanal');
  addWeeklyMetadata(summary, params, dates);
  summary.getRow(8).values = [
    'Empleado', 'Sede habitual', 'Horas asignadas (programadas)',
    'Estado de cobertura', 'Cantidad de avisos', 'Mensajes de revisión'
  ];
  for (const schedule of params.schedules) {
    const warnings = scheduleWarnings(schedule);
    const row = summary.addRow([
      schedule.employee.fullName,
      branchMap.get(schedule.employee.branchId) ?? `Sede no disponible (${schedule.employee.branchId})`,
      schedule.calculation.assignedMinutes / (24 * 60),
      COVERAGE_LABELS[schedule.calculation.coverageStatus],
      warnings.length,
      warnings.length ? warnings.join('\n') : 'Sin avisos.'
    ]);
    row.getCell(3).numFmt = DURATION_FORMAT;
    row.getCell(3).alignment = { vertical: 'top', horizontal: 'right' };
    row.getCell(4).alignment = { vertical: 'top', wrapText: true };
    row.getCell(5).alignment = { vertical: 'top', horizontal: 'center' };
    row.getCell(6).alignment = { vertical: 'top', wrapText: true };
    row.height = warnings.length ? warningRowHeight(warnings, 92, 18, 34) : 24;
    if (schedule.calculation.coverageStatus !== 'confirmed' || warnings.length > 0) {
      row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1CC' } };
      row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1CC' } };
      row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E8' } };
    }
  }
  summary.columns = [
    { width: 25 }, { width: 21 }, { width: 25 }, { width: 25 }, { width: 17 }, { width: 78 }
  ];
  styleTitle(summary, 6);
  styleMetadata(summary, 6);
  styleTableHeader(summary, 8, 6, summary.rowCount);

  const detail = workbook.addWorksheet('Detalle diario');
  addWeeklyMetadata(detail, params, dates);
  detail.getRow(8).values = [
    'Empleado', 'Fecha', 'Estado del día', 'Sede habitual', 'Sede efectiva', 'Sede sobrescrita',
    'Período de pago', 'ID de período(s)', 'ID(s) de turno', 'Inicio tramo 1', 'Fin tramo 1',
    'Inicio tramo 2', 'Fin tramo 2', 'Horas asignadas (programadas)', 'Avisos del día',
    'Arrastre desde el día anterior (recortes; F3 une solapamientos)'
  ];
  for (const schedule of params.schedules) {
    const dailyMinutes = new Map(schedule.calculation.byDate.map((item) => [item.date, item.scheduledMinutes]));
    for (const date of dates) {
      const day = schedule.days.find((candidate) => candidate.date === date);
      if (!day) throw new RangeError(`Schedule is missing the required date ${date}.`);
      const dayShifts = shiftsForDay(schedule, date, params.shifts);
      const branches = branchValues(schedule, dayShifts, params.branches);
      const period = periodValues(day, dayShifts, params.periods);
      const warningMessages = dateWarnings(schedule, date);
      const carryInEvidence = carryInEvidenceForDay(schedule, date, params.shifts);
      const row = detail.addRow([
        schedule.employee.fullName,
        excelDate(date),
        dayStatus(schedule, date, dayShifts, carryInEvidence, dailyMinutes.get(date) ?? 0),
        branches.home,
        branches.effective,
        branches.override,
        period.label,
        period.ids,
        unique(dayShifts.map((shift) => shift.id)).join('\n'),
        timeValues(dayShifts, 'startTime'),
        timeValues(dayShifts, 'endTime'),
        timeValues(dayShifts, 'secondStart'),
        timeValues(dayShifts, 'secondEnd'),
        (dailyMinutes.get(date) ?? 0) / (24 * 60),
        warningMessages.join('\n'),
        carryInEvidence.join('\n')
      ]);
      row.getCell(2).numFmt = 'dd/mm/yyyy';
      row.getCell(14).numFmt = DURATION_FORMAT;
      row.getCell(14).alignment = { vertical: 'top', horizontal: 'right' };
      row.eachCell((cell, columnNumber) => {
        if (columnNumber !== 2 && columnNumber !== 14) cell.alignment = { vertical: 'top', wrapText: true };
      });
      row.height = Math.max(
        warningRowHeight(warningMessages, 92, 18, 26),
        warningRowHeight(carryInEvidence, 76, 18, 26)
      );
      if (day.state !== 'scheduled' && day.state !== 'day-off') {
        row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1CC' } };
      }
      if (warningMessages[0] !== 'Sin avisos para esta fecha.') {
        row.getCell(15).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E8' } };
      }
      if (carryInEvidence.length > 0) {
        row.getCell(16).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3F8' } };
        row.getCell(16).font = { color: { argb: 'FF18304B' } };
      }
    }
  }
  detail.columns = [
    { width: 25 }, { width: 14 }, { width: 23 }, { width: 21 }, { width: 25 }, { width: 25 },
    { width: 36 }, { width: 24 }, { width: 24 }, { width: 16 }, { width: 16 }, { width: 16 },
    { width: 16 }, { width: 25 }, { width: 78 }, { width: 82 }
  ];
  styleTitle(detail, 16);
  styleMetadata(detail, 16);
  styleTableHeader(detail, 8, 16, detail.rowCount);

  return workbook;
}

export async function exportWeeklySchedule(params: WeeklyScheduleExportParams): Promise<void> {
  const workbook = buildWeeklyScheduleWorkbook(params);
  const endDate = addDaysToDate(params.week.startDate, 6);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME_TYPE });
  saveAs(blob, `horario-semanal-${params.week.startDate}-a-${endDate}.xlsx`);
}
