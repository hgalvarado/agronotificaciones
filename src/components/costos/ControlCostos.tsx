'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Campo, Entrada, EstadoVacio, Tarjeta } from '@/components/ui/Primitivos'
import { IconDinero, IconSearch, IconSend } from '@/components/ui/Icons'
import { mensajeDeError } from '@/lib/errores'
import { construirXlsx, descargar, type CeldaHoja } from '@/lib/hojas'
import { formatearFecha } from '@/lib/estados'

export type LineaCosto = {
  /** Una fila por LOTE de la labor (grano de `registro_detalle`). */
  detalle_id: string
  registro_id: string
  ticket_id: string
  ticket_codigo: string
  ticket_proceso: string
  fecha: string
  lote_temporada_id: string
  ut: string
  lote_nombre: string | null
  zona_id: string | null
  zona: string | null
  encargado: string | null
  equipo_codigo: string
  labor_id: string
  labor_nombre: string
  categoria_labor_id: string | null
  categoria_labor: string | null
  tarea_codigo: string
  codigo_implemento: string | null
  /** Horas de la labor repartidas entre sus lotes. */
  horas: number | null
  /** Manzanas de ESTE lote. */
  mz: number | null
  concepto: 'EQUIPO' | 'IMPLEMENTO'
  puesto: string | null
  costo_hora: number | null
  costo: number | null
  costo_mz: number | null
}

/** Fila de `fn_costos_por_categoria`. */
export type FilaCategoria = {
  categoria_labor_id: string | null
  categoria_labor: string
  labor_id: string
  labor_nombre: string
  mz: number
  horas: number
  costo: number
  costo_categoria: number
  pct_categoria: number | null
  costo_mz: number | null
  lotes: number
}

const AGRUPACIONES = [
  { valor: 'ut', etiqueta: 'Lote' },
  { valor: 'encargado', etiqueta: 'Encargado' },
  { valor: 'zona', etiqueta: 'Zona' },
  { valor: 'puesto', etiqueta: 'Puesto de trabajo' },
  { valor: 'equipo_codigo', etiqueta: 'Equipo' },
  { valor: 'labor_nombre', etiqueta: 'Labor' },
  { valor: 'categoria_labor', etiqueta: 'Categoría' },
  { valor: 'codigo_implemento', etiqueta: 'Código de implemento' },
  { valor: 'ticket_codigo', etiqueta: 'Ticket' },
  { valor: 'fecha', etiqueta: 'Fecha' },
] as const

type Agrupacion = (typeof AGRUPACIONES)[number]['valor']

const dinero = new Intl.NumberFormat('es-HN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const horasFmt = new Intl.NumberFormat('es-HN', { maximumFractionDigits: 2 })

/** Mismo aspecto que los otros selectores de la barra de filtros. */
const CLASE_FILTRO =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium focus:border-brand-600 focus:outline-none'

function normalizar(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function ControlCostos({
  lineas,
  desde,
  hasta,
  truncado,
}: {
  lineas: LineaCosto[]
  desde: string
  hasta: string
  truncado: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [agrupacion, setAgrupacion] = useState<Agrupacion>('ut')
  const [concepto, setConcepto] = useState('')
  const [categoria, setCategoria] = useState('')
  const [lote, setLote] = useState('')
  const [encargado, setEncargado] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(null)
  const [dDesde, setDDesde] = useState(desde)
  const [dHasta, setDHasta] = useState(hasta)

  // El desglose por categoría y labor lo calcula la base: el % de cada
  // labor dentro de su categoría necesita el total de la categoría, y
  // sacarlo aquí obligaría a que las 4000 líneas del tope estuvieran
  // todas cargadas para que la división cuadrara.
  const [desglose, setDesglose] = useState<FilaCategoria[]>([])
  const [errorDesglose, setErrorDesglose] = useState<string | null>(null)

  const categorias = useMemo(
    () => [...new Set(lineas.map((l) => l.categoria_labor).filter(Boolean))].sort() as string[],
    [lineas]
  )

  const lotes = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const l of lineas) {
      if (!mapa.has(l.lote_temporada_id)) {
        mapa.set(l.lote_temporada_id, l.lote_nombre ? `${l.ut} · ${l.lote_nombre}` : l.ut)
      }
    }
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true }))
  }, [lineas])

  const encargados = useMemo(
    () => [...new Set(lineas.map((l) => l.encargado).filter(Boolean))].sort() as string[],
    [lineas]
  )

  const filtradas = useMemo(() => {
    const q = normalizar(busqueda.trim())
    return lineas.filter((l) => {
      if (concepto && l.concepto !== concepto) return false
      if (categoria && l.categoria_labor !== categoria) return false
      if (lote && l.lote_temporada_id !== lote) return false
      if (encargado && l.encargado !== encargado) return false
      if (!q) return true
      return (
        normalizar(l.equipo_codigo ?? '').includes(q) ||
        normalizar(l.labor_nombre ?? '').includes(q) ||
        normalizar(l.puesto ?? '').includes(q) ||
        normalizar(l.ut ?? '').includes(q) ||
        normalizar(l.lote_nombre ?? '').includes(q) ||
        normalizar(l.encargado ?? '').includes(q) ||
        normalizar(l.codigo_implemento ?? '').includes(q) ||
        normalizar(l.ticket_codigo ?? '').includes(q)
      )
    })
  }, [lineas, concepto, categoria, lote, encargado, busqueda])

  useEffect(() => {
    let vivo = true

    // La función asíncrona se declara DENTRO del efecto: React 19 marca
    // como error actualizar estado desde una definida fuera.
    async function traer() {
      const { data, error: e } = await supabase.rpc('fn_costos_por_categoria', {
        p_desde: desde,
        p_hasta: hasta,
        p_lote_temporada_id: lote || null,
        p_encargado: encargado || null,
      })
      if (!vivo) return
      if (e) {
        setDesglose([])
        setErrorDesglose(
          mensajeDeError(
            e,
            'No se pudo calcular el desglose por categoría. Si dice que la función no existe, falta correr la migración 19 en el SQL Editor de Supabase.'
          )
        )
        return
      }
      setErrorDesglose(null)
      setDesglose((data as FilaCategoria[] | null) ?? [])
    }

    traer()
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, lote, encargado])

  // Agrupado por categoría, con el orden que trae la base (la categoría
  // más cara primero) y respetando el filtro de categoría de la pantalla.
  const porCategoria = useMemo(() => {
    const mapa = new Map<string, FilaCategoria[]>()
    for (const f of desglose) {
      if (categoria && f.categoria_labor !== categoria) continue
      mapa.set(f.categoria_labor, [...(mapa.get(f.categoria_labor) ?? []), f])
    }
    return [...mapa.entries()]
  }, [desglose, categoria])

  const totalCosto = filtradas.reduce((a, l) => a + (l.costo ?? 0), 0)
  const totalHoras = filtradas.reduce((a, l) => a + (l.horas ?? 0), 0)
  const sinTarifa = filtradas.filter((l) => l.costo_hora === null).length

  // Las manzanas se cuentan UNA vez por línea de lote, no por concepto:
  // cada labor genera dos filas (equipo e implemento) sobre las mismas
  // manzanas, y sumarlas las duplicaría dejando el costo por manzana a
  // la mitad. La llave es `detalle_id` —el lote— porque la vista ahora
  // baja a ese grano.
  const mzUnicas = useMemo(() => {
    const vistos = new Map<string, number>()
    for (const l of filtradas) {
      if (l.mz !== null && !vistos.has(l.detalle_id)) vistos.set(l.detalle_id, l.mz)
    }
    return [...vistos.values()].reduce((a, b) => a + b, 0)
  }, [filtradas])

  const costoPorMz = mzUnicas > 0 ? totalCosto / mzUnicas : null

  const grupos = useMemo(() => {
    type Grupo = {
      costo: number
      horas: number
      lineas: LineaCosto[]
      /** Manzanas por línea de lote, para no contarlas dos veces. */
      mzPorRegistro: Map<string, number>
    }
    const mapa = new Map<string, Grupo>()
    for (const l of filtradas) {
      const clave = (l[agrupacion] as string | null) ?? '(sin dato)'
      const g: Grupo = mapa.get(clave) ?? {
        costo: 0,
        horas: 0,
        lineas: [],
        mzPorRegistro: new Map(),
      }
      g.costo += l.costo ?? 0
      g.horas += l.horas ?? 0
      if (l.mz !== null) g.mzPorRegistro.set(l.detalle_id, l.mz)
      g.lineas.push(l)
      mapa.set(clave, g)
    }
    return [...mapa.entries()]
      .map(([clave, g]) => {
        const mz = [...g.mzPorRegistro.values()].reduce((a, b) => a + b, 0)
        return [clave, { ...g, mz, costoMz: mz > 0 ? g.costo / mz : null }] as const
      })
      .sort((a, b) => b[1].costo - a[1].costo)
  }, [filtradas, agrupacion])

  const maxCosto = grupos[0]?.[1].costo ?? 0

  function aplicarRango() {
    router.push(`/costos?desde=${dDesde}&hasta=${dHasta}`)
  }

  function exportar() {
    const filas: CeldaHoja[][] = [
      [
        'Fecha',
        'Ticket',
        'UT',
        'Lote',
        'Zona',
        'Encargado',
        'Equipo',
        'Cod. Implemento',
        'Labor',
        'Categoria',
        'Tarea',
        'Concepto',
        'Puesto',
        'Horas',
        'Mz',
        'Costo x Hora',
        'Costo',
        'Costo x Mz',
      ],
      ...filtradas.map(
        (l) =>
          [
            l.fecha,
            l.ticket_codigo,
            l.ut,
            l.lote_nombre ?? '',
            l.zona ?? '',
            l.encargado ?? '',
            l.equipo_codigo,
            l.codigo_implemento ?? '',
            l.labor_nombre,
            l.categoria_labor ?? '',
            l.tarea_codigo,
            l.concepto,
            l.puesto ?? '',
            l.horas ?? '',
            l.mz ?? '',
            l.costo_hora ?? '',
            l.costo ?? '',
            l.costo_mz ?? '',
          ] as CeldaHoja[]
      ),
    ]
    descargar(construirXlsx('Costos', filas), `costos-${desde}-a-${hasta}.xlsx`)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------- Rango ---------------- */}
      <Tarjeta className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Desde" className="min-w-[140px] flex-1">
            <Entrada type="date" value={dDesde} onChange={(e) => setDDesde(e.target.value)} />
          </Campo>
          <Campo etiqueta="Hasta" className="min-w-[140px] flex-1">
            <Entrada type="date" value={dHasta} onChange={(e) => setDHasta(e.target.value)} />
          </Campo>
          <Boton onClick={aplicarRango}>Consultar</Boton>
        </div>
      </Tarjeta>

      {/* ---------------- Totales ---------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metrica etiqueta="Costo total" valor={`L ${dinero.format(totalCosto)}`} destacado />
        <Metrica
          etiqueta="Costo por mz"
          valor={costoPorMz !== null ? `L ${dinero.format(costoPorMz)}` : '—'}
          destacado
        />
        <Metrica etiqueta="Manzanas" valor={horasFmt.format(mzUnicas)} />
        <Metrica etiqueta="Horas" valor={horasFmt.format(totalHoras)} />
        <Metrica etiqueta="Sin tarifa" valor={String(sinTarifa)} alerta={sinTarifa > 0} />
      </div>

      {sinTarifa > 0 && (
        <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 ring-1 ring-inset ring-amber-600/20">
          Hay {sinTarifa} línea{sinTarifa === 1 ? '' : 's'} cuyo puesto de trabajo no tiene tarifa
          vigente en la fecha del trabajo, así que entran en cero.{' '}
          <Link href="/admin/tarifas" className="font-semibold underline">
            Cargar tarifas
          </Link>
        </p>
      )}

      {truncado && (
        <p className="rounded-xl bg-blue-50 px-3.5 py-2.5 text-xs text-blue-800 ring-1 ring-inset ring-blue-600/20">
          El rango trae más líneas de las que se pueden mostrar de una vez. Acorta las fechas para
          que los totales sean exactos.
        </p>
      )}

      {/* ---------------- Filtros ---------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar equipo, labor, puesto o ticket…"
            inputMode="search"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>

        <select
          value={agrupacion}
          onChange={(e) => {
            setAgrupacion(e.target.value as Agrupacion)
            setGrupoAbierto(null)
          }}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium focus:border-brand-600 focus:outline-none"
        >
          {AGRUPACIONES.map((a) => (
            <option key={a.valor} value={a.valor}>
              Agrupar por {a.etiqueta.toLowerCase()}
            </option>
          ))}
        </select>

        <select
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium focus:border-brand-600 focus:outline-none"
        >
          <option value="">Equipo e implemento</option>
          <option value="EQUIPO">Sólo equipo</option>
          <option value="IMPLEMENTO">Sólo implemento</option>
        </select>

        {categorias.length > 0 && (
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className={CLASE_FILTRO}
          >
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}

        {lotes.length > 0 && (
          <select
            value={lote}
            onChange={(e) => {
              setLote(e.target.value)
              setGrupoAbierto(null)
            }}
            className={`${CLASE_FILTRO} max-w-[200px]`}
          >
            <option value="">Todos los lotes</option>
            {lotes.map(([id, etiqueta]) => (
              <option key={id} value={id}>
                {etiqueta}
              </option>
            ))}
          </select>
        )}

        {encargados.length > 0 && (
          <select
            value={encargado}
            onChange={(e) => {
              setEncargado(e.target.value)
              setGrupoAbierto(null)
            }}
            className={CLASE_FILTRO}
          >
            <option value="">Todos los encargados</option>
            {encargados.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        )}

        <Boton
          variante="secundario"
          tamano="sm"
          onClick={exportar}
          disabled={filtradas.length === 0}
        >
          <IconSend className="h-4 w-4" />
          Excel
        </Boton>
      </div>

      {errorDesglose && <Alerta>{errorDesglose}</Alerta>}

      {/* ------- Desglose por categoría y labor ------- */}
      {porCategoria.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="px-1">
            <h2 className="text-sm font-bold text-slate-900">Desglose por categoría</h2>
            <p className="text-xs text-slate-400">
              {etiquetaAlcance(lote, lotes, encargado)} · el porcentaje es lo que pesa cada labor
              dentro del costo de su categoría.
            </p>
          </div>

          {porCategoria.map(([nombreCategoria, labores]) => {
            const total = labores[0]?.costo_categoria ?? 0
            const mzCategoria = labores.reduce((a, f) => a + Number(f.mz), 0)
            return (
              <Tarjeta key={nombreCategoria} className="overflow-hidden">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">{nombreCategoria}</p>
                    <p className="text-[11px] text-slate-400">
                      {labores.length} labor{labores.length === 1 ? '' : 'es'}
                      {mzCategoria > 0 ? ` · ${horasFmt.format(mzCategoria)} mz` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-base font-bold tabular-nums text-brand-800">
                      L {dinero.format(total)}
                    </p>
                    <p className="text-[11px] text-slate-400">costo total de la categoría</p>
                  </div>
                </div>

                {/* Celular: una tarjeta por labor. Una tabla de seis
                    columnas no cabe en un teléfono y él revisa esto
                    desde el celular. */}
                <div className="divide-y divide-slate-50 sm:hidden">
                  {labores.map((f) => (
                    <div key={f.labor_id} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-semibold text-slate-800">
                          {f.labor_nombre}
                        </p>
                        <p className="shrink-0 text-sm font-bold tabular-nums text-slate-900">
                          L {dinero.format(f.costo)}
                        </p>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-brand-600"
                          style={{ width: `${Math.min(Number(f.pct_categoria ?? 0), 100)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {f.pct_categoria !== null
                          ? `${Number(f.pct_categoria).toFixed(1)}% de la categoría`
                          : 'sin costo'}
                        {Number(f.mz) > 0 ? ` · ${horasFmt.format(Number(f.mz))} mz` : ''}
                        {f.costo_mz !== null ? ` · L ${dinero.format(Number(f.costo_mz))}/mz` : ''}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Escritorio: la tabla */}
                <div className="hidden sm:block">
                  <div className="scroll-suave overflow-x-auto">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                          <th className="px-4 py-2.5">Labor</th>
                          <th className="px-2 py-2.5 text-right">Mz</th>
                          <th className="px-2 py-2.5 text-right">Horas</th>
                          <th className="px-2 py-2.5 text-right">Subtotal</th>
                          <th className="px-2 py-2.5 text-right">L / mz</th>
                          <th className="px-4 py-2.5 text-right">% categoría</th>
                        </tr>
                      </thead>
                      <tbody>
                        {labores.map((f) => (
                          <tr key={f.labor_id} className="border-b border-slate-50 last:border-0">
                            <td className="px-4 py-2 font-semibold text-slate-800">
                              {f.labor_nombre}
                              <span className="ml-1.5 text-[11px] font-medium text-slate-400">
                                {f.lotes} lote{f.lotes === 1 ? '' : 's'}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-slate-600">
                              {Number(f.mz) > 0 ? horasFmt.format(Number(f.mz)) : '—'}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-slate-500">
                              {horasFmt.format(Number(f.horas))}
                            </td>
                            <td className="px-2 py-2 text-right font-bold tabular-nums text-slate-900">
                              L {dinero.format(Number(f.costo))}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-slate-500">
                              {f.costo_mz !== null ? dinero.format(Number(f.costo_mz)) : '—'}
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex items-center justify-end gap-2">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className="h-full rounded-full bg-brand-600"
                                    style={{
                                      width: `${Math.min(Number(f.pct_categoria ?? 0), 100)}%`,
                                    }}
                                  />
                                </div>
                                <span className="w-12 text-right font-bold tabular-nums text-slate-700">
                                  {f.pct_categoria !== null
                                    ? `${Number(f.pct_categoria).toFixed(1)}%`
                                    : '—'}
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-slate-300 bg-slate-50/60 font-bold">
                          <td className="px-4 py-2.5">Total {nombreCategoria}</td>
                          <td className="px-2 py-2.5 text-right tabular-nums">
                            {mzCategoria > 0 ? horasFmt.format(mzCategoria) : '—'}
                          </td>
                          <td className="px-2 py-2.5 text-right tabular-nums">
                            {horasFmt.format(labores.reduce((a, f) => a + Number(f.horas), 0))}
                          </td>
                          <td className="px-2 py-2.5 text-right tabular-nums">
                            L {dinero.format(total)}
                          </td>
                          <td className="px-2 py-2.5" />
                          <td className="px-4 py-2.5 text-right tabular-nums">100%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </Tarjeta>
            )
          })}
        </div>
      )}

      {/* ---------------- Grupos ---------------- */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[var(--shadow-card)]">
        {grupos.length === 0 ? (
          <EstadoVacio
            icono={<IconDinero />}
            titulo="Sin costos en el rango"
            descripcion="No hay labores registradas con estos filtros, o los puestos aún no tienen tarifa."
          />
        ) : (
          grupos.map(([clave, g]) => {
            const abierto = grupoAbierto === clave
            return (
              <div key={clave} className="border-b border-slate-100 last:border-0">
                <button
                  onClick={() => setGrupoAbierto(abierto ? null : clave)}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-slate-50/70"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {agrupacion === 'fecha' ? formatearFecha(clave) : clave}
                    </p>
                    {/* Barra proporcional al grupo más caro: de un vistazo se
                        ve en qué se está yendo la plata. */}
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-brand-600"
                        style={{
                          width: maxCosto > 0 ? `${(g.costo / maxCosto) * 100}%` : '0%',
                        }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {horasFmt.format(g.horas)} h
                      {g.mz > 0 ? ` · ${horasFmt.format(g.mz)} mz` : ''} · {g.lineas.length} línea
                      {g.lineas.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums text-slate-900">
                      L {dinero.format(g.costo)}
                    </p>
                    {g.costoMz !== null && (
                      <p className="text-[11px] tabular-nums text-slate-400">
                        L {dinero.format(g.costoMz)} / mz
                      </p>
                    )}
                  </div>
                </button>

                {abierto && (
                  <div className="scroll-suave overflow-x-auto border-t border-slate-100 bg-slate-50/40">
                    <table className="w-full min-w-[640px] text-xs">
                      <thead>
                        <tr className="text-left text-slate-400">
                          {[
                            'Fecha', 'UT', 'Encargado', 'Equipo', 'Cód. impl.', 'Labor',
                            'Concepto', 'Puesto', 'Horas', 'Mz', 'L/h', 'Costo', 'L/mz',
                          ].map(
                            (h) => (
                              <th key={h} className="px-3 py-2 font-bold uppercase tracking-wide">
                                {h}
                              </th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {g.lineas.slice(0, 200).map((l) => (
                          <tr
                            key={`${l.detalle_id}-${l.concepto}`}
                            className="border-t border-slate-100"
                          >
                            <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">
                              {formatearFecha(l.fecha)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-slate-700">
                              {l.ut}
                            </td>
                            <td className="px-3 py-1.5 text-slate-500">{l.encargado ?? '—'}</td>
                            <td className="px-3 py-1.5 font-semibold text-slate-700">
                              {l.equipo_codigo}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">
                              {l.codigo_implemento ?? '—'}
                            </td>
                            <td className="max-w-[160px] truncate px-3 py-1.5 text-slate-600">
                              {l.labor_nombre}
                            </td>
                            <td className="px-3 py-1.5 text-slate-400">
                              {l.concepto === 'EQUIPO' ? 'Equipo' : 'Implemento'}
                            </td>
                            <td className="px-3 py-1.5 text-slate-500">{l.puesto ?? '—'}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                              {l.horas !== null ? horasFmt.format(l.horas) : '—'}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                              {l.mz !== null ? horasFmt.format(l.mz) : '—'}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">
                              {l.costo_hora !== null ? dinero.format(l.costo_hora) : 'sin tarifa'}
                            </td>
                            <td className="px-3 py-1.5 text-right font-bold tabular-nums text-slate-900">
                              {dinero.format(l.costo ?? 0)}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                              {l.costo_mz !== null ? dinero.format(l.costo_mz) : '—'}
                            </td>
                          </tr>
                        ))}
                        {g.lineas.length > 200 && (
                          <tr className="border-t border-slate-100">
                            <td colSpan={13} className="px-3 py-2 italic text-slate-400">
                              Se muestran 200 de {g.lineas.length} líneas. Descarga el Excel para
                              verlas todas.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <p className="px-1 text-xs text-slate-400">
        Cada labor genera dos líneas, igual que en la notificación de SAP: una por el puesto del
        equipo y otra por el puesto del implemento. Las horas son las notificadas en la labor, no
        las del horómetro completo. Las manzanas se cuentan una sola vez por lote aunque generen
        dos líneas de costo, para que el costo por manzana no salga a la mitad. Cuando una labor
        cubre varios lotes, su costo se reparte entre ellos en proporción a las manzanas de cada
        uno —y a partes iguales si la labor no mide área—, así que la suma por lote da exactamente
        el costo de la labor.
      </p>
    </div>
  )
}

function Metrica({
  etiqueta,
  valor,
  destacado = false,
  alerta = false,
}: {
  etiqueta: string
  valor: string
  destacado?: boolean
  alerta?: boolean
}) {
  return (
    <div
      className={`rounded-xl border px-3.5 py-3 shadow-[var(--shadow-card)] ${
        alerta ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200/80 bg-white'
      }`}
    >
      <p className="text-[11px] font-medium text-slate-400">{etiqueta}</p>
      <p
        className={`mt-0.5 font-bold tracking-tight tabular-nums ${
          destacado ? 'text-lg text-brand-800' : 'text-lg text-slate-900'
        }`}
      >
        {valor}
      </p>
    </div>
  )
}

/** Texto que dice sobre qué está calculado el desglose. */
function etiquetaAlcance(
  lote: string,
  lotes: (readonly [string, string])[],
  encargado: string
) {
  const partes: string[] = []
  const nombreLote = lotes.find(([id]) => id === lote)?.[1]
  if (nombreLote) partes.push(`Lote ${nombreLote}`)
  if (encargado) partes.push(`encargado ${encargado}`)
  return partes.length > 0 ? partes.join(' · ') : 'Todos los lotes del rango'
}
