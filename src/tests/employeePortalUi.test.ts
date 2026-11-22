// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { defaultSettings, seededBranches, seededEmployees, seededPayPeriods, seededShifts } from '../data/seed';

function fakeStorage(values: Record<string, string> = {}) {
  const data = new Map(Object.entries(values));
  const getItem = vi.fn((key: string) => data.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { data.set(key, value); });
  const removeItem = vi.fn((key: string) => { data.delete(key); });
  vi.stubGlobal('localStorage', { getItem, setItem, removeItem });
  return { data, getItem, setItem, removeItem };
}

describe('Employee Portal UI & Suite', () => {
  beforeEach(() => {
    fakeStorage({
      'qbano-branches': JSON.stringify(seededBranches),
      'qbano-employees': JSON.stringify(seededEmployees),
      'qbano-periods': JSON.stringify(seededPayPeriods),
      'qbano-shifts': JSON.stringify(seededShifts),
      'qbano-settings': JSON.stringify(defaultSettings),
      'qbano-adjustments': JSON.stringify({})
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders Portal Empleados button in admin header and navigates to login', async () => {
    render(createElement(App));

    const portalBtn = await screen.findByRole('button', { name: /portal empleados/i });
    expect(portalBtn).toBeDefined();

    await act(async () => {
      fireEvent.click(portalBtn);
    });

    // Should now show the Employee Login screen
    expect(screen.getByText('Portal de Consulta y Horarios de Empleados')).toBeDefined();
    expect(screen.getByText('Soy Empleado')).toBeDefined();
    expect(screen.getByText('Modo Administrador')).toBeDefined();
  });

  it('authenticates an employee with document and pin, entering their personal portal', async () => {
    render(createElement(App));

    const portalBtn = await screen.findByRole('button', { name: /portal empleados/i });
    await act(async () => {
      fireEvent.click(portalBtn);
    });

    // Fill credentials for Laura Martinez (doc: 10101010, pin: 1010)
    const docInput = screen.getByPlaceholderText(/10101010/i);
    const pinInput = screen.getByPlaceholderText('••••');

    fireEvent.change(docInput, { target: { value: '10101010' } });
    fireEvent.change(pinInput, { target: { value: '1010' } });

    const submitBtn = screen.getByRole('button', { name: /ingresar a mi portal/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Verify employee portal loaded for Laura
    expect(screen.getByText('Laura Martínez')).toBeDefined();
    expect(screen.getByText(/sede unicentro/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /hoy y próximo turno/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /mi semana/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /mis horas quincenales/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /mi perfil y pin/i })).toBeDefined();
  });

  it('shows error on invalid credentials', async () => {
    render(createElement(App));

    const portalBtn = await screen.findByRole('button', { name: /portal empleados/i });
    await act(async () => {
      fireEvent.click(portalBtn);
    });

    const docInput = screen.getByPlaceholderText(/10101010/i);
    const pinInput = screen.getByPlaceholderText('••••');

    fireEvent.change(docInput, { target: { value: '10101010' } });
    fireEvent.change(pinInput, { target: { value: '9999' } });

    const submitBtn = screen.getByRole('button', { name: /ingresar a mi portal/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(screen.getByText(/el pin ingresado es incorrecto/i)).toBeDefined();
  });

  it('allows quick demo access with one click', async () => {
    render(createElement(App));

    const portalBtn = await screen.findByRole('button', { name: /portal empleados/i });
    await act(async () => {
      fireEvent.click(portalBtn);
    });

    const lauraChip = screen.getByTitle(/ingresar como laura martínez/i);
    await act(async () => {
      fireEvent.click(lauraChip);
    });

    expect(screen.getByText('Laura Martínez')).toBeDefined();
  });

  it('displays only hours in the hours tab without monetary figures', async () => {
    render(createElement(App));

    const portalBtn = await screen.findByRole('button', { name: /portal empleados/i });
    await act(async () => {
      fireEvent.click(portalBtn);
    });

    const lauraChip = screen.getByTitle(/ingresar como laura martínez/i);
    await act(async () => {
      fireEvent.click(lauraChip);
    });

    // Navigate to "Mis Horas Quincenales"
    const hoursTabBtn = screen.getByRole('button', { name: /mis horas quincenales/i });
    await act(async () => {
      fireEvent.click(hoursTabBtn);
    });

    // Check hours titles exist
    expect(screen.getByText('Total Horas Computadas en Quincena')).toBeDefined();
    expect(screen.getByText(/Horas Ordinarias \(ORD\)/i)).toBeDefined();
    expect(screen.getByText(/Recargo Nocturno \(RN\)/i)).toBeDefined();

    // Verify no monetary salary symbols appear inside hours-grid-cards
    const hoursGrid = document.querySelector('.hours-grid-cards');
    expect(hoursGrid?.textContent).not.toContain('$');
  });

  it('logs out and returns to login', async () => {
    render(createElement(App));

    const portalBtn = await screen.findByRole('button', { name: /portal empleados/i });
    await act(async () => {
      fireEvent.click(portalBtn);
    });

    const lauraChip = screen.getByTitle(/ingresar como laura martínez/i);
    await act(async () => {
      fireEvent.click(lauraChip);
    });

    const logoutBtn = screen.getByTitle('Cerrar sesión');
    await act(async () => {
      fireEvent.click(logoutBtn);
    });

    expect(screen.getByText('Portal de Consulta y Horarios de Empleados')).toBeDefined();
  });

  it('allows switching to admin with master PIN', async () => {
    render(createElement(App));

    const portalBtn = await screen.findByRole('button', { name: /portal empleados/i });
    await act(async () => {
      fireEvent.click(portalBtn);
    });

    const lauraChip = screen.getByTitle(/ingresar como laura martínez/i);
    await act(async () => {
      fireEvent.click(lauraChip);
    });

    const adminSwitchBtn = screen.getByTitle('Ir al panel de administración');
    await act(async () => {
      fireEvent.click(adminSwitchBtn);
    });

    expect(screen.getByText('Acceso a Modo Administrador')).toBeDefined();

    const adminPinInput = screen.getByLabelText(/pin de administrador/i);
    fireEvent.change(adminPinInput, { target: { value: '1234' } });

    const enterBtn = screen.getByRole('button', { name: 'Ingresar' });
    await act(async () => {
      fireEvent.click(enterBtn);
    });

    // Should return to admin view with the Dashboard button
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeDefined();
  });
});

