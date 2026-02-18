# Sandwich Qbano - MVP Nómina Quincenal (Frontend)

Aplicación web frontend en React + TypeScript para capturar turnos por quincena y calcular horas/recargos con exportación a Excel.

## Stack

- React + TypeScript + Vite
- Estado local con `localStorage`
- Motor de cálculo aislado en `src/lib/calculation.ts`
- Exportación XLSX con `exceljs`
- Pruebas unitarias con `vitest`

## Ejecución

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev`: desarrollo
- `npm run build`: build de producción
- `npm run start`: preview del build
- `npm run test`: pruebas unitarias

## Flujo MVP

1. Dashboard: seleccionar/crear periodo (quincena) y filtrar por sede.
2. Empleados: CRUD básico (crear + activar/inactivar).
3. Horarios: captura por día por empleado, con descanso y copia/pegado.
4. Cálculo: detalle diario, resumen por empleado y liquidación tipo "HORAS EXTRAS".
5. Exportar: genera Excel con hojas `Detalle`, `Resumen`, `Horas Extras`.

## Estructura relevante

- `src/lib/calculation.ts`: funciones `splitShiftIntoSegments`, `classifySegments`, `applyOrdinaryVsExtra`, `aggregateDailyAndPeriod`.
- `src/lib/exportExcel.ts`: generación del XLSX.
- `src/data/seed.ts`: datos iniciales (empresa, sedes, empleados, ejemplo de turnos).
- `src/tests/calculation.test.ts`: pruebas del motor.

## Supuestos MVP

- Timezone operacional: `America/Bogota`.
- Las primeras 8 horas netas del día son ordinarias; excedente se marca extra.
- El break se descuenta primero del tramo diurno no dominical.
- `RN DOMIN` existe como columna, pero el motor base no la asigna automáticamente en esta versión (queda disponible para ajustes posteriores).
