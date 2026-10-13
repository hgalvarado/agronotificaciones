'use client'

/**
 * El informe ejecutivo de un lote.
 *
 * ── Qué contesta, y en qué orden ────────────────────────────────────
 *
 * Es una pantalla para quien NO capturó el turno: un gerente que quiere
 * saber qué pasó en un lote sin abrir cinco pestañas. Por eso va de lo
 * general a lo particular, y no al revés:
 *
 *   1. **Cuándo.** La línea de tiempo, a escala de días, con el DDT.
 *   2. **¿Se cumplió?** Dosis y costo contra lo planificado, con su
 *      desviación y su color.
 *   3. **¿Dónde se fue el dinero?** Las tres piezas y la fase más cara.
 *   4. **¿Contra qué se aplicó?** Los químicos con sus objetivos.
 *
 * ── Por qué un lote a la vez ────────────────────────────────────────
 *
 * Porque la pregunta es «qué pasó en ESTE lote». Una tabla de cien lotes
 * contesta otra —«cuál se me fue de precio»—, y ésa ya la contesta el
 * tablero de la 67, que sigue vivo en esta misma pestaña. Lo que faltaba
 * era poder bajar al lote y contar su historia entera.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alerta, Boton, Campo, Esqueleto, Selector, Tarjeta } from '@/components/ui/Primitivos'
import { IconDescargar } from '@/components/ui/Icons'
import { n2 } from '@/lib/trasplante/formato'
import { descargar } from '@/lib/hojas'
import { hoyIso } from '@/lib/fechas'
import { canExecuteAction, type Reglas } from '@/lib/permisos/clientABAC'
import { AVISO_SIN_MIGRACION, leerInforme } from '@/lib/desinfeccion/repositorioCliente'
import { diagnosticarLectura } from '@/lib/supabase/instalacion'
import type { CatalogosDesinfeccion } from '@/lib/desinfeccion/tipos'
import {
  conSigno,
  hitosDe,
  piezasDe,
  productosDe,
  retrasoDias,
  tonoDelta,
  type FilaInforme,
  type Tono,
} from '@/lib/desinfeccion/informe'
import { informeEjecutivoPdf, nombreInforme } from '@/lib/desinfeccion/informePdf'
import { Cronograma, RadiografiaCosto } from './GraficosInforme'

type Fila = FilaInforme & { id: string }

export function InformeEjecutivo({
  temporadaId,
  zonas,
  reglas,
  onSinMigracion,
}: {
  temporadaId: string
  zonas: CatalogosDesinfeccion['zonas']
  reglas: Reglas
  onSinMigracion: (falta: boolean, causa?: string | null) => void
}) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [zonaId, setZonaId] = useState('')
  const [elegido, setElegido] = useState<string>('')
  /** El fallo que NO es una migración: se dice aquí, sin tapar el módulo. */
  const [fallo, setFallo] = useState<string | null>(null)

  const avisar = useCallback(
    (falta: boolean, causa: string | null = null) => onSinMigracion(falta, causa),
    [onSinMigracion]
  )

  useEffect(() => {
    let vivo = true
    async function cargar() {
      setCargando(true)
      const { datos, error, codigo } = await leerInforme(temporadaId || null)
      if (!vivo) return
      setCargando(false)
      if (error) {
        /*
         * **No todo error es una migración que falta.**
         *
         * Antes, cualquier fallo —un permiso, un `select` sin conceder,
         * la caché de esquema de PostgREST sin recargar, la red— se
         * contestaba con «corre las migraciones 59 y 60». Quien las
         * tenía puestas las volvía a correr, no pasaba nada, y la
         * pantalla seguía amarilla sin una sola pista de la causa.
         *
         * Ahora sólo se dice eso cuando la base responde que la
         * relación o la columna no existen. Lo demás se enseña con su
         * texto, y el resto del módulo sigue utilizable: que el informe
         * no cargue no es razón para esconder la captura.
         */
        const d = diagnosticarLectura(AVISO_SIN_MIGRACION, { message: error, code: codigo })
        avisar(d.falta, d.avisoModulo)
        setFallo(d.mensaje)
        setFilas([])
        return
      }
      avisar(false, null)
      setFallo(null)
      setFilas(datos)
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [temporadaId, avisar])

  // El recorte por zona es de pantalla: la reja de verdad la pone la
  // vista sobre `desinfeccion_reporte` (migración 71). Lo que no se
  // puede ver no llega hasta aquí.
  const visibles = useMemo(
    () => filas.filter((f) => !zonaId || f.zona_id === zonaId),
    [filas, zonaId]
  )

  /*
   * Qué lote se mira.
   *
   * Se guarda el id elegido y se RESUELVE contra la lista, en vez de
   * guardar la fila: con otro filtro puesto, la fila guardada podría ya
   * no estar en la lista y la pantalla enseñaría un lote que el
   * desplegable no ofrece.
   */
  const fila = useMemo(
    () => visibles.find((f) => f.id === elegido) ?? visibles[0] ?? null,
    [visibles, elegido]
  )

  const puedeExportar = canExecuteAction(reglas, 'desinfeccion_reporte', 'exportar')

  function descargarPdf() {
    if (!fila) return
    descargar(informeEjecutivoPdf(fila, hoyIso()), nombreInforme(fila))
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Los filtros, en una fila encima de todo: es donde se buscan. */}
      <Tarjeta className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
          <Campo etiqueta="Zona">
            <Selector value={zonaId} onChange={(e) => setZonaId(e.target.value)}>
              <option value="">Todas las zonas</option>
              {zonas.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo
            etiqueta="Lote y ciclo"
            ayuda="Sólo salen los lotes que tu rol puede ver: el recorte lo hace la base, no esta pantalla."
          >
            <Selector
              value={fila?.id ?? ''}
              buscable
              onChange={(e) => setElegido(e.target.value)}
            >
              {visibles.length === 0 && <option value="">No hay lotes que mirar</option>}
              {visibles.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.lote_nomenclatura}
                  {f.lote_nombre ? ` · ${f.lote_nombre}` : ''} — ciclo {f.ciclo}
                </option>
              ))}
            </Selector>
          </Campo>

          <Boton
            variante="secundario"
            onClick={descargarPdf}
            disabled={!fila || !puedeExportar}
            className="h-11"
          >
            <IconDescargar className="h-4 w-4" />
            Descargar informe ejecutivo
          </Boton>
        </div>
      </Tarjeta>

      {cargando && <Esqueleto className="h-64 w-full" />}

      {/* El fallo, dicho con el texto de la base. Un «no se pudo cargar»
          a secas obliga a abrir la consola para saber qué pasó, y quien
          está en campo no la abre. */}
      {!cargando && fallo && <Alerta tono="rojo">{fallo}</Alerta>}

      {!cargando && !fallo && !fila && (
        <Alerta tono="ambar">
          Todavía no hay ningún lote con desinfección capturada en lo que seleccionaste. En cuanto
          se cierre un turno con sus lotes y sus manzanas, aparece aquí.
        </Alerta>
      )}

      {!cargando && fila && (
        <>
          <Encabezado fila={fila} />
          <SeccionCronograma fila={fila} />
          <SeccionCumplimiento fila={fila} />
          <SeccionFinanciera fila={fila} />
          <SeccionAgronomia fila={fila} />
        </>
      )}
    </div>
  )
}

/* ================================================================== */
/* El encabezado del lote                                              */
/* ================================================================== */

function Encabezado({ fila }: { fila: Fila }) {
  return (
    <Tarjeta className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="truncate text-xl font-bold tracking-tight text-slate-900">
          {fila.lote_nomenclatura}
          {fila.lote_nombre && <span className="font-normal text-slate-400"> · {fila.lote_nombre}</span>}
        </h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
          <span>Ciclo {fila.ciclo}</span>
          <span aria-hidden>·</span>
          <span>{fila.zona_nombre ?? 'Sin zona'}</span>
          <span aria-hidden>·</span>
          <span>{fila.temporada_nombre ?? '—'}</span>
          {fila.variedad && (
            <>
              <span aria-hidden>·</span>
              <span>{fila.variedad}</span>
            </>
          )}
        </p>
      </div>

      <div className="flex shrink-0 gap-5">
        <Cifra etiqueta="Manzanas" valor={n2(fila.mz_regadas)} />
        <Cifra etiqueta="Costo total" valor={`L ${n2(fila.costo_total)}`} destacado />
        <Cifra etiqueta="Costo / mz" valor={`L ${n2(fila.costo_mz)}`} />
      </div>
    </Tarjeta>
  )
}

function Cifra({
  etiqueta,
  valor,
  destacado = false,
}: {
  etiqueta: string
  valor: string
  destacado?: boolean
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{etiqueta}</p>
      <p
        className={`text-lg font-bold tabular-nums ${
          destacado ? 'text-brand-700' : 'text-slate-900'
        }`}
      >
        {valor}
      </p>
    </div>
  )
}

/* ================================================================== */
/* 1 · Cronograma                                                      */
/* ================================================================== */

function SeccionCronograma({ fila }: { fila: Fila }) {
  const hitos = useMemo(() => hitosDe(fila), [fila])
  const retraso = retrasoDias(fila)

  return (
    <Tarjeta className="p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Cronograma operativo</h3>
        {retraso !== null && (
          <span
            className={`text-xs font-semibold ${
              retraso > 7 ? 'text-red-700' : retraso < -7 ? 'text-amber-700' : 'text-slate-500'
            }`}
          >
            {retraso === 0
              ? 'Se aplicó el día planificado'
              : `${Math.abs(retraso)} días ${retraso > 0 ? 'después' : 'antes'} de lo planificado`}
          </span>
        )}
      </div>
      <Cronograma hitos={hitos} />
    </Tarjeta>
  )
}

/* ================================================================== */
/* 2 · Cumplimiento                                                    */
/* ================================================================== */

const CLASES: Record<Tono, string> = {
  bien: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  alerta: 'bg-amber-50 text-amber-700 ring-amber-200',
  malo: 'bg-red-50 text-red-700 ring-red-200',
  neutro: 'bg-slate-50 text-slate-500 ring-slate-200',
}

function SeccionCumplimiento({ fila }: { fila: Fila }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <TarjetaDelta
        titulo="Dosis por manzana"
        plan={fila.dosis_mz_plan === null ? null : `${n2(fila.dosis_mz_plan)} L/mz`}
        real={`${n2(fila.dosis_mz_real)} L/mz`}
        delta={fila.delta_dosis === null ? null : `${conSigno(fila.delta_dosis)} L/mz`}
        pct={fila.delta_dosis_pct}
      />
      <TarjetaDelta
        titulo="Costo del lote"
        plan={fila.costo_plan === null ? null : `L ${n2(fila.costo_plan)}`}
        real={`L ${n2(fila.costo_total)}`}
        delta={fila.delta_costo === null ? null : `L ${conSigno(fila.delta_costo)}`}
        pct={fila.delta_costo_pct}
      />
    </div>
  )
}

/**
 * Lo planificado contra lo real, con su desviación.
 *
 * **Sin plan no se enseña un cero.** Un cero diría «se planificó cero»,
 * que es una afirmación distinta de «no se planificó», y la segunda es
 * la verdad en un lote que se desinfectó sobre la marcha.
 */
function TarjetaDelta({
  titulo,
  plan,
  real,
  delta,
  pct,
}: {
  titulo: string
  plan: string | null
  real: string
  delta: string | null
  pct: number | null
}) {
  const tono = tonoDelta(pct)

  return (
    <Tarjeta className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{titulo}</p>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] text-slate-400">Planificado</p>
          <p className="text-base font-semibold tabular-nums text-slate-500">{plan ?? 'Sin plan'}</p>
        </div>
        <span aria-hidden className="pb-1 text-slate-300">
          →
        </span>
        <div className="text-right">
          <p className="text-[11px] text-slate-400">Real</p>
          <p className="text-xl font-bold tabular-nums text-slate-900">{real}</p>
        </div>
      </div>

      {/* La desviación lleva el signo Y el color: el color solo no se ve
          en una impresión en blanco y negro, y el signo solo no salta a
          la vista en una pantalla llena de números. */}
      <div
        className={`mt-3 flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 ring-inset ${CLASES[tono]}`}
      >
        <span>{delta ?? 'Nada con que comparar'}</span>
        <span className="tabular-nums">{pct === null ? '' : `${conSigno(pct, 1)}%`}</span>
      </div>
    </Tarjeta>
  )
}

/* ================================================================== */
/* 3 · Radiografía financiera                                          */
/* ================================================================== */

function SeccionFinanciera({ fila }: { fila: Fila }) {
  const piezas = useMemo(() => piezasDe(fila), [fila])

  return (
    <Tarjeta className="p-4">
      <h3 className="text-sm font-semibold text-slate-900">Radiografía financiera</h3>
      <p className="mb-3 text-xs text-slate-400">
        Dónde se fue el dinero de este lote. El químico y la mano de obra se reparten entre los
        lotes de su turno; el acarreo, entre las manzanas de su zona en la temporada.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <RadiografiaCosto piezas={piezas} />

        {/* La fase más cara, dicha con palabras. La barra no la contesta:
            el acarreo y el químico no son fases, son conceptos. */}
        <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Fase más cara de la cuadrilla
          </p>
          <p className="mt-0.5 text-lg font-bold text-slate-900">
            {fila.fase_mas_cara ?? 'Sin cuadrilla'}
          </p>
          <dl className="mt-2 flex flex-col gap-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Preriego</dt>
              <dd className="font-semibold tabular-nums text-slate-900">
                L {n2(fila.costo_personal_preriego)}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Aplicación</dt>
              <dd className="font-semibold tabular-nums text-slate-900">
                L {n2(fila.costo_personal_aplicacion)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            El preriego lo hace mucha gente pocas horas y la aplicación poca gente muchas: cuál
            pesa más no es evidente.
          </p>
        </div>
      </div>
    </Tarjeta>
  )
}

/* ================================================================== */
/* 4 · Agronomía                                                       */
/* ================================================================== */

function SeccionAgronomia({ fila }: { fila: Fila }) {
  const productos = useMemo(() => productosDe(fila), [fila])

  return (
    <Tarjeta className="p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Agronomía</h3>
        <span className="text-xs text-slate-400">
          Caudal {n2(fila.caudal_agua)} m³/h · {n2(fila.horas_riego)} h de riego
        </span>
      </div>

      {productos.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">
          No hay químicos anotados en este lote.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {productos.map((q) => (
            <li
              key={q.codigo ?? q.nombre ?? '—'}
              className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-semibold text-slate-900">
                  {q.codigo && <span className="font-mono text-sm">{q.codigo}</span>}{' '}
                  <span className="text-sm">{q.nombre ?? ''}</span>
                  {q.concentracion && (
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      {q.concentracion}
                    </span>
                  )}
                </p>
                <p className="flex shrink-0 gap-3 text-xs tabular-nums text-slate-500">
                  <span>
                    <strong className="text-slate-900">{n2(q.dosis_mz)}</strong> L/mz
                  </span>
                  <span>
                    <strong className="text-slate-900">{n2(q.ppm)}</strong> ppm
                  </span>
                  <span>
                    L <strong className="text-slate-900">{n2(q.costo)}</strong>
                  </span>
                </p>
              </div>

              {/* Los objetivos, como etiquetas. Es el dato que no existía
                  antes de la 71: contra qué se aplicó de verdad, que no
                  tiene por qué ser lo que dice la etiqueta del bote. */}
              <div className="mt-2 flex flex-wrap gap-1">
                {(q.objetivos ?? []).length === 0 ? (
                  <span className="text-[11px] italic text-slate-400">
                    Sin objetivo de control anotado
                  </span>
                ) : (
                  (q.objetivos ?? []).map((o) => (
                    <span
                      key={o}
                      className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200"
                    >
                      {o}
                    </span>
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  )
}
