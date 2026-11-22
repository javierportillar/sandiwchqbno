import React, { useState } from 'react';
import type { Employee, PayrollSettings } from '../../types/payroll';
import { authenticateEmployee, verifyAdminPin, DEFAULT_ADMIN_PIN } from '../../lib/employeeAuth';
import { LogIn, KeyRound, UserCheck, Sparkles, Building2, AlertCircle } from 'lucide-react';

interface EmployeeLoginProps {
  employees: Employee[];
  settings: PayrollSettings;
  onLoginSuccess: (employee: Employee) => void;
  onAdminLoginSuccess: () => void;
  onCancel?: () => void;
  allowCancel?: boolean;
}

export const EmployeeLogin: React.FC<EmployeeLoginProps> = ({
  employees,
  settings,
  onLoginSuccess,
  onAdminLoginSuccess,
  onCancel,
  allowCancel = false
}) => {
  const [mode, setMode] = useState<'employee' | 'admin'>('employee');
  const [documentId, setDocumentId] = useState('');
  const [pin, setPin] = useState('');
  const [adminPinInput, setAdminPinInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleEmployeeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const result = authenticateEmployee(employees, documentId, pin);
    if (result.ok) {
      onLoginSuccess(result.employee);
    } else {
      setError(result.error);
    }
  };

  const handleAdminSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!adminPinInput.trim()) {
      setError('Por favor ingresa el PIN maestro de Administrador.');
      return;
    }
    const isValid = verifyAdminPin(settings, adminPinInput);
    if (isValid) {
      onAdminLoginSuccess();
    } else {
      setError('PIN de Administrador incorrecto.');
    }
  };

  const handleQuickEmployeeLogin = (emp: Employee) => {
    const defaultPin = emp.pin || (emp.documentId ? emp.documentId.slice(-4) : DEFAULT_ADMIN_PIN);
    setDocumentId(emp.documentId ?? '');
    setPin(defaultPin);
    setError(null);
    const result = authenticateEmployee(employees, emp.documentId ?? '', defaultPin);
    if (result.ok) {
      onLoginSuccess(result.employee);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card panel">
        <div className="login-header">
          <div className="login-brand-icon">
            <Building2 size={28} color="#D97706" />
          </div>
          <h2>Sándwich Qbano</h2>
          <p className="muted">Portal de Consulta y Horarios de Empleados</p>
        </div>

        <div className="login-mode-tabs">
          <button
            type="button"
            className={`tab-btn ${mode === 'employee' ? 'active' : ''}`}
            onClick={() => {
              setMode('employee');
              setError(null);
            }}
          >
            <UserCheck size={16} />
            <span>Soy Empleado</span>
          </button>
          <button
            type="button"
            className={`tab-btn ${mode === 'admin' ? 'active' : ''}`}
            onClick={() => {
              setMode('admin');
              setError(null);
            }}
          >
            <KeyRound size={16} />
            <span>Modo Administrador</span>
          </button>
        </div>

        {error && (
          <div className="login-error-alert" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {mode === 'employee' ? (
          <form onSubmit={handleEmployeeSubmit} className="login-form">
            <label>
              <span className="label-text">Número de Cédula o Documento</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Ej. 10101010"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                autoComplete="username"
                required
              />
            </label>

            <label>
              <span className="label-text">PIN de Acceso (4 dígitos)</span>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoComplete="current-password"
                required
              />
              <small className="muted helper-text">
                Por defecto son los últimos 4 dígitos de tu cédula.
              </small>
            </label>

            <button type="submit" className="primary btn-block">
              <LogIn size={18} />
              <span>Ingresar a Mi Portal</span>
            </button>
          </form>
        ) : (
          <form onSubmit={handleAdminSubmit} className="login-form">
            <label>
              <span className="label-text">PIN Maestro de Administrador</span>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                placeholder="••••"
                value={adminPinInput}
                onChange={(e) => setAdminPinInput(e.target.value)}
                autoComplete="current-password"
                required
              />
              <small className="muted helper-text">
                PIN de control de operador / nómina (Por defecto: 1234).
              </small>
            </label>

            <button type="submit" className="primary btn-block">
              <KeyRound size={18} />
              <span>Acceder al Panel de Gestión</span>
            </button>
          </form>
        )}

        {/* Demo Fast Access Section */}
        <div className="login-demo-section">
          <div className="demo-title">
            <Sparkles size={14} color="#D97706" />
            <span>Acceso rápido de prueba</span>
          </div>
          <div className="demo-chips">
            {employees.slice(0, 3).map((emp) => (
              <button
                key={emp.id}
                type="button"
                className="chip-quick-access"
                onClick={() => handleQuickEmployeeLogin(emp)}
                title={`Ingresar como ${emp.fullName} (Cédula: ${emp.documentId})`}
              >
                <span>{emp.fullName.split(' ')[0]}</span>
                <span className="badge-hint">PIN: {emp.pin || emp.documentId?.slice(-4)}</span>
              </button>
            ))}
            <button
              type="button"
              className="chip-quick-access admin-chip"
              onClick={() => onAdminLoginSuccess()}
              title="Entrar directo al Panel de Administrador"
            >
              <span>Admin (1234)</span>
            </button>
          </div>
        </div>

        {allowCancel && onCancel && (
          <div className="login-footer-actions">
            <button type="button" className="subtle btn-sm" onClick={onCancel}>
              Volver
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
