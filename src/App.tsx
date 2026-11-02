import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AppTab,
  Branch,
  CalculationResult,
  Employee,
  EmployeeRole,
  HourTotals,
  PayPeriod,
  PayrollSettings,
  Shift,
  ShiftKind,
  ShiftTemplate
} from './types/payroll';
import {
  defaultSettings,
  seededBranches,
  seededCompany,
  seededEmployees,
  seededPayPeriods,
  seededShifts
} from './data/seed';
import { checkSnapshot, fixed2, getStorageLockManager, loadState, pesos, saveState, STORAGE_KEYS as KEY, uid, withStorageLock } from './lib/storage';
import { LocalBackup, LocalRestoreRecovery } from './components/LocalBackup';
import { readRestoreJournal, RESTORE_JOURNAL_KEY } from './lib/localBackup';
import type { RestoreJournalRead, RestoreResult } from './lib/localBackup';
import { ShiftEditor } from './components/ShiftEditor';
import { WeekNavigator } from './components/WeekNavigator';
import { WeekSchedule } from './components/WeekSchedule';
import type { EmployeeWeekActions } from './components/EmployeeWeekCard';
import { duplicateShiftGroups, endsBeyondPeriodEnd, isEmptyShift, needsShiftReview, normalTemplateForEmployee, templateFields } from './lib/shiftSafety';
import type { StorageReadError, StorageSnapshot } from './lib/storage';
import { aggregateDailyAndPeriod, calculateShiftTotals } from './lib/calculation';
import { exportPayrollExcel } from './lib/exportExcel';
import { resolveTemplateForDate, listTemplatesForDate } from './lib/templates';
import { canRestoreAssignment, restoreAssignmentInList } from './lib/brushSession';
import type { SessionAssignment } from './lib/brushSession';
import {
  addDaysToDate,
  buildEmployeeWeekSchedule,
  buildScheduleCellKey as buildShiftKey,
  getInitialScheduleWeekStart
} from './lib/scheduleWeek';
import type { EmployeeWeekDay } from './lib/scheduleWeek';

const TABS: Array<{ id: AppTab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'empleados', label: 'Empleados' },
  { id: 'horarios', label: 'Horarios' },
  { id: 'calculo', label: 'Cálculo' },
  { id: 'configuracion', label: 'Configuración' }
];

const HOURS_COLUMNS: Array<keyof HourTotals> = [
  'ORD',
  'RN',
  'HED',
  'HEN',
  'DOM08',
  'DOM18',
  'RN_DOM',
  'HED_DOM',
  'HEN_DOM'
];

const LABEL_BY_KEY: Record<keyof HourTotals, string> = {
  ORD: 'ORD',
  RN: 'RN',
  HED: 'HED',
  HEN: 'HEN',
  DOM08: 'DOMIN 0,8',
  DOM18: 'DOMIN 1,8',
  RN_DOM: 'RN DOMIN',
  HED_DOM: 'HED DOMIN',
  HEN_DOM: 'HEN DOMIN'
};

const toISO = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const enumerateDates = (startISO: string, endISO: string): string[] => {
  const start = new Date(`${startISO}T12:00:00`);
  const end = new Date(`${endISO}T12:00:00`);
  const result: string[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    result.push(toISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
};

const dayLabel = (dateISO: string) => {
  const date = new Date(`${dateISO}T12:00:00`);
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit'
  }).format(date);
};

const buildPeriodLabel = (startDate: string, endDate: string) => `${startDate} a ${endDate}`;

const branchClassSuffix = (branchId: string): 'avenida' | 'unicentro' | 'unico' | 'unknown' => {
  if (branchId === 'branch-avenida') return 'avenida';
  if (branchId === 'branch-unicentro') return 'unicentro';
  if (branchId === 'branch-unico') return 'unico';
  return 'unknown';
};

type CellShiftKind = ShiftKind | 'custom';
type BrushKind = ShiftKind | null;

const shiftKindLabel = (kind: CellShiftKind) => {
  if (kind === 'partido') return 'Part';
  if (kind === 'normal') return 'Norm';
  if (kind === 'doblado') return 'Dobl';
  if (kind === 'descanso') return 'Desc';
  return 'Pers';
};

const fullShiftKindLabel = (kind: ShiftKind) => {
  if (kind === 'partido') return 'Partido';
  if (kind === 'normal') return 'Normal';
  if (kind === 'doblado') return 'Doblado';
  return 'Descanso';
};

const getAssignedShiftKind = (shift: Shift | undefined, branch: Branch | undefined): CellShiftKind | undefined => {
  if (!shift) return undefined;
  if (shift.restDay) return 'descanso';
  if (shift.templateId && branch) {
    return branch.shiftTemplates.find((template) => template.id === shift.templateId)?.kind;
  }
  if (shift.startTime || shift.endTime || shift.secondStart || shift.secondEnd) {
    return 'custom';
  }
  return undefined;
};

const getEffectiveBranchId = (employee: Employee, shift: Shift | undefined): string =>
  shift?.overrideBranchId ?? employee.branchId;

const formatShiftRange = (shift: Shift | undefined) => {
  if (!shift) return 'Sin turno asignado';
  if (shift.restDay) return 'Descanso';
  const firstRange = `${shift.startTime ?? '-'}–${shift.endTime ?? '-'}`;
  if (shift.secondStart || shift.secondEnd) {
    return `${firstRange} · ${shift.secondStart ?? '-'}–${shift.secondEnd ?? '-'}`;
  }
  return firstRange;
};

type StoredData = {
  branches: Branch[];
  employees: Employee[];
  periods: PayPeriod[];
  shifts: Shift[];
  settings: PayrollSettings;
  adjustments: Record<string, Record<string, number>>;
};

type GateError = StorageReadError | 'changed' | 'write-failed' | 'lock-failed' | 'restore-failed';
type InitialData = { ok: true; data: StoredData; snapshot: StorageSnapshot } | { ok: false; error: Exclude<GateError, 'write-failed'> };

const readInitialData = (): InitialData => {
  const branches = loadState(KEY.branches, seededBranches);
  if (!branches.ok) return branches;
  const employees = loadState(KEY.employees, seededEmployees);
  if (!employees.ok) return employees;
  const periods = loadState(KEY.periods, seededPayPeriods);
  if (!periods.ok) return periods;
  const shifts = loadState(KEY.shifts, seededShifts);
  if (!shifts.ok) return shifts;
  const settings = loadState(KEY.settings, defaultSettings);
  if (!settings.ok) return settings;
  const adjustments = loadState<Record<string, Record<string, number>>>(KEY.adjustments, {});
  if (!adjustments.ok) return adjustments;
  return { ok: true, data: {
    branches: branches.value, employees: employees.value, periods: periods.value,
    shifts: shifts.value, settings: settings.value, adjustments: adjustments.value
  }, snapshot: {
    [KEY.branches]: branches.raw, [KEY.employees]: employees.raw,
    [KEY.periods]: periods.raw, [KEY.shifts]: shifts.raw,
    [KEY.settings]: settings.raw, [KEY.adjustments]: adjustments.raw
  } };
};

function App() {
  const [initial, setInitial] = useState<InitialData | null>(null);
  const [runtimeError, setRuntimeError] = useState<GateError | null>(null);
  const [recovery, setRecovery] = useState<Exclude<RestoreJournalRead, { kind: 'none' }> | null>(null);
  const blocked = useRef(true);
  const readFailure = useRef<Extract<InitialData, { ok: false }> | null>(null);
  const recoveryFailure = useRef<Exclude<RestoreJournalRead, { kind: 'none' }> | null>(null);
  const firstSnapshot = useRef<StorageSnapshot | null>(null);
  const expected = useRef<StorageSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    const onStorage = (event: StorageEvent) => {
      if (event.key === RESTORE_JOURNAL_KEY) {
        blocked.current = true;
        expected.current = null;
        const journal = readRestoreJournal();
        if (journal.kind === 'none') setRuntimeError('restore-failed');
        else setRecovery(journal);
        return;
      }
      if (event.key !== null && !Object.values(KEY).includes(event.key)) return;
      try {
        if (event.storageArea && event.storageArea !== localStorage) return;
      } catch {
        readFailure.current ??= { ok: false, error: 'unavailable' };
        blocked.current = true;
        setRuntimeError('unavailable');
        return;
      }
      // Another context changed one of our keys (or cleared the storage area).
      readFailure.current ??= { ok: false, error: 'changed' };
      blocked.current = true;
      setRuntimeError('changed');
    };
    window.addEventListener('storage', onStorage);
    const journal = readRestoreJournal();
    if (journal.kind !== 'none') recoveryFailure.current ??= journal;
    if (recoveryFailure.current) {
      queueMicrotask(() => {
        if (!active) return;
        blocked.current = true;
        setRecovery(recoveryFailure.current);
      });
      return () => { active = false; window.removeEventListener('storage', onStorage); };
    }
    const result = readInitialData();
    if (!result.ok) {
      readFailure.current ??= result;
    } else if (firstSnapshot.current) {
      if (Object.keys(result.snapshot).some((key) => result.snapshot[key] !== firstSnapshot.current![key])) {
        readFailure.current ??= { ok: false, error: 'changed' };
      }
    } else {
      firstSnapshot.current = result.snapshot;
    }

    // StrictMode re-runs mount effects synchronously; retain failures from both.
    queueMicrotask(() => {
      if (!active) return;
      let settled: InitialData = readFailure.current ?? result;
      const release = () => {
        if (settled.ok) {
          const error = checkSnapshot(settled.snapshot);
          if (error) settled = { ok: false, error };
        }
        if (settled.ok) {
          expected.current = settled.snapshot;
          blocked.current = false;
        }
        setInitial(settled);
      };
      const locks = getStorageLockManager();
      if (settled.ok && locks) {
        void withStorageLock(release, locks).catch(() => {
          if (!active) return;
          blocked.current = true;
          setInitial({ ok: false, error: 'lock-failed' });
        });
      } else {
        release();
      }
    });
    return () => { active = false; window.removeEventListener('storage', onStorage); };
  }, []);

  // Recheck when the content commits, before the browser can paint it.
  useLayoutEffect(() => {
    if (!initial?.ok || blocked.current || !expected.current) return;
    const error = checkSnapshot(expected.current);
    if (error) {
      blocked.current = true;
      setRuntimeError(error);
    }
  }, [initial]);

  const persist = useCallback((key: string, value: unknown) => {
    if (blocked.current || !expected.current) return;
    const commit = () => {
      if (blocked.current || !expected.current) return;
      const journal = readRestoreJournal();
      if (journal.kind !== 'none') {
        blocked.current = true;
        expected.current = null;
        setRecovery(journal);
        return;
      }
      const error = checkSnapshot(expected.current);
      if (error) {
        blocked.current = true;
        setRuntimeError(error);
        return;
      }
      const result = saveState(key, value);
      if (!result.ok) {
        blocked.current = true;
        setRuntimeError('write-failed');
        return;
      }
      expected.current[key] = result.raw;
    };
    const locks = getStorageLockManager();
    if (locks) {
      void withStorageLock(commit, locks).catch(() => {
        blocked.current = true;
        setRuntimeError('lock-failed');
      });
    } else {
      blocked.current = true;
      setRuntimeError('lock-failed');
    }
  }, []);

  const handleRestoreStarted = useCallback(() => {
    blocked.current = true;
  }, []);
  const handleRestoreProblem = useCallback((reason: Extract<RestoreResult, { ok: false }>['reason']) => {
    blocked.current = true;
    if (reason === 'snapshot-changed') {
      setRuntimeError('changed');
      return;
    }
    const journal = readRestoreJournal();
    if (journal.kind !== 'none') {
      setRecovery(journal);
      return;
    }
    setRuntimeError('restore-failed');
  }, []);
  const handleRestoreComplete = useCallback(() => {
    blocked.current = true;
    const journal = readRestoreJournal();
    if (journal.kind === 'valid' && journal.journal.status === 'applied') {
      setRecovery(journal);
      window.location.reload();
      return;
    }
    setRecovery(journal.kind === 'none' ? { kind: 'malformed' } : journal);
  }, []);
  const handleRecoveryResolved = useCallback(() => {
    blocked.current = true;
    expected.current = null;
    setRecovery(null);
    setRuntimeError('restore-failed');
    window.location.reload();
  }, []);
  const backupCallbacks = {
    onRestoreStarted: handleRestoreStarted,
    onRestoreProblem: handleRestoreProblem,
    onRestoreComplete: handleRestoreComplete
  };

  const readError = initial && !initial.ok ? initial.error : null;
  const error = readError ?? runtimeError;
  return (
    <>
      {recovery && <LocalRestoreRecovery initial={recovery} onResolved={handleRecoveryResolved} />}
      {!recovery && !initial && <main className="app-shell"><p role="status">Comprobando almacenamiento local…</p></main>}
      {!recovery && error && (
        <main className="app-shell">
          <section className="panel storage-error" role="alert">
            <h1>No se puede usar el almacenamiento local</h1>
            {error === 'invalid-json' && <p>Hay datos locales que no se pueden interpretar.</p>}
            {error === 'invalid-shape' && <p>Hay datos locales con un formato inesperado.</p>}
            {error === 'unavailable' && <p>El navegador impidió leer el almacenamiento local.</p>}
            {error === 'changed' && <p>Los datos locales cambiaron fuera de esta sesión. Se detuvo la edición para evitar sobrescribirlos.</p>}
            {error === 'write-failed' && <p>El navegador impidió guardar los cambios. No se puede asegurar que se hayan guardado todos.</p>}
            {error === 'lock-failed' && <p>No se pudo adquirir el bloqueo exclusivo para validar o guardar. La edición se detuvo.</p>}
            {error === 'restore-failed' && <p>La restauración no se pudo confirmar. La edición permanece bloqueada; revisá el registro de recuperación antes de continuar.</p>}
            <p>La edición y las escrituras automáticas están bloqueadas. No borres los datos del navegador; contacta a soporte para revisar la situación.</p>
            {runtimeError && <p>No recargues ni cierres esta página: podría haber cambios que solo están en memoria.</p>}
          </section>
          <section className="panel"><LocalBackup {...backupCallbacks} /></section>
        </main>
      )}
      {initial?.ok && <div hidden={!!runtimeError || !!recovery}><AppContent initial={initial.data} persist={persist} backupCallbacks={backupCallbacks} /></div>}
    </>
  );
}

function usePersistOnChange(key: string, value: unknown, persist: (key: string, value: unknown) => void) {
  const previous = useRef(value);
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    persist(key, value);
  }, [key, value, persist]);
}

function AppContent({ initial, persist, backupCallbacks }: {
  initial: StoredData;
  persist: (key: string, value: unknown) => void;
  backupCallbacks: {
    onRestoreStarted: () => void;
    onRestoreProblem: (reason: Extract<RestoreResult, { ok: false }>['reason']) => void;
    onRestoreComplete: () => void;
  };
}) {
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [branches] = useState(initial.branches);
  const [employees, setEmployees] = useState(initial.employees);
  const [periods, setPeriods] = useState(initial.periods);
  const [shifts, setShifts] = useState(initial.shifts);
  const [settings, setSettings] = useState(initial.settings);
  const [adjustmentsByPeriod, setAdjustmentsByPeriod] = useState(initial.adjustments);

  const [selectedPeriodId, setSelectedPeriodId] = useState(periods[0]?.id ?? '');
  const [scheduleView, setScheduleView] = useState<'week' | 'quincena'>('week');
  const [weekStartDate, setWeekStartDate] = useState(() => getInitialScheduleWeekStart(periods, shifts));
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [calculation, setCalculation] = useState<{ result: CalculationResult; periodId: string; shifts: Shift[]; employees: Employee[]; settings: PayrollSettings; adjustments: typeof adjustmentsByPeriod } | null>(null);
  const [scheduleNotice, setScheduleNotice] = useState('');

  const [newEmployee, setNewEmployee] = useState({
    fullName: '',
    documentId: '',
    branchId: branches[0]?.id ?? '',
    baseMonthlySalary: 1600000,
    role: '' as string
  });

  const [newPeriod, setNewPeriod] = useState({
    startDate: '',
    endDate: ''
  });

  const [customizingCells, setCustomizingCells] = useState<Record<string, boolean>>({});
  const [pendingBranches, setPendingBranches] = useState<Record<string, string>>({});
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(() => new Set());
  const [openCell, setOpenCell] = useState<string | null>(null);
  const [activeBrush, setActiveBrush] = useState<BrushKind>(null);
  const [sessionAssignments, setSessionAssignments] = useState<SessionAssignment[]>([]);

  usePersistOnChange(KEY.employees, employees, persist);
  usePersistOnChange(KEY.periods, periods, persist);
  usePersistOnChange(KEY.shifts, shifts, persist);
  usePersistOnChange(KEY.settings, settings, persist);
  usePersistOnChange(KEY.adjustments, adjustmentsByPeriod, persist);

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPeriodId) ?? periods[0],
    [periods, selectedPeriodId]
  );

  const selectedWeek = useMemo(() => ({
    startDate: weekStartDate,
    endDateExclusive: addDaysToDate(weekStartDate, 7)
  }), [weekStartDate]);

  const allEmployeeWeekSchedules = useMemo(() => employees.map((employee) =>
    buildEmployeeWeekSchedule({ employee, week: selectedWeek, periods, shifts, branches })
  ), [employees, selectedWeek, periods, shifts, branches]);

  const weekSchedules = useMemo(() => allEmployeeWeekSchedules.filter((schedule) => {
    const hasScheduleData = schedule.days.some((day) => day.shiftIds.length > 0) ||
      schedule.issues.some((item) => Boolean(item.shiftIds?.length));
    const visibleByStatus = schedule.employee.active || hasScheduleData;
    const visibleByBranch = branchFilter === 'all' || schedule.employee.branchId === branchFilter;
    return visibleByStatus && visibleByBranch;
  }), [allEmployeeWeekSchedules, branchFilter]);

  const periodDates = useMemo(() => {
    if (!selectedPeriod) {
      return [];
    }
    return enumerateDates(selectedPeriod.startDate, selectedPeriod.endDate);
  }, [selectedPeriod]);

  const filteredEmployees = useMemo(() => {
    if (branchFilter === 'all') {
      return employees.filter((employee) => employee.active);
    }
    return employees.filter((employee) => employee.active && employee.branchId === branchFilter);
  }, [employees, branchFilter]);

  const branchesMap = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const endsBeyondSelectedPeriod = (shift: Shift): boolean =>
    Boolean(selectedPeriod && endsBeyondPeriodEnd(shift, selectedPeriod.endDate));
  const isShiftReviewNeeded = (shift: Shift): boolean => {
    if (!periodDates.includes(shift.date)) return true;
    const employee = employees.find((item) => item.id === shift.employeeId);
    const branch = branchesMap.get(shift.overrideBranchId ?? employee?.branchId ?? '');
    if (!employee || !branch) return true;
    const template = branch.shiftTemplates.find((item) => item.id === shift.templateId);
    if (shift.templateId && !template && shift.templateId !== 'partido') return true;
    return needsShiftReview(shift, template?.kind) || endsBeyondSelectedPeriod(shift);
  };

  const employeesByBranch = useMemo(() => {
    const map = new Map<string, Employee[]>();
    for (const branch of branches) {
      map.set(branch.id, []);
    }
    const reviewEmployees = new Set(shifts.filter((shift) => shift.payPeriodId === selectedPeriod?.id && isShiftReviewNeeded(shift)).map((shift) => shift.employeeId));
    const visible = employees.filter((employee) =>
      (employee.active || reviewEmployees.has(employee.id)) &&
      (branchFilter === 'all' || employee.branchId === branchFilter)
    );
    for (const employee of visible) {
      const list = map.get(employee.branchId);
      if (list) {
        list.push(employee);
      }
    }
    return map;
  }, [branches, employees, branchFilter, shifts, selectedPeriod]);

  const shiftsByKey = useMemo(() => {
    const map = new Map<string, Shift>();
    for (const shift of shifts) {
      map.set(buildShiftKey(shift.employeeId, shift.payPeriodId, shift.date), shift);
    }
    return map;
  }, [shifts]);

  const periodAdjustments = selectedPeriod
    ? adjustmentsByPeriod[selectedPeriod.id] ?? {}
    : ({} as Record<string, number>);

  const periodShifts = selectedPeriod ? shifts.filter((shift) => shift.payPeriodId === selectedPeriod.id) : [];
  const duplicates = duplicateShiftGroups(periodShifts);
  const duplicateKeys = new Set(duplicates.map((group) => buildShiftKey(group[0].employeeId, group[0].payPeriodId, group[0].date)));
  const reviewShifts = periodShifts.filter((shift) => !duplicateKeys.has(buildShiftKey(shift.employeeId, shift.payPeriodId, shift.date)) && isShiftReviewNeeded(shift));
  const periodBoundaryReviewShifts = reviewShifts.filter(endsBeyondSelectedPeriod);
  const hasPendingBranch = Boolean(selectedPeriod && Object.keys(pendingBranches).some((key) => JSON.parse(key)[0] === selectedPeriod.id));
  const calculationBlocked = reviewShifts.length > 0 || duplicates.length > 0 || hasPendingBranch;
  const calculationResult = calculation && selectedPeriod && calculation.periodId === selectedPeriod.id &&
    calculation.shifts === shifts && calculation.employees === employees && calculation.settings === settings &&
    calculation.adjustments === adjustmentsByPeriod && !calculationBlocked ? calculation.result : null;

  const runCalculation = () => {
    if (!selectedPeriod || calculationBlocked) {
      return;
    }

    const result = aggregateDailyAndPeriod({
      shifts,
      employees,
      settings,
      periodId: selectedPeriod.id,
      adjustments: periodAdjustments
    });

    setCalculation({ result, periodId: selectedPeriod.id, shifts, employees, settings, adjustments: adjustmentsByPeriod });
  };

  const upsertShiftForPeriod = (employeeId: string, periodId: string, date: string, patch: Partial<Shift>): Shift | undefined => {
    const key = buildShiftKey(employeeId, periodId, date);
    if (shifts.filter((item) => buildShiftKey(item.employeeId, item.payPeriodId, item.date) === key).length > 1) return undefined;
    const existing = shiftsByKey.get(key);

    const base: Shift =
      existing ?? {
        id: uid('shift'),
        employeeId,
        payPeriodId: periodId,
        date,
        breakMinutes: 0,
        restDay: false
      };

    const next = { ...base, ...patch };

    setShifts((prev) => {
      const withoutCurrent = prev.filter((item) => buildShiftKey(item.employeeId, item.payPeriodId, item.date) !== key);
      return [...withoutCurrent, next];
    });
    setCalculation(null);

    return next;
  };

  const upsertShift = (employeeId: string, date: string, patch: Partial<Shift>): Shift | undefined =>
    selectedPeriod ? upsertShiftForPeriod(employeeId, selectedPeriod.id, date, patch) : undefined;

  const getWeekCellKey = (employee: Employee, day: EmployeeWeekDay): string | undefined =>
    day.periodResolution.status === 'available'
      ? buildShiftKey(employee.id, day.periodResolution.period.id, day.date)
      : undefined;

  const clearWeekDraft = (cellKey: string) => {
    setPendingBranches((previous) => {
      const next = { ...previous };
      delete next[cellKey];
      return next;
    });
  };

  const toggleWeekDay = (employee: Employee, day: EmployeeWeekDay) => {
    const cellKey = getWeekCellKey(employee, day);
    if (!cellKey || day.state === 'duplicate' || day.state === 'period-mismatch') return;
    setOpenCell((previous) => previous === cellKey ? null : cellKey);
    setCustomizingCells((previous) => ({ ...previous, [cellKey]: false }));
  };

  const changeWeekBranch = (employee: Employee, day: EmployeeWeekDay, branchId: string) => {
    const cellKey = getWeekCellKey(employee, day);
    if (!cellKey || day.state === 'review' || day.state === 'duplicate' || day.state === 'period-mismatch') {
      setScheduleNotice(`Revisa primero el turno de ${employee.fullName} (${day.date}) antes de cambiar la sede.`);
      return;
    }
    setCalculation(null);
    setPendingBranches((previous) => ({ ...previous, [cellKey]: branchId }));
  };

  const cancelWeekBranch = (employee: Employee, day: EmployeeWeekDay) => {
    const cellKey = getWeekCellKey(employee, day);
    if (cellKey) clearWeekDraft(cellKey);
  };

  const saveWeekAssignment = (
    employee: Employee,
    day: EmployeeWeekDay,
    branchId: string,
    patch: Partial<Shift>,
    allowReview = false
  ) => {
    if (day.periodResolution.status !== 'available') return;
    if (day.state === 'duplicate' || day.state === 'period-mismatch' || (day.state === 'review' && !allowReview)) {
      setScheduleNotice(`Revisa el turno de ${employee.fullName} (${day.date}) antes de reemplazarlo.`);
      return;
    }
    const cellKey = buildShiftKey(employee.id, day.periodResolution.period.id, day.date);
    const saved = upsertShiftForPeriod(employee.id, day.periodResolution.period.id, day.date, {
      ...patch,
      overrideBranchId: branchId === employee.branchId ? undefined : branchId
    });
    if (!saved) {
      setScheduleNotice(`No se modificó ${employee.fullName} (${day.date}): hay registros duplicados que requieren revisión.`);
      return;
    }
    clearWeekDraft(cellKey);
    setOpenCell(null);
    setCustomizingCells((previous) => ({ ...previous, [cellKey]: false }));
    setScheduleNotice(`${employee.fullName} · ${day.date}: asignación guardada.`);
  };

  const assignWeekTemplate = (employee: Employee, day: EmployeeWeekDay, branchId: string, template: ShiftTemplate) => {
    saveWeekAssignment(employee, day, branchId, templateFields(template));
  };

  const assignWeekDayOff = (employee: Employee, day: EmployeeWeekDay, branchId: string) => {
    saveWeekAssignment(employee, day, branchId, {
      restDay: true,
      templateId: undefined,
      startTime: undefined,
      endTime: undefined,
      secondStart: undefined,
      secondEnd: undefined,
      breakMinutes: 0
    });
  };

  const toggleWeekCustom = (employee: Employee, day: EmployeeWeekDay) => {
    const cellKey = getWeekCellKey(employee, day);
    if (!cellKey || day.state === 'duplicate' || day.state === 'period-mismatch') return;
    setOpenCell(cellKey);
    setCustomizingCells((previous) => ({ ...previous, [cellKey]: !previous[cellKey] }));
  };

  const saveWeekCustom = (employee: Employee, day: EmployeeWeekDay, branchId: string, patch: Partial<Shift>) => {
    saveWeekAssignment(employee, day, branchId, patch, true);
  };

  const fillDefaultsForPeriod = () => {
    if (!selectedPeriod) return;
    const missing: string[] = [];
    for (const employee of filteredEmployees) {
      const branch = branchesMap.get(employee.branchId);
      for (const date of periodDates) {
        const cell = buildShiftKey(employee.id, selectedPeriod.id, date);
        if (shiftsByKey.has(cell)) continue;
        if (pendingBranches[cell]) {
          missing.push(`${employee.fullName} (${date}, cambio de sede pendiente)`);
          continue;
        }
        const template = normalTemplateForEmployee(branch, employee, date);
        if (!template) {
          missing.push(`${employee.fullName} (${branch?.name ?? 'sede no disponible'}, ${date}${employee.role ? `, ${employee.role}` : ', sin rol'})`);
          continue;
        }
        upsertShift(employee.id, date, templateFields(template));
      }
    }
    setScheduleNotice(missing.length ? `No se precargó: ${missing.join('; ')}. Revisa sede, rol y plantilla para la fecha.` : 'Precarga terminada. Las franjas de plantilla son provisionales.');
  };

  const addEmployee = () => {
    if (!newEmployee.fullName.trim()) {
      return;
    }
    const employee: Employee = {
      id: uid('emp'),
      companyId: seededCompany.id,
      branchId: newEmployee.branchId,
      fullName: newEmployee.fullName.trim(),
      documentId: newEmployee.documentId.trim() || undefined,
      baseMonthlySalary: Number(newEmployee.baseMonthlySalary),
      active: true,
      role: (newEmployee.role as EmployeeRole) || undefined
    };

    setEmployees((prev) => [...prev, employee]);
    setNewEmployee((prev) => ({ ...prev, fullName: '', documentId: '', role: '' }));
  };

  const addPeriod = () => {
    if (!newPeriod.startDate || !newPeriod.endDate) {
      return;
    }
    const period: PayPeriod = {
      id: uid('period'),
      companyId: seededCompany.id,
      startDate: newPeriod.startDate,
      endDate: newPeriod.endDate,
      label: buildPeriodLabel(newPeriod.startDate, newPeriod.endDate)
    };
    setPeriods((prev) => [period, ...prev]);
    setSelectedPeriodId(period.id);
    setNewPeriod({ startDate: '', endDate: '' });
  };

  const createHalfMonthPeriod = (yearMonth: string, half: '1' | '2') => {
    if (!yearMonth) {
      return;
    }
    const [year, month] = yearMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const startDate = `${year}-${String(month).padStart(2, '0')}-${half === '1' ? '01' : '16'}`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(
      half === '1' ? 15 : lastDay
    ).padStart(2, '0')}`;

    const period: PayPeriod = {
      id: uid('period'),
      companyId: seededCompany.id,
      startDate,
      endDate,
      label: buildPeriodLabel(startDate, endDate)
    };

    setPeriods((prev) => [period, ...prev]);
    setSelectedPeriodId(period.id);
  };

  const applyBrush = (employee: Employee, date: string) => {
    if (!activeBrush || !selectedPeriod) {
      return;
    }

    const cell = buildShiftKey(employee.id, selectedPeriod.id, date);
    if (pendingBranches[cell]) {
      setScheduleNotice('Hay un cambio de sede pendiente en esta celda. Asigna el turno desde el selector o cancela el cambio.');
      return;
    }
    if (duplicateKeys.has(cell)) {
      setScheduleNotice('Hay turnos duplicados en esta celda. Exporta una copia local y contacta a soporte; no se modificaron.');
      return;
    }
    const previousShift = shiftsByKey.get(cell);
    if (previousShift && isShiftReviewNeeded(previousShift) && !isEmptyShift(previousShift)) {
      setScheduleNotice(`Revisa el turno de ${employee.fullName} (${date}) con Personalizar antes de reemplazarlo.`);
      return;
    }
    const previousShiftJson = previousShift ? JSON.stringify(previousShift) : null;
    const branch = branchesMap.get(getEffectiveBranchId(employee, previousShift));

    let assignedShift: Shift | undefined;
    if (activeBrush === 'descanso') {
      assignedShift = upsertShift(employee.id, date, {
        restDay: true,
        templateId: undefined,
        startTime: undefined,
        endTime: undefined,
        secondStart: undefined,
        secondEnd: undefined,
        breakMinutes: 0
      });
    } else {
      const template = resolveTemplateForDate(branch, date, {
        role: employee.role,
        kind: activeBrush
      });
      if (!template) {
        setScheduleNotice(`No hay plantilla para ${employee.fullName} (${branch?.name ?? 'sede no disponible'}, ${date}${employee.role ? `, ${employee.role}` : ', sin rol'}). Revisa sede, rol y tipo.`);
        return;
      }
      assignedShift = upsertShift(employee.id, date, templateFields(template));
    }

    if (!assignedShift) {
      return;
    }

    setOpenCell(null);
    setCustomizingCells((prev) => ({ ...prev, [cell]: false }));
    setSessionAssignments((prev) => [
      ...prev,
      {
        id: uid('session'),
        employeeId: employee.id,
        employeeName: employee.fullName,
        date,
        kind: activeBrush,
        previousShiftJson,
        assignedShiftJson: JSON.stringify(assignedShift)
      }
    ]);
  };

  const undoAssignment = (assignment: SessionAssignment) => {
    if (selectedPeriod && canRestoreAssignment(sessionAssignments, shifts, assignment, selectedPeriod.id)) {
      setShifts((prev) => restoreAssignmentInList(prev, assignment, selectedPeriod.id));
    }
    setSessionAssignments((prev) => prev.filter((item) => item.id !== assignment.id));
  };

  const undoAllSession = () => {
    if (!selectedPeriod) {
      return;
    }
    const toUndo = [...sessionAssignments].reverse();
    setShifts((prev) =>
      toUndo.reduce((items, assignment) => restoreAssignmentInList(items, assignment, selectedPeriod.id), prev)
    );
    setSessionAssignments([]);
  };

  const updateAdjustment = (employeeId: string, value: number) => {
    if (!selectedPeriod) {
      return;
    }

    setAdjustmentsByPeriod((prev) => ({
      ...prev,
      [selectedPeriod.id]: {
        ...(prev[selectedPeriod.id] ?? {}),
        [employeeId]: value
      }
    }));
  };

  const exportExcel = async () => {
    if (!selectedPeriod || !calculationResult) {
      return;
    }

    await exportPayrollExcel({
      period: selectedPeriod,
      employees,
      branches,
      shifts,
      result: calculationResult
    });
  };

  const formatConcepts = (shift: Shift | undefined) => {
    if (!shift || isShiftReviewNeeded(shift)) {
      return '';
    }

    const totals = calculateShiftTotals(shift, settings);

    const concepts = [
      ['ORD', totals.ORD],
      ['RN', totals.RN],
      ['HED', totals.HED],
      ['HEN', totals.HEN],
      ['DOM 0,8', totals.DOM08],
      ['DOM 1,8', totals.DOM18],
      ['RN DOM', totals.RN_DOM],
      ['HED DOM', totals.HED_DOM],
      ['HEN DOM', totals.HEN_DOM]
    ]
      .filter(([, hours]) => Number(hours) > 0)
      .map(([label, hours]) => `${label} ${fixed2(Number(hours))}`);

    return concepts.join(' · ');
  };

  const weekActions: EmployeeWeekActions = {
    onToggleDay: (employee, day) => toggleWeekDay(employee, day),
    onChangeBranch: (employee, day, _cellKey, branchId) => changeWeekBranch(employee, day, branchId),
    onCancelBranch: (employee, day) => cancelWeekBranch(employee, day),
    onAssignTemplate: (employee, day, branchId, template) => assignWeekTemplate(employee, day, branchId, template),
    onAssignDayOff: (employee, day, branchId) => assignWeekDayOff(employee, day, branchId),
    onToggleCustom: (employee, day) => toggleWeekCustom(employee, day),
    onSaveCustom: (employee, day, branchId, patch) => saveWeekCustom(employee, day, branchId, patch)
  };

  return (
    <div className="app-shell">
      <section className="panel grid">
        <h1>Sandwich Qbano - Nómina Quincenal (MVP Frontend)</h1>
        <small className="muted">
          Empresa: {seededCompany.name} | Timezone: America/Bogota | Modelo local sin backend
        </small>
        <div className="nav">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === 'dashboard' && (
        <section className="panel grid">
          <h2>1. Dashboard</h2>
          <div className="grid grid-2">
            <label>
              Periodo de pago
              <select
                value={selectedPeriod?.id ?? ''}
                onChange={(event) => setSelectedPeriodId(event.target.value)}
              >
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Filtro sede
              <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
                <option value="all">Todas</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-2">
            <label>
              Nuevo periodo: inicio
              <input
                type="date"
                value={newPeriod.startDate}
                onChange={(event) =>
                  setNewPeriod((prev) => ({ ...prev, startDate: event.target.value }))
                }
              />
            </label>
            <label>
              Nuevo periodo: fin
              <input
                type="date"
                value={newPeriod.endDate}
                onChange={(event) =>
                  setNewPeriod((prev) => ({ ...prev, endDate: event.target.value }))
                }
              />
            </label>
          </div>

          <div className="row">
            <button className="primary" onClick={addPeriod}>
              Crear periodo personalizado
            </button>
            <label>
              Crear quincena rápida
              <input
                type="month"
                onChange={(event) => {
                  if (event.target.value) {
                    createHalfMonthPeriod(event.target.value, '1');
                  }
                }}
              />
            </label>
            <button
              className="subtle"
              onClick={() => {
                const monthInput = prompt('Mes en formato YYYY-MM (ej: 2026-02)');
                if (monthInput) {
                  createHalfMonthPeriod(monthInput, '2');
                }
              }}
            >
              Crear segunda quincena (16-fin)
            </button>
          </div>

          <small className="muted">
            Empleados activos visibles: {filteredEmployees.length} | Días del periodo: {periodDates.length}
          </small>
        </section>
      )}

      {activeTab === 'empleados' && (
        <section className="panel grid">
          <h2>2. Empleados</h2>
          <div className="grid grid-2">
            <label>
              Nombre completo
              <input
                value={newEmployee.fullName}
                onChange={(event) =>
                  setNewEmployee((prev) => ({ ...prev, fullName: event.target.value }))
                }
              />
            </label>
            <label>
              Documento
              <input
                value={newEmployee.documentId}
                onChange={(event) =>
                  setNewEmployee((prev) => ({ ...prev, documentId: event.target.value }))
                }
              />
            </label>
            <label>
              Sede
              <select
                value={newEmployee.branchId}
                onChange={(event) =>
                  setNewEmployee((prev) => ({ ...prev, branchId: event.target.value }))
                }
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Básico mensual
              <input
                type="number"
                min={0}
                value={newEmployee.baseMonthlySalary}
                onChange={(event) =>
                  setNewEmployee((prev) => ({
                    ...prev,
                    baseMonthlySalary: Number(event.target.value)
                  }))
                }
              />
            </label>
            {newEmployee.branchId === 'branch-avenida' && (
              <label>
                Rol
                <select
                  value={newEmployee.role}
                  onChange={(event) =>
                    setNewEmployee((prev) => ({ ...prev, role: event.target.value }))
                  }
                >
                  <option value="">Seleccione...</option>
                  <option value="sala">Sala</option>
                  <option value="domicilio">Domicilio</option>
                </select>
              </label>
            )}
          </div>
          <div className="row">
            <button className="primary" onClick={addEmployee}>
              Crear empleado
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Documento</th>
                  <th>Sede</th>
                  <th>Rol</th>
                  <th>Básico</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td>{employee.fullName}</td>
                    <td>{employee.documentId ?? '-'}</td>
                    <td>{branchesMap.get(employee.branchId)?.name}</td>
                    <td>
                      {employee.branchId === 'branch-avenida' ? (
                        <select
                          value={employee.role ?? ''}
                          onChange={(event) =>
                            setEmployees((prev) =>
                              prev.map((item) =>
                                item.id === employee.id
                                  ? { ...item, role: (event.target.value as EmployeeRole) || undefined }
                                  : item
                              )
                            )
                          }
                        >
                          <option value="">Sin rol</option>
                          <option value="sala">Sala</option>
                          <option value="domicilio">Domicilio</option>
                        </select>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{pesos(employee.baseMonthlySalary)}</td>
                    <td>
                      <button
                        className={employee.active ? 'subtle' : 'danger'}
                        onClick={() =>
                          setEmployees((prev) =>
                            prev.map((item) =>
                              item.id === employee.id ? { ...item, active: !item.active } : item
                            )
                          )
                        }
                      >
                        {employee.active ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'horarios' && (
        <section className="panel grid">
          <h2>3. Horarios</h2>
          <div className="schedule-view-toggle" role="group" aria-label="Vista de horarios">
            <button
              type="button"
              aria-pressed={scheduleView === 'week'}
              className={scheduleView === 'week' ? 'active' : ''}
              onClick={() => setScheduleView('week')}
            >
              Semana
            </button>
            <button
              type="button"
              aria-pressed={scheduleView === 'quincena'}
              className={scheduleView === 'quincena' ? 'active' : ''}
              onClick={() => setScheduleView('quincena')}
            >
              Quincena y pincel
            </button>
          </div>
          <label className="schedule-branch-filter">
            Filtrar sede
            <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
              <option value="all">Todas las sedes</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>

          {scheduleView === 'week' ? (
            <>
              <WeekNavigator weekStart={weekStartDate} onChange={setWeekStartDate} />
              {scheduleNotice && <p role="status" className="schedule-notice">{scheduleNotice}</p>}
              <p className="week-template-note">Las plantillas son provisionales. “Horas asignadas” suma tramos programados sin descontar pausas ni aplicar cálculos de nómina.</p>
              <WeekSchedule
                schedules={weekSchedules}
                branches={branches}
                periods={periods}
                shifts={shifts}
                week={selectedWeek}
                branchFilter={branchFilter}
                collapsedBranches={collapsedBranches}
                onToggleBranch={(branchId) => setCollapsedBranches((previous) => {
                  const next = new Set(previous);
                  if (next.has(branchId)) next.delete(branchId);
                  else next.add(branchId);
                  return next;
                })}
                openCell={openCell}
                customizingCells={customizingCells}
                pendingBranches={pendingBranches}
                actions={weekActions}
              />
            </>
          ) : (
            <div className="quincena-schedule">
          <div className="legend">
            <div className="legend-group">
              <span className="legend-label">Sedes</span>
              <span className="branch-badge branch-badge-avenida">Avenida</span>
              <span className="branch-badge branch-badge-unicentro">Unicentro</span>
              <span className="branch-badge branch-badge-unico">Único</span>
            </div>
            <div className="legend-group">
              <span className="legend-label">Turnos</span>
              <span className="chip chip-partido chip-active">Partido</span>
              <span className="chip chip-normal chip-active">Normal</span>
              <span className="chip chip-doblado chip-active">Doblado</span>
              <span className="chip chip-descanso chip-active">Descanso</span>
            </div>
          </div>

          <div className="row">
            <button className="primary" onClick={fillDefaultsForPeriod}>
              Precargar defaults por sede en celdas vacías
            </button>
          </div>

          {scheduleNotice && <p role="status">{scheduleNotice}</p>}
          <p>Las franjas de las plantillas son provisionales y requieren confirmación.</p>
          {duplicates.length > 0 && <div role="alert"><p>Hay turnos duplicados. No edites esas celdas: exporta una copia local y contacta a soporte; no se borró ningún registro.</p><ul>{duplicates.map((group) => <li key={buildShiftKey(group[0].employeeId, group[0].payPeriodId, group[0].date)}>{group[0].employeeId} — {group[0].date} — IDs: {group.map((shift) => shift.id).join(', ')}</li>)}</ul></div>}
          {hasPendingBranch && <p role="status">Hay cambios de sede pendientes. Asigna un turno o cancela cada borrador antes de calcular.</p>}
          {reviewShifts.length > 0 && <div role="alert">
            <p>Hay {reviewShifts.length} turno(s) que requieren revisión antes de calcular. Abre la celda y usa Personalizar para definir los tramos reales.</p>
            {periodBoundaryReviewShifts.length > 0 && <ul>{periodBoundaryReviewShifts.map((shift) => <li key={shift.id}>
              {employees.find((employee) => employee.id === shift.employeeId)?.fullName ?? shift.employeeId} — {shift.date}: el intervalo {formatShiftRange(shift)} termina más allá del cierre del período ({selectedPeriod?.endDate}). Cálculo y exportación bloqueados; no se aplicó un reparto ni se modificó el turno.
            </li>)}</ul>}
          </div>}

          <div className="panel highlight grid brush-panel">
            <div className="brush-modes">
              <span className="brush-label">Modo asignación</span>
              {(['partido', 'normal', 'doblado', 'descanso'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`chip chip-${kind} ${activeBrush === kind ? 'chip-active' : ''}`}
                  onClick={() => setActiveBrush((prev) => (prev === kind ? null : kind))}
                >
                  {fullShiftKindLabel(kind)}
                </button>
              ))}
              <button
                type="button"
                className={`chip ${activeBrush === null ? 'chip-active-neutral' : ''}`}
                onClick={() => setActiveBrush(null)}
              >
                Sin modo
              </button>
            </div>
            {activeBrush && (
              <small className="muted">
                Modo <strong>{fullShiftKindLabel(activeBrush)}</strong> activo — clic en cualquier día para aplicar. Sobrescribe el turno existente.
              </small>
            )}

            {sessionAssignments.length > 0 && (
              <div className="session-detail">
                <div className="row session-detail-header">
                  <strong>Detalle de la sesión</strong>
                  <button type="button" className="subtle" onClick={undoAllSession}>
                    Deshacer todo
                  </button>
                </div>
                <ul className="session-detail-list">
                  {sessionAssignments.map((assignment) => (
                    <li key={assignment.id}>
                      <span className={`chip chip-${assignment.kind} chip-active`}>
                        {shiftKindLabel(assignment.kind)}
                      </span>
                      <span>{assignment.employeeName}</span>
                      <span className="muted">{assignment.date}</span>
                      <button
                        type="button"
                        className="session-detail-undo"
                        onClick={() => undoAssignment(assignment)}
                        aria-label="Deshacer"
                        title="Deshacer esta asignación"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="table-wrap quincena-table-wrap">
            <table className="quincena-table">
              <thead>
                <tr>
                  <th>Empleado</th>
                  {periodDates.map((date) => (
                    <th key={date}>{dayLabel(date)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {branches
                  .filter((branch) => (employeesByBranch.get(branch.id)?.length ?? 0) > 0)
                  .map((branch) => {
                    const isCollapsed = collapsedBranches.has(branch.id);
                    const branchEmployees = employeesByBranch.get(branch.id) ?? [];
                    const suffix = branchClassSuffix(branch.id);

                    return (
                      <Fragment key={branch.id}>
                        <tr className={`branch-header branch-header-${suffix}`}>
                          <td colSpan={1 + periodDates.length}>
                            <button
                              type="button"
                              className="branch-header-toggle"
                              aria-expanded={!isCollapsed}
                              onClick={() =>
                                setCollapsedBranches((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(branch.id)) {
                                    next.delete(branch.id);
                                  } else {
                                    next.add(branch.id);
                                  }
                                  return next;
                                })
                              }
                            >
                              <span className={`branch-badge branch-badge-${suffix}`}>{branch.name}</span>
                              <span className="branch-header-count">
                                {branchEmployees.length} empleado{branchEmployees.length === 1 ? '' : 's'}
                              </span>
                              <span className="branch-header-arrow">{isCollapsed ? '▸' : '▾'}</span>
                            </button>
                          </td>
                        </tr>
                        {!isCollapsed &&
                          branchEmployees.map((employee) => (
                            <tr key={employee.id}>
                              <td>
                                <div className="grid">
                                  <strong>{employee.fullName}</strong>
                                  {!employee.active && <small>Inactivo — visible para revisión de turnos</small>}
                                  <div className="row" style={{ gap: 6 }}>
                                    <span
                                      className={`branch-badge branch-badge-${branchClassSuffix(employee.branchId)}`}
                                    >
                                      {branchesMap.get(employee.branchId)?.name}
                                    </span>
                                    {employee.role && (
                                      <small className="muted">
                                        {employee.role === 'sala' ? 'Sala' : 'Domicilio'}
                                      </small>
                                    )}
                                    <small className="muted">básico {pesos(employee.baseMonthlySalary)}</small>
                                  </div>
                                </div>
                              </td>
                              {periodDates.map((date) => {
                                const shift =
                                  selectedPeriod &&
                                  shiftsByKey.get(buildShiftKey(employee.id, selectedPeriod.id, date));
                                const cellKey = buildShiftKey(employee.id, selectedPeriod?.id ?? '', date);
                                if (duplicateKeys.has(cellKey)) {
                                  const group = duplicates.find((items) => buildShiftKey(items[0].employeeId, items[0].payPeriodId, items[0].date) === cellKey)!;
                                  return <td key={cellKey} data-label={dayLabel(date)} aria-label={`Turnos duplicados para ${employee.fullName}, ${date}`}><strong>Duplicado</strong><small> IDs: {group.map((item) => item.id).join(', ')}. Exporta copia local y contacta a soporte.</small></td>;
                                }
                                const effectiveBranchId = pendingBranches[cellKey] ?? getEffectiveBranchId(employee, shift || undefined);
                                const branch = branchesMap.get(effectiveBranchId);
                                const isSelectorOpen = openCell === cellKey;
                                const isCustomizing = customizingCells[cellKey] ?? false;
                                const activeKind = getAssignedShiftKind(shift || undefined, branch);
                                const availableTemplates = branch
                                  ? listTemplatesForDate(branch, date, employee.role)
                                  : [];
                                const concepts = formatConcepts(shift || undefined);

                                const handleChip = (kind: ShiftKind) => {
                                  if (shift && isShiftReviewNeeded(shift) && !isEmptyShift(shift)) {
                                    setScheduleNotice(`Revisa el turno de ${employee.fullName} (${date}) con Personalizar antes de reemplazarlo.`);
                                    return;
                                  }
                                  if (kind === 'descanso') {
                                    upsertShift(employee.id, date, {
                                      restDay: true,
                                      overrideBranchId: effectiveBranchId === employee.branchId ? undefined : effectiveBranchId,
                                      templateId: undefined,
                                      startTime: undefined,
                                      endTime: undefined,
                                      secondStart: undefined,
                                      secondEnd: undefined,
                                      breakMinutes: 0
                                    });
                                    setPendingBranches((prev) => { const next = { ...prev }; delete next[cellKey]; return next; });
                                    setOpenCell(null);
                                    setCustomizingCells((prev) => ({ ...prev, [cellKey]: false }));
                                    return;
                                  }
                                  const template = resolveTemplateForDate(branch, date, {
                                    role: employee.role,
                                    kind
                                  });
                                  if (template) {
                                    upsertShift(employee.id, date, { ...templateFields(template), overrideBranchId: effectiveBranchId === employee.branchId ? undefined : effectiveBranchId });
                                    setPendingBranches((prev) => { const next = { ...prev }; delete next[cellKey]; return next; });
                                    setOpenCell(null);
                                    setCustomizingCells((prev) => ({ ...prev, [cellKey]: false }));
                                  }
                                };

                                return (
                                  <td key={`${employee.id}-${date}`} data-label={dayLabel(date)} aria-label={`Horario de ${employee.fullName}, ${date}`}>
                                    <div
                                      className={`shift-cell cell-state-mode branch-cell-${branchClassSuffix(employee.branchId)}`}
                                    >
                                      <button
                                        type="button"
                                        className={
                                          activeKind
                                            ? `chip chip-${activeKind} chip-active chip-compact`
                                            : 'cell-placeholder'
                                        }
                                        onClick={() => {
                                          if (activeBrush) {
                                            applyBrush(employee, date);
                                            return;
                                          }
                                          setOpenCell((prev) => (prev === cellKey ? null : cellKey));
                                          setCustomizingCells((prev) => ({ ...prev, [cellKey]: false }));
                                        }}
                                        aria-label={
                                          shift && isShiftReviewNeeded(shift)
                                            ? `Revisar turno de ${employee.fullName}, ${date}`
                                            : activeKind
                                              ? `Turno ${shiftKindLabel(activeKind)} para ${employee.fullName}, ${date}`
                                              : `Asignar turno para ${employee.fullName}, ${date}`
                                        }
                                        aria-expanded={isSelectorOpen}
                                        title={formatShiftRange(shift || undefined)}
                                      >
                                        {shift && isShiftReviewNeeded(shift) ? 'Revisar' : activeKind ? shiftKindLabel(activeKind) : '—'}
                                      </button>
                                      {shift?.overrideBranchId && (
                                        <small className="override-indicator">
                                          🏢 {branchesMap.get(shift.overrideBranchId)?.name}
                                        </small>
                                      )}

                                      {isSelectorOpen && (
                                        <div className="mini-selector">
                                          <div className="chips mini-selector-options">
                                            {(['partido', 'normal', 'doblado'] as const).map((kind) => {
                                              const available = availableTemplates.some((t) => t.kind === kind);
                                              if (!available) return null;
                                              return (
                                                <button
                                                  key={kind}
                                                  type="button"
                                                  className={`chip chip-${kind} ${activeKind === kind ? 'chip-active' : ''}`}
                                                  onClick={() => handleChip(kind)}
                                                  aria-label={`${fullShiftKindLabel(kind)} para ${employee.fullName}, ${date}`}
                                                  title={availableTemplates.find((t) => t.kind === kind)?.label ?? kind}
                                                >
                                                  {fullShiftKindLabel(kind)}
                                                </button>
                                              );
                                            })}
                                            <button
                                              type="button"
                                              className={`chip chip-descanso ${activeKind === 'descanso' ? 'chip-active' : ''}`}
                                              onClick={() => handleChip('descanso')}
                                              aria-label={`Descanso para ${employee.fullName}, ${date}`}
                                            >
                                              Descanso
                                            </button>
                                          </div>

                                          {availableTemplates.length === 0 && <small>No hay plantilla para esta sede, rol y fecha. Revisa el rol o define tramos reales.</small>}
                                          {shift && isShiftReviewNeeded(shift) && <small className="review-warning">Turno pendiente de revisión: define los tramos reales en Personalizar.</small>}
                                          <button
                                            type="button"
                                            className="subtle personalize-btn"
                                            aria-label={`Personalizar turno de ${employee.fullName}, ${date}`}
                                            onClick={() =>
                                              setCustomizingCells((prev) => ({ ...prev, [cellKey]: !isCustomizing }))
                                            }
                                          >
                                            Personalizar
                                          </button>

                                          <small className="muted">Rango: {formatShiftRange(shift || undefined)}</small>
                                          {concepts && <small className="muted">Conceptos: {concepts}</small>}

                                          <div className="override-menu">
                                            <span className="override-label">🏢 Cambiar sede</span>
                                            {pendingBranches[cellKey] && <><small>Sede seleccionada: {branch?.name}. El cambio se guarda al asignar un turno.</small><button type="button" className="subtle" aria-label={`Cancelar cambio de sede para ${employee.fullName}, ${date}`} onClick={() => { setPendingBranches((prev) => { const next = { ...prev }; delete next[cellKey]; return next; }); setCustomizingCells((prev) => ({ ...prev, [cellKey]: false })); }}>Cancelar cambio de sede</button></>}
                                            <div className="override-options">
                                              {branches.map((branchOption) => (
                                                <button
                                                  key={branchOption.id}
                                                  type="button"
                                                  className={effectiveBranchId === branchOption.id ? 'active' : ''}
                                                  aria-label={`Cambiar sede a ${branchOption.name} para ${employee.fullName}, ${date}`}
                                                  onClick={() => {
                                                    if (branchOption.id === effectiveBranchId) return;
                                                    if (shift && isShiftReviewNeeded(shift) && !isEmptyShift(shift)) {
                                                      setScheduleNotice(`Revisa el turno de ${employee.fullName} (${date}) antes de cambiar la sede.`);
                                                      return;
                                                    }
                                                    setCalculation(null);
                                                    setPendingBranches((prev) => ({ ...prev, [cellKey]: branchOption.id }));
                                                    setCustomizingCells((prev) => ({ ...prev, [cellKey]: false }));
                                                  }}
                                                >
                                                  {branchOption.name}
                                                </button>
                                              ))}
                                            </div>
                                          </div>

                                          {isCustomizing && (
                                            <ShiftEditor key={cellKey} shift={shift || undefined} requiresReview={Boolean(shift && isShiftReviewNeeded(shift))} onSave={(patch) => {
                                              upsertShift(employee.id, date, { ...patch, overrideBranchId: effectiveBranchId === employee.branchId ? undefined : effectiveBranchId });
                                              setPendingBranches((prev) => { const next = { ...prev }; delete next[cellKey]; return next; });
                                              setCustomizingCells((prev) => ({ ...prev, [cellKey]: false }));
                                              setOpenCell(null);
                                            }} />
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>
            </div>
          )}
        </section>
      )}

      {activeTab === 'calculo' && (
        <section className="panel grid">
          <h2>4. Cálculo</h2>
          {hasPendingBranch && <p role="alert">Hay cambios de sede pendientes. Vuelve a Horarios para asignar el turno o cancelar el cambio; después calcula nuevamente.</p>}
          {duplicates.length > 0 && <div role="alert"><p>Hay turnos duplicados. Exporta una copia local y contacta a soporte; no se borró ningún registro.</p><ul>{duplicates.map((group) => <li key={buildShiftKey(group[0].employeeId, group[0].payPeriodId, group[0].date)}>{group[0].employeeId} — {group[0].date} — IDs: {group.map((shift) => shift.id).join(', ')}</li>)}</ul></div>}
          {reviewShifts.length > 0 && <div role="alert"><p>Hay turnos pendientes de revisión. No se puede calcular ni exportar hasta definir sus tramos reales en Horarios → Personalizar:</p><ul>{reviewShifts.map((shift) => <li key={shift.id}>
            {employees.find((employee) => employee.id === shift.employeeId)?.fullName ?? shift.employeeId} — {shift.date}
            {endsBeyondSelectedPeriod(shift) && <> — El intervalo {formatShiftRange(shift)} termina más allá del cierre del período ({selectedPeriod?.endDate}); cálculo y exportación bloqueados. No se aplicó un reparto ni se modificó el turno.</>}
          </li>)}</ul><p>Si un turno no aparece en Horarios, revisa los filtros, la sede y las fechas; si falta el empleado, contacta a soporte sin borrar el registro.</p></div>}
          <div className="row">
            <button className="primary" onClick={runCalculation} disabled={calculationBlocked}>
              Calcular
            </button>
            <button className="subtle" onClick={exportExcel} disabled={!calculationResult}>
              Exportar a Excel (.xlsx)
            </button>
          </div>

          {!calculationResult && (
            <small className="muted">
              Ejecuta “Calcular” para generar detalle diario, resumen y liquidación de horas extras.
            </small>
          )}

          {calculationResult && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Fecha</th>
                      <th>Sede</th>
                      <th>Turno</th>
                      <th>ORD</th>
                      <th>RN</th>
                      <th>HED</th>
                      <th>HEN</th>
                      <th>DOMIN 0,8</th>
                      <th>DOMIN 1,8</th>
                      <th>RN DOMIN</th>
                      <th>HED DOMIN</th>
                      <th>HEN DOMIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculationResult.dayBreakdowns.map((item) => (
                      <tr key={buildShiftKey(item.employeeId, item.shift.payPeriodId, item.date)}>
                        <td>{item.employeeName}</td>
                        <td>{item.date}</td>
                        <td>{branchesMap.get(item.shift.overrideBranchId ?? employees.find((employee) => employee.id === item.employeeId)?.branchId ?? '')?.name ?? '—'}</td>
                        <td>{formatShiftRange(item.shift)}</td>
                        <td>{fixed2(item.breakdown.ordHours)}</td>
                        <td>{fixed2(item.breakdown.rnHours)}</td>
                        <td>{fixed2(item.breakdown.hedHours)}</td>
                        <td>{fixed2(item.breakdown.henHours)}</td>
                        <td>{fixed2(item.breakdown.dom08Hours)}</td>
                        <td>{fixed2(item.breakdown.dom18Hours)}</td>
                        <td>{fixed2(item.breakdown.rnDomHours)}</td>
                        <td>{fixed2(item.breakdown.hedDomHours)}</td>
                        <td>{fixed2(item.breakdown.henDomHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3>Resumen por empleado (Hoja 2)</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      {HOURS_COLUMNS.map((key) => (
                        <th key={key}>{LABEL_BY_KEY[key]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {calculationResult.summaries.map((summary) => (
                      <tr key={summary.employeeId}>
                        <td>{summary.employeeName}</td>
                        {HOURS_COLUMNS.map((key) => (
                          <td key={key}>{fixed2(summary.totals[key])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3>Liquidación “HORAS EXTRAS” (Hoja 3)</h3>
              {calculationResult.summaries.map((summary) => (
                <div key={`liq-${summary.employeeId}`} className="panel grid">
                  <div className="row">
                    <strong>{summary.employeeName}</strong>
                    <span className="badge">VrHoraBase: {pesos(summary.vrHoraBase)}</span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Tipo</th>
                          <th>Can.</th>
                          <th>Vr Hora</th>
                          <th>Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {HOURS_COLUMNS.filter((key) => key !== 'ORD').map((key) => (
                          <tr key={key}>
                            <td>{LABEL_BY_KEY[key]}</td>
                            <td>{fixed2(summary.totals[key])}</td>
                            <td>{pesos(summary.vrHoraBase)}</td>
                            <td>{pesos(summary.subtotals[key])}</td>
                          </tr>
                        ))}
                        <tr>
                          <td>TOTAL HORAS EXTRAS</td>
                          <td colSpan={2}></td>
                          <td>{pesos(summary.totalExtras)}</td>
                        </tr>
                        <tr>
                          <td>AJUSTE AL CIEN</td>
                          <td colSpan={2}></td>
                          <td>
                            <input
                              type="number"
                              value={periodAdjustments[summary.employeeId] ?? 0}
                              onChange={(event) =>
                                updateAdjustment(summary.employeeId, Number(event.target.value))
                              }
                            />
                          </td>
                        </tr>
                        <tr>
                          <td>TOTAL</td>
                          <td colSpan={2}></td>
                          <td>
                            {pesos(
                              summary.totalExtras +
                                (periodAdjustments[summary.employeeId] ?? summary.adjustment)
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )}
        </section>
      )}

      {activeTab === 'configuracion' && (
        <section className="panel grid">
          <h2>5. Configuración</h2>
          <LocalBackup {...backupCallbacks} />
          <div className="grid grid-2">
            <label>
              Inicio nocturno
              <input
                type="time"
                value={settings.nocturnalStart}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, nocturnalStart: event.target.value }))
                }
              />
            </label>
            <label>
              Fin nocturno
              <input
                type="time"
                value={settings.nocturnalEnd}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, nocturnalEnd: event.target.value }))
                }
              />
            </label>
            <label>
              Horas ordinarias/día
              <input
                type="number"
                min={1}
                value={settings.dailyOrdinaryHours}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    dailyOrdinaryHours: Number(event.target.value)
                  }))
                }
              />
            </label>
            <label>
              Horas base mensual
              <input
                type="number"
                min={1}
                value={settings.monthlyHoursBase}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    monthlyHoursBase: Number(event.target.value)
                  }))
                }
              />
            </label>
          </div>

          <h4>Multiplicadores</h4>
          <div className="grid grid-2">
            {Object.entries(settings.multipliers).map(([key, value]) => (
              <label key={key}>
                {key}
                <input
                  type="number"
                  step="0.01"
                  value={value}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      multipliers: {
                        ...prev.multipliers,
                        [key]: Number(event.target.value)
                      }
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default App;
