import React from 'react';
import type { Employee, Shift, Branch } from '../../types/payroll';
import { getColombianWorkdayInfo } from '../../lib/colombianCalendar';
import { Clock, Calendar, MapPin, Coffee, Sparkles } from 'lucide-react';

interface EmployeeTodayCardProps {
  employee: Employee;
  shifts: Shift[];
  branches: Branch[];
}

export const EmployeeTodayCard: React.FC<EmployeeTodayCardProps> = ({
  employee,
  shifts,
  branches
}) => {
  const todayISO = new Date().toISOString().slice(0, 10);
  const employeeShifts = shifts.filter((s) => s.employeeId === employee.id);

  // Today's shift
  const todayShift = employeeShifts.find((s) => s.date === todayISO);

  // Next upcoming shift
  const upcomingShifts = employeeShifts
    .filter((s) => s.date >= todayISO && !s.restDay && (s.startTime || s.templateId))
    .sort((a, b) => a.date.localeCompare(b.date));

  const nextShift = todayShift && !todayShift.restDay ? todayShift : upcomingShifts[0];

  const habitualBranch = branches.find((b) => b.id === employee.branchId);

  const getBranchForShift = (shift?: Shift) => {
    if (!shift) return habitualBranch;
    const branchId = shift.overrideBranchId || employee.branchId;
    return branches.find((b) => b.id === branchId) || habitualBranch;
  };

  const todayWorkdayInfo = getColombianWorkdayInfo(todayISO);

  // Format time range nicely
  const formatShiftTimes = (shift: Shift) => {
    if (shift.restDay) return 'Día Libre / Descanso';
    const first = `${shift.startTime ?? '-'} a ${shift.endTime ?? '-'}`;
    if (shift.secondStart || shift.secondEnd) {
      return `${first} y ${shift.secondStart ?? '-'} a ${shift.secondEnd ?? '-'}`;
    }
    return first;
  };

  const getShiftKindLabel = (shift: Shift, branch?: Branch): { label: string; kindClass: string } => {
    if (shift.restDay) return { label: 'Descanso', kindClass: 'chip-descanso' };
    if (shift.templateId && branch) {
      const tmpl = branch.shiftTemplates.find((t) => t.id === shift.templateId);
      if (tmpl) {
        return {
          label: tmpl.kind.toUpperCase(),
          kindClass: `chip-${tmpl.kind}`
        };
      }
    }
    if (shift.secondStart || shift.secondEnd) {
      return { label: 'PARTIDO', kindClass: 'chip-partido' };
    }
    return { label: 'TURNO REGULAR', kindClass: 'chip-normal' };
  };

  const effectiveBranch = getBranchForShift(todayShift);
  const isRotation = todayShift?.overrideBranchId && todayShift.overrideBranchId !== employee.branchId;

  return (
    <div className="employee-hero-card panel">
      <div className="hero-top-row">
        <div className="hero-greeting">
          <span className="badge-today-label">
            <Calendar size={14} />
            <span>HOY · {todayISO}</span>
          </span>
          {todayWorkdayInfo.holidays.length > 0 && (
            <span className="badge-holiday">
              <Sparkles size={13} />
              <span>Festivo: {todayWorkdayInfo.holidays[0].name}</span>
            </span>
          )}
        </div>

        <div className="hero-branch-badge">
          <MapPin size={14} />
          <span>Sede habitual: {habitualBranch?.name ?? 'No asignada'}</span>
        </div>
      </div>

      <div className="hero-status-body">
        {todayShift && !todayShift.restDay && (todayShift.startTime || todayShift.templateId) ? (
          <div className="hero-shift-active">
            <div className="hero-kind-row">
              {(() => {
                const { label, kindClass } = getShiftKindLabel(todayShift, effectiveBranch);
                return (
                  <span className={`chip ${kindClass} chip-active`}>
                    {label}
                  </span>
                );
              })()}
              {isRotation && (
                <span className="badge-rotation">
                  Turno en sede: {effectiveBranch?.name}
                </span>
              )}
              {employee.role && (
                <span className="badge-role">
                  Rol: {employee.role === 'sala' ? 'Sala' : 'Domicilio'}
                </span>
              )}
            </div>

            <div className="hero-time-display">
              <Clock size={28} className="time-icon" />
              <div>
                <div className="time-range">{formatShiftTimes(todayShift)}</div>
                <div className="time-subtitle">
                  {effectiveBranch?.name ? `Sede ${effectiveBranch.name}` : ''}
                </div>
              </div>
            </div>
          </div>
        ) : todayShift?.restDay ? (
          <div className="hero-rest-active">
            <Coffee size={32} color="#6B7280" />
            <div>
              <h3>Hoy es tu día libre</h3>
              <p className="muted">Disfruta tu descanso. No tienes turnos programados para hoy.</p>
            </div>
          </div>
        ) : (
          <div className="hero-rest-active">
            <Coffee size={32} color="#D97706" />
            <div>
              <h3>Sin turno registrado para hoy</h3>
              <p className="muted">No hay turno activo para la fecha actual.</p>
            </div>
          </div>
        )}
      </div>

      {/* Next Shift Banner if today is off or done */}
      {(!todayShift || todayShift.restDay) && nextShift && nextShift.date !== todayISO && (
        <div className="hero-next-shift-banner">
          <div className="next-shift-info">
            <span className="muted label">Próximo turno:</span>
            <strong>{nextShift.date}</strong>
            <span>({formatShiftTimes(nextShift)})</span>
            <span className="next-branch-badge">
              {getBranchForShift(nextShift)?.name}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
