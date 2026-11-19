'use client'

/**
 * Bitácora (kardex) de la estación: cada movimiento con su entrada, salida y saldo, agrupado por día (lo más
 * reciente arriba; lo hecho junto en un mismo registro, p. ej. los productos de una recepción, va en un bloque con sangría), con el nombre de quien lo hizo. Lo pendiente de enviar sale marcado. Tocar una fila abre el
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
  filasHistoricas,
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

const NOMBRE_TIPO: Record<TipoFila, string> = { ...NOMBRE_MOVIMIENTO, ENVASE: 'Envases', HISTORICO: 'Aplicación histórica' }
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
  // Bloques contraídos (varios productos hechos en un mismo registro): por defecto todos expandidos
  const [cerrados, setCerrados] = useState<Set<string>>(new Set())
  const todos = useMemo(
    () =>
      ordenarRecientes([
        ...filasDeKardex(estado, kardex(estado, cola, estacionId)),
        ...filasEnvases(estado, cola, estacionId),
        ...filasHistoricas(estado, cola, estacionId),
      ]),
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
  // Dentro de un día: los movimientos del MISMO registro y tipo (p. ej. los productos de una misma recepción) van juntos en un bloque.
  // La lista queda en el mismo orden (lo más reciente arriba); el bloque ocupa el lugar de su primer movimiento.
  const bloquesDe = (delDia: typeof filas) => {
    const bloques: { clave: string; filas: typeof filas }[] = []
    const porClave = new Map<string, { clave: string; filas: typeof filas }>()
    for (const x of delDia) {
      const k = x.documento_id ? `${x.documento_id}|${x.tipo}` : null
      const existente = k ? porClave.get(k) : undefined
      if (existente) existente.filas.push(x)
      else {
        const nuevo = { clave: k ?? x.clave, filas: [x] }
        bloques.push(nuevo)
        if (k) porClave.set(k, nuevo)
      }
    }
    return bloques
  }
  const hayBloques = [...porDia.values()].some((d) => bloquesDe(d).some((b) => b.filas.length > 1))
  const clavesBloques = [...porDia.entries()].flatMap(([dia, d]) => bloquesDe(d).filter((b) => b.filas.length > 1).map((b) => `${dia}|${b.clave}`))
  const alternarBloque = (clave: string) =>
    setCerrados((c) => {
      const n = new Set(c)
      if (n.has(clave)) n.delete(clave)
      else n.add(clave)
      return n
    })

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
      {hayBloques && (
        <div className="flex justify-end gap-3 text-xs font-bold text-brand-700">
          <button type="button" onClick={() => setCerrados(new Set())} data-expandir-todo className="min-h-11 px-1 underline">
            Expandir bloques
          </button>
          <button type="button" onClick={() => setCerrados(new Set(clavesBloques))} data-contraer-todo className="min-h-11 px-1 underline">
            Contraer bloques
          </button>
        </div>
      )}
      {[...porDia.entries()].map(([dia, delDia]) => (
        <div key={dia} data-dia={dia}>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">{DIA.format(new Date(`${dia}T12:00:00Z`))}</p>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200">
            {bloquesDe(delDia).map((b) => {
              if (b.filas.length === 1) return filaMovimiento(b.filas[0])
              const clave = `${dia}|${b.clave}`
              const abierto = !cerrados.has(clave)
              const primero = b.filas[0]
              const esEnvase = primero.tipo === 'ENVASE'
              const titulo = esEnvase
                ? (NOMBRE_MOTIVO_ENVASE[primero.motivo ?? ''] ?? 'Envases')
                : primero.tipo === 'HISTORICO'
                  ? 'Aplicación histórica'
                  : NOMBRE_MOVIMIENTO[primero.tipo as keyof typeof NOMBRE_MOVIMIENTO]
              const turnos = primero.turnos.map(turno).filter(Boolean).join(', ')
              const quien = nombrePersona(estado, primero.registrado_por)
              return (
                <div key={clave} data-bloque={primero.tipo} data-bloque-cuenta={b.filas.length}>
                  <button
                    type="button"
                    onClick={() => alternarBloque(clave)}
                    aria-expanded={abierto}
                    data-bloque-cabecera
                    className="grid min-h-14 w-full grid-cols-[3rem_1fr] items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="text-xs tabular-nums text-slate-500">{RELOJ.format(new Date(primero.fecha_hora))}</span>
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold text-slate-800">
                        {titulo}
                        {turnos ? ` · ${turnos}` : ''}
                      </span>
                      <span className="block break-words text-xs text-slate-400">{quien ?? 'Persona sin nombre en este teléfono'}</span>
                      <span className="block break-words text-xs font-semibold text-slate-500">
                        <span aria-hidden="true">{abierto ? '▾' : '▸'}</span> {b.filas.length} {esEnvase ? 'envases' : 'productos'} · hecho junto
                      </span>
                    </span>
                  </button>
                  {abierto && <div className="ml-6 divide-y divide-slate-100 border-l-2 border-brand-200 bg-slate-50/40">{b.filas.map((x) => filaMovimiento(x, true))}</div>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )

  /** Un movimiento de la lista: al tocarlo se abre su detalle. */
  function filaMovimiento(x: (typeof filas)[number], enBloque = false) {
    const esEnvase = x.tipo === 'ENVASE'
    const esHistorico = x.tipo === 'HISTORICO'
    const titulo = esEnvase
      ? (NOMBRE_MOTIVO_ENVASE[x.motivo ?? ''] ?? 'Envases')
      : esHistorico
        ? 'Aplicación histórica'
        : NOMBRE_MOVIMIENTO[x.tipo as keyof typeof NOMBRE_MOVIMIENTO]
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
        data-historico={esHistorico ? '' : undefined}
        data-quien={quien ?? ''}
        className={`grid min-h-14 w-full ${enBloque ? 'grid-cols-[1fr_auto]' : 'grid-cols-[3rem_1fr_auto]'} items-center gap-2 px-3 py-2 text-left ${x.anulado ? 'opacity-50' : ''} ${x.pendiente ? 'bg-amber-50/60' : 'hover:bg-slate-50'}`}
      >
        {!enBloque && <span className="text-xs tabular-nums text-slate-500">{RELOJ.format(new Date(x.fecha_hora))}</span>}
        <span className="min-w-0">
          {enBloque ? (
            <span className={`block break-words text-sm font-semibold text-slate-800 ${x.anulado ? 'line-through' : ''}`}>{articulo}</span>
          ) : (
            <>
              <span className={`block break-words text-sm font-semibold text-slate-800 ${x.anulado ? 'line-through' : ''}`}>
                {titulo}
                {turnos ? ` · ${turnos}` : ''}
              </span>
              {(productos.length !== 1 || esEnvase) && <span className="block break-words text-xs text-slate-500">{articulo}</span>}
              <span className="block break-words text-xs text-slate-400" data-quien-movimiento>
                {quien ?? 'Persona sin nombre en este teléfono'}
              </span>
            </>
          )}
          {esHistorico && (
            <span className="mr-1 inline-block" data-insignia-historico>
              <Insignia tono="azul">Histórico</Insignia>
            </span>
          )}
          {x.pendiente && <Insignia tono="ambar">por enviar</Insignia>}
        </span>
        <span className="text-right tabular-nums">
          {esHistorico ? (
            <>
              <span className="block text-sm font-bold text-slate-500">{cantidad(x.cantidad ?? 0)}</span>
              <span className="block text-xs text-slate-400">sin mover inventario</span>
            </>
          ) : (
            <>
              <span className={`block text-sm font-bold ${x.entrada ? 'text-brand-700' : 'text-red-700'}`}>
                {x.entrada ? `+${cantidad(x.entrada)}` : `−${cantidad(x.salida)}`}
              </span>
              {x.saldo !== null && <span className="block text-xs text-slate-500">saldo {cantidad(x.saldo)}</span>}
            </>
          )}
        </span>
      </button>
    )
  }
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
