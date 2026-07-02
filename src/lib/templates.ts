import type { Branch, DayScope, EmployeeRole, ShiftKind, ShiftTemplate } from '../types/payroll';

/**
 * Determina si un DayScope cubre un día de la semana específico.
 */
function dayScopeMatches(dayScope: DayScope, dayOfWeek: number): boolean {
  switch (dayScope) {
    case 'all':
      return true;
    case 'mon-sat':
      return dayOfWeek >= 1 && dayOfWeek <= 6;
    case 'sun':
      return dayOfWeek === 0;
    case 'sun-thu':
      return dayOfWeek >= 0 && dayOfWeek <= 4;
    case 'fri-sat':
      return dayOfWeek === 5 || dayOfWeek === 6;
  }
}

/**
 * Busca en el catálogo de plantillas de una sede la primera que coincida
 * con la fecha, rol opcional y tipo de turno opcional.
 *
 * - Filtra por dayScope según el día de la semana de dateISO.
 * - Si se pasa `kind`, filtra por ese tipo de turno.
 * - Si la plantilla requiere un rol y no se pasa, no hay match.
 * - Devuelve undefined si no hay ninguna plantilla que cumpla todos los filtros.
 */
export function resolveTemplateForDate(
  branch: Branch | undefined,
  dateISO: string,
  options?: { role?: EmployeeRole; kind?: ShiftKind }
): ShiftTemplate | undefined {
  if (!branch) return undefined;
  const date = new Date(`${dateISO}T12:00:00Z`);
  const dayOfWeek = date.getUTCDay();

  return branch.shiftTemplates.find((t) => {
    if (!dayScopeMatches(t.dayScope, dayOfWeek)) return false;
    if (options?.kind && t.kind !== options.kind) return false;
    if (t.role && t.role !== options?.role) return false;
    return true;
  });
}

/**
 * Devuelve todas las plantillas de una sede que aplican para una fecha y rol dados.
 * Útil para poblar los chips disponibles en la celda de horario.
 */
export function listTemplatesForDate(
  branch: Branch | undefined,
  dateISO: string,
  role?: EmployeeRole
): ShiftTemplate[] {
  if (!branch) return [];
  const date = new Date(`${dateISO}T12:00:00Z`);
  const dayOfWeek = date.getUTCDay();

  return branch.shiftTemplates.filter((t) => {
    if (!dayScopeMatches(t.dayScope, dayOfWeek)) return false;
    if (t.role && t.role !== role) return false;
    return true;
  });
}
