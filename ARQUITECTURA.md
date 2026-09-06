# AgroNotificaciones — Arquitectura de migración a Supabase + Next.js

Análisis de la base actual (AppSheet / Google Sheets), esquema relacional propuesto, seguridad (RBAC + RLS), arquitectura de UI/UX mobile-first y lógica de negocio para las funcionalidades nuevas.

Archivos que acompañan este documento:

- `sql/01_schema.sql` — DDL completo (catálogos, transaccional, tarifas, auditoría).
- `sql/02_rls_policies.sql` — Row Level Security por rol.
- `sql/03_rpc_business_logic.sql` — funciones RPC (duplicar, cerrar ticket, dashboard, costeo).

---

## 1. Análisis de la base actual

Revisé `DBNOTIFICACIONMAQUINARIA.xlsx` (21 hojas) y el archivo de liquidación `16.01 - NOTIFICACIONES SAP AGOSTO 2026.xlsb`. Hallazgos clave que definieron el diseño:

**Lo que ya funciona bien y se conserva conceptualmente:**
- El flujo de 3 etapas (`TICKET` → `HOROMETROS` → `REGISTROS` + `DETALLE REGISTRO`) es sólido y coincide exactamente con lo que describes. Se mantiene, sólo se normaliza.
- Ya existe una hoja `LOG_HOROMETROS` — es decir, el negocio *ya* necesitaba auditoría de cambios en horómetros (ediciones de Torre de Control). Se generaliza a una tabla `log_auditoria`.
- `LABORESTAREAS` y `LABORESIMPLEMENTOS` ya modelan las relaciones muchos-a-muchos que pediste explícitamente — se conservan como tablas puente.
- La hoja `Categorias` (con columna `Ciclos`) ya insinúa un concepto de mantenimiento preventivo por horas — lo formalicé como `categorias_equipo.ciclo_horas`, útil para una futura alerta de mantenimiento.

**Problemas estructurales que la migración corrige:**
1. **IDs como texto hexadecimal corto** (`c93bd6c3`) generados por AppSheet — se reemplazan por `uuid` nativo de Postgres con `gen_random_uuid()`, con integridad referencial real (FKs), cosa que Google Sheets no puede garantizar.
2. **`UBICACIONES TECNICAS` duplica el lote entero cada temporada** (mismo lote `1001-010` reaparece con ID distinto en cada `IDTEMPORADA`). Esto rompe el histórico de "cuánta área tiene este lote a través del tiempo" y complica reportes multi-temporada. Se separa en `lotes` (el lote físico, permanente) + `lotes_temporada` (área/zona/estado vigente en cada ciclo). Esto es una mejora de diseño, no sólo una migración 1:1.
3. **`HOROMETROS.HORAS` y `HORAS HOMBRE` se guardaban como texto libre** (`'8'` como string) — se tipan como `numeric`, y `horas_maquina` pasa a ser una columna **calculada** (`generated always as`) para que nunca se desincronice del horómetro inicial/final.
4. **No hay catálogo de "Categoría de Labor"** — lo pediste como nuevo y se agrega (`categorias_labor`), enlazado 1:N a `labores`.
5. **No hay control de permisos granular ni RLS** — hoy la seguridad probablemente vive en la lógica de la app AppSheet (`USUARIOS.ROL`). Se traslada a la base de datos vía Supabase RLS, que es la única forma de garantizar "el digitador SOLO ve sus propios registros" de forma infalible (ni un bug de frontend puede filtrarlo).
6. **No existe módulo financiero** — se agrega `tarifas_equipo` y `tarifas_labor`, versionadas por vigencia para no distorsionar costos históricos cuando cambie una tarifa.
7. **El archivo de liquidación SAP** (`16.01 - NOTIFICACIONES SAP...xlsb`) revela que la fórmula real de liquidación (`Orden` + `Puesto de Trabajo` según el tipo de equipo — "Admin"/"Api"/"Comb"— y tarifas por temporada por puesto de trabajo) es más compleja que lo cubierto en este primer diseño. Recomiendo una **Fase 2** de descubrimiento específica para modelar `sap_formulas_liquidacion` (mapeo equipo→puesto de trabajo→orden) antes de conectar la exportación automática a SAP. No lo inventé en este esquema para no adivinar reglas de negocio que no me confirmaste.

---

## 2. Esquema relacional (resumen)

```
roles ──< perfiles (extiende auth.users) >── permisos

temporadas ──< lotes_temporada >── lotes
zonas ──< lotes_temporada

familias_equipo ──< equipos >── categorias_equipo
implementos
operadores
categorias_labor ──< labores >──< labores_tareas >── tareas_sap
                              └──< labores_implementos >── implementos

tarifas_equipo (equipo_id, vigente_desde/hasta)
tarifas_labor  (labor_id,  vigente_desde/hasta)

tickets (usuario_id, estado ABIERTO/CERRADO)
  └──< horometros (equipo_id, operador_id, horas_maquina calculada)
         └──< registros (labor_id, tarea_id, implemento_id)
                └──< registro_detalle (lote_temporada_id, avance_mz)

log_auditoria (tabla, registro_id, campo, valor_anterior/nuevo)
```

El detalle completo con tipos, constraints e índices está en `sql/01_schema.sql`. Decisiones de tipado relevantes:

- `estado_ticket` y `turno_tipo` son **enums nativos de Postgres**, no catálogos con FK (son listas cerradas que casi nunca cambian, y un enum es más rápido de indexar y validar en el formulario).
- `horas_maquina` es columna generada — imposible que quede inconsistente con el horómetro.
- `avance_mz` es `numeric` nullable — confirmas que el avance en manzanas es opcional.
- Todas las tablas transaccionales llevan `usuario_id` (autor) porque es la columna que sostiene el RLS del Digitador.

---

## 3. RBAC + Row Level Security

### 3.1 Modelo de permisos

En vez de codificar "si rol = X entonces puede Y" directamente en cada policy (lo cual obliga a tocar SQL cada vez que cambian los permisos), se separa en dos capas:

1. **`permisos`**: tabla `(rol_id, recurso, accion)` — esta es la que alimenta tu panel administrativo. Un Administrador puede, desde una pantalla CRUD normal en Next.js, dar de alta/baja permisos sin que nadie toque el backend.
2. **RLS policies**: llaman a `fn_tiene_permiso(recurso, accion)` en vez de hardcodear el rol. Así el SQL de seguridad es estable; lo que cambia es la tabla `permisos`.

La regla de "el Digitador sólo ve lo suyo" **no** vive en la tabla `permisos` (eso controla la acción, no el alcance de filas) — vive directamente en la policy, comparando `usuario_id = auth.uid()`. Esto es intencional: permiso de acción y alcance de fila son dos dimensiones distintas y mezclar clarlas en una sola tabla genérica termina siendo más confuso que explícito en SQL.

### 3.2 Regla de bloqueo por cierre de ticket

```sql
-- extracto de horometros_update (ver sql/02_rls_policies.sql completo)
using (
    fn_es_admin()
    or fn_mi_rol() = 'TORRE_CONTROL'
    or exists (
        select 1 from tickets t
        where t.id = ticket_id and t.usuario_id = auth.uid() and t.estado = 'ABIERTO'
    )
)
```

En cuanto el ticket pasa a `CERRADO`, esta condición deja de cumplirse para el digitador — la UI puede seguir mostrando el botón "Editar" por error de estado local, pero el `UPDATE` será rechazado por Postgres. Torre de Control y Admin siguen pudiendo editar después del cierre (para corregir antes de notificar a SAP), tal como pediste.

### 3.3 Nadie hace DELETE salvo Administrador en catálogos

Ninguna policy `for delete` existe para Torre de Control ni Digitador en ninguna tabla transaccional. Para catálogos, Torre de Control tiene `insert`/`update` pero no `delete`. Esto es literal a tu especificación y no requiere lógica adicional en el frontend: simplemente no se renderiza el botón de borrar para esos roles, y aunque alguien fuerce la llamada a la API, Postgres la rechaza.

---

## 4. Arquitectura Next.js / TailwindCSS (mobile-first)

### 4.1 Principios de UI para el flujo Ticket → Horómetro → Labor en celular

El reto de UX real aquí no es visual, es **de navegación de estado**: un operador de campo abre un Ticket, y dentro de esa sesión necesita entrar y salir varias veces del formulario de Horómetro y del de Labor sin perder contexto, muchas veces con conectividad intermitente. Recomendaciones concretas:

1. **Un layout de "wizard acumulativo", no un formulario de una sola pantalla.** El Ticket es un contenedor persistente; Horómetros y Registros son listas que crecen dentro de él. La navegación correcta es: `Ticket (detalle) → [+ Agregar Horómetro] → [+ Agregar Labor dentro de ese horómetro]`, todo con botón "atrás" que regresa al Ticket sin perder lo ya guardado.
2. **Guardar por sección, no al final.** Cada Horómetro y cada Registro se insertan en Supabase apenas el usuario los completa (no se acumulan en estado de React hasta un submit final) — así una pérdida de señal a mitad de jornada no bota todo el trabajo del día.
3. **Bottom sheet / drawer para formularios secundarios**, no rutas nuevas de página completa, para que el usuario nunca pierda el contexto visual del Ticket mientras registra una labor.
4. **Inputs numéricos con teclado nativo** (`inputMode="decimal"`) para horómetro y manzanas — en campo, con guantes o sol directo, el teclado completo de texto es fricción innecesaria.
5. **Botón "Duplicar" siempre visible en cada fila** de Horómetro/Registro ya guardada (ver diseño abajo) — es la funcionalidad de mayor ahorro de tiempo que pediste.

### 4.2 Estructura de carpetas sugerida (App Router)

```
app/
  (auth)/login/page.tsx
  (app)/
    layout.tsx                 # navbar inferior fija (mobile), guard de sesión
    tickets/
      page.tsx                 # lista de tickets del usuario (o todos si Torre/Admin)
      [ticketId]/
        page.tsx                # detalle: lista de horómetros + botón cerrar ticket
        horometros/
          nuevo/page.tsx
          [horometroId]/
            page.tsx             # detalle horómetro + lista de registros/labores
            registros/nuevo/page.tsx
    dashboard/
      page.tsx                  # avance por categoría de labor / lote
    admin/
      permisos/page.tsx         # panel RBAC
      catalogos/[tabla]/page.tsx
lib/
  supabase/client.ts
  supabase/server.ts
  types/database.types.ts       # generado con `supabase gen types typescript`
components/
  ticket/TicketCard.tsx
  horometro/HorometroForm.tsx
  horometro/HorometroRow.tsx    # incluye botón "Duplicar"
  registro/RegistroForm.tsx
  ui/BottomSheet.tsx
```

### 4.3 Cliente Supabase (Next.js App Router, `@supabase/ssr`)

```ts
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/types/database.types'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

```ts
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/types/database.types'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => list.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)),
      },
    }
  )
}
```

### 4.4 Formulario de Horómetro — mobile-first, con validación y `inputMode`

```tsx
// components/horometro/HorometroForm.tsx
'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Props = {
  ticketId: string
  equipos: { id: string; codigo: string; nombre: string }[]
  operadores: { id: string; nombre: string }[]
  onCreated: (horometroId: string) => void
}

export function HorometroForm({ ticketId, equipos, operadores, onCreated }: Props) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    fecha: new Date().toISOString().slice(0, 10),
    turno: 'DIURNO' as 'DIURNO' | 'NOCTURNO',
    equipo_id: '',
    horometro_inicial: '',
    horometro_final: '',
    horas_hombre: '',
    operador_id: '',
    comentario: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const inicial = Number(form.horometro_inicial)
    const final = Number(form.horometro_final)
    if (final < inicial) {
      setError('El horómetro final no puede ser menor al inicial.')
      return
    }

    setSaving(true)
    const { data, error: dbError } = await supabase
      .from('horometros')
      .insert({
        ticket_id: ticketId,
        fecha: form.fecha,
        turno: form.turno,
        equipo_id: form.equipo_id,
        horometro_inicial: inicial,
        horometro_final: final,
        horas_hombre: form.horas_hombre ? Number(form.horas_hombre) : null,
        operador_id: form.operador_id || null,
        comentario: form.comentario || null,
      })
      .select('id')
      .single()

    setSaving(false)
    if (dbError) { setError(dbError.message); return }
    onCreated(data.id)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Fecha
          <input
            type="date"
            value={form.fecha}
            onChange={(e) => setForm({ ...form, fecha: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-3 text-base"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Turno
          <select
            value={form.turno}
            onChange={(e) => setForm({ ...form, turno: e.target.value as 'DIURNO' | 'NOCTURNO' })}
            className="rounded-lg border border-slate-300 px-3 py-3 text-base"
          >
            <option value="DIURNO">Diurno</option>
            <option value="NOCTURNO">Nocturno</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Equipo
        <select
          value={form.equipo_id}
          onChange={(e) => setForm({ ...form, equipo_id: e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base"
          required
        >
          <option value="">Selecciona un equipo…</option>
          {equipos.map((eq) => (
            <option key={eq.id} value={eq.id}>{eq.codigo} — {eq.nombre}</option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Horómetro inicial
          <input
            type="text" inputMode="decimal"
            value={form.horometro_inicial}
            onChange={(e) => setForm({ ...form, horometro_inicial: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-3 text-base"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Horómetro final
          <input
            type="text" inputMode="decimal"
            value={form.horometro_final}
            onChange={(e) => setForm({ ...form, horometro_final: e.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-3 text-base"
            required
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Horas hombre (si difiere de las horas máquina)
        <input
          type="text" inputMode="decimal"
          value={form.horas_hombre}
          onChange={(e) => setForm({ ...form, horas_hombre: e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base"
          placeholder="Ej. 8"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Operador
        <select
          value={form.operador_id}
          onChange={(e) => setForm({ ...form, operador_id: e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base"
        >
          <option value="">Selecciona un operador…</option>
          {operadores.map((op) => (
            <option key={op.id} value={op.id}>{op.nombre}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Comentarios (fallas, novedades)
        <textarea
          value={form.comentario}
          onChange={(e) => setForm({ ...form, comentario: e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-3 text-base"
          rows={3}
        />
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="sticky bottom-4 rounded-xl bg-emerald-700 px-4 py-4 text-base font-semibold text-white shadow-lg active:scale-[0.98] disabled:opacity-50"
      >
        {saving ? 'Guardando…' : 'Guardar horómetro'}
      </button>
    </form>
  )
}
```

Notas de diseño en este componente:
- `inputMode="decimal"` en vez de `type="number"`: evita las flechitas de incremento nativas (torpes en celular) y controla mejor el formato.
- El botón de guardar es `sticky bottom-4`: en pantallas largas de formulario, el usuario nunca tiene que hacer scroll para confirmar.
- Validación de negocio (`final >= inicial`) se hace también client-side para feedback inmediato, aunque el constraint `horometro_final_mayor` en la base es la garantía real.

### 4.5 Fila de registro con botón "Duplicar" (la funcionalidad de mayor ahorro de tiempo)

```tsx
// components/horometro/HorometroRow.tsx
'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Props = {
  horometro: {
    id: string
    equipo_codigo: string
    operador_nombre: string | null
    horas_maquina: number
  }
}

export function HorometroRow({ horometro }: Props) {
  const supabase = createClient()
  const router = useRouter()
  const [duplicating, setDuplicating] = useState(false)

  async function handleDuplicate() {
    setDuplicating(true)
    const { data, error } = await supabase.rpc('duplicar_horometro', {
      p_horometro_id: horometro.id,
    })
    setDuplicating(false)
    if (error) { alert(error.message); return }
    // Llevamos al usuario directo a editar el equipo/operador/lecturas del clon
    router.push(`/tickets/actual/horometros/${data}?editar=equipo`)
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <p className="font-semibold text-slate-900">{horometro.equipo_codigo}</p>
        <p className="text-sm text-slate-500">
          {horometro.operador_nombre ?? 'Sin operador'} · {horometro.horas_maquina} hrs máquina
        </p>
      </div>
      <button
        onClick={handleDuplicate}
        disabled={duplicating}
        className="flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 active:bg-slate-200"
        aria-label="Duplicar horómetro"
      >
        {duplicating ? '…' : '⧉ Duplicar'}
      </button>
    </div>
  )
}
```

El flujo real: al tocar "Duplicar", se llama al RPC `duplicar_horometro` (ver `sql/03_rpc_business_logic.sql`), que clona el registro con las lecturas en 0 y navega directo al formulario de edición con foco en "Equipo" — así el usuario sólo cambia el tractor/operador y las dos lecturas, sin re-teclear turno, fecha, ni las labores asociadas si también se duplican con `duplicar_registro`.

### 4.6 Navegación inferior fija (mobile-first, un solo pulgar)

```tsx
// app/(app)/layout.tsx (extracto)
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <main className="flex-1 overflow-y-auto pb-20">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t border-slate-200 bg-white py-2 pb-[env(safe-area-inset-bottom)]">
        <NavItem href="/tickets" icon="🎫" label="Tickets" />
        <NavItem href="/dashboard" icon="📊" label="Avance" />
        <NavItem href="/perfil" icon="👤" label="Perfil" />
      </nav>
    </div>
  )
}
```

`pb-[env(safe-area-inset-bottom)]` es importante en celulares con gesto de inicio (iPhone sin botón) para que la barra no quede pegada al borde real de la pantalla.

---

## 5. Lógica de negocio: Duplicación y Dashboard de avance

### 5.1 Duplicar (resumen funcional)

Dos RPC independientes porque son dos granularidades distintas de "lo mismo trabajando en paralelo":

- **`duplicar_horometro(p_horometro_id, p_equipo_id?, p_operador_id?)`** — cuando **otro tractor** hace la misma jornada (mismo ticket, fecha y turno), pero es un equipo físico distinto con su propio horómetro. Resetea las lecturas a `0` a propósito, para forzar al usuario a capturarlas reales (nunca copiar horómetros de otro equipo).
- **`duplicar_registro(p_registro_id, p_horometro_id?, p_copiar_detalle=true)`** — cuando **la misma labor** se repite (mismo lote, misma tarea SAP, mismo implemento), típicamente enlazada al horómetro recién duplicado. Aquí sí tiene sentido copiar `avance_mz` como punto de partida editable, porque a menudo el avance por lote se reparte proporcionalmente entre los equipos que atacaron el mismo lote ese día.

Flujo combinado típico en la UI: el usuario duplica el horómetro → edita equipo/operador/lecturas → el sistema le ofrece automáticamente "¿Duplicar también las labores de este horómetro?" → si acepta, se llama a `duplicar_registro` por cada registro del horómetro origen, apuntando al nuevo `horometro_id`.

### 5.2 Dashboard de avance por Categoría de Labor y Lote

La pregunta de negocio es: *"de la categoría 'Preparación de Tierra', ¿cuántas mz llevamos en el lote 1001-010, cuántas faltan, y qué labores de esa categoría ya se completaron ahí?"*

Se resuelve en tres capas (ver `sql/03_rpc_business_logic.sql` §4):

1. **`v_avance_lote_labor`** (vista base): cruza cada lote-temporada con cada labor de la categoría, sumando `avance_mz` real registrado. Una labor sin ningún registro aparece con `mz_trabajadas = 0` (gracias al `left join` + `coalesce`), así el dashboard muestra explícitamente "0 de 12 mz" en vez de simplemente omitir la labor pendiente.
2. **`fn_avance_por_categoria(categoria, temporada, lote?)`**: expone `mz_pendientes` (`area_neta - mz_trabajadas`, nunca negativo) y `labor_completada` (booleano: `mz_trabajadas >= area_neta`). Esta es la función que alimenta la tabla detallada "labor por labor" del dashboard.
3. **`fn_resumen_avance_categoria_por_lote(categoria, temporada)`**: agrega lo anterior a nivel de tarjeta por lote — `% avance` como labores completas / labores totales de la categoría. Esta es la que alimenta las tarjetas resumen tipo KPI.

```tsx
// app/(app)/dashboard/page.tsx (extracto de consumo)
const { data: resumen } = await supabase.rpc('fn_resumen_avance_categoria_por_lote', {
  p_categoria_labor_id: categoriaSeleccionada,
  p_temporada_id: temporadaActivaId,
})
// resumen: [{ lote_id, nomenclatura, area_neta, labores_totales, labores_completas, pct_avance }]

const { data: detalle } = await supabase.rpc('fn_avance_por_categoria', {
  p_categoria_labor_id: categoriaSeleccionada,
  p_temporada_id: temporadaActivaId,
  p_lote_id: loteExpandido, // null hasta que el usuario toca una tarjeta para expandirla
})
// detalle: [{ labor_nombre, mz_trabajadas, mz_pendientes, labor_completada }]
```

Patrón de UI recomendado: tarjetas colapsadas por lote (con `pct_avance` como barra de progreso) que, al tocarlas, expanden la tabla `detalle` filtrada por ese lote — evita cargar todas las combinaciones lote×labor de una vez en un celular con blackspot de señal en el campo.

---

## 6. Próximos pasos sugeridos

1. Validar conmigo el mapeo exacto `equipo → puesto de trabajo → orden SAP` (visto en el archivo `.xlsb`) antes de construir el export automático a SAP — esa lógica de "fórmula" (Admin/Api/Comb) no está en este primer esquema porque no quise inventarla sin confirmarla contigo.
2. Definir qué catálogos exactos puede crear el Digitador ("catálogos limitados" — en el seed de permisos dejé `operadores` e `implementos` como ejemplo, ajustable en la tabla `permisos` sin tocar código).
3. Migración de datos: script de carga desde las 21 hojas actuales hacia el esquema nuevo (puedo prepararlo una vez aprobado el esquema, mapeando los IDs hex actuales a los nuevos UUID y preservando trazabilidad histórica).
4. Confirmar reglas exactas de "labor completada" en el dashboard (aquí asumí `mz_trabajadas >= area_neta`; si alguna labor no se mide en mz sino en horas, esa lógica necesita una variante).
