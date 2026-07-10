import { describe, expect, it } from 'vitest';
import {
  canRestoreAssignment,
  hasNewerAssignmentForCell,
  restoreAssignmentInList
} from '../lib/brushSession';
import type { SessionAssignment } from '../lib/brushSession';
import type { Shift } from '../types/payroll';

const originalShift: Shift = {
  id: 'shift-1',
  employeeId: 'emp-1',
  payPeriodId: 'period-1',
  date: '2026-01-05',
  startTime: '08:00',
  endTime: '17:00',
  breakMinutes: 60
};

const makeAssignment = (
  id: string,
  previousShift: Shift | null,
  assignedShift: Shift
): SessionAssignment => ({
  id,
  employeeId: assignedShift.employeeId,
  employeeName: 'Laura',
  date: assignedShift.date,
  kind: 'normal',
  previousShiftJson: previousShift ? JSON.stringify(previousShift) : null,
  assignedShiftJson: JSON.stringify(assignedShift)
});

describe('sesión de pincel', () => {
  it('un undo antiguo no puede sobrescribir una asignación posterior de la misma celda', () => {
    const firstAssignment = {
      ...originalShift,
      startTime: '10:00',
      endTime: '19:00'
    };
    const secondAssignment = {
      ...firstAssignment,
      startTime: '12:00',
      endTime: '22:00'
    };
    const first = makeAssignment('a1', originalShift, firstAssignment);
    const second = makeAssignment('a2', firstAssignment, secondAssignment);
    const history = [first, second];

    expect(hasNewerAssignmentForCell(history, first)).toBe(true);
    expect(canRestoreAssignment(history, [secondAssignment], first, 'period-1')).toBe(false);
    expect(restoreAssignmentInList([secondAssignment], first, 'period-1')).toEqual([
      secondAssignment
    ]);

    expect(canRestoreAssignment(history, [secondAssignment], second, 'period-1')).toBe(true);
    expect(restoreAssignmentInList([secondAssignment], second, 'period-1')).toEqual([
      firstAssignment
    ]);
  });
});
