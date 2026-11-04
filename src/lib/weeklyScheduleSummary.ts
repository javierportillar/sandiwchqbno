import type { Branch, Employee, Shift } from '../types/payroll';
import { getScheduleWeekDates } from './scheduleWeek';
import type { EmployeeWeekSchedule, ScheduleWeek } from './scheduleWeek';
import { calculateWeeklyScheduledMinutes } from './weeklySchedule';

export interface WeeklyScheduleBranchSummary {
  branchId: string;
  branchName: string;
  scheduledMinutes: number;
  scheduledEmployeeCount: number;
  shareOfTotalHours: number;
}

export interface WeeklyScheduleDaySummary {
  date: string;
  scheduledMinutes: number;
  minutesByBranch: Record<string, number>;
  unattributedMinutes: number;
}

export interface WeeklyScheduleSummary {
  week: ScheduleWeek;
  registeredEmployeeCount: number;
  activeEmployeeCount: number;
  scheduledEmployeeCount: number;
  unassignedActiveEmployeeCount: number;
  shiftCount: number;
  scheduledMinutes: number;
  unattributedMinutes: number;
  branches: WeeklyScheduleBranchSummary[];
  days: WeeklyScheduleDaySummary[];
}

function addMinutes(target: Record<string, number>, key: string, minutes: number): void {
  target[key] = (target[key] ?? 0) + minutes;
}

export function buildWeeklyScheduleSummary(input: {
  week: ScheduleWeek;
  employees: readonly Employee[];
  schedules: readonly EmployeeWeekSchedule[];
  branches: readonly Branch[];
  shifts: readonly Shift[];
}): WeeklyScheduleSummary {
  const { week, employees, schedules, branches, shifts } = input;
  const minutesByDay = new Map<string, Record<string, number>>();
  const totalMinutesByDay = new Map<string, number>();
  const scheduledBranchesByEmployee = new Map<string, Set<string>>();
  const scheduledEmployeeIds = new Set<string>();
  const contributingShiftIds = new Set<string>();
  let scheduledMinutes = 0;

  for (const schedule of schedules) {
    const employeeId = schedule.employee.id;
    const employeeShifts = shifts.filter((shift) => shift.employeeId === employeeId);
    const branchIds = [...new Set(employeeShifts.map((shift) => shift.overrideBranchId ?? schedule.employee.branchId))];
    const byBranchAndDay = new Map<string, Map<string, number>>();

    for (const branchId of branchIds) {
      const branchResult = calculateWeeklyScheduledMinutes({
        employeeId,
        week,
        shifts: employeeShifts.filter((shift) => (shift.overrideBranchId ?? schedule.employee.branchId) === branchId)
      });
      byBranchAndDay.set(branchId, new Map(branchResult.byDate.map(({ date, scheduledMinutes: minutes }) => [date, minutes])));
    }

    scheduledMinutes += schedule.calculation.assignedMinutes;
    if (schedule.calculation.assignedMinutes > 0) scheduledEmployeeIds.add(employeeId);
    for (const shift of employeeShifts) {
      if (calculateWeeklyScheduledMinutes({ employeeId, week, shifts: [shift] }).assignedMinutes > 0) {
        contributingShiftIds.add(shift.id);
      }
    }

    const dayTotals = new Map(schedule.calculation.byDate.map(({ date, scheduledMinutes: minutes }) => [date, minutes]));
    for (const [date, totalForDay] of dayTotals) {
      totalMinutesByDay.set(date, (totalMinutesByDay.get(date) ?? 0) + totalForDay);
      const branchMinutes = [...byBranchAndDay.entries()].map(([branchId, dailyMinutes]) => ({
        branchId,
        minutes: dailyMinutes.get(date) ?? 0
      }));
      const sumByAllBranches = branchMinutes.reduce((sum, entry) => sum + entry.minutes, 0);
      const dayAllocation = minutesByDay.get(date) ?? {};

      if (sumByAllBranches > totalForDay) {
        // The per-branch unions overlap; preserve the authoritative total without double-counting a location.
        addMinutes(dayAllocation, '__unattributed__', totalForDay);
      } else {
        for (const { branchId, minutes } of branchMinutes) {
          if (minutes === 0) continue;
          if (!branches.some((branch) => branch.id === branchId)) {
            addMinutes(dayAllocation, '__unattributed__', minutes);
            continue;
          }
          addMinutes(dayAllocation, branchId, minutes);
          const employeeBranches = scheduledBranchesByEmployee.get(employeeId) ?? new Set<string>();
          employeeBranches.add(branchId);
          scheduledBranchesByEmployee.set(employeeId, employeeBranches);
        }
        addMinutes(dayAllocation, '__unattributed__', totalForDay - sumByAllBranches);
      }
      minutesByDay.set(date, dayAllocation);
    }
  }

  const branchEmployeeIds = new Map(branches.map((branch) => [branch.id, new Set<string>()]));
  for (const [employeeId, employeeBranches] of scheduledBranchesByEmployee) {
    for (const branchId of employeeBranches) branchEmployeeIds.get(branchId)?.add(employeeId);
  }

  const branchMinutes = new Map(branches.map((branch) => [branch.id, 0]));
  let unattributedMinutes = 0;
  for (const day of minutesByDay.values()) {
    for (const [branchId, minutes] of Object.entries(day)) {
      if (branchId === '__unattributed__') unattributedMinutes += minutes;
      else if (branchMinutes.has(branchId)) branchMinutes.set(branchId, (branchMinutes.get(branchId) ?? 0) + minutes);
      else unattributedMinutes += minutes;
    }
  }

  const activeEmployees = employees.filter((employee) => employee.active);
  const activeScheduledEmployeeCount = activeEmployees.filter((employee) => scheduledEmployeeIds.has(employee.id)).length;
  const daySummaries = getScheduleWeekDates(week).map((date) => {
    const allocation = minutesByDay.get(date) ?? {};
    const byBranch = Object.fromEntries(branches.map((branch) => [branch.id, allocation[branch.id] ?? 0]));
    return {
      date,
      scheduledMinutes: totalMinutesByDay.get(date) ?? 0,
      minutesByBranch: byBranch,
      unattributedMinutes: allocation.__unattributed__ ?? 0
    };
  });

  return {
    week,
    registeredEmployeeCount: employees.length,
    activeEmployeeCount: activeEmployees.length,
    scheduledEmployeeCount: scheduledEmployeeIds.size,
    unassignedActiveEmployeeCount: activeEmployees.length - activeScheduledEmployeeCount,
    shiftCount: contributingShiftIds.size,
    scheduledMinutes,
    unattributedMinutes,
    branches: branches.map((branch) => {
      const minutes = branchMinutes.get(branch.id) ?? 0;
      return {
        branchId: branch.id,
        branchName: branch.name,
        scheduledMinutes: minutes,
        scheduledEmployeeCount: branchEmployeeIds.get(branch.id)?.size ?? 0,
        shareOfTotalHours: scheduledMinutes > 0 ? minutes / scheduledMinutes : 0
      };
    }),
    days: daySummaries
  };
}
