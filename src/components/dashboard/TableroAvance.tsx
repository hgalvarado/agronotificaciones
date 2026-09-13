'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Tarjeta } from '@/components/ui/Primitivos'
import { IconChevronRight, IconSearch, IconX } from '@/components/ui/Icons'
import { mensajeDeError } from '@/lib/errores'

/* ------------------------------------------------------------------ */
/* Tipos                                                              */
/* ------------------------------------------------------------------ */

export type OpcionSimple = { id: string; nombre: string }
export type OpcionProceso = { id: string; codigo: string; nombre: string }
export type OpcionTemporada = { id: string; nombre: string; activa: boolean }
export type OpcionLabor = { id: string; nombre: string; categoria_labor_id: string | null }
export type OpcionLote = {
  id: string
  temporada_id: string
  zona_id: string | null
  etiqueta: string
}

type FilaLabor = {
  labor_id: string
  labor_nombre: string
  categoria_id: string | null
  categoria_labor: string | null
  proceso_id: string | null
  proceso_codigo: string | null
  area_plan: number
  mz_avance: number
  mz_pendiente: number
  pct_avance: number | null
  lotes_con_plan: number
  lotes_tocados: number
  lineas: number
  primera_fecha: string | null
  ultima_fecha: string | null
}

type FilaZona = {
  zona_id: string | null
  zona: string | null
  encargado: string | null
  area_plan: number
  mz_avance: number
  mz_pendiente: number
  pct_avance: number | null
  lotes_tocados: number
  ultima_fecha: string | null
}

type Filtros = {
  temporada: string
  proceso: string
  zona: string
  lote: string
  categoria: string
  labor: string
  desde: string
  hasta: string
}

const num = new Intl.NumberFormat('es-HN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function fechaCorta(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-HN', {
    day: '2-digit',
    month: 'short',
  })
}

function color(pct: number) {
  if (pct >= 99) return 'bg-emerald-500'
  if (pct >= 50) return 'bg-brand-600'
  return 'bg-amber-500'
}

/** Permiso de pantalla que corresponde a cada proceso. */
const RUTA: Record<string, string> = { APS: 'plan_aps' }

/* ------------------------------------------------------------------ */

export function TableroAvance({
  temporadas,
  procesos,
  zonas,
  lotes,
  labores,
  categorias,
  permisosPlan,
}: {
  temporadas: OpcionTemporada[]
  procesos: OpcionProceso[]
  zonas: OpcionSimple[]
  lotes: OpcionLote[]
  labores: OpcionLabor[]
  categorias: OpcionSimple[]
  /** Códigos de pantalla de plan que este usuario puede ver. */
  permisosPlan: string[]
}) {
  const supabase = createClient()

  const temporadaInicial = temporadas.find((t) => t.activa)?.id ?? temporadas[0]?.id ?? ''

  const [filtros, setFiltros] = useState<Filtros>({
    temporada: temporadaInicial,
    proceso: '',
    zona: '',
    lote: '',
    categoria: '',
    labor: '',
    desde: '',
    hasta: '',
  })

  const [porLabor, setPorLabor] = useState<FilaLabor[]>([])
  const [porZona, setPorZona] = useState<FilaZona[]>([])
  // Arranca en «cargando» sólo si de verdad hay algo que pedir. Ponerlo
  // en true y apagarlo dentro del efecto haría un `setState` sincrónico
  // en el cuerpo del efecto, que React 19 marca como error.
  const [cargando, setCargando] = useState(Boolean(temporadaInicial))
  const [error, setError] = useState<string | null>(null)
  const [abrirFiltros, setAbrirFiltros] = useState(false)

  /* ----------------------------- Consulta ---------------------------- */

  useEffect(() => {
    if (!filtros.temporada) return
    let vivo = true

    // La función asíncrona se declara DENTRO del efecto: React 19 marca
    // como error llamar a `setState` desde una función definida fuera y
    // referenciada aquí (`react-hooks/set-state-in-effect`).
    async function traer() {
      setCargando(true)
      setError(null)

      const parametros = {
        p_temporada_id: filtros.temporada,
        p_proceso_id: filtros.proceso || null,
        p_zona_id: filtros.zona || null,
        p_lote_temporada_id: filtros.lote || null,
        p_labor_id: filtros.labor || null,
        p_categoria_labor_id: filtros.categoria || null,
        p_desde: filtros.desde || null,
        p_hasta: filtros.hasta || null,
      }

      const [avance, zona] = await Promise.all([
        supabase.rpc('fn_tablero_avance', parametros),
        supabase.rpc('fn_tablero_por_zona', parametros),
      ])

      if (!vivo) return

      if (avance.error || zona.error) {
        setPorLabor([])
        setPorZona([])
        setError(
          mensajeDeError(
            avance.error ?? zona.error,
            'No se pudo leer el avance. Si dice que la función no existe, falta correr la migración 15 en el SQL Editor de Supabase.',
          ),
        )
      } else {
        setPorLabor((avance.data as FilaLabor[] | null) ?? [])
        setPorZona((zona.data as FilaZona[] | null) ?? [])
      }
      setCargando(false)
    }

    traer()
    return () => {
      vivo = false
    }
    // `supabase` es estable entre renders (el cliente del navegador es
    // uno solo), así que no entra en las dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filtros.temporada,
    filtros.proceso,
    filtros.zona,
    filtros.lote,
    filtros.labor,
    filtros.categoria,
    filtros.desde,
    filtros.hasta,
  ])

  /* ------------------------- Listas dependientes --------------------- */

  // Los lotes se recortan a la temporada y a la zona elegidas: una lista
  // de 400 lotes de todas las temporadas no sirve de filtro.
  const lotesVisibles = useMemo(
    () =>
      lotes.filter(
        (l) =>
          l.temporada_id === filtros.temporada && (!filtros.zona || l.zona_id === filtros.zona),
      ),
    [lotes, filtros.temporada, filtros.zona],
  )

  // Y las labores, a la categoría elegida.
  const laboresVisibles = useMemo(
    () => labores.filter((l) => !filtros.categoria || l.categoria_labor_id === filtros.categoria),
    [labores, filtros.categoria],
  )

  function cambiar(cambios: Partial<Filtros>) {
    setFiltros((prev) => {
      const siguiente = { ...prev, ...cambios }
      // Coherencia: si cambia la zona o la temporada, el lote elegido
      // puede quedar fuera de la lista; si cambia la categoría, la labor.
      if (cambios.zona !== undefined || cambios.temporada !== undefined) siguiente.lote = ''
      if (cambios.categoria !== undefined) siguiente.labor = ''
      return siguiente
    })
  }

  const activos = [
    filtros.proceso && 'proceso',
    filtros.zona && 'zona',
    filtros.lote && 'lote',
    filtros.categoria && 'categoría',
    filtros.labor && 'labor',
    (filtros.desde || filtros.hasta) && 'fechas',
  ].filter(Boolean).length

  function limpiar() {
    setFiltros({
      temporada: filtros.temporada,
      proceso: '',
      zona: '',
      lote: '',
      categoria: '',
      labor: '',
      desde: '',
      hasta: '',
    })
  }

  /* ------------------------------ Totales ---------------------------- */

  // El plan es el MISMO para todas las labores del proceso, así que no se
  // suma: se toma el mayor de los que vinieron (hay uno por proceso).
  const plan = porLabor.reduce((m, l) => Math.max(m, Number(l.area_plan)), 0)
  // Si en la lista hay labores de varios procesos, ese «mayor» es el de
  // uno solo de ellos. Se dice, en vez de dejar creer que es el total.
  const variosProcesos = new Set(porLabor.map((l) => l.proceso_id ?? 'sin')).size > 1
  // Esta sí es una suma de pasadas distintas, y se rotula como tal para
  // que nadie la lea como «área terminada».
  const pasadas = porLabor.reduce((a, l) => a + Number(l.mz_avance), 0)
  const ultima = porLabor.reduce<string | null>(
    (m, l) => (l.ultima_fecha && (!m || l.ultima_fecha > m) ? l.ultima_fecha : m),
    null,
  )

  const procesoElegido = procesos.find((p) => p.id === filtros.proceso)
  const puedeVerPlan = procesoElegido
    ? permisosPlan.includes(RUTA[procesoElegido.codigo] ?? '')
    : false

  return (
    <div className="flex flex-col gap-4">
      {/* ----------------------------- Filtros ---------------------------- */}
      <Tarjeta className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <IconSearch className="h-4 w-4 shrink-0 text-slate-300" />
            <p className="truncate text-sm font-semibold text-slate-700">
              Filtros
              {activos > 0 && (
                <span className="ml-1.5 rounded-full bg-brand-700 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {activos}
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {activos > 0 && (
              <button
                onClick={limpiar}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100"
              >
                <IconX className="h-3.5 w-3.5" />
                Limpiar
              </button>
            )}
            {/* En celular los filtros arrancan cerrados: seis selectores
                abiertos empujarían el avance fuera de la pantalla. */}
            <button
              onClick={() => setAbrirFiltros((v) => !v)}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50 sm:hidden"
            >
              {abrirFiltros ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>

        <div
          className={`mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 ${
            abrirFiltros ? '' : 'hidden sm:grid'
          }`}
        >
          <Filtro etiqueta="Temporada">
            <select
              value={filtros.temporada}
              onChange={(e) => cambiar({ temporada: e.target.value })}
              className={CLASE_SELECT}
            >
              {temporadas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                  {t.activa ? ' (activa)' : ''}
                </option>
              ))}
            </select>
          </Filtro>

          <Filtro etiqueta="Proceso">
            <select
              value={filtros.proceso}
              onChange={(e) => cambiar({ proceso: e.target.value })}
              className={CLASE_SELECT}
            >
              <option value="">Todos</option>
              {procesos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} · {p.nombre}
                </option>
              ))}
            </select>
          </Filtro>

          <Filtro etiqueta="Zona">
            <select
              value={filtros.zona}
              onChange={(e) => cambiar({ zona: e.target.value })}
              className={CLASE_SELECT}
            >
              <option value="">Todas</option>
              {zonas.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.nombre}
                </option>
              ))}
            </select>
          </Filtro>

          <Filtro etiqueta={`Lote${lotesVisibles.length > 0 ? ` (${lotesVisibles.length})` : ''}`}>
            <select
              value={filtros.lote}
              onChange={(e) => cambiar({ lote: e.target.value })}
              className={CLASE_SELECT}
            >
              <option value="">Todos</option>
              {lotesVisibles.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.etiqueta}
                </option>
              ))}
            </select>
          </Filtro>

          <Filtro etiqueta="Categoría de labor">
            <select
              value={filtros.categoria}
              onChange={(e) => cambiar({ categoria: e.target.value })}
              className={CLASE_SELECT}
            >
              <option value="">Todas</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Filtro>

          <Filtro etiqueta="Labor">
            <select
              value={filtros.labor}
              onChange={(e) => cambiar({ labor: e.target.value })}
              className={CLASE_SELECT}
            >
              <option value="">Todas</option>
              {laboresVisibles.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nombre}
                </option>
              ))}
            </select>
          </Filtro>

          <Filtro etiqueta="Desde">
            <input
              type="date"
              value={filtros.desde}
              onChange={(e) => cambiar({ desde: e.target.value })}
              className={CLASE_SELECT}
            />
          </Filtro>

          <Filtro etiqueta="Hasta">
            <input
              type="date"
              value={filtros.hasta}
              onChange={(e) => cambiar({ hasta: e.target.value })}
              className={CLASE_SELECT}
            />
          </Filtro>
        </div>

        {(filtros.zona || filtros.lote) && (
          <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
            Al filtrar por zona o por lote, el área planificada se recorta igual, así que el
            porcentaje sigue siendo el de lo filtrado. Los filtros de labor, categoría y fecha
            recortan sólo lo ejecutado: un plan no tiene labor ni fecha.
          </p>
        )}
      </Tarjeta>

      {error && <Alerta>{error}</Alerta>}

      {/* ---------------------------- Resumen ----------------------------- */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Kpi
          etiqueta="Plan"
          valor={plan > 0 ? `${num.format(plan)} mz` : '—'}
          nota={variosProcesos ? 'del proceso con más área — filtra uno' : undefined}
        />
        <Kpi etiqueta="Labores con avance" valor={String(porLabor.length)} />
        <Kpi
          etiqueta="Manzanas recorridas"
          valor={`${num.format(pasadas)} mz`}
          nota="suma de todas las labores"
        />
        <Kpi etiqueta="Última captura" valor={fechaCorta(ultima)} />
      </div>

      {/* --------------------------- Por labor ---------------------------- */}
      <Tarjeta>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-900">Avance por labor</h2>
          {procesoElegido && puedeVerPlan && (
            <Link
              href={`/plan/${procesoElegido.codigo}?temporada=${filtros.temporada}`}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50"
            >
              Ver el plan
              <IconChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        {cargando ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Cargando…</p>
        ) : porLabor.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            {activos > 0
              ? 'Nada capturado con esos filtros. Prueba a quitar alguno.'
              : 'Todavía no hay labores capturadas en esta temporada. Si ya se capturaron, revisa que sus tareas SAP tengan proceso asignado en Catálogos → Tareas SAP.'}
          </p>
        ) : (
          <div className="divide-y divide-slate-50">
            {porLabor.map((l) => {
              const pct = l.pct_avance === null ? null : Number(l.pct_avance)
              return (
                <div key={`${l.labor_id}-${l.proceso_id ?? 'sin'}`} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-800">
                      {l.labor_nombre}
                      {l.proceso_codigo && !filtros.proceso && (
                        <span className="ml-1.5 text-[11px] font-medium text-slate-400">
                          {l.proceso_codigo}
                        </span>
                      )}
                    </p>
                    <p className="shrink-0 text-xs tabular-nums text-slate-500">
                      {num.format(Number(l.mz_avance))}
                      {Number(l.area_plan) > 0 ? ` / ${num.format(Number(l.area_plan))}` : ''} mz
                      {pct !== null && (
                        <strong className="ml-1.5 text-slate-900">{pct.toFixed(0)}%</strong>
                      )}
                    </p>
                  </div>

                  {pct !== null ? (
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${color(pct)}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] italic text-slate-400">
                      Sin plan contra el que medir
                      {l.proceso_codigo ? ` en ${l.proceso_codigo}` : ''}.
                    </p>
                  )}

                  <p className="mt-1 text-[11px] text-slate-400">
                    {l.categoria_labor ?? 'Sin categoría'} · {l.lotes_tocados} lote
                    {l.lotes_tocados === 1 ? '' : 's'}
                    {Number(l.lotes_con_plan) > 0 ? ` de ${l.lotes_con_plan} en el plan` : ''}
                    {Number(l.mz_pendiente) > 0
                      ? ` · faltan ${num.format(Number(l.mz_pendiente))} mz`
                      : ''}
                    {l.ultima_fecha ? ` · última ${fechaCorta(l.ultima_fecha)}` : ''}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </Tarjeta>

      {/* --------------------------- Por zona ----------------------------- */}
      {porZona.length > 0 && (
        <Tarjeta>
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-900">Avance por zona y encargado</h2>
            <p className="text-xs text-slate-400">
              Con los mismos filtros. Aquí sí se suman las labores, porque la pregunta es cuánto
              trabajo lleva cada zona.
            </p>
          </div>

          {/* Celular: una tarjeta por zona */}
          <div className="divide-y divide-slate-50 sm:hidden">
            {porZona.map((z) => {
              const pct = z.pct_avance === null ? null : Number(z.pct_avance)
              return (
                <div key={z.zona_id ?? 'sin'} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-800">
                      {z.zona ?? 'Sin zona'}
                    </p>
                    <p className="shrink-0 text-xs tabular-nums text-slate-500">
                      {num.format(Number(z.mz_avance))}
                      {Number(z.area_plan) > 0 ? ` / ${num.format(Number(z.area_plan))}` : ''} mz
                      {pct !== null && (
                        <strong className="ml-1.5 text-slate-900">{pct.toFixed(0)}%</strong>
                      )}
                    </p>
                  </div>
                  {pct !== null && (
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${color(pct)}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-slate-400">
                    {z.encargado ?? 'Sin encargado'} · {z.lotes_tocados} lote
                    {z.lotes_tocados === 1 ? '' : 's'} · última {fechaCorta(z.ultima_fecha)}
                  </p>
                </div>
              )
            })}
          </div>

          {/* Escritorio: la tabla */}
          <div className="hidden sm:block">
            <div className="scroll-suave overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5">Zona</th>
                    <th className="px-2 py-2.5">Encargado</th>
                    <th className="px-2 py-2.5 text-right">Plan</th>
                    <th className="px-2 py-2.5 text-right">Avance</th>
                    <th className="px-2 py-2.5 text-right">Falta</th>
                    <th className="px-4 py-2.5 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {porZona.map((z) => (
                    <tr key={z.zona_id ?? 'sin'} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-2 font-semibold text-slate-800">
                        {z.zona ?? 'Sin zona'}
                      </td>
                      <td className="px-2 py-2 text-slate-500">{z.encargado ?? '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                        {num.format(Number(z.area_plan))}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                        {num.format(Number(z.mz_avance))}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-amber-700">
                        {num.format(Number(z.mz_pendiente))}
                      </td>
                      <td className="px-4 py-2 text-right font-bold tabular-nums text-slate-900">
                        {z.pct_avance !== null ? `${Number(z.pct_avance).toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Tarjeta>
      )}

      <p className="px-1 text-xs leading-relaxed text-slate-400">
        Cada labor de un proceso recorre la misma área planificada, así que sus porcentajes no se
        suman entre sí: si el arado va al 100% y el emplasticado al 60%, el lote está arado completo
        y emplasticado a medias.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const CLASE_SELECT =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10'

function Filtro({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {etiqueta}
      </span>
      {children}
    </label>
  )
}

function Kpi({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-[var(--shadow-card)]">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{etiqueta}</p>
      <p className="mt-0.5 text-lg font-bold tracking-tight tabular-nums text-slate-900">{valor}</p>
      {nota && <p className="text-[10px] text-slate-400">{nota}</p>}
    </div>
  )
}
