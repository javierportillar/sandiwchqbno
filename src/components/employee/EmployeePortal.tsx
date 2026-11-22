import React, { useState } from 'react';
import type { Employee, Shift, Branch, PayPeriod, PayrollSettings } from '../../types/payroll';
import { EmployeeTodayCard } from './EmployeeTodayCard';
import { EmployeeWeekSchedule } from './EmployeeWeekSchedule';
import { EmployeeHoursView } from './EmployeeHoursView';
import { EmployeeProfileView } from './EmployeeProfileView';
import {
  Calendar,
  Clock,
  User,
  LogOut,
  Building2,
  CalendarDays,
  KeyRound
} from 'lucide-react';

interface EmployeePortalProps {
  employee: Employee;
  shifts: Shift[];
  branches: Branch[];
  periods: PayPeriod[];
  settings: PayrollSettings;
  onLogout: () => void;
  onSwitchToAdmin: () => void;
  onUpdateEmployeePin: (employeeId: string, newPin: string) => void;
}

type EmployeeTab = 'today' | 'week' | 'hours' | 'profile';

export const EmployeePortal: React.FC<EmployeePortalProps> = ({
  employee,
  shifts,
  branches,
  periods,
  settings,
  onLogout,
  onSwitchToAdmin,
  onUpdateEmployeePin
}) => {
  const [activeTab, setActiveTab] = useState<EmployeeTab>('today');

  const habitualBranch = branches.find((b) => b.id === employee.branchId);

  return (
    <div className="employee-portal-shell grid">
      {/* Top Employee Navigation Bar */}
      <header className="employee-top-header panel">
        <div className="header-left">
          <div className="brand-logo-pill">
            <Building2 size={20} color="#D97706" />
            <span className="brand-name">Sándwich Qbano</span>
          </div>
          <span className="portal-badge">Portal del Empleado</span>
        </div>

        <div className="header-center">
          <div className="employee-user-badge">
            <div className="user-avatar-circle">
              <User size={16} />
            </div>
            <div className="user-info">
              <span className="user-name">{employee.fullName}</span>
              <span className="user-sub">
                {habitualBranch?.name ? `Sede ${habitualBranch.name}` : ''}
                {employee.role ? ` · ${employee.role === 'sala' ? 'Sala' : 'Domicilio'}` : ''}
              </span>
            </div>
          </div>
        </div>

        <div className="header-right">
          <button
            type="button"
            className="subtle btn-admin-switch"
            onClick={onSwitchToAdmin}
            title="Ir al panel de administración"
          >
            <KeyRound size={16} />
            <span className="hide-on-mobile">Panel Admin</span>
          </button>
          <button
            type="button"
            className="danger btn-logout"
            onClick={onLogout}
            title="Cerrar sesión"
          >
            <LogOut size={16} />
            <span className="hide-on-mobile">Salir</span>
          </button>
        </div>
      </header>

      {/* Tabs Menu */}
      <nav className="employee-nav-tabs">
        <button
          type="button"
          className={`employee-tab-btn ${activeTab === 'today' ? 'active' : ''}`}
          onClick={() => setActiveTab('today')}
        >
          <Clock size={18} />
          <span>Hoy y Próximo Turno</span>
        </button>

        <button
          type="button"
          className={`employee-tab-btn ${activeTab === 'week' ? 'active' : ''}`}
          onClick={() => setActiveTab('week')}
        >
          <CalendarDays size={18} />
          <span>Mi Semana</span>
        </button>

        <button
          type="button"
          className={`employee-tab-btn ${activeTab === 'hours' ? 'active' : ''}`}
          onClick={() => setActiveTab('hours')}
        >
          <Calendar size={18} />
          <span>Mis Horas Quincenales</span>
        </button>

        <button
          type="button"
          className={`employee-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <User size={18} />
          <span>Mi Perfil y PIN</span>
        </button>
      </nav>

      {/* Active Content */}
      <main className="employee-portal-content">
        {activeTab === 'today' && (
          <div className="grid">
            <EmployeeTodayCard employee={employee} shifts={shifts} branches={branches} />
            <EmployeeWeekSchedule
              employee={employee}
              shifts={shifts}
              branches={branches}
            />
          </div>
        )}

        {activeTab === 'week' && (
          <EmployeeWeekSchedule
            employee={employee}
            shifts={shifts}
            branches={branches}
          />
        )}

        {activeTab === 'hours' && (
          <EmployeeHoursView
            employee={employee}
            shifts={shifts}
            periods={periods}
            settings={settings}
            branches={branches}
          />
        )}

        {activeTab === 'profile' && (
          <EmployeeProfileView
            employee={employee}
            branches={branches}
            onUpdatePin={onUpdateEmployeePin}
          />
        )}
      </main>
    </div>
  );
};
