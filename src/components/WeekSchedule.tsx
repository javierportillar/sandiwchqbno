import type { Branch } from '../types/payroll';
import type { EmployeeWeekSchedule } from '../lib/scheduleWeek';
import { EmployeeWeekCard, type EmployeeWeekActions } from './EmployeeWeekCard';

function branchSuffix(branchId: string): string {
  if (branchId === 'branch-avenida') return 'avenida';
  if (branchId === 'branch-unicentro') return 'unicentro';
  if (branchId === 'branch-unico') return 'unico';
  return 'unknown';
}

export function WeekSchedule({
  schedules,
  branches,
  collapsedBranches,
  onToggleBranch,
  openCell,
  customizingCells,
  pendingBranches,
  actions
}: {
  schedules: readonly EmployeeWeekSchedule[];
  branches: readonly Branch[];
  collapsedBranches: ReadonlySet<string>;
  onToggleBranch: (branchId: string) => void;
  openCell: string | null;
  customizingCells: Readonly<Record<string, boolean>>;
  pendingBranches: Readonly<Record<string, string>>;
  actions: EmployeeWeekActions;
}) {
  const incomplete = schedules.filter((item) => item.calculation.coverageStatus !== 'confirmed').length;
  const needingReview = schedules.filter((item) => item.issues.some((issue) =>
    issue.code !== 'unassigned_day_state' && issue.code !== 'missing_day_state'
  )).length;

  return (
    <div className="week-schedule">
      <div className="week-schedule-status" role="status" aria-live="polite">
        <strong>{schedules.length === 0
          ? 'No hay empleados para mostrar'
          : incomplete === 0
            ? 'Cobertura semanal confirmada'
            : `Cobertura incompleta en ${incomplete} empleado(s)`}</strong>
        {needingReview > 0 && <span>{needingReview} empleado(s) tienen datos que requieren revisión.</span>}
        <small>Las horas asignadas son una suma de tramos programados; no son horas trabajadas ni pagadas.</small>
      </div>

      {schedules.length === 0 && <p className="muted">No hay empleados para mostrar con este filtro.</p>}

      {branches.map((branch) => {
        const branchSchedules = schedules.filter((item) => item.employee.branchId === branch.id);
        if (branchSchedules.length === 0) return null;
        const collapsed = collapsedBranches.has(branch.id);
        const panelId = `week-branch-${branch.id}`;
        return (
          <section className={`week-branch-group week-branch-${branchSuffix(branch.id)}`} key={branch.id}>
            <h3>
              <button
                type="button"
                className="week-branch-toggle"
                aria-expanded={!collapsed}
                aria-controls={panelId}
                onClick={() => onToggleBranch(branch.id)}
              >
                <span className={`branch-badge branch-badge-${branchSuffix(branch.id)}`}>{branch.name}</span>
                <span>{branchSchedules.length} empleado{branchSchedules.length === 1 ? '' : 's'}</span>
                <span aria-hidden="true">{collapsed ? '＋' : '−'}</span>
              </button>
            </h3>
            {!collapsed && (
              <div className="week-branch-employees" id={panelId}>
                {branchSchedules.map((schedule) => (
                  <EmployeeWeekCard
                    key={schedule.employee.id}
                    schedule={schedule}
                    branches={branches}
                    openCell={openCell}
                    customizingCells={customizingCells}
                    pendingBranches={pendingBranches}
                    actions={actions}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {schedules.some((item) => !branches.some((branch) => branch.id === item.employee.branchId)) && (
        <section className="week-branch-group week-branch-unknown">
          <h3>
            <button
              type="button"
              className="week-branch-toggle"
              aria-expanded={!collapsedBranches.has('unknown-branch')}
              aria-controls="week-branch-unknown"
              onClick={() => onToggleBranch('unknown-branch')}
            >
              <span className="branch-badge">Sede no disponible</span>
              <span>Empleados con sede por revisar</span>
              <span aria-hidden="true">{collapsedBranches.has('unknown-branch') ? '＋' : '−'}</span>
            </button>
          </h3>
          {!collapsedBranches.has('unknown-branch') && (
            <div className="week-branch-employees" id="week-branch-unknown">
              {schedules.filter((item) => !branches.some((branch) => branch.id === item.employee.branchId)).map((schedule) => (
                <EmployeeWeekCard
                  key={schedule.employee.id}
                  schedule={schedule}
                  branches={branches}
                  openCell={openCell}
                  customizingCells={customizingCells}
                  pendingBranches={pendingBranches}
                  actions={actions}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
