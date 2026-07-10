import type { Shift } from '../types/payroll';

export interface SessionAssignment {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  kind: 'partido' | 'normal' | 'doblado' | 'descanso';
  previousShiftJson: string | null;
  assignedShiftJson: string;
}

const isSameCell = (left: SessionAssignment, right: SessionAssignment) =>
  left.employeeId === right.employeeId && left.date === right.date;

const isSameShiftCell = (shift: Shift, assignment: SessionAssignment, periodId: string) =>
  shift.employeeId === assignment.employeeId &&
  shift.payPeriodId === periodId &&
  shift.date === assignment.date;

export const hasNewerAssignmentForCell = (
  assignments: SessionAssignment[],
  assignment: SessionAssignment
): boolean => {
  const index = assignments.findIndex((item) => item.id === assignment.id);
  return index >= 0 && assignments.slice(index + 1).some((item) => isSameCell(item, assignment));
};

export const restoreAssignmentInList = (
  items: Shift[],
  assignment: SessionAssignment,
  periodId: string
): Shift[] => {
  const current = items.find((shift) => isSameShiftCell(shift, assignment, periodId));
  if (!current || JSON.stringify(current) !== assignment.assignedShiftJson) {
    return items;
  }

  const withoutCurrent = items.filter((shift) => !isSameShiftCell(shift, assignment, periodId));
  if (!assignment.previousShiftJson) {
    return withoutCurrent;
  }

  return [...withoutCurrent, JSON.parse(assignment.previousShiftJson) as Shift];
};

export const canRestoreAssignment = (
  assignments: SessionAssignment[],
  items: Shift[],
  assignment: SessionAssignment,
  periodId: string
): boolean => {
  if (hasNewerAssignmentForCell(assignments, assignment)) {
    return false;
  }

  const current = items.find((shift) => isSameShiftCell(shift, assignment, periodId));
  return Boolean(current && JSON.stringify(current) === assignment.assignedShiftJson);
};
