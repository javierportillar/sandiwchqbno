import { useState } from 'react';
import type { Shift } from '../types/payroll';
import { validShiftRanges } from '../lib/shiftSafety';

export function ShiftEditor({ shift, requiresReview, onSave }: { shift?: Shift; requiresReview: boolean; onSave: (patch: Partial<Shift>) => void }) {
  const ambiguous = requiresReview;
  const [start, setStart] = useState(ambiguous ? '' : shift?.startTime ?? '');
  const [end, setEnd] = useState(ambiguous ? '' : shift?.endTime ?? '');
  const [split, setSplit] = useState(Boolean(!ambiguous && (shift?.secondStart || shift?.secondEnd)));
  const [secondStart, setSecondStart] = useState(ambiguous ? '' : shift?.secondStart ?? '');
  const [secondEnd, setSecondEnd] = useState(ambiguous ? '' : shift?.secondEnd ?? '');
  const [error, setError] = useState('');

  const save = () => {
    if (!validShiftRanges({ startTime: start, endTime: end, secondStart: split ? secondStart : undefined, secondEnd: split ? secondEnd : undefined })) {
      setError('Ingresa horas HH:mm completas y sin superposición. En turnos partidos solo se admite 00:00 como final del último tramo; otros cruces de medianoche requieren revisión con soporte.');
      return;
    }
    if (shift?.templateOriginIds !== undefined && (!Array.isArray(shift.templateOriginIds) || !shift.templateOriginIds.every((id) => typeof id === 'string'))) {
      setError('La procedencia guardada tiene un formato desconocido. Conserva una copia y contacta a soporte.');
      return;
    }
    const origins = [...(shift?.templateOriginIds ?? [])];
    if (shift?.templateId && !origins.includes(shift.templateId)) origins.push(shift.templateId);
    onSave({ startTime: start, endTime: end, secondStart: split ? secondStart : undefined,
      secondEnd: split ? secondEnd : undefined, breakMinutes: 0, templateId: undefined,
      ...(origins.length ? { templateOriginIds: origins } : {}), restDay: false });
  };

  return (
    <div className="shift-cell customize-mode inline-customize">
      {ambiguous && <p>Revisa el turno anterior: define nuevamente los tramos reales antes de guardar. No se deducirá el intervalo anterior.</p>}
      <label>Inicio del primer tramo<input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <label>Fin del primer tramo<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      <label className="row"><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />Agregar segundo tramo</label>
      {split && <>
        <label>Inicio del segundo tramo<input type="time" value={secondStart} onChange={(e) => setSecondStart(e.target.value)} /></label>
        <label>Fin del segundo tramo<input type="time" value={secondEnd} onChange={(e) => setSecondEnd(e.target.value)} /></label>
      </>}
      <small>Solo se suman los tramos trabajados; no se descuenta una pausa adicional.</small>
      <small>Si un turno de un solo tramo termina antes de su hora de inicio, se interpreta que termina al día siguiente.</small>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="primary" onClick={save}>Guardar tramos</button>
    </div>
  );
}
