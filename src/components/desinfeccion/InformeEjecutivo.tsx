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
  cuadrillaDe,
  dossierDe,
  ejecucionesDe,
  etapasDe,
  logisticaDe,
  nombreFase,
  planContraReal,
  productosDe,
  retrasoDias,
  tonoDelta,
  type FilaInforme,
  type Tono,
} from '@/lib/desinfeccion/informe'
import { informeEjecutivoPdf, nombreInforme } from '@/lib/desinfeccion/informePdf'
import { CronogramaEtapas } from './GraficosInforme'

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
    [onSinMigracion],
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
    [filas, zonaId],
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
    [visibles, elegido],
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
            <Selector value={fila?.id ?? ''} buscable onChange={(e) => setElegido(e.target.value)}>
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
          <SeccionDossier fila={fila} />
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
          {fila.lote_nombre && (
            <span className="font-normal text-slate-400"> · {fila.lote_nombre}</span>
          )}
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
          {/* Con qué se aplicó (migración 75). Va en la cabecera y no en
              una tarjeta: es contexto del turno, como la zona o la
              variedad, y es lo primero que se pregunta cuando un turno
              sale raro. */}
          {fila.equipo_aplicacion && (
            <>
              <span aria-hidden>·</span>
              <span>{fila.equipo_aplicacion}</span>
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
  const etapas = useMemo(() => etapasDe(fila), [fila])
  const retraso = retrasoDias(fila)

  return (
    <Tarjeta className="p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          Cronograma operativo · Plan vs. Real
        </h3>
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
      <CronogramaEtapas etapas={etapas} />
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
        titulo="Químico de aplicación"
        plan={fila.costo_plan === null ? null : `L ${n2(fila.costo_plan)}`}
        real={`L ${n2(fila.costo_quimico_aplicacion)}`}
        delta={fila.delta_costo === null ? null : `L ${conSigno(fila.delta_costo)}`}
        pct={fila.delta_costo_pct}
        pie="El plan sólo presupuesta químico de aplicación: se compara contra eso, no contra el costo total."
      />
    </div>
  )
}

/**
 * Lo planificado contra lo real, con su desviación. **Compacta.**
 *
 * ── Por qué cabe en una fila ────────────────────────────────────────
 *
 * Antes esta tarjeta gastaba cuatro renglones —rótulo, plan, flecha,
 * real— y una banda más para la desviación. Dos de ellas empujaban la
 * radiografía y el expediente fuera de la primera pantalla del móvil,
 * que es donde se lee el informe. Plan y real caben en un renglón
 * separados por una flecha, y la desviación entra en la misma línea del
 * rótulo: lo que se lee primero es el número grande y su color.
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
  pie,
}: {
  titulo: string
  plan: string | null
  real: string
  delta: string | null
  pct: number | null
  pie?: string
}) {
  const tono = tonoDelta(pct)

  return (
    <Tarjeta className="p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {titulo}
        </p>
        {/* La desviación lleva el signo Y el color: el color solo no se
            ve en una impresión en blanco y negro, y el signo solo no
            salta a la vista en una pantalla llena de números. */}
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ${CLASES[tono]}`}
        >
          {pct === null ? 'Sin plan' : `${conSigno(pct, 1)}%`}
        </span>
      </div>

      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xl font-bold tabular-nums text-slate-900">{real}</span>
        <span className="text-[11px] text-slate-400">
          plan {plan ?? '—'}
          {delta ? ` · ${delta}` : ''}
        </span>
      </p>

      {pie && <p className="mt-1 text-[11px] leading-snug text-slate-400">{pie}</p>}
    </Tarjeta>
  )
}

/* ================================================================== */
/* 3 · Radiografía financiera                                          */
/* ================================================================== */

/**
 * ── Por qué ya no hay barra apilada ─────────────────────────────────
 *
 * La barra decía «98 % químico, 2 % acarreo» y ahí se acababa. Con tres
 * conceptos de los que uno se lleva casi todo, la proporción no es la
 * pregunta: ya se sabe que el químico manda. Lo que nadie podía contestar
 * mirando esa barra era **de dónde salió cada lempira** —qué producto,
 * qué cuadrilla, qué acarreo—, que es justo lo que se discute cuando el
 * número no cuadra.
 *
 * Así que en su lugar van tres paneles con el detalle, cada uno con su
 * total al pie. La proporción se sigue leyendo —los tres totales están
 * uno al lado del otro— y además se puede auditar.
 */
function SeccionFinanciera({ fila }: { fila: Fila }) {
  const productos = useMemo(() => productosDe(fila), [fila])
  const cuadrilla = useMemo(() => cuadrillaDe(fila), [fila])
  const acarreos = useMemo(() => logisticaDe(fila), [fila])

  return (
    <Tarjeta className="p-4">
      <h3 className="text-sm font-semibold text-slate-900">Radiografía financiera</h3>
      <p className="mb-3 text-xs text-slate-400">
        Dónde se fue el dinero de este lote, línea por línea. El químico y la mano de obra del turno
        se reparten entre sus lotes por manzanas cubiertas; el acarreo, según se haya cargado a la
        zona o directo al lote.
      </p>

      <div className="flex flex-col gap-3">
        {/* ---------------- 1 · Químicos, prorrateados al lote --------- */}
        <Panel titulo="Detalle de químicos" pie="Prorrateado al lote" total={Number(fila.costo_quimico ?? 0)}>
          <Tabla
            cabeceras={['Producto', 'Fase', 'Litros lote', 'Dosis/mz', 'Costo/L', 'Costo lote']}
            vacio="No hay químicos anotados en este lote."
            filas={productos.map((q) => [
              `${q.codigo ?? ''} ${q.nombre ?? ''}`.trim() || '—',
              q.fase ? nombreFase(q.fase) : '—',
              `${n2(q.litros_lote ?? q.litros)}${
                q.litros_turno !== null && q.litros_turno !== undefined
                  ? ` de ${n2(q.litros_turno)}`
                  : ''
              }`,
              n2(q.dosis_mz),
              n2(q.costo_litro),
              `L ${n2(q.costo_lote ?? q.costo)}`,
            ])}
          />
        </Panel>

        {/* ---------------- 2 · Mano de obra, por fase ----------------- */}
        <Panel
          titulo="Detalle de mano de obra por fase"
          pie="Prorrateado al lote"
          total={Number(fila.costo_personal ?? 0)}
          insignia={fila.fase_mas_cara ? `Fase más cara: ${fila.fase_mas_cara}` : null}
        >
          {/* El resumen por fase va antes que los puestos: la pregunta
              que más se repite en gerencia es cuál fase pesó más, y el
              preriego —mucha gente pocas horas— no es evidente. */}
          <dl className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {[
              ['Preriego', fila.costo_personal_preriego],
              ['Aplicación', fila.costo_personal_aplicacion],
              ['Lavado de cinta', fila.costo_personal_lavado],
            ].map(([etiqueta, valor]) => (
              <span key={String(etiqueta)} className="flex gap-1.5">
                <dt className="text-slate-400">{etiqueta}</dt>
                <dd className="font-semibold tabular-nums text-slate-900">
                  L {n2(Number(valor ?? 0))}
                </dd>
              </span>
            ))}
          </dl>

          <Tabla
            cabeceras={['Puesto', 'Fase', 'Personas', 'H. extras', 'Jornada', 'Costo lote']}
            vacio="No se anotó cuadrilla en este lote."
            filas={cuadrilla.map((c) => [
              c.puesto_texto ?? c.operador_nombre ?? 'Sin puesto',
              nombreFase(c.fase),
              n2(c.cantidad_personas),
              n2(c.horas_extras),
              c.jornada_tipo ?? '—',
              `L ${n2(c.costo_lote)}`,
            ])}
          />
        </Panel>

        {/* ---------------- 3 · Logística y acarreo -------------------- */}
        <Panel
          titulo="Detalle de logística y acarreo"
          pie="Lo que este lote absorbió en este ciclo"
          total={Number(fila.costo_logistica ?? 0)}
        >
          <Tabla
            cabeceras={['Fecha', 'Cargo', 'Equipo', 'Implemento', 'Operador', 'Horas', 'Costo lote']}
            vacio="No hay acarreos que le toquen a este lote."
            filas={acarreos.map((a) => [
              a.fecha ?? '—',
              a.tipo_cargo === 'lote' ? 'Cargo directo al lote' : 'Prorrateo zonal',
              a.equipo_nombre ?? '—',
              a.implemento_nombre ?? '—',
              a.operador_nombre ?? '—',
              n2(a.horas_trabajo),
              `L ${n2(a.costo_lote)}`,
            ])}
          />
        </Panel>
      </div>
    </Tarjeta>
  )
}

/**
 * Una tabla del expediente.
 *
 * Con desplazamiento horizontal propio: a 390 px, seis columnas no caben
 * y estrujarlas hace ilegible la que importa. Un carril que se arrastra
 * deja las cifras a su tamaño y no rompe el ancho de la página, que es
 * lo que de verdad no se puede permitir en un teléfono.
 */
function Tabla({
  cabeceras,
  filas,
  vacio,
}: {
  cabeceras: string[]
  filas: string[][]
  vacio: string
}) {
  if (filas.length === 0) {
    return <p className="py-3 text-center text-[11px] italic text-slate-400">{vacio}</p>
  }

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[34rem] border-collapse text-[11px]">
        <thead>
          <tr>
            {cabeceras.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={`border-b border-slate-200 pb-1 font-semibold uppercase tracking-wide text-slate-400 ${
                  i === 0 ? 'text-left' : 'text-right'
                }`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0">
              {f.map((celda, j) => (
                <td
                  key={j}
                  className={`py-1 ${
                    j === 0
                      ? 'pr-2 text-left font-semibold text-slate-900'
                      : j === f.length - 1
                        ? 'pl-2 text-right font-bold tabular-nums text-slate-900'
                        : 'pl-2 text-right tabular-nums text-slate-500'
                  }`}
                >
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Un panel del desglose, con su total al pie. */
function Panel({
  titulo,
  pie,
  total,
  insignia,
  children,
}: {
  titulo: string
  pie: string
  total: number
  insignia?: string | null
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold text-slate-900">{titulo}</h4>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{pie}</p>
        </div>
        {insignia && (
          <span className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
            {insignia}
          </span>
        )}
      </div>

      {children}

      <p className="mt-2 flex items-baseline justify-between border-t border-slate-200 pt-2">
        <span className="text-[11px] font-semibold text-slate-500">Total</span>
        <span className="text-base font-bold tabular-nums text-slate-900">L {n2(total)}</span>
      </p>
    </section>
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

/* ================================================================== */
/* 5 · Detalle operativo del lote por fase (Plan vs. Real)             */
/* ================================================================== */

/**
 * El expediente del lote, fase por fase.
 *
 * ── Qué contesta que no conteste nada de lo de arriba ───────────────
 *
 * Lo anterior son totales: cuánto costó, cuánta dosis, cuándo se hizo.
 * Cuando uno de esos números no cuadra, la discusión baja siempre al
 * mismo sitio —«¿pero qué se echó en el preriego?», «¿cuántos estuvieron
 * en el lavado?»— y hasta ahora eso obligaba a salirse del informe y
 * abrir la captura turno por turno.
 *
 * Aquí están las CUATRO fases, siempre las cuatro. Una fase que no se
 * hizo se dice que no se hizo: el hueco es un dato, y esconderlo deja al
 * lector preguntándose si falta la fase o falta el renglón.
 *
 * El plan se enseña al lado porque es contra lo que se mide, y porque el
 * plan sólo existe para la aplicación: verlo vacío en las otras tres
 * explica por qué la desviación no se calcula para ellas.
 */
function SeccionDossier({ fila }: { fila: Fila }) {
  const fases = useMemo(() => dossierDe(fila), [fila])
  const etapas = useMemo(() => etapasDe(fila), [fila])
  const pares = useMemo(() => planContraReal(fila), [fila])

  /** El DDT de la etapa que corresponde a cada fase, para el encabezado. */
  const ddtDe: Record<string, 'preriego' | 'lecturas' | 'aplicacion' | 'lavado'> = {
    '1_Preriego': 'preriego',
    '2_Lecturas': 'lecturas',
    '3_Aplicacion': 'aplicacion',
    '4_Lavado': 'lavado',
  }

  return (
    <Tarjeta className="p-4">
      <h3 className="text-sm font-semibold text-slate-900">
        Detalle operativo del lote por fase (Plan vs. Real)
      </h3>
      <p className="mb-3 text-xs text-slate-400">
        Las cuatro fases del ciclo con lo que de verdad se hizo: el reloj, el agua, la conductividad
        y la calibración de cada turno, los químicos ya prorrateados a este lote y la cuadrilla que
        estuvo.
      </p>

      <div className="flex flex-col gap-3">
        {fases.map((f) => {
          const etapa = etapas.find((e) => e.clave === ddtDe[f.clave])
          return (
            <section
              key={f.clave}
              className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h4 className="text-xs font-semibold text-slate-900">{f.etiqueta}</h4>
                {f.vacia ? (
                  <span className="text-[11px] italic text-slate-400">
                    No se registró esta fase
                  </span>
                ) : (
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-slate-500">
                    {etapa && (etapa.ddtPlan !== null || etapa.ddtReal !== null) && (
                      <span>
                        DDT plan {etapa.ddtPlan ?? '—'} · real{' '}
                        <strong className="text-slate-900">{etapa.ddtReal ?? '—'}</strong>
                      </span>
                    )}
                    {etapa?.desfase !== null && etapa?.desfase !== undefined && (
                      <span
                        className={
                          Math.abs(etapa.desfase) > 7 ? 'text-amber-700' : 'text-slate-500'
                        }
                      >
                        {conSigno(etapa.desfase, 0)} d
                      </span>
                    )}
                    <span>
                      Químico <strong className="text-slate-900">L {n2(f.costoQuimico)}</strong>
                    </span>
                    <span>
                      Cuadrilla <strong className="text-slate-900">L {n2(f.costoCuadrilla)}</strong>
                    </span>
                  </span>
                )}
              </div>

              {!f.vacia && (
                <>
                  {/* Lo operativo: el reloj, el agua, la CE, la
                      calibración. Es lo que se discute cuando un turno
                      sale raro, y hasta ahora obligaba a salirse del
                      informe y abrir la captura. */}
                  {f.datos.length > 0 && (
                    <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                      {f.datos.map((d) => (
                        <div
                          key={d.etiqueta}
                          className="flex items-baseline justify-between gap-2 border-b border-slate-200/70 pb-0.5 text-[11px]"
                        >
                          <dt className="min-w-0 truncate text-slate-400">{d.etiqueta}</dt>
                          <dd className="shrink-0 font-semibold tabular-nums text-slate-900">
                            {d.valor}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {/* **La comparativa del plan sólo en la fase 3**: es la
                      única que el plan presupuesta. Repetirla en las
                      otras tres dejaría tres tablas vacías. */}
                  {f.clave === '3_Aplicacion' && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Químicos · plan contra real
                      </p>
                      <Tabla
                        cabeceras={[
                          'Producto',
                          'Dosis plan',
                          'Dosis real',
                          'Litros plan',
                          'Litros real',
                          'Costo plan',
                          'Costo real',
                        ]}
                        vacio="Este lote se desinfectó sin plan: no hay contra qué medirlo."
                        filas={pares.map((x) => [
                          `${x.codigo}${x.nombre ? ` · ${x.nombre}` : ''}`,
                          x.dosisPlan === null ? '—' : n2(x.dosisPlan),
                          x.dosisReal === null ? '—' : n2(x.dosisReal),
                          x.litrosPlan === null ? '—' : n2(x.litrosPlan),
                          x.litrosReal === null ? '—' : n2(x.litrosReal),
                          x.costoPlan === null ? '—' : `L ${n2(x.costoPlan)}`,
                          x.costoReal === null ? '—' : `L ${n2(x.costoReal)}`,
                        ])}
                      />
                    </div>
                  )}

                  {f.clave !== '3_Aplicacion' && f.productos.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Químicos
                      </p>
                      <Tabla
                        cabeceras={['Producto', 'Litros lote', 'Litros turno', 'Costo lote']}
                        vacio="Sin químicos en esta fase."
                        filas={f.productos.map((q) => [
                          `${q.codigo ?? ''} ${q.nombre ?? ''}`.trim() || '—',
                          n2(q.litros_lote ?? q.litros),
                          q.litros_turno === null || q.litros_turno === undefined
                            ? '—'
                            : n2(q.litros_turno),
                          `L ${n2(q.costo_lote ?? q.costo)}`,
                        ])}
                      />
                    </div>
                  )}

                  {f.cuadrilla.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Cuadrilla
                      </p>
                      <Tabla
                        cabeceras={['Puesto', 'Personas', 'H. extras', 'Jornada', 'Costo lote']}
                        vacio="Sin cuadrilla en esta fase."
                        filas={f.cuadrilla.map((c) => [
                          c.puesto_texto ?? c.operador_nombre ?? 'Sin puesto',
                          n2(c.cantidad_personas),
                          n2(c.horas_extras),
                          c.jornada_tipo ?? '—',
                          `L ${n2(c.costo_lote)}`,
                        ])}
                      />
                    </div>
                  )}
                </>
              )}
            </section>
          )
        })}
      </div>

      <TurnosDelLote fila={fila} />
    </Tarjeta>
  )
}

/**
 * Los turnos que regaron este lote, con el factor del reparto.
 *
 * Es la pieza que permite AUDITAR todo lo anterior: si alguien discute
 * una dosis, aquí están las manzanas del lote, las del turno completo y
 * la fracción que salió de dividirlas. Sin esto, el prorrateo es un
 * número que hay que creerse.
 */
function TurnosDelLote({ fila }: { fila: Fila }) {
  const turnos = useMemo(() => ejecucionesDe(fila), [fila])
  if (turnos.length === 0) return null

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <h4 className="text-xs font-semibold text-slate-900">Turnos que regaron este lote</h4>
      <p className="text-[11px] text-slate-400">
        El factor es las manzanas del lote entre las del turno: es con lo que se reparten litros y
        costos.
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {turnos.map((t, i) => (
          <li
            key={`${t.turno_codigo ?? '—'}-${i}`}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] ring-1 ring-inset ring-slate-200"
          >
            <span className="font-semibold text-slate-900">
              {t.turno_codigo ?? ''} {t.turno_nombre ?? ''}
            </span>
            <span className="tabular-nums text-slate-500">
              {n2(t.mz_cubiertas)} de {n2(t.mz_total_turno)} mz · factor{' '}
              {Number(t.factor_lote ?? 0).toFixed(4)}
            </span>
            <span className="tabular-nums text-slate-400">
              {t.fecha_aplicacion ?? '—'}
              {t.estacion_nombre ? ` · ${t.estacion_nombre}` : ''}
              {t.agua_total_m3 ? ` · ${n2(t.agua_total_m3)} m³` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
