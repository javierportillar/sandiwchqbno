# Sándwich Qbano · Nómina Quincenal

> **Liquidación de nómina para tres sedes en Cali** — Avenida, Unicentro y Único — con **turnos plantilla predefinidos por sede**, código de color por franja horaria y exportación a Excel. Todo en el navegador, `localStorage`, sin backend. Frontend React 19 + TypeScript + Vite.

> **Documento vivo del proyecto.** Este README es el plan canónico. Cambia cuando cambia el alcance; se mantiene en sincronía con el tracker de tareas y con el pptx oficial `INVERSIONES CAICEDO BASTIDAS SAS COMPONENTES DE NOMINA.pptx` que define reglas de negocio.

```
                         ┌──────────────────────────────────┐
                         │  Operador de nómina (celular/PC) │
                         └───────────────┬──────────────────┘
                                         │
                                         ▼
                         ┌──────────────────────────────────┐
                         │      PWA React (Vite build)      │
                         │                                  │
                         │  Dashboard · Empleados · Horarios│
                         │  Cálculo · Configuración         │
                         └────┬─────────┬──────────┬────────┘
                              │         │          │
                              ▼         ▼          ▼
                    ┌──────────────┐ ┌─────────┐ ┌────────────┐
                    │ localStorage │ │ Motor   │ │ ExcelJS    │
                    │ (fuente única│ │ cálculo │ │ (.xlsx     │
                    │  de verdad)  │ │ (puro)  │ │  descarga) │
                    └──────────────┘ └─────────┘ └────────────┘
```

---

## 1 · Índice

1. [Visión](#2--visión)
2. [Roles operativos](#3--roles-operativos)
3. [Reglas de negocio desde el pptx](#4--reglas-de-negocio-desde-el-pptx)
4. [Estado del proyecto](#5--estado-del-proyecto)
5. [Plan MVP por fases](#6--plan-mvp-por-fases)
6. [Stack tecnológico](#7--stack-tecnológico)
7. [Modelo de datos](#8--modelo-de-datos)
8. [Estructura del repositorio](#9--estructura-del-repositorio)
9. [Quickstart](#10--quickstart)
10. [Convenciones y decisiones](#11--convenciones-y-decisiones)
11. [Roadmap post-MVP](#12--roadmap-post-mvp)

---

## 2 · Visión

| Antes | Después |
|---|---|
| El operador ingresaba HH:MM entrada/salida en cuatro inputs pequeños por celda, sin pista visual de sede ni de tipo de turno. | Un click sobre un chip **Partido / Normal / Doblado / Descanso**. El sistema conoce el horario exacto según sede + rol + día de la semana. |
| Todas las celdas se veían iguales, en escala de grises azul. Para "ubicar rápido a Laura de Unicentro" había que leer subtítulos. | Cada celda tiene **borde de color por sede** y **chip de color por franja de turno**. Se lee la grilla de un vistazo. |
| El recargo nocturno arrancaba a las **21:00** en la configuración por defecto, cuando el pptx dice **19:00**. Toda la nómina salía con RN subestimado. | El default queda alineado al pptx (`nocturnalStart: '19:00'`), y hay tests que fijan la regla contra los desgloses del documento oficial. |
| La sede "Panamericana" no existe en el negocio real: era placeholder. | Las tres sedes reales quedan cargadas: **Avenida**, **Unicentro**, **Único**, cada una con su catálogo de turnos plantilla. |

**Lo que la app NO hace (por diseño del MVP).**

- **No aplica automáticamente la regla de "3+ domingos → compensatorio"** (art. 179/180 CST, descrita en el pptx). Esta regla exige contabilizar domingos por mes calendario cruzando quincenas — queda fuera del MVP y va como roadmap V2.
- **No tiene backend ni multiusuario**. Todo vive en `localStorage` de un solo navegador. Si el operador cambia de máquina, migra manualmente.
- **No calcula parafiscales, seguridad social ni retención en la fuente**. Solo liquida conceptos de trabajo suplementario (RN, HED, HEN, DOM, RN_DOM, HED_DOM, HEN_DOM) según la fórmula `Sueldo Básico / 220 × TARIFA × cantidad de horas`.

---

## 3 · Roles operativos

El proyecto se opera con un dueño de producto humano y agentes especializados con roles bien diferenciados. Esto NO es cosmético: define qué puede tocar cada uno y dónde para la línea.

| Rol | Quién | Qué hace | Qué NO hace |
|---|---|---|---|
| **Product Owner (PO)** | Javier (humano) | Define alcance, valida contra el pptx oficial, decide go/no-go de cada fase, aprueba paleta de colores. | NO escribe código de aplicación. NO toma decisiones de arquitectura autónomas. |
| **Revisor / Arquitecto** | Agente IA con rol reviewer | Audita post-commit contra las reglas del pptx, valida que cada plantilla de turno arroje los conceptos correctos, GO/NO-GO técnico al cierre de cada fase, dueño de los tests contra el pptx. | NO implementa código sin handoff explícito. NO cambia paleta ni copywriting sin PO. |
| **Desarrollador Frontend** | Agente IA con rol dev | Implementa tipos, seed, motor de cálculo, celda de horario, chips, CSS custom properties, tests de plantilla. Corre validaciones locales antes de cada commit. | NO cambia reglas de negocio (multiplicadores, franja nocturna, dayScope) sin PO+Revisor. NO renombra sedes ni conceptos. NO se sale del scope del brief sin preguntar. |
| **QA / Verificador** | Agente IA o el propio PO | Corre `npm test` + prueba manual del flujo Dashboard → Horarios → Cálculo → Exportar, valida el .xlsx contra un caso conocido de nómina de la empresa. | NO firma un GO si algún test contra el pptx queda rojo. NO acepta warnings de TypeScript. |

### Handoff estándar por fase

```
PO define alcance de fase
    ↓
Revisor traduce alcance a criterios de aceptación (DoD)
    ↓
Dev valida local (npm test + build + tsc) · commit directo a main · push
    ↓
Revisor audita post-commit · verifica DoD · valida contra pptx si aplica
    ↓
Si hay scope violation o bug → Revisor pide revert (git revert en main)
    ↓
QA corre flujo end-to-end · exporta xlsx · valida números
    ↓
PO firma GO/NO-GO · se avanza a la siguiente fase
```

**Regla dura.** El Dev NO firma su propio trabajo. El Revisor NO implementa. El PO NO codea. Si un rol necesita salirse de su carril, se comunica ANTES del commit — no después.

### Política de branching (MVP pre-producción)

Durante la fase MVP, **todo el trabajo va directo a `main` con commit-push**. Sin ramas por fase, sin PRs, sin approval gate pre-merge. Decisión explícita del PO por el trade-off costo/beneficio en un equipo de un solo dev sin CI/CD.

**Contrapartida obligatoria del Dev.** Antes de cada commit, en este orden:

```bash
npm test          # tests unitarios
npm run build     # build de producción
npx tsc --noEmit  # type check
```

Si cualquiera falla, **no se commitea** — se arregla y se re-valida hasta que los tres pasen verdes. Un commit rojo en main degrada la línea para todos.

**Contrapartida obligatoria del Revisor.** Como no hay gate pre-merge, audita post-commit con ventana corta (mismo día). Si detecta scope violation, bug o test roto, pide `git revert` inmediato — no se acumula deuda técnica sobre trabajo mal firmado.

**Cuándo cambiamos a ramas + PRs.** Cualquiera de estos gatilla el cambio:

1. La app entra en uso de producción real (un operador corriendo nómina con datos vivos).
2. Se suma un segundo desarrollador al proyecto.
3. Se conecta CI/CD.
4. El PO lo decide por otra razón.

Cuando cambie, se agrega convención de ramas (`fase-N-nombre`), se abre PR contra main, y el Revisor mergea (no el Dev).

---

## 4 · Reglas de negocio desde el pptx

Estas reglas están en `INVERSIONES CAICEDO BASTIDAS SAS COMPONENTES DE NOMINA.pptx` (slides 2 a 5). Son la fuente única de verdad. Si un cálculo del código las contradice, el bug está en el código.

### 4.1 · Trabajo suplementario (fórmula general y tarifas)

**Fórmula.** `Sueldo Básico / 220 × TARIFA × cantidad de horas`

| Concepto | Código | Tarifa (recargo sobre hora ordinaria) | Definición |
|---|---|---|---|
| Recargo Nocturno | `RN` | 0,35 | Horas dentro de la jornada ordinaria trabajadas **después de las 7 PM**. |
| Hora Extra Diurna | `HED` | 0,25 | Horas adicionales a la jornada ordinaria, hasta las 7 PM. |
| Hora Extra Nocturna | `HEN` | 0,75 | Horas adicionales a la jornada ordinaria, después de las 7 PM. |
| Dominical Diurno | `DOM_DIURNO` | 0,80 | Trabajo dominical ocasional o habitual (art. 179/180 CST), tramo diurno. |
| Dominical Nocturno | `DOM_NOCT` | 1,80 | Tramo dominical trabajado después de las 7 PM. |
| Recargo Nocturno Dominical | `RN_DOM` | 1,15 | 0,35 + 0,80 acumulado. |
| Hora Extra Diurna Dominical | `HED_DOM` | 2,05 | 1,25 + 0,80 acumulado. |
| Hora Extra Nocturna Dominical | `HEN_DOM` | 2,55 | 1,75 + 0,80 acumulado. |

> **Nota sobre "tarifas totales" vs "recargos".** El pptx habla en tarifas totales (`HED = 1,25` → 100% de la hora ordinaria + 25% de recargo). El código maneja únicamente el **recargo** (`0,25`), y suma la hora ordinaria por separado en `ORD`. Matemáticamente equivalente. Cualquier cambio de convención debe pasar por el Revisor.

> **Jornada ordinaria = 7h/día — firmado por PO 2026-07-02.** `defaultSettings.dailyOrdinaryHours = 7`. Alinea con los desgloses del pptx: Avenida sala DOBLADO 11-22 = 7 ORD + 1 HED + 3 HEN, Único DOM-JUE DOBLADO 11-21 = 7 ORD + 1 HED + 2 HEN, y análogos. La ley colombiana estándar es 8h/día; el pptx refleja el pacto interno de la empresa. El motor asigna las primeras 7h netas del día a `ORD` (o `RN` si caen después de las 19:00) y el excedente a extras.

### 4.2 · Turnos plantilla por sede

Cada empleado se ubica con un chip de turno. El sistema conoce las horas exactas según sede + día + rol.

#### Avenida — sala (todos los días)

| Turno | Franja | Desglose esperado |
|---|---|---|
| Partido | 11:00-14:00 + 18:00-22:00 | 4 ORD + 3 RN |
| Normal | 14:00-22:00 | 5 ORD + 2 RN + 1 HEN |
| Doblado | 11:00-22:00 | 7 ORD + 1 HED + 3 HEN |

#### Avenida — domiciliarios (todos los días)

| Turno | Franja | Desglose esperado |
|---|---|---|
| Partido | 12:00-15:00 + 18:00-22:00 | 4 ORD + 3 RN |
| Normal | 15:00-22:00 | 4 ORD + 3 RN |
| Doblado | 12:00-22:00 | 7 ORD + 3 HEN |

#### Unicentro — lunes a sábado

| Turno | Franja | Desglose esperado |
|---|---|---|
| Partido | 11:00-14:00 + 18:00-22:00 | 4 ORD + 3 RN |
| Normal | 14:00-22:00 | 5 ORD + 2 RN + 1 HEN |
| Doblado | 11:00-22:00 | 7 ORD + 1 HED + 3 HEN |

#### Unicentro — domingo

| Turno | Franja | Desglose esperado |
|---|---|---|
| Partido | 10:00-14:00 + 18:00-22:00 | 5 ORD + 2 RN + 1 HEN |
| Normal | 14:00-22:00 | 5 ORD + 2 RN + 1 HEN |
| Doblado | 10:00-22:00 | 7 ORD + 2 HED + 3 HEN |

#### Único — domingo a jueves

| Turno | Franja | Desglose esperado |
|---|---|---|
| Partido | 11:00-14:00 + 18:00-21:00 | 4 ORD + 2 RN |
| Normal | 14:00-21:00 | 5 ORD + 2 RN |
| Doblado | 11:00-21:00 | 7 ORD + 1 HED + 2 HEN |

#### Único — viernes y sábado

| Turno | Franja | Desglose esperado |
|---|---|---|
| Partido | 11:00-14:00 + 18:00-21:30 | 4 ORD + 2,5 RN |
| Normal | 14:00-21:30 | 5 ORD + 2 RN + 0,5 HEN |
| Doblado | 11:00-21:30 | 7 ORD + 1 HED + 2,5 HEN |

### 4.3 · Reglas fuera del MVP

- **Domingo ocasional vs habitual.** El pptx distingue: hasta 2 domingos en el mes = `TARIFA 0,80` sin compensatorio; 3 o más = `TARIFA 0,80` con compensatorio en la semana. El MVP calcula el `TARIFA 0,80` correctamente pero **no genera el compensatorio automático**. Queda como V2.
- **Cambio de cierre por evento**. Si la sede ajusta cierre por temporada o evento, el operador usa el botón "Personalizar" de la celda y entra horas a mano.

---

## 5 · Estado del proyecto

| Módulo | Estado | Notas |
|---|---|---|
| Motor de cálculo `splitShiftIntoSegments` + `classifySegments` + `applyOrdinaryVsExtra` | ✅ Estable | `nocturnalStart` corregido a 19:00 en Fase 0.2. |
| Persistencia `localStorage` | ✅ Estable | `qbano-*` keys en `src/lib/storage.ts`. |
| Exportación Excel `.xlsx` (Detalle, Resumen, Horas Extras) | ✅ Estable | `src/lib/exportExcel.ts`. |
| Seed con 3 sedes reales (Avenida, Unicentro, Único) | ✅ Completa | Fase 0.1 cerrada. |
| Modelo `ShiftTemplate` + rol de empleado | 🟡 Aceptado parcial | F1.1/F1.2/F1.3 aceptadas con Opción B (2026-07-02). Correctivas en Fase 1.4. |
| Motor de dos tramos para turno partido | 🟡 Deuda técnica | Heurístico "medio y medio" cumple los 6 casos del pptx por coincidencia numérica. Migración a `secondStart`/`secondEnd` explícitos en F1.4c. |
| Celda de horario con chips de turno y color por sede | 🔴 Pendiente | Fase 2. Bloqueada hasta cerrar F1.4a + F1.4b. |
| Paleta por sede + franja + leyenda | 🔴 Pendiente | Fase 3. |
| Agrupar filas por sede + copiar/pegar por plantilla | 🔴 Pendiente | Fase 4. |
| Tests contra pptx (18 casos: 3 sedes × 3 turnos × dayScopes) | 🔴 Pendiente | Fase 5. |
| Regla "3+ domingos → compensatorio" | ⏳ Roadmap V2 | Fuera de MVP por decisión de PO. |

---

## 6 · Plan MVP por fases

Cada tarea tiene **ID** (usar en commits), **rol responsable**, **rol revisor** y **Definition of Done** (DoD) verificable.

### Fase 0 · Fixes críticos ✅ COMPLETADA

| ID | Tarea | Estado |
|---|---|---|
| **F0.1** | Renombrar sede `Panamericana` → `Avenida`. | ✅ Commit `5696df3` |
| **F0.2** | Corregir `defaultSettings.nocturnalStart` de `'21:00'` a `'19:00'`. | ✅ Commit `8139782` |

### Fase 1 · Modelo de datos: plantillas de turno + rol 🟡 ACEPTADA PARCIAL

Aceptación de PO 2026-07-02 con Opción B: no se hace revert, se completa en Fase 1.4.

| ID | Tarea | Estado | Comentario |
|---|---|---|---|
| **F1.1** | Extender tipos con ShiftTemplate/DayScope/EmployeeRole/etc. | 🟡 Parcial (`1a6a61a`) | Solo se agregó `Shift.templateId?`. Faltantes → F1.4a. |
| **F1.2** | Poblar `seededBranches` con 6 combinaciones dayScope × sede × rol. | 🟡 Mal dirigida (`645fb78`) | Se agregaron 3 templates globales huérfanos. Refactor por sede → F1.4b. |
| **F1.3** | Extender `splitShiftIntoSegments` para consumir `secondStart`/`secondEnd`. | 🟡 Con deuda (`3d80827`) | Heurístico "medio y medio" cumple pptx por coincidencia numérica. Migración → F1.4c. |

### Fase 1.4 · Correctivas de Fase 1

| ID | Tarea | Responsable | Revisor | DoD |
|---|---|---|---|---|
| **F1.4a** | Agregar en `payroll.ts` los tipos que faltaron en F1.1: `ShiftKind`, `DayScope`, `EmployeeRole`, `ShiftTemplate`, `Branch.shiftTemplates`, `Shift.secondStart?`/`secondEnd?`, `Employee.role?`. | Dev Frontend | Revisor | `tsc --noEmit` verde. Sin `any`. `seededBranches` sigue funcionando (backward compatible: `shiftTemplates` arranca `[]` en F1.4a, se puebla en F1.4b). |
| **F1.4b** | Eliminar `seededTemplates` global y `ShiftTemplateSeed` de `seed.ts`. Poblar `seededBranches[i].shiftTemplates` con las 6 combinaciones exactas de la sección 4.2 del pptx. | Dev Frontend | Revisor (valida contra pptx) | Cada plantilla matchea 1:1 con la tabla de la sección 4.2. `npm test` verde. **Bloquea Fase 2.** |
| **F1.4c** | Deuda técnica (postergable). Migrar `splitShiftIntoSegments` del heurístico "halfWork = workMinutes / 2" a lectura literal de `shift.secondStart`/`shift.secondEnd`. Eliminar `TEMPLATE_PARTIDO` como magic string. | Dev Frontend | Revisor | Cualquier shift con `secondStart+secondEnd` produce dos bloques literales. Test nuevo: partido 09:00-13:00 + 15:00-19:00 sin break → 8h netas distribuidas correctamente. Trigger: primera excepción del operador, o antes si F5 revela discrepancias. |

### Fase 2 · UI: chips de turno con color por sede

| ID | Tarea | Responsable | Revisor | DoD |
|---|---|---|---|---|
| **F2.1** | Nuevo módulo `src/lib/templates.ts` con `resolveTemplateForDate(branch, dateISO, role?, kind)`. Tests en `src/tests/templates.test.ts`. | Dev Frontend | Revisor | Domingo 2026-01-04 con Unicentro + `partido` devuelve la plantilla 10:00-14:00 + 18:00-22:00. Cobertura de los 6 dayScopes. |
| **F2.2** | Rediseñar la celda de horario en `src/App.tsx`: 4 chips (Partido/Normal/Doblado/Descanso) + botón "Personalizar" colapsable. | Dev Frontend | Revisor | Un click en "Doblado" en un domingo de Unicentro llena la celda con 10:00-22:00. |
| **F2.3** | Selector "Rol" en Empleados, visible solo cuando `branchId === 'branch-avenida'`. Opciones: Sala / Domicilio. | Dev Frontend | Revisor | Empleado de Avenida sin rol asignado no rompe el flujo. |

### Fase 3 · Paleta y layout

| ID | Tarea | Responsable | Revisor | DoD |
|---|---|---|---|---|
| **F3.1** | CSS custom properties en `src/styles.css`: `--branch-*` y `--turn-*`. Aplicar borde-izquierdo (4px) de sede y fondo suave del chip activo con color de turno. | Dev Frontend | PO (paleta) + Revisor (contraste WCAG AA) | Contraste texto/fondo ≥ 4.5:1 en todos los chips. |
| **F3.2** | Leyenda arriba de la tabla + badge de sede en primera columna. | Dev Frontend | PO | Leyenda coincide con los colores usados en la grilla. |

### Fase 4 · QoL

| ID | Tarea | Responsable | Revisor | DoD |
|---|---|---|---|---|
| **F4.1** | Agrupar filas por sede con fila-separador colapsable. | Dev Frontend | Revisor | Con 30 empleados en 3 sedes, la grilla queda escaneable. |
| **F4.2** | Copiar/pegar migra a `templateId + kind`. Al pegar, resolver plantilla contra fecha destino. | Dev Frontend | Revisor | Copiar un Doblado del lunes a un domingo en Unicentro **no** pega 11-22 sino 10-22. |

### Fase 5 · Tests contra el pptx

| ID | Tarea | Responsable | Revisor | DoD |
|---|---|---|---|---|
| **F5** | Test suite que valida los 18 desgloses de la sección 4.2. | Revisor (dueño) + Dev Frontend (implementa) | PO | 100% verde. |

### Puertas de calidad entre fases

- **F0 → F1**: ✅ Verificado. `npm test` verde, sede "Avenida" visible.
- **F1 → F2**: Tipos compilan, `seededBranches` incluye 6 dayScopes, motor soporta dos tramos.
- **F2 → F3**: Un operador nuevo puede llenar una quincena en < 3 minutos sin abrir "Personalizar".
- **F3 → F4**: PO aprueba la paleta por escrito.
- **F4 → F5**: Todos los flujos funcionan con la UI nueva.
- **F5 → cerrar MVP**: 18/18 casos verdes contra el pptx.

---

## 7 · Stack tecnológico

### Frontend

| Capa | Tecnología | Versión | Por qué |
|---|---|---|---|
| Framework | React | 19.2 | Ya en la base del template. |
| Lenguaje | TypeScript | 5.9 | Tipos estrictos, catch temprano de bugs. |
| Build | Vite | 7.3 | Dev server con HMR y build de producción liviano. |
| Estado | `useState` + `useMemo` | — | El MVP no justifica Zustand ni Redux. |
| Persistencia | `localStorage` via `src/lib/storage.ts` | — | Sin backend. |
| Íconos | lucide-react | 0.574 | Íconos SVG livianos. |
| Utilidades CSS | clsx + tailwind-merge | 2.1 / 3.4 | Composición segura de clases. |
| Exportación | exceljs + file-saver | 4.4 / 2.0 | XLSX con hojas Detalle / Resumen / Horas Extras. |

### Testing

| Capa | Tecnología | Rol |
|---|---|---|
| Runner | Vitest | Ejecuta tests unitarios. |
| Assertions | `@testing-library/jest-dom` | Para tests futuros de UI. |
| DOM | jsdom | Ambiente DOM para tests. |

### Motor de cálculo

100% funcional puro, aislado en `src/lib/calculation.ts`. Cuatro pasos:

1. **`splitShiftIntoSegments`** — parte el turno en tramos por cruces de medianoche y franja nocturna.
2. **`classifySegments`** — clasifica cada tramo en diurno / nocturno / dominical / etc.
3. **`applyOrdinaryVsExtra`** — asigna las primeras N horas del día a `ORD` y el resto a extras.
4. **`aggregateDailyAndPeriod`** — suma por empleado y período; devuelve estructura lista para render y export.

---

## 8 · Modelo de datos

Todo vive en `src/types/payroll.ts` y se persiste como JSON en `localStorage`. Las keys son:

| Key | Contenido |
|---|---|
| `qbano-branches` | Array de `Branch` (con `shiftTemplates` embebidos a partir de Fase 1). |
| `qbano-employees` | Array de `Employee` (con `role?` para Avenida a partir de Fase 2.3). |
| `qbano-periods` | Array de `PayPeriod` (quincenas). |
| `qbano-shifts` | Array de `Shift` (turnos por empleado × día × período, con `templateId?` a partir de Fase 1). |
| `qbano-settings` | `PayrollSettings` (nocturnalStart, multipliers, etc.). |
| `qbano-adjustments` | Diccionario `periodId → employeeId → number` para "ajuste al 100%". |

---

## 9 · Estructura del repositorio

```text
sandwichqbano/
├── README.md                   ← este documento
├── INVERSIONES CAICEDO BASTIDAS SAS COMPONENTES DE NOMINA.pptx
│                               ← fuente única de reglas de negocio
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
└── src/
    ├── App.tsx                 ← toda la UI en un componente (MVP)
    ├── main.tsx                ← entry point React
    ├── styles.css              ← paleta por sede + turno, layout
    ├── vite-env.d.ts
    │
    ├── types/
    │   └── payroll.ts          ← Company, Branch, Employee, Shift, PayrollSettings
    │
    ├── data/
    │   └── seed.ts             ← seed con 3 sedes reales + defaultSettings
    │
    ├── lib/
    │   ├── calculation.ts      ← motor puro
    │   ├── exportExcel.ts      ← generación de .xlsx
    │   └── storage.ts          ← loadState / saveState + helpers de formato
    │
    └── tests/
        └── calculation.test.ts ← tests del motor
```

---

## 10 · Quickstart

### Prerrequisitos

| Software | Versión | Cómo obtenerlo |
|---|---|---|
| Node.js | 20.x+ | `brew install node@20` |
| npm | 10.x+ | incluido con Node |

### Correr en desarrollo

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`.

### Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con HMR. |
| `npm run build` | Build de producción (`dist/`). |
| `npm run start` | Preview del build. |
| `npm test` | Corre la suite de tests con Vitest. |
| `npm run test:watch` | Tests en modo watch. |

### Flujo funcional del MVP

1. **Dashboard**: seleccionar o crear la quincena, filtrar por sede.
2. **Empleados**: alta/edición, asignar sede y (si es Avenida) rol Sala/Domicilio.
3. **Horarios**: por cada empleado × día del período, un click sobre el chip de turno.
4. **Cálculo**: botón "Calcular" → detalle diario + resumen + liquidación.
5. **Exportar**: descarga `.xlsx` con las 3 hojas.

> **Tip para reset entre pruebas.** El estado vive en `localStorage`. Para volver al seed limpio, abrir DevTools → Application → Local Storage → borrar todas las keys `qbano-*` y recargar.

---

## 11 · Convenciones y decisiones

### Convenciones de commits

Formato: `<tipo>(fase-id): descripción breve`

- `feat(F2.2): añadir chips de turno en celda de horario`
- `fix(F0.2): corregir nocturnalStart a 19:00`
- `test(F5): validar Único VIE-SÁB Doblado = 7 ORD + 1 HED + 2,5 HEN`

Tipos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. **La categoría refleja el cambio predominante** — un commit que toca código productivo Y config de tests debe partirse, o etiquetarse por lo dominante.

### Convención de nombres

- **Sedes**: siempre en el nombre real del pptx (`Avenida`, `Unicentro`, `Único`). Sin traducir, sin acortar.
- **Conceptos**: siempre en el código del pptx (`RN`, `HED`, `HEN`, `DOM_DIURNO`, `DOM_NOCT`, `RN_DOM`, `HED_DOM`, `HEN_DOM`).
- **Tipos de turno**: `partido`, `normal`, `doblado`, `descanso`. Minúsculas kebab en código; título en UI.
- **Roles de empleado**: `sala`, `domicilio`. Solo aplica a Avenida hoy.

### Decisiones cerradas

- **Commits directos a main durante MVP pre-producción.** Sin ramas, sin PRs. Ver sección 3.
- **Jornada ordinaria = 7h/día** (`dailyOrdinaryHours = 7`). Firmado por PO 2026-07-02. El pptx refleja el pacto interno de la empresa, no la jornada legal estándar de 8h. Aplicado en `defaultSettings` y en `applyOrdinaryVsExtra`.
- **Fase 1 aceptada parcial (Opción B) 2026-07-02.** No se hizo revert de los commits `1a6a61a` + `645fb78` + `3d80827` + `a500c70`. Los faltantes de F1.1 y F1.2 se completan en Fase 1.4 correctiva. El motor F1.3 queda con deuda técnica registrada — heurístico "medio y medio" funciona en los 6 casos del pptx pero debe migrar a `secondStart`/`secondEnd` explícitos cuando aparezca la primera excepción.
- **`localStorage` como único backend del MVP.** Migrar a Supabase queda como V2.
- **Un solo componente `App.tsx` para el MVP.** Rompemos en subcomponentes cuando pase 1000 líneas o el Revisor lo pida.
- **CSS custom properties, no Tailwind.**
- **Tests contra el pptx = contrato**. Si el pptx cambia, el revisor actualiza los tests primero (fallan), después el Dev ajusta hasta que pasen.

### Decisiones abiertas (esperan PO)

- Paleta exacta de colores por sede y turno (borrador propuesto en F3.1).
- Si el operador puede editar directamente el catálogo de `shiftTemplates` desde la UI.
- Si el `.xlsx` de exportación necesita una hoja extra con desglose por sede.

---

## 12 · Roadmap post-MVP

- **V2.1 · Regla de 3+ domingos → compensatorio.** Lógica de mes calendario, cruza quincenas.
- **V2.2 · Multiusuario con Supabase.** Auth por PIN, RLS por empresa, sync realtime.
- **V2.3 · Vista mensual además de quincenal.**
- **V2.4 · Editor visual de plantillas.**
- **V2.5 · Parafiscales y seguridad social.** Salud, pensión, ARL, caja, ICBF, SENA.
- **V2.6 · Integración con reloj biométrico.**
- **Migración a ramas + PRs.** Cuando se cumpla cualquiera de las condiciones descritas en la sección 3.

---

> **Autoría.** PO: Javier Portilla (Sándwich Qbano · Cali · Colombia). Roles Dev y Reviewer se cumplen con agentes IA especializados según el handoff descrito en la sección 3.
