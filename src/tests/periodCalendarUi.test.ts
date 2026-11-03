// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeriodCalendar } from '../components/PeriodCalendar';
import type { PayPeriod } from '../types/payroll';

const period = (id: string, startDate: string, endDate: string, label = id): PayPeriod => ({
  id,
  companyId: 'company-qbano',
  startDate,
  endDate,
  label
});

function mount(periods: PayPeriod[] = [], initialMonth = '2024-02', onCreatePeriod = vi.fn(() => true)) {
  const onClearError = vi.fn();
  const view = render(createElement(PeriodCalendar, {
    periods,
    initialMonth,
    creationError: '',
    onCreatePeriod,
    onClearError
  }));
  let currentPeriods = periods;
  const rerender = (nextPeriods: PayPeriod[], month: string) => view.rerender(createElement(PeriodCalendar, {
    periods: nextPeriods,
    initialMonth: month,
    creationError: '',
    onCreatePeriod,
    onClearError
  }));
  return {
    onCreatePeriod,
    onClearError,
    changeInitialMonth: (month: string) => rerender(currentPeriods, month),
    changePeriods: (nextPeriods: PayPeriod[]) => {
      currentPeriods = nextPeriods;
      rerender(currentPeriods, initialMonth);
    }
  };
}

function clickDate(date: string) {
  const button = document.querySelector(`button[data-calendar-date="${date}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing calendar date button ${date}`);
  fireEvent.click(button);
}

afterEach(cleanup);

describe('period calendar UI', () => {
  it('marks first-quincena dates with stable color and start/end markers, and explains the color outside the cells', () => {
    mount([period('february-first-half', '2024-02-01', '2024-02-15', 'Primera quincena de febrero')]);

    const firstDay = document.querySelector('[data-calendar-date="2024-02-01"]');
    const lastDay = document.querySelector('[data-calendar-date="2024-02-15"]');
    expect(firstDay?.querySelector('.period-day-marker')?.textContent).toBe('I');
    expect(lastDay?.querySelector('.period-day-marker')?.textContent).toBe('F');
    expect(firstDay?.querySelector('.period-day-marker')?.classList.contains('marker-green')).toBe(true);
    expect(firstDay?.querySelector('.period-day-marker')?.getAttribute('title')).toContain('Período 1');
    expect(screen.getByText('Primera quincena de febrero')).toBeTruthy();
    expect(document.querySelector('.period-range-category')?.textContent).toBe('Período 1');
    const legend = Array.from(document.querySelectorAll('.period-legend-entry')).map((entry) => entry.textContent);
    expect(legend).toEqual(expect.arrayContaining([
      expect.stringContaining('Período 1Del 1 al 15 de cada mes'),
      expect.stringContaining('Período 2Del 16 al último día del mes'),
      expect.stringContaining('Rango personalizadoOtro rango de fechas')
    ]));
    expect(firstDay?.querySelector('.period-day-marker')?.textContent).not.toContain('P1');
    const endpoints = document.querySelector('.period-range-endpoints')?.textContent ?? '';
    expect(endpoints).toContain('Inicio:');
    expect(endpoints).toContain('Fin:');
    expect(endpoints).toContain('01 de febrero de 2024');
    expect(endpoints).toContain('15 de febrero de 2024');
  });

  it('shows range start and end markers when both endpoints fall outside the visible month', () => {
    mount([period('winter-range', '2024-01-29', '2024-03-03', 'Cruza febrero')]);

    const startCell = document.querySelector('[data-calendar-date="2024-01-29"]')?.closest('td');
    const endCell = document.querySelector('[data-calendar-date="2024-03-03"]')?.closest('td');
    expect(startCell?.classList.contains('outside-month')).toBe(true);
    expect(endCell?.classList.contains('outside-month')).toBe(true);
    expect(startCell?.querySelector('.period-day-marker')?.textContent).toBe('I');
    expect(endCell?.querySelector('.period-day-marker')?.textContent).toBe('F');
    expect(startCell?.querySelector('.period-day-marker')?.classList.contains('marker-slate')).toBe(true);
    expect(document.querySelector('.period-range-category')?.textContent).toBe('Rango personalizado');

    const endpoints = document.querySelector('.period-range-endpoints')?.textContent ?? '';
    expect(endpoints).toContain('29 de enero de 2024');
    expect(endpoints).toContain('3 de marzo de 2024');
  });

  it('keeps period colors and labels attached to their date ranges when order changes or a custom range is added', () => {
    const firstHalf = period('first-half', '2024-02-01', '2024-02-15', 'Primera quincena');
    const secondHalf = period('second-half', '2024-02-16', '2024-02-29', 'Segunda quincena');
    const custom = period('custom', '2024-01-29', '2024-01-31', 'Rango adicional');
    const calendar = mount([secondHalf, firstHalf]);

    const expectDateColor = (date: string, color: string, marker: string) => {
      const periodMarker = document.querySelector(`[data-calendar-date="${date}"] .period-day-marker`);
      expect(periodMarker?.textContent).toBe(marker);
      expect(periodMarker?.classList.contains(`marker-${color}`)).toBe(true);
    };

    expectDateColor('2024-02-01', 'green', 'I');
    expectDateColor('2024-02-15', 'green', 'F');
    expectDateColor('2024-02-16', 'gold', 'I');
    expectDateColor('2024-02-29', 'gold', 'F');
    expect(Array.from(document.querySelectorAll('.period-range-category')).map((badge) => badge.textContent))
      .toEqual(['Período 2', 'Período 1']);

    calendar.changePeriods([custom, secondHalf, firstHalf]);

    expectDateColor('2024-02-01', 'green', 'I');
    expectDateColor('2024-02-15', 'green', 'F');
    expectDateColor('2024-02-16', 'gold', 'I');
    expectDateColor('2024-02-29', 'gold', 'F');
    expectDateColor('2024-01-29', 'slate', 'I');
    expect(Array.from(document.querySelectorAll('.period-range-category')).map((badge) => badge.textContent))
      .toEqual(['Rango personalizado', 'Período 2', 'Período 1']);
  });

  it('waits for an explicit create action after the user selects a custom inclusive range', () => {
    const { onCreatePeriod } = mount();

    clickDate('2024-02-05');
    expect(onCreatePeriod).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Crear período' }) as HTMLButtonElement).disabled).toBe(true);
    clickDate('2024-02-09');
    expect(onCreatePeriod).not.toHaveBeenCalled();
    expect(screen.getByText(/5 de feb de 2024 — 9 de feb de 2024/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Crear período' }));
    expect(onCreatePeriod).toHaveBeenCalledWith('2024-02-05', '2024-02-09');
  });

  it('navigates months and offers both explicit quincena actions for the visible month', () => {
    const { onCreatePeriod } = mount([], '2024-02');
    expect(onCreatePeriod).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(screen.getByText('Marzo de 2024')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Crear primera quincena' }));
    expect(onCreatePeriod).toHaveBeenLastCalledWith('2024-03-01', '2024-03-15');
    fireEvent.click(screen.getByRole('button', { name: 'Crear segunda quincena' }));
    expect(onCreatePeriod).toHaveBeenLastCalledWith('2024-03-16', '2024-03-31');
    expect(onCreatePeriod).toHaveBeenCalledTimes(2);
  });

  it('marks an already-created exact quincena as existing and disables its action', () => {
    mount([period('first-half', '2024-02-01', '2024-02-15', 'Primera quincena de febrero')]);

    const existingAction = screen.getByRole('button', { name: 'Ya existe primera quincena' }) as HTMLButtonElement;
    expect(existingAction.disabled).toBe(true);
    expect(existingAction.closest('.quick-period-card')?.classList.contains('quick-period-blocked')).toBe(false);
    expect(document.querySelector('.status-created')?.textContent).toBe('Ya existe');
  });

  it('follows the selected payroll period month when its initial month changes', () => {
    const calendar = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(screen.getByText('Marzo de 2024')).toBeTruthy();

    calendar.changeInitialMonth('2024-05');

    expect(screen.getByText('Mayo de 2024')).toBeTruthy();
  });

  it('flags overlapping persisted periods and blocks both conflicting range actions', () => {
    mount([
      period('first', '2024-02-05', '2024-02-15', 'Primer rango'),
      period('overlap', '2024-02-12', '2024-02-20', 'Rango cruzado')
    ]);

    expect(document.querySelectorAll('[data-calendar-date="2024-02-12"] .period-day-marker')).toHaveLength(2);
    expect(document.querySelector('[data-calendar-date="2024-02-12"] .period-conflict-marker')?.textContent).toContain('Cruce');
    expect(screen.getAllByText('Se cruza con otro período.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Bloqueada por conflicto primera quincena' })
      .closest('.quick-period-card')?.classList.contains('quick-period-blocked')).toBe(true);
    expect((screen.getByRole('button', { name: 'Bloqueada por conflicto primera quincena' }) as HTMLButtonElement).disabled).toBe(true);

    clickDate('2024-02-10');
    clickDate('2024-02-14');
    expect(screen.getByRole('alert').textContent).toContain('se superponen');
    expect((screen.getByRole('button', { name: 'Crear período' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
