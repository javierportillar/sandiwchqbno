import React, { useState } from 'react';
import type { Employee, Branch } from '../../types/payroll';
import { getEffectiveEmployeePin } from '../../lib/employeeAuth';
import { User, KeyRound, CheckCircle, AlertCircle, Shield, Building2 } from 'lucide-react';

interface EmployeeProfileViewProps {
  employee: Employee;
  branches: Branch[];
  onUpdatePin: (employeeId: string, newPin: string) => void;
}

export const EmployeeProfileView: React.FC<EmployeeProfileViewProps> = ({
  employee,
  branches,
  onUpdatePin
}) => {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const habitualBranch = branches.find((b) => b.id === employee.branchId);
  const effectivePin = getEffectiveEmployeePin(employee);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (currentPin.trim() !== effectivePin) {
      setMessage({ type: 'error', text: 'El PIN actual ingresado no coincide.' });
      return;
    }

    const cleanNew = newPin.trim();
    if (!/^\d{4,6}$/.test(cleanNew)) {
      setMessage({
        type: 'error',
        text: 'El nuevo PIN debe tener entre 4 y 6 dígitos numéricos.'
      });
      return;
    }

    if (cleanNew !== confirmPin.trim()) {
      setMessage({ type: 'error', text: 'La confirmación del nuevo PIN no coincide.' });
      return;
    }

    onUpdatePin(employee.id, cleanNew);
    setMessage({ type: 'success', text: '¡Tu PIN de acceso ha sido actualizado correctamente!' });
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
  };

  return (
    <div className="employee-profile-container grid grid-2">
      {/* Information Card */}
      <div className="panel grid">
        <div className="profile-header-card">
          <div className="profile-avatar">
            <User size={36} color="#D97706" />
          </div>
          <div>
            <h3>{employee.fullName}</h3>
            <span className="muted">Cédula: {employee.documentId ?? 'No registrada'}</span>
          </div>
        </div>

        <div className="profile-details-list">
          <div className="detail-item">
            <span className="detail-label">
              <Building2 size={16} /> Sede Habitual
            </span>
            <strong className="detail-value">{habitualBranch?.name ?? 'Sin asignar'}</strong>
          </div>

          <div className="detail-item">
            <span className="detail-label">
              <Shield size={16} /> Rol Operativo
            </span>
            <strong className="detail-value">
              {employee.role ? (employee.role === 'sala' ? 'Personal de Sala' : 'Domiciliario') : 'General'}
            </strong>
          </div>

          <div className="detail-item">
            <span className="detail-label">
              <CheckCircle size={16} /> Estado
            </span>
            <span className="badge-active-status">
              {employee.active ? 'Activo en nómina' : 'Inactivo'}
            </span>
          </div>
        </div>
      </div>

      {/* Change PIN Form */}
      <div className="panel grid">
        <div className="pin-form-header">
          <KeyRound size={20} color="#0891B2" />
          <h3>Seguridad y PIN de Acceso</h3>
        </div>
        <p className="muted">
          Puedes actualizar tu PIN de 4 dígitos para acceder a tus turnos y horarios.
        </p>

        {message && (
          <div className={`message-alert ${message.type}`}>
            {message.type === 'success' ? (
              <CheckCircle size={18} color="#15803D" />
            ) : (
              <AlertCircle size={18} color="#9e1f28" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="pin-form grid">
          <label>
            <span className="label-text">PIN Actual</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="••••"
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value)}
              required
            />
          </label>

          <label>
            <span className="label-text">Nuevo PIN (4 a 6 dígitos)</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="••••"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              required
            />
          </label>

          <label>
            <span className="label-text">Confirmar Nuevo PIN</span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="••••"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              required
            />
          </label>

          <button type="submit" className="primary btn-block">
            <span>Guardar Nuevo PIN</span>
          </button>
        </form>
      </div>
    </div>
  );
};
