import React, { useMemo, useState } from 'react';
import type { Employee, Shift, PayrollSettings, PayPeriod, Branch } from '../../types/payroll';
import { aggregateDailyAndPeriod } from '../../lib/calculation';
import { Clock, Calendar, AlertCircle, Sun, Moon, Sparkles } from 'lucide-react';

interface EmployeeHoursViewProps {
  employee: Employee;
  shifts: Shift[];
  periods: PayPeriod[];
  settings: PayrollSettings;
  branches: Branch[];
}

export const EmployeeHoursView: React.FC<EmployeeHoursViewProps> = ({
  employee,
  shifts,
  periods,
  settings,
  branches
}) => {
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(
    periods[0]?.id ?? ''
  );

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) ?? periods[0],
    [periods, selectedPeriodId]
  );

  // Run pure calculation for the selected period
  const calculation = useMemo(() => {
    if (!selectedPeriod) return null;
    try {
      return aggregateDailyAndPeriod({
        shifts,
        employees: [employee],
        settings,
        periodId: selectedPeriod.id,
        period: selectedPeriod,
        periods,
        adjustments: {}
      });
    } catch {
      return null;
    }
  }, [shifts, employee, settings, selectedPeriod, periods]);

  const summary = calculation?.summaries[0];
  const dayBreakdowns = useMemo(() => {
    if (!calculation) return [];
    return calculation.dayBreakdowns.filter((b) => b.employeeId === employee.id);
  }, [calculation, employee.id]);

  const totals = summary?.totals;

  // Calculate gross total hours without any money
  const totalWorkedHours = totals
    ? totals.ORD +
      totals.RN +
      totals.HED +
      totals.HEN +
      totals.DOM08 +
      totals.RN_DOM +
      totals.HED_DOM +
      totals.HEN_DOM
    : 0;

  const habitualBranch = branches.find((b) => b.id === employee.branchId);

  return (
    <div className="employee-hours-container grid">
      {/* Period Selection Banner */}
      <div className="period-selector-panel panel">
        <label>
          <span className="label-text">
            <Calendar size={16} /> Selecciona la Quincena a Consultar
          </span>
          <select
            value={selectedPeriod?.id ?? ''}
            onChange={(e) => setSelectedPeriodId(e.target.value)}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label || `${p.startDate} al ${p.endDate}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {totals ? (
        <>
          {/* Main KPI Totals (HOURS ONLY - NO MONETARY AMOUNTS) */}
          <div className="hours-kpi-banner panel">
            <div className="kpi-main">
              <Clock size={28} color="#0891B2" />
              <div>
                <span className="kpi-main-label">Total Horas Computadas en Quincena</span>
                <span className="kpi-main-value">{totalWorkedHours.toFixed(1)} horas</span>
              </div>
            </div>
            <div className="kpi-sub-badges">
              <span className="badge-kpi">
                <Sun size={14} /> Ordinarias: {totals.ORD.toFixed(1)}h
              </span>
              <span className="badge-kpi">
                <Moon size={14} /> Nocturnas: {totals.RN.toFixed(1)}h
              </span>
              {(totals.DOM08 > 0 || totals.RN_DOM > 0) && (
                <span className="badge-kpi holiday">
                  <Sparkles size={14} /> Dominicales/Festivas:{' '}
                  {(totals.DOM08 + totals.RN_DOM).toFixed(1)}h
                </span>
              )}
            </div>
          </div>

          {/* Detailed Hour Buckets (Strictly Hours) */}
          <div className="hours-grid-cards">
            <div className="hour-card panel">
              <div className="hour-card-header">
                <Sun size={18} color="#D97706" />
                <span className="hour-type">Horas Ordinarias (ORD)</span>
              </div>
              <div className="hour-value">{totals.ORD.toFixed(2)} h</div>
              <small className="muted">Jornada ordinaria diurna</small>
            </div>

            <div className="hour-card panel">
              <div className="hour-card-header">
                <Moon size={18} color="#1E40AF" />
                <span className="hour-type">Recargo Nocturno (RN)</span>
              </div>
              <div className="hour-value">{totals.RN.toFixed(2)} h</div>
              <small className="muted">Horas trabajadas después del corte nocturno</small>
            </div>

            <div className="hour-card panel">
              <div className="hour-card-header">
                <Clock size={18} color="#7C3AED" />
                <span className="hour-type">Horas Extras Diurnas (HED)</span>
              </div>
              <div className="hour-value">{totals.HED.toFixed(2)} h</div>
              <small className="muted">Horas sobre jornada ordinaria diurna</small>
            </div>

            <div className="hour-card panel">
              <div className="hour-card-header">
                <Clock size={18} color="#7C3AED" />
                <span className="hour-type">Horas Extras Nocturnas (HEN)</span>
              </div>
              <div className="hour-value">{totals.HEN.toFixed(2)} h</div>
              <small className="muted">Horas sobre jornada ordinaria nocturna</small>
            </div>

            <div className="hour-card panel">
              <div className="hour-card-header">
                <Sparkles size={18} color="#15803D" />
                <span className="hour-type">Dominical / Festivo Diurno (DOM)</span>
              </div>
              <div className="hour-value">{totals.DOM08.toFixed(2)} h</div>
              <small className="muted">Trabajadas en domingo o festivo diurno</small>
            </div>

            <div className="hour-card panel">
              <div className="hour-card-header">
                <Sparkles size={18} color="#15803D" />
                <span className="hour-type">RN Dominical / Festivo (RN_DOM)</span>
              </div>
              <div className="hour-value">{totals.RN_DOM.toFixed(2)} h</div>
              <small className="muted">Recargo nocturno en domingos y festivos</small>
            </div>
          </div>

          {/* Daily Breakdown Table (Hours only) */}
          <div className="panel grid">
            <h3>Detalle Día a Día de la Quincena</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Horario Registrado</th>
                    <th>Sede</th>
                    <th>ORD (h)</th>
                    <th>RN (h)</th>
                    <th>HED (h)</th>
                    <th>HEN (h)</th>
                    <th>DOM (h)</th>
                    <th>RN_DOM (h)</th>
                    <th>Total Día</th>
                  </tr>
                </thead>
                <tbody>
                  {dayBreakdowns.length > 0 ? (
                    dayBreakdowns.map(({ date, shift, breakdown }) => {
                      const shiftBranch =
                        branches.find((b) => b.id === (shift.overrideBranchId || employee.branchId)) ||
                        habitualBranch;

                      const dayTotal =
                        breakdown.ordHours +
                        breakdown.rnHours +
                        breakdown.hedHours +
                        breakdown.henHours +
                        breakdown.dom08Hours +
                        breakdown.rnDomHours +
                        breakdown.hedDomHours +
                        breakdown.henDomHours;

                      return (
                        <tr key={shift.id}>
                          <td>
                            <strong>{date}</strong>
                          </td>
                          <td>
                            {shift.restDay
                              ? 'Descanso'
                              : `${shift.startTime ?? '-'} a ${shift.endTime ?? '-'}${
                                  shift.secondStart ? ` · ${shift.secondStart} a ${shift.secondEnd}` : ''
                                }`}
                          </td>
                          <td>{shiftBranch?.name ?? '-'}</td>
                          <td>{breakdown.ordHours.toFixed(1)}</td>
                          <td>{breakdown.rnHours.toFixed(1)}</td>
                          <td>{breakdown.hedHours.toFixed(1)}</td>
                          <td>{breakdown.henHours.toFixed(1)}</td>
                          <td>{breakdown.dom08Hours.toFixed(1)}</td>
                          <td>{breakdown.rnDomHours.toFixed(1)}</td>
                          <td>
                            <strong>{dayTotal.toFixed(1)}h</strong>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={10} className="muted" style={{ textAlign: 'center', padding: '16px' }}>
                        No hay turnos registrados para esta quincena.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="panel error-state">
          <AlertCircle size={24} color="#9e1f28" />
          <p>No se pudo calcular la información para el período seleccionado.</p>
        </div>
      )}
    </div>
  );
};
