import type { Employee, PayrollSettings, EmployeeAuthSession } from '../types/payroll';

export const AUTH_SESSION_KEY = 'qbano-auth-session';
export const DEFAULT_ADMIN_PIN = '1234';

/**
 * Resolves the effective PIN for an employee.
 * If employee has an explicit pin set, use it.
 * Otherwise, derive from the last 4 digits of documentId, or fallback to '1234'.
 */
export function getEffectiveEmployeePin(employee: Employee): string {
  if (employee.pin && employee.pin.trim().length > 0) {
    return employee.pin.trim();
  }
  const cleanDoc = (employee.documentId ?? '').replace(/\D/g, '');
  if (cleanDoc.length >= 4) {
    return cleanDoc.slice(-4);
  }
  return DEFAULT_ADMIN_PIN;
}

export type AuthResult =
  | { ok: true; employee: Employee }
  | { ok: false; error: string };

/**
 * Authenticates an employee by documentId and 4-digit PIN.
 */
export function authenticateEmployee(
  employees: Employee[],
  documentId: string,
  pin: string
): AuthResult {
  const cleanDoc = (documentId ?? '').trim();
  const cleanPin = (pin ?? '').trim();

  if (!cleanDoc) {
    return { ok: false, error: 'Por favor ingresa tu número de documento o cédula.' };
  }

  if (!cleanPin) {
    return { ok: false, error: 'Por favor ingresa tu PIN de acceso de 4 dígitos.' };
  }

  const employee = employees.find(
    (emp) => (emp.documentId ?? '').trim() === cleanDoc
  );

  if (!employee) {
    return {
      ok: false,
      error: 'No se encontró ningún empleado con ese número de documento.'
    };
  }

  if (!employee.active) {
    return {
      ok: false,
      error: 'El empleado está registrado como inactivo. Consulta con tu supervisor.'
    };
  }

  const expectedPin = getEffectiveEmployeePin(employee);
  if (cleanPin !== expectedPin) {
    return {
      ok: false,
      error: 'El PIN ingresado es incorrecto. Intenta nuevamente.'
    };
  }

  return { ok: true, employee };
}

/**
 * Validates the master admin PIN.
 */
export function verifyAdminPin(settings: PayrollSettings, pin: string): boolean {
  const expectedPin = (settings.adminPin ?? '').trim() || DEFAULT_ADMIN_PIN;
  return (pin ?? '').trim() === expectedPin;
}

/**
 * Read current session from localStorage safely.
 */
export function getStoredEmployeeSession(): EmployeeAuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.employeeId === 'string') {
      return parsed as EmployeeAuthSession;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Store or clear current session in localStorage.
 */
export function setStoredEmployeeSession(session: EmployeeAuthSession | null): void {
  try {
    if (!session) {
      localStorage.removeItem(AUTH_SESSION_KEY);
    } else {
      localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // ignore local storage errors in sandboxed contexts
  }
}
