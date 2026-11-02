import { useId } from 'react';
import type { Branch, Employee, Shift, ShiftKind, ShiftTemplate } from '../types/payroll';
import { listTemplatesForDate } from '../lib/templates';
import type { EmployeeWeekDay } from '../lib/scheduleWeek';
import { ShiftEditor } from './ShiftEditor';

const SHIFT_KINDS: ShiftKind[] = ['partido', 'normal', 'doblado'];

const SHIFT_KIND_LABEL: Record<ShiftKind, string> = {
  partido: 'Partido',
  normal: 'Normal',
  doblado: 'Doblado',
  descanso: 'Día libre'
};

function formatRange(shift?: Pick<Shift, 'startTime' | 'endTime' | 'secondStart' | 'secondEnd' | 'restDay'>): string {
  if (!shift || shift.restDay) return '';
  const first = `${shift.startTime ?? '—'}–${shift.endTime ?? '—'}`;
  return shift.secondStart || shift.secondEnd
    ? `${first} · ${shift.secondStart ?? '—'}–${shift.secondEnd ?? '—'}`
    : first;
}

function dayStateLabel(day: EmployeeWeekDay): string {
  switch (day.state) {
    case 'scheduled': return 'Turno asignado';
    case 'day-off': return 'Día libre';
    case 'review': return 'Revisión necesaria';
    case 'duplicate': return 'Turnos duplicados';
    case 'period-mismatch': return 'Período inconsistente';
    case 'period-overlap': return 'Períodos superpuestos';
    case 'period-missing': return 'Sin período de pago';
    default: return 'Sin asignar';
  }
}

export function WeekDayAssignment({
  employee,
  day,
  branches,
  branchId,
  pendingBranchId,
  open,
  customizing,
  onToggle,
  onBranchChange,
  onCancelBranch,
  onAssignTemplate,
  onAssignDayOff,
  onToggleCustom,
  onSaveCustom
}: {
  employee: Employee;
  day: EmployeeWeekDay;
  branches: readonly Branch[];
  branchId: string;
  pendingBranchId?: string;
  open: boolean;
  customizing: boolean;
  onToggle: () => void;
  onBranchChange: (branchId: string) => void;
  onCancelBranch: () => void;
  onAssignTemplate: (template: ShiftTemplate, branchId: string) => void;
  onAssignDayOff: (branchId: string) => void;
  onToggleCustom: () => void;
  onSaveCustom: (patch: Partial<Shift>, branchId: string) => void;
}) {
  const controlsId = useId();
  const period = day.periodResolution.status === 'available' ? day.periodResolution.period : undefined;
  const assignable = Boolean(period) && day.state !== 'duplicate' && day.state !== 'period-mismatch';
  const requiresReview = day.state === 'review';
  const branch = branches.find((item) => item.id === branchId);
  const templates = branch ? listTemplatesForDate(branch, day.date, employee.role) : [];
  const assignedTemplate = day.shift?.templateId
    ? branch?.shiftTemplates.find((template) => template.id === day.shift?.templateId)
    : undefined;
  const assignedKind = day.shift?.restDay
    ? 'descanso'
    : assignedTemplate?.kind ?? (day.shift && (day.shift.startTime || day.shift.endTime || day.shift.secondStart || day.shift.secondEnd) ? 'custom' : undefined);
  const assignedKindLabel = assignedKind === 'custom' ? 'Personalizado' : assignedKind ? SHIFT_KIND_LABEL[assignedKind] : '';
  const stateLabel = dayStateLabel(day);
  const scheduleRange = formatRange(day.shift);
  const actionName = day.state === 'unassigned'
    ? `Asignar turno a ${employee.fullName}, ${day.date}`
    : day.state === 'review'
      ? `Revisar turno de ${employee.fullName}, ${day.date}`
      : `Editar ${stateLabel.toLocaleLowerCase('es-CO')} de ${employee.fullName}, ${day.date}`;

  return (
    <li className={`week-day-row week-day-${day.state}`}>
      <div className="week-day-heading">
        <time dateTime={day.date}>{new Intl.DateTimeFormat('es-CO', {
          weekday: 'long', day: '2-digit', month: 'short', timeZone: 'UTC'
        }).format(new Date(`${day.date}T12:00:00Z`))}</time>
        <span className={`week-day-status week-day-status-${day.state}`}>{stateLabel}</span>
      </div>

      {scheduleRange && <p className="week-day-range">{scheduleRange}</p>}
      {day.state === 'scheduled' && assignedKind && (
        <span className={`week-day-kind chip chip-${assignedKind}`}>{assignedKindLabel}</span>
      )}
      {day.branchId && branch && (
        <span className={`branch-badge branch-badge-${branch.id.replace('branch-', '')}`}>
          {branch.name}
        </span>
      )}

      {!assignable ? (
        <p className="week-day-blocker" role="status">{day.message}</p>
      ) : (
        <>
          <button
            type="button"
            className={`week-day-trigger ${day.state === 'unassigned' ? 'week-day-trigger-empty' : ''}`}
            aria-expanded={open}
            aria-controls={controlsId}
            aria-label={actionName}
            onClick={onToggle}
          >
            {day.state === 'unassigned' ? 'Sin asignar · Elegir turno' : 'Editar asignación'}
            <span aria-hidden="true">{open ? '−' : '+'}</span>
          </button>

          {open && (
            <div className="week-day-controls" id={controlsId}>
              <label>
                Sede para {employee.fullName}, {day.date}
                <select
                  value={branchId}
                  onChange={(event) => onBranchChange(event.target.value)}
                  aria-label={`Sede para ${employee.fullName}, ${day.date}`}
                  disabled={requiresReview}
                >
                  {branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>

              {pendingBranchId && (
                <div className="week-branch-draft" role="status">
                  <span>Cambio de sede pendiente; se guarda al asignar el día.</span>
                  <button
                    type="button"
                    className="subtle"
                    onClick={onCancelBranch}
                    aria-label={`Cancelar cambio de sede para ${employee.fullName}, ${day.date}`}
                  >
                    Cancelar cambio de sede
                  </button>
                </div>
              )}

              {!requiresReview && (
                <div className="week-template-options" aria-label={`Turnos para ${employee.fullName}, ${day.date}`}>
                  {SHIFT_KINDS.map((kind) => {
                    const template = templates.find((item) => item.kind === kind);
                    if (!template) return null;
                    const interval = formatRange(template);
                    return (
                      <button
                        key={template.id}
                        type="button"
                        className={`chip chip-${kind}`}
                        aria-label={`${SHIFT_KIND_LABEL[kind]} para ${employee.fullName}, ${day.date}${interval ? `, ${interval}` : ''}`}
                        onClick={() => onAssignTemplate(template, branchId)}
                      >
                        <span>{SHIFT_KIND_LABEL[kind]}</span>
                        {interval && <small>{interval}</small>}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="chip chip-descanso"
                    aria-label={`Asignar día libre a ${employee.fullName}, ${day.date}`}
                    onClick={() => onAssignDayOff(branchId)}
                  >
                    Día libre
                  </button>
                </div>
              )}

              {requiresReview && <p className="review-warning">{day.message}</p>}
              <button
                type="button"
                className="subtle week-customize-trigger"
                aria-expanded={customizing}
                aria-controls={`${controlsId}-custom`}
                aria-label={`Personalizar turno de ${employee.fullName}, ${day.date}`}
                onClick={onToggleCustom}
              >
                {customizing ? 'Cerrar personalización' : 'Personalizar horas'}
              </button>
              {customizing && (
                <div id={`${controlsId}-custom`}>
                  <ShiftEditor
                    key={`${employee.id}-${day.date}-${day.shift?.id ?? 'new'}`}
                    shift={day.shift}
                    requiresReview={requiresReview}
                    contextLabel={`${employee.fullName}, ${day.date}`}
                    onSave={(patch) => onSaveCustom(patch, branchId)}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}
