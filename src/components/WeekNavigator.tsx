import { addDaysToDate, getLocalTodayISO, getMondayWeekStart } from '../lib/scheduleWeek';

function formatDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('es-CO', { ...options, timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`));
}

export function WeekNavigator({
  weekStart,
  onChange
}: {
  weekStart: string;
  onChange: (nextWeekStart: string) => void;
}) {
  const weekEnd = addDaysToDate(weekStart, 6);
  const todayWeekStart = getMondayWeekStart(getLocalTodayISO());
  const rangeLabel = `${formatDate(weekStart, { day: '2-digit', month: 'short' })} — ${formatDate(weekEnd, { day: '2-digit', month: 'short', year: 'numeric' })}`;

  return (
    <nav className="week-navigator" aria-label="Navegación de semanas">
      <button
        type="button"
        className="subtle week-nav-button"
        onClick={() => onChange(addDaysToDate(weekStart, -7))}
        aria-label={`Semana anterior a ${weekStart}`}
      >
        <span aria-hidden="true">←</span>
        <span>Semana anterior</span>
      </button>
      <div className="week-range" aria-live="polite">
        <strong>{rangeLabel}</strong>
        <span>{weekStart} — {weekEnd}</span>
      </div>
      <button
        type="button"
        className="subtle week-nav-button"
        onClick={() => onChange(addDaysToDate(weekStart, 7))}
        aria-label={`Semana siguiente a ${weekStart}`}
      >
        <span>Semana siguiente</span>
        <span aria-hidden="true">→</span>
      </button>
      {weekStart !== todayWeekStart && (
        <button
          type="button"
          className="week-today-button"
          onClick={() => onChange(todayWeekStart)}
        >
          Semana actual
        </button>
      )}
    </nav>
  );
}
