import { describe, expect, it } from 'vitest';
import {
  authenticateEmployee,
  getEffectiveEmployeePin,
  verifyAdminPin,
  DEFAULT_ADMIN_PIN
} from '../lib/employeeAuth';
import type { Employee, PayrollSettings } from '../types/payroll';
import { defaultSettings } from '../data/seed';

const mockEmployees: Employee[] = [
  {
    id: 'emp-1',
    companyId: 'company-qbano',
    branchId: 'branch-unicentro',
    fullName: 'Laura Martínez',
    documentId: '10101010',
    baseMonthlySalary: 1650000,
    active: true,
    pin: '1010'
  },
  {
    id: 'emp-2',
    companyId: 'company-qbano',
    branchId: 'branch-unico',
    fullName: 'Juan Camilo Rojas',
    documentId: '20202020',
    baseMonthlySalary: 1550000,
    active: true
    // no pin explicitly set -> should fallback to last 4 digits: '2020'
  },
  {
    id: 'emp-inactive',
    companyId: 'company-qbano',
    branchId: 'branch-avenida',
    fullName: 'Empleado Inactivo',
    documentId: '99999999',
    baseMonthlySalary: 1500000,
    active: false,
    pin: '9999'
  }
];

describe('employeeAuth', () => {
  describe('getEffectiveEmployeePin', () => {
    it('returns explicit pin when defined', () => {
      expect(getEffectiveEmployeePin(mockEmployees[0])).toBe('1010');
    });

    it('derives pin from last 4 digits of documentId when pin is not set', () => {
      expect(getEffectiveEmployeePin(mockEmployees[1])).toBe('2020');
    });

    it('falls back to default admin pin when document is too short and pin is missing', () => {
      const shortDocEmp: Employee = {
        ...mockEmployees[0],
        documentId: '12',
        pin: undefined
      };
      expect(getEffectiveEmployeePin(shortDocEmp)).toBe(DEFAULT_ADMIN_PIN);
    });
  });

  describe('authenticateEmployee', () => {
    it('authenticates with correct documentId and pin', () => {
      const res = authenticateEmployee(mockEmployees, '10101010', '1010');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.employee.fullName).toBe('Laura Martínez');
      }
    });

    it('authenticates using derived last 4 digits pin', () => {
      const res = authenticateEmployee(mockEmployees, '20202020', '2020');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.employee.fullName).toBe('Juan Camilo Rojas');
      }
    });

    it('rejects empty document', () => {
      const res = authenticateEmployee(mockEmployees, '', '1010');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/documento/i);
      }
    });

    it('rejects empty pin', () => {
      const res = authenticateEmployee(mockEmployees, '10101010', '');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/pin/i);
      }
    });

    it('rejects unknown document', () => {
      const res = authenticateEmployee(mockEmployees, '55555555', '1234');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/no se encontró ningún empleado/i);
      }
    });

    it('rejects incorrect pin', () => {
      const res = authenticateEmployee(mockEmployees, '10101010', '9999');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/pin ingresado es incorrecto/i);
      }
    });

    it('rejects inactive employee', () => {
      const res = authenticateEmployee(mockEmployees, '99999999', '9999');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/inactivo/i);
      }
    });
  });

  describe('verifyAdminPin', () => {
    it('accepts configured admin pin', () => {
      const settings: PayrollSettings = {
        ...defaultSettings,
        adminPin: '9876'
      };
      expect(verifyAdminPin(settings, '9876')).toBe(true);
      expect(verifyAdminPin(settings, '1234')).toBe(false);
    });

    it('falls back to default admin pin 1234 when not set', () => {
      const settings: PayrollSettings = {
        ...defaultSettings,
        adminPin: undefined
      };
      expect(verifyAdminPin(settings, '1234')).toBe(true);
      expect(verifyAdminPin(settings, '0000')).toBe(false);
    });
  });
});
