import { describe, it, expect } from 'vitest';
import { seededBranches } from '../data/seed';
import { resolveTemplateForDate, listTemplatesForDate } from '../lib/templates';
import type { Branch } from '../types/payroll';

const avenida = seededBranches.find((b) => b.id === 'branch-avenida') as Branch;
const unicentro = seededBranches.find((b) => b.id === 'branch-unicentro') as Branch;
const unico = seededBranches.find((b) => b.id === 'branch-unico') as Branch;

describe('resolveTemplateForDate', () => {
  it('Avenida sala partido devuelve avenida-sala-partido', () => {
    const t = resolveTemplateForDate(avenida, '2026-01-05', {
      role: 'sala',
      kind: 'partido'
    });
    expect(t?.id).toBe('avenida-sala-partido');
  });

  it('Avenida domicilio partido devuelve avenida-domi-partido', () => {
    const t = resolveTemplateForDate(avenida, '2026-01-05', {
      role: 'domicilio',
      kind: 'partido'
    });
    expect(t?.id).toBe('avenida-domi-partido');
  });

  it('Avenida sin role devuelve undefined (templates requieren rol)', () => {
    const t = resolveTemplateForDate(avenida, '2026-01-05', { kind: 'normal' });
    expect(t).toBeUndefined();
  });

  it('Unicentro partido: domingo vs lunes devuelven plantillas distintas', () => {
    const sunday = resolveTemplateForDate(unicentro, '2026-01-04', { kind: 'partido' });
    const monday = resolveTemplateForDate(unicentro, '2026-01-05', { kind: 'partido' });
    expect(sunday?.id).toBe('unicentro-dom-partido');
    expect(monday?.id).toBe('unicentro-ls-partido');
  });

  it('Único partido: jueves vs viernes devuelven plantillas distintas', () => {
    const thu = resolveTemplateForDate(unico, '2026-01-01', { kind: 'partido' });
    const fri = resolveTemplateForDate(unico, '2026-01-02', { kind: 'partido' });
    expect(thu?.id).toBe('unico-dj-partido');
    expect(fri?.id).toBe('unico-vs-partido');
  });

  it('Unicentro normal sábado tiene startTime 14:00', () => {
    const t = resolveTemplateForDate(unicentro, '2026-01-03', { kind: 'normal' });
    expect(t?.startTime).toBe('14:00');
    expect(t?.endTime).toBe('22:00');
  });

  it('kind descanso (no existe como plantilla) devuelve undefined', () => {
    const t = resolveTemplateForDate(unicentro, '2026-01-05', {
      kind: 'descanso'
    });
    expect(t).toBeUndefined();
  });
});

describe('listTemplatesForDate', () => {
  it('Unicentro lunes devuelve 3 templates (normal/partido/doblado)', () => {
    const templates = listTemplatesForDate(unicentro, '2026-01-05');
    expect(templates).toHaveLength(3);
    expect(templates.map((t) => t.kind).sort()).toEqual([
      'doblado',
      'normal',
      'partido'
    ]);
  });

  it('Unicentro domingo devuelve 3 templates (DOM variants)', () => {
    const templates = listTemplatesForDate(unicentro, '2026-01-04');
    expect(templates).toHaveLength(3);
    expect(templates.every((t) => t.id.includes('dom-'))).toBe(true);
  });

  it('Avenida con role=sala devuelve 3 templates', () => {
    const templates = listTemplatesForDate(avenida, '2026-01-05', 'sala');
    expect(templates).toHaveLength(3);
    expect(templates.every((t) => t.role === 'sala')).toBe(true);
  });

  it('Avenida sin role devuelve 0 templates', () => {
    const templates = listTemplatesForDate(avenida, '2026-01-05');
    expect(templates).toHaveLength(0);
  });
});
