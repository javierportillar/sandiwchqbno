import { useEffect, useState } from 'react';
import type { Branch, Employee, ScheduledShiftKind, Shift, ShiftTemplate } from '../types/payroll';
import type { EmployeeWeekDay, EmployeeWeekSchedule } from '../lib/scheduleWeek';
import { buildScheduleCellKey } from '../lib/scheduleWeek';
import { buildWeeklyLoadPlan, type WeeklyLoadMode, type WeeklyLoadPlan } from '../lib/weeklyBulkLoad';
import { WeekDayAssignment } from './WeekDayAssignment';

export interface EmployeeWeekActions {
  onToggleDay: (employee: Employee, day: EmployeeWeekDay, cellKey: string) => void;
  onChangeBranch: (employee: Employee, day: EmployeeWeekDay, cellKey: string, branchId: string) => void;
  onCancelBranch: (employee: Employee, day: EmployeeWeekDay, cellKey: string) => void;
  onAssignTemplate: (employee: Employee, day: EmployeeWeekDay, branchId: string, template: ShiftTemplate) => void;
  onAssignDayOff: (employee: Employee, day: EmployeeWeekDay, branchId: string) => void;
  onToggleCustom: (employee: Employee, day: EmployeeWeekDay, cellKey: string) => void;
  onSaveCustom: (employee: Employee, day: EmployeeWeekDay, branchId: string, patch: Partial<Shift>) => void;
  onApplyWeeklyLoad: (employee: Employee, plan: WeeklyLoadPlan) => void;
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

const SCHEDULED_KINDS: ScheduledShiftKind[] = ['normal', 'partido', 'doblado'];
const KIND_LABEL: Record<ScheduledShiftKind, string> = {
  normal: 'Normal',
  partido: 'Partido',
  doblado: 'Doblado'
};

const SKIP_LABEL: Record<WeeklyLoadPlan['skipped'][number]['reason'], string> = {
  'existing-assignment': 'Ya tiene un turno; se conserva.',
  'pending-branch': 'Tiene un cambio de sede pendiente.',
  'period-missing': 'No hay período de pago para esa fecha.',
  'period-overlap': 'Hay períodos de pago superpuestos.',
  'period-mismatch': 'El turno guardado no coincide con el período de la fecha.',
  duplicate: 'Hay turnos duplicados que requieren revisión.',
  review: 'El turno existente requiere revisión.',
  'day-off-preserved': 'Día libre explícito; se conserva sin cambios.',
  'branch-unavailable': 'La sede elegida no está disponible.',
  'template-unavailable': 'No hay una plantilla compatible para ese día, sede y rol.'
};

function formatTemplateRange(template: ShiftTemplate): string {
  const first = `${template.startTime}–${template.endTime}`;
  return template.secondStart && template.secondEnd
    ? `${first} · ${template.secondStart}–${template.secondEnd}`
    : first;
}

function formatShiftRange(shift: Shift): string {
  const first = shift.startTime && shift.endTime ? `${shift.startTime}–${shift.endTime}` : 'Turno asignado';
  return shift.secondStart && shift.secondEnd ? `${first} · ${shift.secondStart}–${shift.secondEnd}` : first;
}

function formatBranchName(branches: readonly Branch[], branchId: string): string {
  return branches.find((branch) => branch.id === branchId)?.name ?? 'Sede no disponible';
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC'
  }).format(new Date(`${date}T12:00:00Z`));
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
  const [loadKind, setLoadKind] = useState<ScheduledShiftKind | ''>(employee.habitualShiftKind ?? '');
  const [loadBranchId, setLoadBranchId] = useState(employee.branchId);
  const [loadMode, setLoadMode] = useState<WeeklyLoadMode>('fill-unassigned');
  const [loadPreview, setLoadPreview] = useState<WeeklyLoadPlan | null>(null);

  useEffect(() => {
    setLoadKind(employee.habitualShiftKind ?? '');
    setLoadBranchId(employee.branchId);
    setLoadPreview(null);
  }, [schedule, employee.habitualShiftKind, employee.branchId, branches, pendingBranches]);

  const reviewWeeklyLoad = () => {
    if (!loadKind) return;
    setLoadPreview(buildWeeklyLoadPlan({
      schedule,
      branches,
      kind: loadKind,
      branchId: loadBranchId,
      mode: loadMode,
      pendingBranches
    }));
  };

  const replacementCount = loadPreview?.assignments.filter((item) => item.replaces).length ?? 0;
  const newAssignmentCount = (loadPreview?.assignments.length ?? 0) - replacementCount;

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

      <section className="weekly-load-panel" aria-label={`Carga semanal para ${employee.fullName}`}>
        <div className="weekly-load-heading">
          <div>
            <h5>Aplicar un tipo de turno a la semana</h5>
            <p>
              {employee.habitualShiftKind
                ? `Turno habitual sugerido: ${KIND_LABEL[employee.habitualShiftKind]}.`
                : 'No hay un turno habitual configurado; elegí uno para esta carga.'}
              {' '}La sugerencia no asigna turnos por sí sola. Los días libres explícitos siempre se conservan.
            </p>
          </div>
        </div>
        <fieldset className="weekly-load-mode">
          <legend>Qué hacer con los turnos de esta semana</legend>
          <div className="weekly-load-mode-options">
            <label>
              <input
                type="radio"
                name={`weekly-load-mode-${employee.id}`}
                value="fill-unassigned"
                checked={loadMode === 'fill-unassigned'}
                onChange={() => { setLoadMode('fill-unassigned'); setLoadPreview(null); }}
              />
              <span><strong>Completar días sin turno</strong><small>Conserva los turnos ya asignados.</small></span>
            </label>
            <label>
              <input
                type="radio"
                name={`weekly-load-mode-${employee.id}`}
                value="replace-scheduled"
                checked={loadMode === 'replace-scheduled'}
                onChange={() => { setLoadMode('replace-scheduled'); setLoadPreview(null); }}
              />
              <span><strong>Reemplazar turnos existentes</strong><small>Solo reemplaza turnos válidos; muestra el antes y después.</small></span>
            </label>
          </div>
        </fieldset>
        <div className="weekly-load-controls">
          <label>
            Tipo de turno
            <select value={loadKind} onChange={(event) => {
              setLoadKind(event.target.value as ScheduledShiftKind | '');
              setLoadPreview(null);
            }}>
              <option value="">Elegí un turno…</option>
              {SCHEDULED_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
            </select>
          </label>
          <label>
            Sede de destino para turnos nuevos y reemplazados
            <select value={loadBranchId} onChange={(event) => {
              setLoadBranchId(event.target.value);
              setLoadPreview(null);
            }}>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>
          <button type="button" className="subtle" onClick={reviewWeeklyLoad} disabled={!loadKind}>
            Revisar carga semanal
          </button>
        </div>
        {loadPreview && (
          <div className="weekly-load-preview" role="status" aria-live="polite">
            <strong>
              {loadPreview.assignments.length
                ? loadPreview.mode === 'replace-scheduled'
                  ? `Se reemplazarán ${replacementCount} turno(s) y se asignarán ${newAssignmentCount} día(s) vacío(s); se omitirán ${loadPreview.skipped.length}.`
                  : `Se asignarán ${loadPreview.assignments.length} día(s); se omitirán ${loadPreview.skipped.length}.`
                : `No hay días disponibles para asignar; se omitirán ${loadPreview.skipped.length}.`}
            </strong>
            {loadPreview.assignments.length > 0 && (
              <ul className="weekly-load-list">
                {loadPreview.assignments.map((item) => (
                  <li key={item.date} className="weekly-load-change">
                    <span>{formatDate(item.date)}</span>
                    <span className="weekly-load-before">
                      <small>Antes</small>
                      <span>{item.replaces ? formatShiftRange(item.replaces) : 'Sin asignar'}</span>
                      {item.replaces && (
                        <small className="weekly-load-location">
                          Sede: {formatBranchName(branches, item.replaces.overrideBranchId ?? employee.branchId)}
                        </small>
                      )}
                    </span>
                    <span className="weekly-load-arrow" aria-hidden="true">→</span>
                    <span className="weekly-load-after">
                      <small>Después</small>
                      <span>{item.template.label}</span>
                      <span>{formatTemplateRange(item.template)}</span>
                      <small className="weekly-load-location">Sede: {formatBranchName(branches, item.branchId)}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {loadPreview.skipped.length > 0 && (
              <details>
                <summary>Ver días omitidos ({loadPreview.skipped.length})</summary>
                <ul className="weekly-load-list weekly-load-skipped">
                  {loadPreview.skipped.map((item) => (
                    <li key={`${item.date}-${item.reason}`}>
                      <span>{formatDate(item.date)}</span>
                      <span>{SKIP_LABEL[item.reason]}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="row weekly-load-actions">
              <button
                type="button"
                className="primary"
                disabled={loadPreview.assignments.length === 0}
                onClick={() => {
                  actions.onApplyWeeklyLoad(employee, loadPreview);
                  setLoadPreview(null);
                }}
              >
                {loadPreview.mode === 'replace-scheduled'
                  ? replacementCount > 0
                    ? `Confirmar reemplazo de ${replacementCount} turno(s) y asignar ${newAssignmentCount}`
                    : `Confirmar y aplicar ${newAssignmentCount} turno(s)`
                  : `Confirmar y aplicar ${loadPreview.assignments.length} turno(s)`}
              </button>
              <button type="button" className="subtle" onClick={() => setLoadPreview(null)}>Cancelar</button>
            </div>
          </div>
        )}
      </section>

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
