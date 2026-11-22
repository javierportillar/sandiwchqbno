import React, { useMemo, useState } from 'react';
import type { Employee, Shift, Branch } from '../../types/payroll';
import { addDaysToDate, getMondayWeekStart } from '../../lib/scheduleWeek';
import { calculateWeeklyScheduledMinutes } from '../../lib/weeklySchedule';
import { getColombianWorkdayInfo } from '../../lib/colombianCalendar';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Coffee,
  CheckCircle2
} from 'lucide-react';

interface EmployeeWeekScheduleProps {
  employee: Employee;
  shifts: Shift[];
  branches: Branch[];
}

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export const EmployeeWeekSchedule: React.FC<EmployeeWeekScheduleProps> = ({
  employee,
  shifts,
  branches
}) => {
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const initialMonday = useMemo(() => getMondayWeekStart(todayISO), [todayISO]);
  const [currentWeekStart, setCurrentWeekStart] = useState<string>(initialMonday);

  const weekEndExclusive = useMemo(
    () => addDaysToDate(currentWeekStart, 7),
    [currentWeekStart]
  );

  const weekEndInclusive = useMemo(
    () => addDaysToDate(currentWeekStart, 6),
    [currentWeekStart]
  );

  // Filter shifts relevant for this week & employee
  const employeeShifts = useMemo(
    () => shifts.filter((s) => s.employeeId === employee.id),
    [shifts, employee.id]
  );

  // Generate 7 day objects
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const dateISO = addDaysToDate(currentWeekStart, i);
      const dayShift = employeeShifts.find((s) => s.date === dateISO);
      const workdayInfo = getColombianWorkdayInfo(dateISO);
      const isToday = dateISO === todayISO;
      const dayName = DAY_NAMES[i];
      return {
        date: dateISO,
        dayName,
        shift: dayShift,
        workdayInfo,
        isToday
      };
    });
  }, [currentWeekStart, employeeShifts, todayISO]);

  // Scheduled minutes calculation from pure module
  const weeklyScheduled = useMemo(() => {
    try {
      return calculateWeeklyScheduledMinutes({
        employeeId: employee.id,
        week: { startDate: currentWeekStart, endDateExclusive: weekEndExclusive },
        shifts: employeeShifts
      });
    } catch {
      return { assignedMinutes: 0, byDate: [] };
    }
  }, [employee.id, currentWeekStart, weekEndExclusive, employeeShifts]);

  const habitualBranch = branches.find((b) => b.id === employee.branchId);

  const getBranchForShift = (shift?: Shift) => {
    if (!shift) return habitualBranch;
    const branchId = shift.overrideBranchId || employee.branchId;
    return branches.find((b) => b.id === branchId) || habitualBranch;
  };

  const formatHours = (minutes: number) => {
    const hours = minutes / 60;
    return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
  };

  const totalAssignedMinutes = weeklyScheduled.assignedMinutes;
  const workedDaysCount = weekDays.filter(
    (d) => d.shift && !d.shift.restDay && (d.shift.startTime || d.shift.templateId)
  ).length;
  const restDaysCount = weekDays.filter((d) => d.shift?.restDay).length;

  return (
    <div className="employee-week-container grid">
      {/* Week Navigator */}
      <div className="employee-week-nav panel">
        <div className="nav-controls">
          <button
            type="button"
            className="subtle btn-icon"
            onClick={() => setCurrentWeekStart((prev) => addDaysToDate(prev, -7))}
            aria-label="Semana anterior"
          >
            <ChevronLeft size={18} />
            <span>Semana Anterior</span>
          </button>

          <div className="week-range-label">
            <Calendar size={18} color="#D97706" />
            <strong>
              {currentWeekStart} al {weekEndInclusive}
            </strong>
          </div>

          <button
            type="button"
            className="subtle btn-icon"
            onClick={() => setCurrentWeekStart((prev) => addDaysToDate(prev, 7))}
            aria-label="Semana siguiente"
          >
            <span>Semana Siguiente</span>
            <ChevronRight size={18} />
          </button>
        </div>

        {currentWeekStart !== initialMonday && (
          <div className="current-week-reset">
            <button
              type="button"
              className="subtle btn-sm"
              onClick={() => setCurrentWeekStart(initialMonday)}
            >
              Volver a la Semana Actual
            </button>
          </div>
        )}
      </div>

      {/* Week Summary KPI Cards */}
      <div className="employee-kpi-grid">
        <div className="kpi-card panel">
          <Clock size={20} color="#0891B2" />
          <div>
            <div className="kpi-value">{formatHours(totalAssignedMinutes)}</div>
            <div className="kpi-label">Horas programadas semana</div>
          </div>
        </div>

        <div className="kpi-card panel">
          <CheckCircle2 size={20} color="#15803D" />
          <div>
            <div className="kpi-value">{workedDaysCount} de 7</div>
            <div className="kpi-label">Días con turno</div>
          </div>
        </div>

        <div className="kpi-card panel">
          <Coffee size={20} color="#7C3AED" />
          <div>
            <div className="kpi-value">{restDaysCount}</div>
            <div className="kpi-label">Días de descanso</div>
          </div>
        </div>
      </div>

      {/* 7-Day Responsive Cards */}
      <div className="employee-days-grid">
        {weekDays.map(({ date, dayName, shift, workdayInfo, isToday }) => {
          const shiftBranch = getBranchForShift(shift);
          const dayMinutes =
            weeklyScheduled.byDate.find((b) => b.date === date)?.scheduledMinutes ?? 0;

          return (
            <div
              key={date}
              className={`employee-day-card panel ${isToday ? 'is-today' : ''} ${
                shift?.restDay ? 'is-rest' : ''
              }`}
            >
              <div className="day-card-header">
                <div className="day-name-block">
                  <span className="day-title">{dayName}</span>
                  <span className="day-date">{date}</span>
                </div>

                <div className="day-badges">
                  {isToday && <span className="badge-today">HOY</span>}
                  {workdayInfo.isSunday && <span className="badge-domingo">DOM</span>}
                  {workdayInfo.holidays.length > 0 && (
                    <span className="badge-festivo" title={workdayInfo.holidays[0].name}>
                      Festivo
                    </span>
                  )}
                </div>
              </div>

              <div className="day-card-body">
                {shift && !shift.restDay && (shift.startTime || shift.templateId) ? (
                  <div className="shift-info-box">
                    <div className="shift-times-row">
                      <Clock size={16} color="#0891B2" />
                      <strong>
                        {shift.startTime} – {shift.endTime}
                        {shift.secondStart && ` · ${shift.secondStart} – ${shift.secondEnd}`}
                      </strong>
                    </div>

                    <div className="shift-branch-row">
                      <MapPin size={14} color="#62708a" />
                      <span>{shiftBranch?.name ?? 'Sede'}</span>
                      {shift.overrideBranchId && shift.overrideBranchId !== employee.branchId && (
                        <span className="tag-rotacion">Rotación</span>
                      )}
                    </div>

                    {dayMinutes > 0 && (
                      <div className="shift-duration-tag">
                        Programado: {formatHours(dayMinutes)}
                      </div>
                    )}
                  </div>
                ) : shift?.restDay ? (
                  <div className="rest-info-box">
                    <Coffee size={20} color="#6B7280" />
                    <span>Día de Descanso</span>
                  </div>
                ) : (
                  <div className="unassigned-info-box">
                    <span className="muted">Sin turno asignado</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
