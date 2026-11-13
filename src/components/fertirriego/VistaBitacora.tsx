'use client'

/**
 * Bitácora (kardex) de la estación: cada movimiento con su entrada, salida y saldo, agrupado por día (lo más
 * reciente arriba), con el nombre de quien lo hizo. Lo pendiente de enviar sale marcado. Tocar una fila abre el
 * DETALLE del registro (y desde ahí, anular / devolver).
 *
 * Piloto 2 (puntos 3 y 4): filtros por turno, producto, tipo, fecha (un día o rango) y cantidad (exacta o entre), en
 * una barra que se abre y cierra; los movimientos de envases (también los de «solo envases») salen en la lista.
 */

import { useMemo, useState } from 'react'
import { Insignia } from '@/components/ui/Primitivos'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { hoyIso } from '@/lib/fechas/zona'
import { NOMBRE_MOVIMIENTO, cantidad, kardex } from '@/lib/fertirriego/calculos'
import {
  SIN_FILTROS,
  filasDeKardex,
  filasEnvases,
  filtrarBitacora,
  filtrosActivos,
  nombrePersona,
  ordenarRecientes,
  type FiltrosBitacora,
  type TipoFila,
} from '@/lib/fertirriego/bitacora'
import { ordenarPorClase } from '@/lib/fertirriego/productos'
import type { EstadoCampo, Operacion } from '@/lib/fertirriego/tipos'

const RELOJ = new Intl.DateTimeFormat('es-HN', { timeZone: 'America/Tegucigalpa', hour: '2-digit', minute: '2-digit' })
const DIA = new Intl.DateTimeFormat('es-HN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })

const NOMBRE_TIPO: Record<TipoFila, string> = { ...NOMBRE_MOVIMIENTO, ENVASE: 'Envases' }
const NOMBRE_MOTIVO_ENVASE: Record<string, string> = {
  RECEPCION: 'Envases recibidos',
  ENTREGA: 'Envases entregados',
  CONTEO: 'Envases · ajuste por conteo',
  ANULACION: 'Envases · anulación',
}

const claseEntrada = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:border-brand-600 focus:outline-none'

export function VistaBitacora({
  estado,
  cola,
  estacionId,
  productos,
  onProductos,
  onAbrir,
}: {
  estado: EstadoCampo
  cola: Operacion[]
  estacionId: string
  /** Productos filtrados (desde «En bodega» llega uno). */
  productos: string[]
  onProductos: (ids: string[]) => void
  onAbrir: (documentoTipo: string, documentoId: string) => void
}) {
  const [filtros, setFiltros] = useState<Omit<FiltrosBitacora, 'productos'>>(SIN_FILTROS)
  const [abiertos, setAbiertos] = useState(false)
  const [modoFecha, setModoFecha] = useState<'dia' | 'rango'>('dia')
  const [modoCantidad, setModoCantidad] = useState<'exacta' | 'entre'>('entre')
  const todos = useMemo(
    () => ordenarRecientes([...filasDeKardex(estado, kardex(estado, cola, estacionId)), ...filasEnvases(estado, cola, estacionId)]),
    [estado, cola, estacionId]
  )
  const f: FiltrosBitacora = { ...filtros, productos }
  const filas = filtrarBitacora(todos, f)
  const activos = filtrosActivos(f)

  const material = (id: string | null) => (id ? estado.materiales.find((m) => m.id === id) : undefined)
  const envase = (id: string | null) => (id ? (estado.envases_tipos ?? []).find((e) => e.id === id)?.nombre : undefined) ?? 'Envase'
  const turno = (id: string) => estado.turnos.find((t) => t.id === id)?.turno
  const turnosEstacion = estado.turnos.filter((t) => t.estacion_id === estacionId).sort((a, b) => a.turno.localeCompare(b.turno, 'es', { numeric: true }))
  const usados = useMemo(() => new Set(todos.map((x) => x.material_id).filter(Boolean) as string[]), [todos])
  const tiposUsados = useMemo(() => [...new Set(todos.map((x) => x.tipo))], [todos])

  const porDia = new Map<string, typeof filas>()
  for (const x of filas) porDia.set(x.dia, [...(porDia.get(x.dia) ?? []), x])

  const poner = (cambios: Partial<Omit<FiltrosBitacora, 'productos'>>) => setFiltros((x) => ({ ...x, ...cambios }))

  return (
    <div className="flex flex-col gap-3">
      {/* ---- Barra de filtros (se abre y cierra) ---- */}
      <div className="rounded-xl bg-white ring-1 ring-inset ring-slate-200">
        <div className="flex items-center gap-2 px-2 py-1">
          <button
            type="button"
            onClick={() => setAbiertos((v) => !v)}
            aria-expanded={abiertos}
            data-filtros-bitacora
            className="flex min-h-11 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold text-slate-700"
          >
            <span>{abiertos ? '▾' : '▸'}</span>
            Filtros{activos > 0 ? ` (${activos})` : ''}
            <span className="ml-auto text-xs font-normal text-slate-500" data-cuenta-bitacora={filas.length}>
              {filas.length} movimiento{filas.length === 1 ? '' : 's'}
            </span>
          </button>
          {activos > 0 && (
            <button
              type="button"
              onClick={() => {
                setFiltros(SIN_FILTROS)
                onProductos([])
              }}
              data-limpiar-filtros
              className="min-h-11 rounded-lg px-2 text-xs font-bold text-brand-700 underline"
            >
              Limpiar
            </button>
          )}
        </div>
        {abiertos && (
          <div className="grid grid-cols-1 gap-3 border-t border-slate-100 p-3 sm:grid-cols-2" data-panel-filtros>
            {turnosEstacion.length > 0 && (
              <div data-filtro-turno>
                <SelectorMultiple
                  etiqueta="Turno"
                  opciones={turnosEstacion.map((t) => ({ valor: t.id, etiqueta: t.turno }))}
                  valores={filtros.turnos}
                  onCambiar={(v) => poner({ turnos: v })}
                />
              </div>
            )}
            <div data-filtro-producto>
              <SelectorMultiple
                etiqueta="Producto"
                opciones={ordenarPorClase(estado.materiales.filter((m) => usados.has(m.id) || productos.includes(m.id))).map(({ material: m, clase }) => ({
                  valor: m.id,
                  etiqueta: `${m.descripcion ?? m.codigo} · ${clase}`,
                }))}
                valores={productos}
                onCambiar={onProductos}
              />
            </div>
            <div data-filtro-tipo>
              <SelectorMultiple
                etiqueta="Tipo"
                opciones={tiposUsados.map((t) => ({ valor: t, etiqueta: NOMBRE_TIPO[t] }))}
                valores={filtros.tipos}
                onCambiar={(v) => poner({ tipos: v as TipoFila[] })}
              />
            </div>

            <div data-filtro-fecha>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fecha</span>
                <Interruptor
                  opciones={[
                    ['dia', 'Un día'],
                    ['rango', 'Rango'],
                  ]}
                  valor={modoFecha}
                  onCambiar={(m) => {
                    setModoFecha(m as 'dia' | 'rango')
                    if (m === 'dia') poner({ hasta: filtros.desde })
                  }}
                  data="fecha"
                />
              </div>
              {modoFecha === 'dia' ? (
                <input type="date" max={hoyIso()} value={filtros.desde} onChange={(e) => poner({ desde: e.target.value, hasta: e.target.value })} data-filtro-dia className={claseEntrada} />
              ) : (
                <div className="flex gap-2">
                  <input type="date" aria-label="Desde" value={filtros.desde} onChange={(e) => poner({ desde: e.target.value })} data-filtro-desde className={claseEntrada} />
                  <input type="date" aria-label="Hasta" value={filtros.hasta} onChange={(e) => poner({ hasta: e.target.value })} data-filtro-hasta className={claseEntrada} />
                </div>
              )}
            </div>

            <div data-filtro-cantidad>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cantidad</span>
                <Interruptor
                  opciones={[
                    ['exacta', 'Exacta'],
                    ['entre', 'Entre'],
                  ]}
                  valor={modoCantidad}
                  onCambiar={(m) => {
                    setModoCantidad(m as 'exacta' | 'entre')
                    if (m === 'exacta') poner({ cantidadMax: filtros.cantidadMin })
                  }}
                  data="cantidad"
                />
              </div>
              {modoCantidad === 'exacta' ? (
                <input
                  inputMode="decimal"
                  placeholder="Ej. 25"
                  value={filtros.cantidadMin}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.,]/g, '')
                    poner({ cantidadMin: v, cantidadMax: v })
                  }}
                  data-filtro-cantidad-exacta
                  className={claseEntrada}
                />
              ) : (
                <div className="flex gap-2">
                  <input inputMode="decimal" placeholder="Mínimo" value={filtros.cantidadMin} onChange={(e) => poner({ cantidadMin: e.target.value.replace(/[^\d.,]/g, '') })} data-filtro-cantidad-min className={claseEntrada} />
                  <input inputMode="decimal" placeholder="Máximo" value={filtros.cantidadMax} onChange={(e) => poner({ cantidadMax: e.target.value.replace(/[^\d.,]/g, '') })} data-filtro-cantidad-max className={claseEntrada} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {filas.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-400">{todos.length === 0 ? 'Sin movimientos todavía.' : 'Ningún movimiento con estos filtros.'}</p>
      )}
      {[...porDia.entries()].map(([dia, lista]) => (
        <div key={dia} data-dia={dia}>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{DIA.format(new Date(`${dia}T12:00:00Z`))}</p>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200">
            {lista.map((x) => {
              const esEnvase = x.tipo === 'ENVASE'
              const titulo = esEnvase ? (NOMBRE_MOTIVO_ENVASE[x.motivo ?? ''] ?? 'Envases') : NOMBRE_MOVIMIENTO[x.tipo as keyof typeof NOMBRE_MOVIMIENTO]
              const turnos = x.turnos.map(turno).filter(Boolean).join(', ')
              const quien = nombrePersona(estado, x.registrado_por)
              const articulo = esEnvase ? envase(x.envase_id) : material(x.material_id)?.descripcion
              return (
                <button
                  key={x.clave}
                  type="button"
                  disabled={x.pendiente}
                  onClick={() => onAbrir(x.documento_tipo, x.documento_id)}
                  data-movimiento={x.tipo}
                  data-quien={quien ?? ''}
                  className={`grid min-h-14 w-full grid-cols-[3rem_1fr_auto] items-center gap-2 px-3 py-2 text-left ${x.anulado ? 'opacity-50' : ''} ${x.pendiente ? 'bg-amber-50/60' : 'hover:bg-slate-50'}`}
                >
                  <span className="text-xs tabular-nums text-slate-500">{RELOJ.format(new Date(x.fecha_hora))}</span>
                  <span className="min-w-0">
                    <span className={`block truncate text-sm font-semibold text-slate-800 ${x.anulado ? 'line-through' : ''}`}>
                      {titulo}
                      {turnos ? ` · ${turnos}` : ''}
                    </span>
                    {(productos.length !== 1 || esEnvase) && <span className="block truncate text-[11px] text-slate-500">{articulo}</span>}
                    <span className="block truncate text-[11px] text-slate-400" data-quien-movimiento>
                      {quien ?? 'Persona sin nombre en este teléfono'}
                    </span>
                    {x.pendiente && <Insignia tono="ambar">por enviar</Insignia>}
                  </span>
                  <span className="text-right tabular-nums">
                    <span className={`block text-sm font-bold ${x.entrada ? 'text-brand-700' : 'text-red-700'}`}>
                      {x.entrada ? `+${cantidad(x.entrada)}` : `−${cantidad(x.salida)}`}
                    </span>
                    {x.saldo !== null && <span className="block text-[11px] text-slate-500">saldo {cantidad(x.saldo)}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Dos opciones pequeñas, una marcada (Un día / Rango; Exacta / Entre). */
function Interruptor({ opciones, valor, onCambiar, data }: { opciones: [string, string][]; valor: string; onCambiar: (v: string) => void; data: string }) {
  return (
    <span className="inline-flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" data-interruptor={data}>
      {opciones.map(([v, t]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={valor === v}
          data-opcion={v}
          onClick={() => onCambiar(v)}
          className={`min-h-9 rounded-md px-2.5 text-xs font-semibold ${valor === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
        >
          {t}
        </button>
      ))}
    </span>
  )
}
