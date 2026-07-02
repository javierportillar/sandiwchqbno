import { useEffect, useMemo, useState } from 'react';
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
  ShiftKind
} from './types/payroll';
import {
  defaultSettings,
  seededBranches,
  seededCompany,
  seededEmployees,
  seededPayPeriods,
  seededShifts
} from './data/seed';
import { fixed2, loadState, pesos, saveState, uid } from './lib/storage';
import { aggregateDailyAndPeriod } from './lib/calculation';
import { exportPayrollExcel } from './lib/exportExcel';
import { resolveTemplateForDate, listTemplatesForDate } from './lib/templates';

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

const KEY = {
  branches: 'qbano-branches',
  employees: 'qbano-employees',
  periods: 'qbano-periods',
  shifts: 'qbano-shifts',
  settings: 'qbano-settings',
  adjustments: 'qbano-adjustments'
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

const buildShiftKey = (employeeId: string, periodId: string, date: string) =>
  `${employeeId}|${periodId}|${date}`;

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [branches] = useState<Branch[]>(() => loadState(KEY.branches, seededBranches));
  const [employees, setEmployees] = useState<Employee[]>(() =>
    loadState(KEY.employees, seededEmployees)
  );
  const [periods, setPeriods] = useState<PayPeriod[]>(() =>
    loadState(KEY.periods, seededPayPeriods)
  );
  const [shifts, setShifts] = useState<Shift[]>(() => loadState(KEY.shifts, seededShifts));
  const [settings, setSettings] = useState<PayrollSettings>(() =>
    loadState(KEY.settings, defaultSettings)
  );
  const [adjustmentsByPeriod, setAdjustmentsByPeriod] = useState<
    Record<string, Record<string, number>>
  >(() => loadState(KEY.adjustments, {}));

  const [selectedPeriodId, setSelectedPeriodId] = useState(periods[0]?.id ?? '');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [calculationResult, setCalculationResult] = useState<CalculationResult | null>(null);

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

  const [copySource, setCopySource] = useState<{ employeeId: string; date: string }>({
    employeeId: '',
    date: ''
  });
  const [copyTargetDates, setCopyTargetDates] = useState<string[]>([]);

  useEffect(() => saveState(KEY.branches, branches), [branches]);
  useEffect(() => saveState(KEY.employees, employees), [employees]);
  useEffect(() => saveState(KEY.periods, periods), [periods]);
  useEffect(() => saveState(KEY.shifts, shifts), [shifts]);
  useEffect(() => saveState(KEY.settings, settings), [settings]);
  useEffect(() => saveState(KEY.adjustments, adjustmentsByPeriod), [adjustmentsByPeriod]);

  const selectedPeriod = useMemo(
    () => periods.find((period) => period.id === selectedPeriodId) ?? periods[0],
    [periods, selectedPeriodId]
  );

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

  const shiftsByKey = useMemo(() => {
    const map = new Map<string, Shift>();
    for (const shift of shifts) {
      map.set(buildShiftKey(shift.employeeId, shift.payPeriodId, shift.date), shift);
    }
    return map;
  }, [shifts]);

  const branchesMap = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);

  const periodAdjustments = selectedPeriod
    ? adjustmentsByPeriod[selectedPeriod.id] ?? {}
    : ({} as Record<string, number>);

  const runCalculation = () => {
    if (!selectedPeriod) {
      return;
    }

    const result = aggregateDailyAndPeriod({
      shifts,
      employees,
      settings,
      periodId: selectedPeriod.id,
      adjustments: periodAdjustments
    });

    setCalculationResult(result);
  };

  const findNormalTemplate = (branch: Branch, employee: Employee) => {
    return branch.shiftTemplates.find(
      (t) =>
        t.kind === 'normal' &&
        (!t.role || t.role === employee.role)
    );
  };

  const upsertShift = (employeeId: string, date: string, patch: Partial<Shift>) => {
    if (!selectedPeriod) {
      return;
    }
    const key = buildShiftKey(employeeId, selectedPeriod.id, date);
    const existing = shiftsByKey.get(key);

    const base: Shift =
      existing ?? {
        id: uid('shift'),
        employeeId,
        payPeriodId: selectedPeriod.id,
        date,
        breakMinutes: 60,
        restDay: false
      };

    const next = { ...base, ...patch };

    setShifts((prev) => {
      const withoutCurrent = prev.filter((item) => item.id !== next.id);
      return [...withoutCurrent, next];
    });
  };

  const fillDefaultsForPeriod = () => {
    if (!selectedPeriod) {
      return;
    }

    for (const employee of filteredEmployees) {
      const branch = branchesMap.get(employee.branchId);
      if (!branch) {
        continue;
      }
      const normalTemplate = findNormalTemplate(branch, employee);
      for (const date of periodDates) {
        const key = buildShiftKey(employee.id, selectedPeriod.id, date);
        if (shiftsByKey.has(key)) {
          continue;
        }
        upsertShift(employee.id, date, {
          startTime: normalTemplate?.startTime ?? branch.defaultStartTime,
          endTime: normalTemplate?.endTime ?? branch.defaultEndTime,
          breakMinutes: normalTemplate?.breakMinutes ?? 60,
          restDay: false
        });
      }
    }
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

  const sourceShift = selectedPeriod
    ? shiftsByKey.get(buildShiftKey(copySource.employeeId, selectedPeriod.id, copySource.date))
    : undefined;

  const applyCopyToTargets = () => {
    if (!selectedPeriod || !sourceShift || !copySource.employeeId) {
      return;
    }

    const patch: Partial<Shift> = {
      startTime: sourceShift.startTime,
      endTime: sourceShift.endTime,
      breakMinutes: sourceShift.breakMinutes,
      restDay: sourceShift.restDay,
      templateId: sourceShift.templateId,
      secondStart: sourceShift.secondStart,
      secondEnd: sourceShift.secondEnd
    };

    for (const date of copyTargetDates) {
      upsertShift(copySource.employeeId, date, patch);
    }
  };

  const toggleTargetDate = (date: string) => {
    setCopyTargetDates((prev) =>
      prev.includes(date) ? prev.filter((item) => item !== date) : [...prev, date]
    );
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
                      {branchesMap.get(employee.branchId)?.name === 'Avenida' ? (
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
          <div className="row">
            <button className="primary" onClick={fillDefaultsForPeriod}>
              Precargar defaults por sede en celdas vacías
            </button>
          </div>

          <div className="panel highlight grid">
            <h4>Copiar/Pegar turnos en varios días</h4>
            <div className="grid grid-2">
              <label>
                Empleado origen
                <select
                  value={copySource.employeeId}
                  onChange={(event) =>
                    setCopySource((prev) => ({ ...prev, employeeId: event.target.value }))
                  }
                >
                  <option value="">Seleccione...</option>
                  {filteredEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Día origen
                <select
                  value={copySource.date}
                  onChange={(event) =>
                    setCopySource((prev) => ({ ...prev, date: event.target.value }))
                  }
                >
                  <option value="">Seleccione...</option>
                  {periodDates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="row">
              <small className="muted">
                Turno origen: {sourceShift?.startTime ?? '-'} a {sourceShift?.endTime ?? '-'} | break{' '}
                {sourceShift?.breakMinutes ?? 0} min
              </small>
            </div>

            <div className="row">
              {periodDates.map((date) => (
                <button
                  key={date}
                  className={copyTargetDates.includes(date) ? 'primary' : 'subtle'}
                  onClick={() => toggleTargetDate(date)}
                >
                  {dayLabel(date)}
                </button>
              ))}
            </div>
            <button className="primary" onClick={applyCopyToTargets}>
              Pegar turno origen en días seleccionados
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  {periodDates.map((date) => (
                    <th key={date}>{dayLabel(date)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((employee) => (
                  <tr key={employee.id}>
                    <td>
                      <div className="grid">
                        <strong>{employee.fullName}</strong>
                        <small className="muted">
                          {branchesMap.get(employee.branchId)?.name} | básico {pesos(employee.baseMonthlySalary)}
                        </small>
                      </div>
                    </td>
                    {periodDates.map((date) => {
                      const shift =
                        selectedPeriod &&
                        shiftsByKey.get(buildShiftKey(employee.id, selectedPeriod.id, date));
                      const branch = branchesMap.get(employee.branchId);
                      const cellKey = `${employee.id}|${date}`;
                      const isCustomizing = customizingCells[cellKey] ?? false;

                      if (isCustomizing) {
                        const isSplit = shift?.secondStart || shift?.secondEnd;
                        return (
                          <td key={`${employee.id}-${date}`}>
                            <div className="shift-cell customize-mode">
                              <div className="times">
                                <input
                                  type="time"
                                  value={shift?.startTime ?? ''}
                                  onChange={(event) =>
                                    upsertShift(employee.id, date, {
                                      startTime: event.target.value || undefined,
                                      restDay: false
                                    })
                                  }
                                />
                                <input
                                  type="time"
                                  value={shift?.endTime ?? ''}
                                  onChange={(event) =>
                                    upsertShift(employee.id, date, {
                                      endTime: event.target.value || undefined,
                                      restDay: false
                                    })
                                  }
                                />
                              </div>
                              {isSplit && (
                                <div className="times">
                                  <input
                                    type="time"
                                    value={shift?.secondStart ?? ''}
                                    placeholder="2do inicio"
                                    onChange={(event) =>
                                      upsertShift(employee.id, date, {
                                        secondStart: event.target.value || undefined,
                                        restDay: false
                                      })
                                    }
                                  />
                                  <input
                                    type="time"
                                    value={shift?.secondEnd ?? ''}
                                    placeholder="2do fin"
                                    onChange={(event) =>
                                      upsertShift(employee.id, date, {
                                        secondEnd: event.target.value || undefined,
                                        restDay: false
                                      })
                                    }
                                  />
                                </div>
                              )}
                              <input
                                type="number"
                                min={0}
                                placeholder="Break min"
                                value={shift?.breakMinutes ?? 60}
                                onChange={(event) =>
                                  upsertShift(employee.id, date, {
                                    breakMinutes: Number(event.target.value),
                                    restDay: false
                                  })
                                }
                              />
                              <label className="row">
                                <input
                                  type="checkbox"
                                  checked={Boolean(shift?.restDay)}
                                  onChange={(event) =>
                                    upsertShift(employee.id, date, {
                                      restDay: event.target.checked,
                                      startTime: event.target.checked ? undefined : shift?.startTime,
                                      endTime: event.target.checked ? undefined : shift?.endTime
                                    })
                                  }
                                />
                                Descanso
                              </label>
                              <button
                                className="subtle"
                                onClick={() =>
                                  setCustomizingCells((prev) => ({ ...prev, [cellKey]: false }))
                                }
                              >
                                Volver a chips
                              </button>
                            </div>
                          </td>
                        );
                      }

                      const activeKind = shift?.restDay
                        ? 'descanso'
                        : shift?.templateId && branch
                          ? branch.shiftTemplates.find((t) => t.id === shift.templateId)?.kind
                          : undefined;

                      const availableTemplates = branch
                        ? listTemplatesForDate(branch, date, employee.role)
                        : [];

                      const handleChip = (kind: ShiftKind) => {
                        if (kind === 'descanso') {
                          upsertShift(employee.id, date, { restDay: true, templateId: undefined });
                          return;
                        }
                        const template = resolveTemplateForDate(branch, date, {
                          role: employee.role,
                          kind
                        });
                        if (template) {
                          upsertShift(employee.id, date, {
                            templateId: template.id,
                            startTime: template.startTime,
                            endTime: template.endTime,
                            secondStart: template.secondStart,
                            secondEnd: template.secondEnd,
                            breakMinutes: template.breakMinutes,
                            restDay: false
                          });
                        }
                      };

                      return (
                        <td key={`${employee.id}-${date}`}>
                          <div className="shift-cell chips-mode">
                            <div className="chips">
                              {(['partido', 'normal', 'doblado'] as const).map((kind) => {
                                const available = availableTemplates.some((t) => t.kind === kind);
                                return (
                                  <button
                                    key={kind}
                                    className={`chip ${activeKind === kind ? 'active' : ''} ${!available ? 'disabled' : ''}`}
                                    disabled={!available}
                                    onClick={() => handleChip(kind)}
                                    title={
                                      available
                                        ? availableTemplates.find((t) => t.kind === kind)
                                            ?.label ?? kind
                                        : 'No disponible para este día'
                                    }
                                  >
                                    {kind === 'partido'
                                      ? 'Partido'
                                      : kind === 'normal'
                                        ? 'Normal'
                                        : 'Doblado'}
                                  </button>
                                );
                              })}
                              <button
                                className={`chip ${activeKind === 'descanso' ? 'active' : ''}`}
                                onClick={() => handleChip('descanso')}
                              >
                                Descanso
                              </button>
                            </div>
                            <button
                              className="subtle personalize-btn"
                              onClick={() =>
                                setCustomizingCells((prev) => ({ ...prev, [cellKey]: true }))
                              }
                            >
                              Personalizar
                            </button>
                            {shift && !shift.restDay && (
                              <small className="muted">
                                {shift.startTime ?? '-'} a {shift.endTime ?? '-'}
                                {shift.secondStart ? ` + ${shift.secondStart}-${shift.secondEnd}` : ''}
                              </small>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'calculo' && (
        <section className="panel grid">
          <h2>4. Cálculo</h2>
          <div className="row">
            <button className="primary" onClick={runCalculation}>
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
                      <tr key={item.breakdown.shiftId}>
                        <td>{item.employeeName}</td>
                        <td>{item.date}</td>
                        <td>
                          {item.shift.restDay
                            ? 'Descanso'
                            : `${item.shift.startTime ?? '-'} - ${item.shift.endTime ?? '-'}`}
                        </td>
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
