import type { Branch, Employee, Shift, ShiftTemplate } from '../types/payroll';
import type { EmployeeWeekDay, EmployeeWeekSchedule } from '../lib/scheduleWeek';
import { buildScheduleCellKey } from '../lib/scheduleWeek';
import { WeekDayAssignment } from './WeekDayAssignment';

export interface EmployeeWeekActions {
  onToggleDay: (employee: Employee, day: EmployeeWeekDay, cellKey: string) => void;
  onChangeBranch: (employee: Employee, day: EmployeeWeekDay, cellKey: string, branchId: string) => void;
  onCancelBranch: (employee: Employee, day: EmployeeWeekDay, cellKey: string) => void;
  onAssignTemplate: (employee: Employee, day: EmployeeWeekDay, branchId: string, template: ShiftTemplate) => void;
  onAssignDayOff: (employee: Employee, day: EmployeeWeekDay, branchId: string) => void;
  onToggleCustom: (employee: Employee, day: EmployeeWeekDay, cellKey: string) => void;
  onSaveCustom: (employee: Employee, day: EmployeeWeekDay, branchId: string, patch: Partial<Shift>) => void;
}

function formatAssignedHours(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

function issueLabel(code: string): string {
  const labels: Record<string, string> = {
    invalid_shift_date: 'Hay un turno con fecha inválida.',
    invalid_time: 'Hay una hora inválida en un turno.',
    partial_interval: 'Hay un tramo incompleto.',
    ambiguous_zero_length_interval: 'Hay un tramo de duración ambigua.',
    invalid_break_minutes: 'Hay un descanso registrado con formato inválido.',
    break_not_deducted: 'Existe un descuento legacy; las horas asignadas no descuentan pausas y requiere revisión.',
    rest_day_with_intervals: 'Un día libre conserva tramos horarios y requiere revisión.',
    duplicate_shift: 'Hay turnos duplicados para el mismo día.',
    duplicate_shift_conflict: 'Los turnos duplicados tienen datos distintos.',
    overlapping_intervals: 'Hay tramos que se superponen; F3 cuenta la unión una sola vez.',
    period_missing: 'Falta un período de pago para una fecha de esta semana.',
    period_overlap: 'Hay períodos de pago superpuestos; las fechas afectadas no se pueden asignar.',
    period_mismatch: 'Hay un turno asociado a un período distinto al que corresponde por fecha.',
    shift_review: 'Hay turnos legacy o límites de período que requieren revisión.'
  };
  return labels[code] ?? 'Hay un dato de horario que requiere revisión.';
}

export function EmployeeWeekCard({
  schedule,
  branches,
  openCell,
  customizingCells,
  pendingBranches,
  actions
}: {
  schedule: EmployeeWeekSchedule;
  branches: readonly Branch[];
  openCell: string | null;
  customizingCells: Readonly<Record<string, boolean>>;
  pendingBranches: Readonly<Record<string, string>>;
  actions: EmployeeWeekActions;
}) {
  const { employee, days, calculation } = schedule;
  const employeeBranch = branches.find((branch) => branch.id === employee.branchId);
  const reviewIssues = schedule.issues.filter((item) =>
    item.code !== 'unassigned_day_state' && item.code !== 'missing_day_state'
  );
  const warningCount = reviewIssues.length;
  const coverageLabel = calculation.coverageStatus === 'confirmed' ? 'Cobertura confirmada' : 'Cobertura incompleta';

  return (
    <article className="employee-week-card">
      <header className="employee-week-card-header">
        <div className="employee-week-identity">
          <div className="employee-week-avatar" aria-hidden="true">
            {employee.fullName.trim().slice(0, 1).toLocaleUpperCase('es-CO')}
          </div>
          <div>
            <h4>{employee.fullName}</h4>
            <div className="employee-week-meta">
              {employeeBranch && (
                <span className={`branch-badge branch-badge-${employeeBranch.id.replace('branch-', '')}`}>
                  {employeeBranch.name}
                </span>
              )}
              {employee.role && <span>{employee.role === 'sala' ? 'Sala' : 'Domicilio'}</span>}
              {!employee.active && <span className="review-warning">Inactivo · visible por revisión</span>}
            </div>
          </div>
        </div>
        <div className="employee-week-summary">
          <span>Horas asignadas</span>
          <strong>{formatAssignedHours(calculation.assignedMinutes)}</strong>
          <span className={`coverage-pill ${calculation.coverageStatus}`}>
            {coverageLabel}
          </span>
        </div>
      </header>

      {(warningCount > 0 || calculation.coverageStatus === 'incomplete') && (
        <div className="employee-week-warnings" role="status">
          <strong>{warningCount ? `${warningCount} aviso(s) de revisión` : 'Semana incompleta'}</strong>
          {warningCount > 0 && (
            <ul>
              {reviewIssues.slice(0, 3).map((item, index) => (
                <li key={`${item.code}-${item.date ?? 'week'}-${index}`}>
                  {item.date ? `${item.date}: ` : ''}{issueLabel(item.code)}
                </li>
              ))}
              {warningCount > 3 && <li>Y {warningCount - 3} aviso(s) adicional(es).</li>}
            </ul>
          )}
          {calculation.coverageStatus === 'incomplete' && <p>Completa las asignaciones o marca explícitamente “Día libre”.</p>}
        </div>
      )}

      <ol className="employee-week-days">
        {days.map((day) => {
          const period = day.periodResolution.status === 'available' ? day.periodResolution.period : undefined;
          const cellKey = period ? buildScheduleCellKey(employee.id, period.id, day.date) : '';
          const effectiveBranchId = period
            ? pendingBranches[cellKey] ?? day.branchId ?? employee.branchId
            : employee.branchId;

          return (
            <WeekDayAssignment
              key={day.date}
              employee={employee}
              day={day}
              branches={branches}
              branchId={effectiveBranchId}
              pendingBranchId={period ? pendingBranches[cellKey] : undefined}
              open={Boolean(cellKey && openCell === cellKey)}
              customizing={Boolean(cellKey && customizingCells[cellKey])}
              onToggle={() => actions.onToggleDay(employee, day, cellKey)}
              onBranchChange={(branchId) => actions.onChangeBranch(employee, day, cellKey, branchId)}
              onCancelBranch={() => actions.onCancelBranch(employee, day, cellKey)}
              onAssignTemplate={(template, branchId) => actions.onAssignTemplate(employee, day, branchId, template)}
              onAssignDayOff={(branchId) => actions.onAssignDayOff(employee, day, branchId)}
              onToggleCustom={() => actions.onToggleCustom(employee, day, cellKey)}
              onSaveCustom={(patch, branchId) => actions.onSaveCustom(employee, day, branchId, patch)}
            />
          );
        })}
      </ol>
    </article>
  );
}
