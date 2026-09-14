'use client'

/**
 * El tablero de avance.
 *
 * Su trabajo es uno: recoger filtros, pedir los datos y repartirlos
 * entre los módulos que dibujan. Ni agrupa (lo hace
 * `lib/tablero/agrupacion`), ni consulta a mano (lo hace
 * `lib/tablero/repositorio`), ni formatea números (`lib/tablero/formato`).
 *
 * Del proceso SAP ya no sabe nada: «Eliminar cualquier lógica o
 * distinción subyacente entre APS, LEV o CAT». Un lote es un lote, y su
 * plan es el área que hay que recorrer, no una por proceso.
 */

import { useEffect, useMemo, useState } from 'react'
import { Alerta, Tarjeta } from '@/components/ui/Primitivos'
import { IconSearch, IconX } from '@/components/ui/Icons'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { GrupoCasillas } from '@/components/ui/GrupoCasillas'
import { ArbolAvance } from './ArbolAvance'
import { ResumenCostosZona } from './ResumenCostosZona'
import { mensajeDeError } from '@/lib/errores'
import { agrupar, costosPorZona, ordenar, totalesDe } from '@/lib/tablero/agrupacion'
import { leerTablero } from '@/lib/tablero/repositorio'
import { colorAvance, dinero, fechaCorta, numero, porcentaje } from '@/lib/tablero/formato'
import {
  AGRUPACIONES,
  AGRUPACION_POR_OMISION,
  CICLOS_TABLERO,
  FILTROS_VACIOS,
  type Agrupacion,
  type FilaLabor,
  type FilaLote,
  type FilaZona,
  type Filtros,
  type OpcionLabor,
  type OpcionLote,
  type OpcionSimple,
  type OpcionTemporada,
} from '@/lib/tablero/tipos'

export type {
  OpcionLabor,
  OpcionLote,
  OpcionSimple,
  OpcionTemporada,
} from '@/lib/tablero/tipos'

export function TableroAvance({
  temporadas,
  zonas,
  lotes,
  labores,
  categorias,
}: {
  temporadas: OpcionTemporada[]
  zonas: OpcionSimple[]
  lotes: OpcionLote[]
  labores: OpcionLabor[]
  categorias: OpcionSimple[]
}) {
  const temporadaInicial = temporadas.find((t) => t.activa)?.id ?? temporadas[0]?.id ?? ''

  const [filtros, setFiltros] = useState<Filtros>({
    temporada: temporadaInicial,
    ...FILTROS_VACIOS,
  })
  const [porAgrupar, setPorAgrupar] = useState<Agrupacion[]>(AGRUPACION_POR_OMISION)

  const [porLabor, setPorLabor] = useState<FilaLabor[]>([])
  const [porZona, setPorZona] = useState<FilaZona[]>([])
  const [porLote, setPorLote] = useState<FilaLote[]>([])
  // Arranca en «cargando» sólo si de verdad hay algo que pedir. Ponerlo
  // en true y apagarlo dentro del efecto haría un `setState` sincrónico
  // en el cuerpo del efecto, que React 19 marca como error.
  const [cargando, setCargando] = useState(Boolean(temporadaInicial))
  const [error, setError] = useState<string | null>(null)
  const [abrirFiltros, setAbrirFiltros] = useState(false)

  /* ----------------------------- Consulta ---------------------------- */

  // Las listas van serializadas en las dependencias: un arreglo nuevo con
  // el mismo contenido dispararía el efecto en cada render.
  const zonasClave = filtros.zonas.join(',')
  const ciclosClave = filtros.ciclos.join(',')

  useEffect(() => {
    if (!filtros.temporada) return
    let vivo = true

    // La función asíncrona se declara DENTRO del efecto: React 19 marca
    // como error llamar a `setState` desde una función definida fuera y
    // referenciada aquí (`react-hooks/set-state-in-effect`).
    async function traer() {
      setCargando(true)
      setError(null)

      const datos = await leerTablero(filtros)
      if (!vivo) return

      if (datos.error) {
        setPorLabor([])
        setPorZona([])
        setPorLote([])
        setError(
          mensajeDeError(
            datos.error,
            'No se pudo leer el avance. Si dice que la función no existe o que le sobran argumentos, falta correr la migración 31 en el SQL Editor de Supabase.'
          )
        )
      } else {
        setPorLabor(datos.porLabor)
        setPorZona(datos.porZona)
        setPorLote(datos.porLote)
      }
      setCargando(false)
    }

    traer()
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filtros.temporada,
    zonasClave,
    filtros.lote,
    ciclosClave,
    filtros.labor,
    filtros.categoria,
    filtros.desde,
    filtros.hasta,
  ])

  /* ------------------------- Listas dependientes --------------------- */

  // Los lotes se recortan a la temporada, a las zonas y a los ciclos
  // elegidos: una lista de 400 lotes de todas las temporadas no sirve de
  // filtro.
  const lotesVisibles = useMemo(
    () =>
      lotes.filter(
        (l) =>
          l.temporada_id === filtros.temporada &&
          (filtros.zonas.length === 0 || (l.zona_id !== null && filtros.zonas.includes(l.zona_id))) &&
          (filtros.ciclos.length === 0 || (l.ciclo !== null && filtros.ciclos.includes(l.ciclo)))
      ),
    [lotes, filtros.temporada, filtros.zonas, filtros.ciclos]
  )

  // Y las labores, a la categoría elegida.
  const laboresVisibles = useMemo(
    () => labores.filter((l) => !filtros.categoria || l.categoria_labor_id === filtros.categoria),
    [labores, filtros.categoria]
  )

  function cambiar(cambios: Partial<Filtros>) {
    setFiltros((prev) => {
      const siguiente = { ...prev, ...cambios }
      // Coherencia: si cambia la zona, el ciclo o la temporada, el lote
      // elegido puede quedar fuera de la lista; si cambia la categoría,
      // la labor.
      if (
        cambios.zonas !== undefined ||
        cambios.temporada !== undefined ||
        cambios.ciclos !== undefined
      ) {
        siguiente.lote = ''
      }
      if (cambios.categoria !== undefined) siguiente.labor = ''
      return siguiente
    })
  }

  const activos = [
    filtros.zonas.length > 0 && 'zona',
    filtros.lote && 'lote',
    filtros.ciclos.length > 0 && 'ciclo',
    filtros.categoria && 'categoría',
    filtros.labor && 'labor',
    (filtros.desde || filtros.hasta) && 'fechas',
  ].filter(Boolean).length

  function limpiar() {
    setFiltros({ temporada: filtros.temporada, ...FILTROS_VACIOS })
  }

  /* ------------------------------ Derivados -------------------------- */

  const niveles = useMemo(() => ordenar(porAgrupar), [porAgrupar])
  const arbol = useMemo(() => agrupar(porLote, niveles), [porLote, niveles])
  const costos = useMemo(() => costosPorZona(porLote), [porLote])
  const totales = useMemo(() => totalesDe(porLote), [porLote])

  const ultima = porLabor.reduce<string | null>(
    (m, l) => (l.ultima_fecha && (!m || l.ultima_fecha > m) ? l.ultima_fecha : m),
    null
  )

  // El plan de la tarjeta sale del avance por labor y NO de la
  // cuadrícula: la cuadrícula sólo trae lotes con trabajo capturado, así
  // que un lote planificado y todavía sin tocar quedaría fuera y el plan
  // saldría más chico que el que miden las barras de abajo.
  const planFiltrado = porLabor.length > 0 ? Number(porLabor[0].area_plan) : 0
  const pctGlobal = planFiltrado > 0 ? (totales.mz * 100) / planFiltrado : null

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

        {/* La temporada va aparte y arriba: es la que manda sobre todo lo
            demás y se ve siempre, también con los filtros plegados. */}
        <div className="mt-3">
          <Etiqueta>Temporada</Etiqueta>
          <SelectorBuscable
            valor={filtros.temporada}
            onCambiar={(id) => cambiar({ temporada: id })}
            permitirVacio={false}
            placeholder="Elige la temporada"
            etiquetaBusqueda="Escribe el nombre de la temporada"
            opciones={temporadas.map((t) => ({
              id: t.id,
              titulo: t.nombre,
              subtitulo: t.activa ? 'Activa' : undefined,
            }))}
          />
        </div>

        <div
          className={`mt-3 flex flex-col gap-3 ${abrirFiltros ? '' : 'hidden sm:flex'}`}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <SelectorMultiple
              etiqueta="Zona"
              opciones={zonas.map((z) => ({ valor: z.id, etiqueta: z.nombre }))}
              valores={filtros.zonas}
              onCambiar={(v) => cambiar({ zonas: v })}
            />
            <SelectorMultiple
              etiqueta="Ciclo"
              opciones={CICLOS_TABLERO.map((c) => ({ valor: String(c), etiqueta: `Ciclo ${c}` }))}
              valores={filtros.ciclos.map(String)}
              onCambiar={(v) => cambiar({ ciclos: v.map(Number) })}
            />

            <div className="flex flex-col gap-1">
              <Etiqueta>Categoría de labor</Etiqueta>
              <SelectorBuscable
                valor={filtros.categoria}
                onCambiar={(id) => cambiar({ categoria: id })}
                placeholder="Todas"
                textoVacio="Todas"
                etiquetaBusqueda="Escribe la categoría"
                opciones={categorias.map((c) => ({ id: c.id, titulo: c.nombre }))}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Etiqueta>Labor</Etiqueta>
              <SelectorBuscable
                valor={filtros.labor}
                onCambiar={(id) => cambiar({ labor: id })}
                placeholder="Todas"
                textoVacio="Todas"
                etiquetaBusqueda="Escribe el nombre de la labor"
                opciones={laboresVisibles.map((l) => ({ id: l.id, titulo: l.nombre }))}
              />
            </div>

            <div className="col-span-2 flex flex-col gap-1 sm:col-span-3 lg:col-span-2">
              <Etiqueta>Lote ({lotesVisibles.length})</Etiqueta>
              <SelectorBuscable
                valor={filtros.lote}
                onCambiar={(id) => cambiar({ lote: id })}
                placeholder="Todos"
                textoVacio="Todos"
                etiquetaBusqueda="Escribe la ubicación técnica"
                opciones={lotesVisibles.map((l) => ({ id: l.id, titulo: l.etiqueta }))}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Etiqueta>Desde</Etiqueta>
              <input
                type="date"
                value={filtros.desde}
                onChange={(e) => cambiar({ desde: e.target.value })}
                className={CLASE_CAMPO}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Etiqueta>Hasta</Etiqueta>
              <input
                type="date"
                value={filtros.hasta}
                onChange={(e) => cambiar({ hasta: e.target.value })}
                className={CLASE_CAMPO}
              />
            </div>
          </div>

          {/* --------------------------- Agrupar por ------------------------- */}
          <div className="border-t border-slate-100 pt-3">
            <Etiqueta>Agrupar por</Etiqueta>
            <p className="mb-2 text-[11px] text-slate-400">
              Marca las que quieras. El árbol siempre se arma en el orden Encargado → Zona → Lote,
              sin importar en qué orden las marques.
            </p>
            <GrupoCasillas
              opciones={AGRUPACIONES.map((a) => ({ valor: a.valor, etiqueta: a.etiqueta }))}
              marcados={porAgrupar}
              onCambiar={(v) => setPorAgrupar(v as Agrupacion[])}
              etiquetaTodos="Todas las agrupaciones"
              columnas={3}
            />
          </div>
        </div>

        {(filtros.zonas.length > 0 || filtros.lote || filtros.ciclos.length > 0) && (
          <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
            Al filtrar por zona, lote o ciclo, el área planificada se recorta igual, así que el
            porcentaje sigue siendo el de lo filtrado. Los filtros de labor, categoría y fecha
            recortan sólo lo ejecutado: un plan no tiene labor ni fecha.
          </p>
        )}
      </Tarjeta>

      {error && <Alerta>{error}</Alerta>}

      {/* ---------------------------- Resumen ----------------------------- */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Kpi etiqueta="Plan" valor={planFiltrado > 0 ? `${numero(planFiltrado)} mz` : '—'} />
        <Kpi
          etiqueta="Manzanas recorridas"
          valor={`${numero(totales.mz)} mz`}
          nota={
            pctGlobal !== null ? `${porcentaje(pctGlobal)} del plan` : 'suma de todas las labores'
          }
        />
        <Kpi etiqueta="Gasto" valor={dinero(totales.gasto)} nota={`${totales.lotes} lotes`} />
        <Kpi etiqueta="Última captura" valor={fechaCorta(ultima)} />
      </div>

      {/* --------------------------- Por labor ---------------------------- */}
      <Tarjeta>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-900">Avance por labor</h2>
        </div>

        {cargando ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Cargando…</p>
        ) : porLabor.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">
            {activos > 0
              ? 'Nada capturado con esos filtros. Prueba a quitar alguno.'
              : 'Todavía no hay labores capturadas en esta temporada.'}
          </p>
        ) : (
          <div className="divide-y divide-slate-50">
            {porLabor.map((l) => {
              const pct = l.pct_avance === null ? null : Number(l.pct_avance)
              return (
                <div key={l.labor_id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-800">
                      {l.labor_nombre}
                    </p>
                    <p className="shrink-0 text-xs tabular-nums text-slate-500">
                      {numero(l.mz_avance)}
                      {Number(l.area_plan) > 0 ? ` / ${numero(l.area_plan)}` : ''} mz
                      {pct !== null && (
                        <strong className="ml-1.5 text-slate-900">{porcentaje(pct)}</strong>
                      )}
                    </p>
                  </div>

                  {pct !== null ? (
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${colorAvance(pct)}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] italic text-slate-400">
                      Sin plan contra el que medir.
                    </p>
                  )}

                  <p className="mt-1 text-[11px] text-slate-400">
                    {l.categoria_labor ?? 'Sin categoría'} · {l.lotes_tocados} lote
                    {l.lotes_tocados === 1 ? '' : 's'}
                    {Number(l.lotes_con_plan) > 0 ? ` de ${l.lotes_con_plan} en el plan` : ''}
                    {Number(l.mz_pendiente) > 0
                      ? ` · faltan ${numero(l.mz_pendiente)} mz`
                      : ''}
                    {l.ultima_fecha ? ` · última ${fechaCorta(l.ultima_fecha)}` : ''}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </Tarjeta>

      {/* ------------------------ Detalle agrupado ------------------------ */}
      {!cargando && porLote.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3 px-1">
            <h2 className="text-sm font-bold text-slate-900">
              {niveles.length === 0
                ? 'Detalle por lote y labor'
                : niveles.map((n) => AGRUPACIONES.find((a) => a.valor === n)?.etiqueta).join(' › ')}
            </h2>
            <p className="shrink-0 text-[11px] text-slate-400">
              {porLote.length} {porLote.length === 1 ? 'línea' : 'líneas'}
            </p>
          </div>
          <ArbolAvance nodos={arbol} plano={niveles.length === 0} />
        </div>
      )}

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
                      {numero(z.mz_avance)}
                      {Number(z.area_plan) > 0 ? ` / ${numero(z.area_plan)}` : ''} mz
                      {pct !== null && (
                        <strong className="ml-1.5 text-slate-900">{porcentaje(pct)}</strong>
                      )}
                    </p>
                  </div>
                  {pct !== null && (
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${colorAvance(pct)}`}
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
                        {numero(z.area_plan)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                        {numero(z.mz_avance)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-amber-700">
                        {numero(z.mz_pendiente)}
                      </td>
                      <td className="px-4 py-2 text-right font-bold tabular-nums text-slate-900">
                        {porcentaje(z.pct_avance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Tarjeta>
      )}

      {/* ------------------ Resumen de costos por zona -------------------- */}
      {!cargando && <ResumenCostosZona zonas={costos} />}

      <p className="px-1 text-xs leading-relaxed text-slate-400">
        Cada labor recorre la misma área planificada del lote, así que sus porcentajes no se suman
        entre sí: si el arado va al 100% y el emplasticado al 60%, el lote está arado completo y
        emplasticado a medias.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const CLASE_CAMPO =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10'

function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </span>
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
