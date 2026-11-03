import { useEffect, useMemo, useState } from 'react';
import type { PayPeriod } from '../types/payroll';
import type { PeriodIntegrityIssue } from '../lib/periodIntegrity';
import {
  formatCalendarDate,
  formatCalendarMonth,
  getCalendarMonth,
  getCurrentCalendarMonth,
  getExistingPeriodIssues,
  getHalfMonthRange,
  getPeriodRangeIssues,
  isValidPeriodDateRange,
  type HalfMonth
} from '../lib/periodCalendar';

interface PeriodCalendarProps {
  periods: readonly PayPeriod[];
  initialMonth?: string;
  creationError: string;
  onCreatePeriod: (startDate: string, endDate: string) => boolean;
  onClearError: () => void;
}

interface SelectedRange {
  startDate: string | null;
  endDate: string | null;
}

interface QuickAction {
  startDate: string;
  endDate: string;
  issues: PeriodIntegrityIssue[];
  status: 'available' | 'created' | 'revisar' | 'blocked';
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const COLOR_NAMES = ['green', 'gold', 'red', 'blue', 'teal', 'slate'] as const;

const fullDateLabel = (date: string) => formatCalendarDate(date, {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});

const monthAfter = (month: string, offset: number): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(2000, monthNumber - 1, 1, 12);
  date.setFullYear(year);
  date.setMonth(date.getMonth() + offset);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export function PeriodCalendar({ periods, initialMonth, creationError, onCreatePeriod, onClearError }: PeriodCalendarProps) {
  const [month, setMonth] = useState(initialMonth || getCurrentCalendarMonth());
  const [selectedRange, setSelectedRange] = useState<SelectedRange>({ startDate: null, endDate: null });
  useEffect(() => {
    if (initialMonth) {
      setMonth(initialMonth);
      setSelectedRange({ startDate: null, endDate: null });
    }
  }, [initialMonth]);
  const calendar = useMemo(() => getCalendarMonth(month), [month]);
  const formattedMonth = formatCalendarMonth(month);
  const monthLabel = formattedMonth.charAt(0).toLocaleUpperCase('es-CO') + formattedMonth.slice(1);

  const periodRows = useMemo(() => periods.map((period, index) => {
    const issues = getExistingPeriodIssues(period, index, periods);
    return {
      period,
      index,
      code: `P${index + 1}`,
      color: COLOR_NAMES[index % COLOR_NAMES.length],
      issues,
      valid: isValidPeriodDateRange(period)
    };
  }), [periods]);

  const visiblePeriodRows = periodRows.filter(({ period, valid }) =>
    !valid || (period.startDate <= calendar.endDate && period.endDate >= calendar.startDate)
  );

  const selectedRangeIssues = selectedRange.startDate && selectedRange.endDate
    ? getPeriodRangeIssues(selectedRange.startDate, selectedRange.endDate, periods)
    : [];

  const selectDate = (date: string) => {
    onClearError();
    setSelectedRange((current) => {
      if (!current.startDate || current.endDate) return { startDate: date, endDate: null };
      if (date < current.startDate) return { startDate: date, endDate: null };
      return { ...current, endDate: date };
    });
  };

  const createPeriod = (startDate: string, endDate: string) => {
    onClearError();
    if (onCreatePeriod(startDate, endDate)) setSelectedRange({ startDate: null, endDate: null });
  };

  const createRange = () => {
    if (!selectedRange.startDate || !selectedRange.endDate || selectedRangeIssues.length) return;
    createPeriod(selectedRange.startDate, selectedRange.endDate);
  };

  const quickAction = (half: HalfMonth) => {
    const range = getHalfMonthRange(month, half);
    const exactRows = periodRows.filter(({ period }) =>
      period.startDate === range.startDate && period.endDate === range.endDate
    );
    const exactRow = exactRows[0];
    const comparisonRows = exactRow
      ? periods.filter((period) => period !== exactRow.period)
      : periods;
    const issues = getPeriodRangeIssues(range.startDate, range.endDate, comparisonRows);
    let status: QuickAction['status'];
    if (exactRow) status = issues.length ? 'revisar' : 'created';
    else status = issues.length ? 'blocked' : 'available';
    return { ...range, issues, status };
  };

  const firstHalf = quickAction('1');
  const secondHalf = quickAction('2');

  const moveMonth = (offset: number) => setMonth((current) => monthAfter(current, offset));
  const previousMonthDisabled = month <= '0001-01';
  const nextMonthDisabled = month >= '9999-12';

  return (
    <section className="period-calendar" aria-labelledby="period-calendar-title">
      <header className="period-calendar-heading">
        <div>
          <p className="period-calendar-eyebrow">Organización de nómina</p>
          <h3 id="period-calendar-title">Períodos de pago</h3>
          <p className="period-calendar-intro">Elegí un rango en el calendario o creá una quincena para el mes visible.</p>
        </div>
        <div className="period-month-navigation" aria-label="Navegación mensual">
          <button className="subtle" type="button" aria-label="Mes anterior" disabled={previousMonthDisabled} onClick={() => moveMonth(-1)}>‹</button>
          <strong aria-live="polite" aria-atomic="true">{monthLabel}</strong>
          <button className="subtle" type="button" aria-label="Mes siguiente" disabled={nextMonthDisabled} onClick={() => moveMonth(1)}>›</button>
          <button className="period-month-today" type="button" onClick={() => setMonth(getCurrentCalendarMonth())}>Este mes</button>
        </div>
      </header>

      <div className="period-calendar-layout">
        <div className="period-calendar-main">
          <div className="period-calendar-table-wrap">
            <table className="period-calendar-table" aria-label={`Calendario de ${monthLabel}`}>
              <thead>
                <tr>{WEEKDAYS.map((day) => <th key={day} scope="col">{day}</th>)}</tr>
              </thead>
              <tbody>
                {Array.from({ length: calendar.days.length / 7 }, (_, weekIndex) => (
                  <tr key={`${month}-week-${weekIndex}`}>
                    {calendar.days.slice(weekIndex * 7, weekIndex * 7 + 7).map(({ date, inCurrentMonth }) => {
                      const activePeriods = periodRows.filter(({ period, valid }) =>
                        valid && period.startDate <= date && date <= period.endDate
                      );
                      const selectedStart = selectedRange.startDate === date;
                      const selectedEnd = selectedRange.endDate === date;
                      const insideSelection = Boolean(selectedRange.startDate && (
                        date >= selectedRange.startDate && (!selectedRange.endDate || date <= selectedRange.endDate)
                      ));
                      const dayHasConflict = activePeriods.length > 1 || activePeriods.some(({ issues }) => issues.length > 0);
                      const dateDescription = [
                        fullDateLabel(date),
                        ...activePeriods.map(({ period }) => `${period.label}: ${fullDateLabel(period.startDate)} a ${fullDateLabel(period.endDate)}`),
                        selectedStart ? 'Inicio seleccionado' : '',
                        selectedEnd ? 'Fin seleccionado' : '',
                        dayHasConflict ? 'Conflicto o período ambiguo; revisar' : ''
                      ].filter(Boolean).join('. ');

                      return (
                        <td key={date} className={`period-calendar-cell${!inCurrentMonth ? ' outside-month' : ''}${dayHasConflict ? ' has-period-conflict' : ''}`}>
                          <button
                            type="button"
                            className={`period-calendar-day${insideSelection ? ' in-selected-range' : ''}${selectedStart ? ' selected-start' : ''}${selectedEnd ? ' selected-end' : ''}`}
                            data-calendar-date={date}
                            aria-label={`Seleccionar ${dateDescription}`}
                            aria-pressed={insideSelection}
                            onClick={() => selectDate(date)}
                          >
                            <span className="period-day-number">{Number(date.slice(-2))}</span>
                            <span className="period-day-markers" aria-hidden="true">
                              {activePeriods.map(({ code, color, period }) => {
                                const isStart = period.startDate === date;
                                const isEnd = period.endDate === date;
                                const label = isStart && isEnd ? 'Inicio y fin' : isStart ? 'Inicio' : isEnd ? 'Fin' : 'Activo';
                                const marker = isStart && isEnd ? 'I/F' : isStart ? 'I' : isEnd ? 'F' : '•';
                                return <span key={`${period.id}-${code}`} className={`period-day-marker marker-${color}`} title={`${label} · ${code}`}>{marker} · {code}</span>;
                              })}
                              {dayHasConflict && <span className="period-conflict-marker">! Cruce</span>}
                              {selectedStart && <span className="selected-range-marker">I</span>}
                              {selectedEnd && <span className="selected-range-marker">F</span>}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="period-calendar-legend" aria-label="Leyenda del calendario">
            <span><i className="legend-swatch" aria-hidden="true" /> Colores y códigos identifican cada rango</span>
            <span><b>I</b> inicio · <b>F</b> fin · <b>•</b> rango activo</span>
            <span><b>! Cruce</b> indica fechas que requieren revisión</span>
            <span className="period-weekend-note">Sábado y domingo se muestran atenuados, no se omiten. En móvil, desliza la grilla para ver los siete días.</span>
          </div>

          <section className="period-existing" aria-labelledby="period-existing-title">
            <div className="period-existing-heading">
              <h4 id="period-existing-title">Períodos que cubren este calendario</h4>
              <span>{visiblePeriodRows.length}</span>
            </div>
            {visiblePeriodRows.length === 0 ? (
              <p className="period-empty-note">No hay rangos guardados en este mes.</p>
            ) : (
              <ul className="period-range-list">
                {visiblePeriodRows.map(({ period, code, color, issues, valid, index }) => {
                  const continuesBefore = valid && period.startDate < calendar.startDate;
                  const continuesAfter = valid && period.endDate > calendar.endDate;
                  return (
                    <li key={`${period.id}-${index}`} className={`period-range-item range-${color}${issues.length ? ' range-conflict' : ''}`}>
                      <span className="period-range-code" aria-hidden="true">{code}</span>
                      <div className="period-range-details">
                        <strong>{period.label || `Período ${code}`}</strong>
                        <span className="period-range-endpoints">
                          <span><b>Inicio:</b> {formatCalendarDate(period.startDate, { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                          <span><b>Fin:</b> {formatCalendarDate(period.endDate, { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                        </span>
                        {(continuesBefore || continuesAfter) && <small>{continuesBefore ? 'Comenzó antes de este calendario. ' : ''}{continuesAfter ? 'Continúa después de este calendario.' : ''}</small>}
                        {!valid && <small className="period-range-warning">Fechas guardadas inválidas; requiere revisión.</small>}
                        {issues.length > 0 && <small className="period-range-warning">{issues.some(({ code: issueCode }) => issueCode === 'overlapping-periods') ? 'Se cruza con otro período.' : 'ID o datos ambiguos; requiere revisión.'}</small>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="period-calendar-side" aria-label="Crear un período">
          <section className="period-range-builder">
            <p className="period-calendar-eyebrow">Rango personalizado</p>
            <h4>Elegí inicio y fin</h4>
            <p className="period-builder-hint">Tocá una fecha inicial y luego una fecha final. El rango incluye ambos días.</p>
            <div className="period-selection-summary" aria-live="polite" aria-atomic="true">
              {!selectedRange.startDate ? (
                <span>Sin fechas seleccionadas</span>
              ) : !selectedRange.endDate ? (
                <><span>Inicio</span><strong>{formatCalendarDate(selectedRange.startDate, { day: 'numeric', month: 'long', year: 'numeric' })}</strong><small>Ahora elegí la fecha de fin.</small></>
              ) : (
                <><span>Rango seleccionado</span><strong>{formatCalendarDate(selectedRange.startDate)} — {formatCalendarDate(selectedRange.endDate)}</strong><small>Ambas fechas quedan incluidas.</small></>
              )}
            </div>
            {selectedRangeIssues.length > 0 && (
              <p className="period-builder-conflict" role="alert">
                No se puede crear este rango: {selectedRangeIssues.map(({ message }) => message).join(' ')}
              </p>
            )}
            {creationError && <p className="period-builder-error" role="alert">{creationError}</p>}
            <div className="period-builder-actions">
              <button className="primary" type="button" disabled={!selectedRange.startDate || !selectedRange.endDate || selectedRangeIssues.length > 0} onClick={createRange}>
                Crear período
              </button>
              <button className="subtle" type="button" disabled={!selectedRange.startDate} onClick={() => { setSelectedRange({ startDate: null, endDate: null }); onClearError(); }}>
                Limpiar selección
              </button>
            </div>
          </section>

          <section className="period-quick-actions" aria-labelledby="period-quick-title">
            <p className="period-calendar-eyebrow">Atajos para {monthLabel}</p>
            <h4 id="period-quick-title">Crear una quincena</h4>
            <QuickPeriodAction
              title="Primera quincena"
              range={firstHalf}
              onCreate={() => createPeriod(firstHalf.startDate, firstHalf.endDate)}
            />
            <QuickPeriodAction
              title="Segunda quincena"
              range={secondHalf}
              onCreate={() => createPeriod(secondHalf.startDate, secondHalf.endDate)}
            />
          </section>
        </aside>
      </div>
    </section>
  );
}

function QuickPeriodAction({
  title,
  range,
  onCreate
}: {
  title: string;
  range: QuickAction;
  onCreate: () => void;
}) {
  const disabled = range.status !== 'available';
  const statusText = range.status === 'created'
    ? 'Ya existe'
    : range.status === 'revisar'
      ? 'Existe; revisar cruce'
      : range.status === 'blocked'
        ? 'Bloqueada por conflicto'
        : 'Lista para crear';
  return (
    <article className={`quick-period-card${range.status === 'blocked' || range.status === 'revisar' ? ' quick-period-blocked' : ''}`}>
      <div>
        <strong>{title}</strong>
        <span>{formatCalendarDate(range.startDate)} — {formatCalendarDate(range.endDate)}</span>
        <small className={`quick-period-status status-${range.status}`}>{statusText}</small>
        {range.issues.length > 0 && <small className="period-range-warning">{range.issues.some(({ code }) => code === 'overlapping-periods') ? 'Se superpone con un período guardado.' : 'Hay un período inválido o ambiguo.'}</small>}
      </div>
      <button
        className={disabled ? 'subtle' : 'primary'}
        type="button"
        aria-label={`${disabled ? statusText : 'Crear'} ${title.toLocaleLowerCase('es-CO')}`}
        disabled={disabled}
        onClick={onCreate}
      >
        {range.status === 'available' ? 'Crear' : statusText}
      </button>
    </article>
  );
}
