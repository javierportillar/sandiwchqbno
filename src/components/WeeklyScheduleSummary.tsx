import { useMemo } from 'react';
import type { Branch, Employee, Shift } from '../types/payroll';
import type { EmployeeWeekSchedule, ScheduleWeek } from '../lib/scheduleWeek';
import { addDaysToDate } from '../lib/scheduleWeek';
import { buildWeeklyScheduleSummary } from '../lib/weeklyScheduleSummary';

function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

function formatCompactHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1).replace('.', ',')} h`;
}

function weekdayLabel(date: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'short',
    timeZone: 'America/Bogota'
  }).format(new Date(`${date}T12:00:00Z`)).replace('.', '');
}

function branchSuffix(branchId: string): string {
  return branchId.replace(/^branch-/, '');
}

export function WeeklyScheduleSummary({
  employees,
  schedules,
  branches,
  shifts,
  week
}: {
  employees: readonly Employee[];
  schedules: readonly EmployeeWeekSchedule[];
  branches: readonly Branch[];
  shifts: readonly Shift[];
  week: ScheduleWeek;
}) {
  const summary = useMemo(() => buildWeeklyScheduleSummary({ employees, schedules, branches, shifts, week }), [
    employees, schedules, branches, shifts, week
  ]);
  const weekEndDate = addDaysToDate(week.endDateExclusive, -1);
  const maxDayMinutes = Math.max(1, ...summary.days.map((day) => day.scheduledMinutes));
  const maxBranchMinutes = Math.max(1, summary.unattributedMinutes, ...summary.branches.map((branch) => branch.scheduledMinutes));
  const hasUnattributedMinutes = summary.unattributedMinutes > 0;

  return (
    <section className="panel weekly-schedule-summary" aria-labelledby="weekly-summary-title">
      <header className="weekly-summary-header">
        <div>
          <p className="weekly-summary-eyebrow">Todas las sedes · Semana seleccionada</p>
          <h2 id="weekly-summary-title">Resumen de la semana</h2>
          <p>{week.startDate} — {weekEndDate}</p>
        </div>
        <p className="weekly-summary-hours-note">Horas brutas programadas: no descuentan pausas ni representan horas pagadas.</p>
      </header>

      <div className="weekly-summary-kpis" aria-label="Indicadores de la semana">
        <article className="weekly-summary-kpi">
          <span>Personal activo</span>
          <strong>{summary.activeEmployeeCount}</strong>
          <small>{summary.registeredEmployeeCount} registrados en total</small>
        </article>
        <article className="weekly-summary-kpi">
          <span>Empleados con turnos</span>
          <strong>{summary.scheduledEmployeeCount}</strong>
          <small>Personas con horas asignadas esta semana</small>
        </article>
        <article className="weekly-summary-kpi">
          <span>Horas programadas</span>
          <strong>{formatMinutes(summary.scheduledMinutes)}</strong>
          <small>Tiempo bruto, sin descontar pausas</small>
        </article>
        <article className="weekly-summary-kpi">
          <span>Turnos asignados</span>
          <strong>{summary.shiftCount}</strong>
          <small>Registros con horario dentro de la semana</small>
        </article>
        <article className="weekly-summary-kpi">
          <span>Activos sin asignación</span>
          <strong>{summary.unassignedActiveEmployeeCount}</strong>
          <small>Empleados activos sin horas programadas</small>
        </article>
      </div>

      <div className="weekly-summary-charts">
        <figure className="weekly-summary-chart-card" aria-labelledby="weekly-day-chart-title">
          <figcaption>
            <h3 id="weekly-day-chart-title">Horas por día y sede</h3>
            <p>La altura muestra el total diario; cada tramo indica dónde se programaron las horas.</p>
          </figcaption>
          <div className="weekly-summary-chart-scroll">
            <div className="weekly-summary-stacked-chart" role="img" aria-label="Columnas apiladas con horas programadas por día y sede">
              {summary.days.map((day) => (
                <div className="weekly-summary-day-column" key={day.date}>
                  <strong>{formatCompactHours(day.scheduledMinutes)}</strong>
                  <div className="weekly-summary-day-track">
                    {summary.branches.map((branch) => {
                      const minutes = day.minutesByBranch[branch.branchId] ?? 0;
                      return minutes > 0 ? (
                        <span
                          key={branch.branchId}
                          className={`weekly-summary-segment weekly-summary-segment-${branchSuffix(branch.branchId)}`}
                          style={{ height: `${minutes / maxDayMinutes * 100}%` }}
                          title={`${branch.branchName}: ${formatMinutes(minutes)}`}
                        />
                      ) : null;
                    })}
                    {day.unattributedMinutes > 0 && (
                      <span
                        className="weekly-summary-segment weekly-summary-segment-unattributed"
                        style={{ height: `${day.unattributedMinutes / maxDayMinutes * 100}%` }}
                        title={`Sede por revisar: ${formatMinutes(day.unattributedMinutes)}`}
                      />
                    )}
                  </div>
                  <span className="weekly-summary-day-label">{weekdayLabel(day.date)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="weekly-summary-legend" aria-label="Leyenda de sedes">
            {summary.branches.map((branch) => (
              <span key={branch.branchId}>
                <i className={`weekly-summary-swatch weekly-summary-swatch-${branchSuffix(branch.branchId)}`} aria-hidden="true" />
                {branch.branchName}
              </span>
            ))}
            {hasUnattributedMinutes && <span><i className="weekly-summary-swatch weekly-summary-swatch-unattributed" aria-hidden="true" />Sede por revisar</span>}
          </div>
        </figure>

        <figure className="weekly-summary-chart-card" aria-labelledby="weekly-branch-chart-title">
          <figcaption>
            <h3 id="weekly-branch-chart-title">Comparación semanal por sede</h3>
            <p>Horas programadas durante toda la semana, comparadas entre sedes.</p>
          </figcaption>
          <div className="weekly-summary-hbar-chart" role="img" aria-label="Barras horizontales con las horas semanales programadas por sede">
            {summary.branches.map((branch) => (
              <div className="weekly-summary-hbar-row" key={branch.branchId}>
                <span className="weekly-summary-hbar-label">
                  <i className={`weekly-summary-swatch weekly-summary-swatch-${branchSuffix(branch.branchId)}`} aria-hidden="true" />
                  {branch.branchName}
                </span>
                <span className="weekly-summary-hbar-track">
                  <i
                    className={`weekly-summary-hbar-fill weekly-summary-hbar-fill-${branchSuffix(branch.branchId)}`}
                    style={{ width: `${branch.scheduledMinutes / maxBranchMinutes * 100}%` }}
                  />
                </span>
                <strong>{formatCompactHours(branch.scheduledMinutes)}</strong>
              </div>
            ))}
            {hasUnattributedMinutes && (
              <div className="weekly-summary-hbar-row">
                <span className="weekly-summary-hbar-label"><i className="weekly-summary-swatch weekly-summary-swatch-unattributed" aria-hidden="true" />Sede por revisar</span>
                <span className="weekly-summary-hbar-track"><i className="weekly-summary-hbar-fill weekly-summary-hbar-fill-unattributed" style={{ width: `${summary.unattributedMinutes / maxBranchMinutes * 100}%` }} /></span>
                <strong>{formatCompactHours(summary.unattributedMinutes)}</strong>
              </div>
            )}
          </div>
          <p className="weekly-summary-branch-note">Las sedes pueden tener personas compartidas; los porcentajes comparan horas contra el total semanal.</p>
        </figure>
      </div>

      <div className="weekly-summary-tables">
        <div className="weekly-summary-table-card">
          <h3>Detalle diario por sede</h3>
          <div className="weekly-summary-table-scroll">
            <table aria-label="Horas programadas por día y sede">
              <thead>
                <tr>
                  <th scope="col">Día</th>
                  {summary.branches.map((branch) => <th scope="col" key={branch.branchId}>{branch.branchName}</th>)}
                  {hasUnattributedMinutes && <th scope="col">Sede por revisar</th>}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.days.map((day) => (
                  <tr key={day.date}>
                    <th scope="row">{weekdayLabel(day.date)} · {day.date}</th>
                    {summary.branches.map((branch) => <td key={branch.branchId}>{formatMinutes(day.minutesByBranch[branch.branchId] ?? 0)}</td>)}
                    {hasUnattributedMinutes && <td>{formatMinutes(day.unattributedMinutes)}</td>}
                    <td><strong>{formatMinutes(day.scheduledMinutes)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="weekly-summary-table-card">
          <h3>Balance de horas por sede</h3>
          <div className="weekly-summary-table-scroll">
            <table aria-label="Horas, empleados y proporción semanal por sede">
              <thead>
                <tr><th scope="col">Sede</th><th scope="col">Horas</th><th scope="col">Empleados</th><th scope="col">Del total</th></tr>
              </thead>
              <tbody>
                {summary.branches.map((branch) => (
                  <tr key={branch.branchId}>
                    <th scope="row"><span className="weekly-summary-table-branch"><i className={`weekly-summary-swatch weekly-summary-swatch-${branchSuffix(branch.branchId)}`} aria-hidden="true" />{branch.branchName}</span></th>
                    <td>{formatMinutes(branch.scheduledMinutes)}</td>
                    <td>{branch.scheduledEmployeeCount}</td>
                    <td>{Math.round(branch.shareOfTotalHours * 100)}%</td>
                  </tr>
                ))}
                {hasUnattributedMinutes && (
                  <tr><th scope="row">Sede por revisar</th><td>{formatMinutes(summary.unattributedMinutes)}</td><td>—</td><td>{summary.scheduledMinutes > 0 ? `${Math.round(summary.unattributedMinutes / summary.scheduledMinutes * 100)}%` : '0%'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {hasUnattributedMinutes && <p className="weekly-summary-unattributed-note">Parte de las horas aparece como “Sede por revisar” porque hay registros sin sede válida o turnos superpuestos entre sedes. Se conserva el total calculado sin duplicar horas.</p>}
    </section>
  );
}
