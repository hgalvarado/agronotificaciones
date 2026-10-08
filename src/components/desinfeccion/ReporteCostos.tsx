'use client'

/**
 * Pestaña 4 · Reporte gerencial. «La factura contable» por lote.
 *
 * El número que importa aquí es uno solo: **cuánto costó desinfectar este
 * lote y cuánto es eso por manzana.** Lo demás es el desglose que lo hace
 * creíble, y por eso las tres piezas se enseñan siempre, aunque alguna
 * vaya en cero: un total sin desglose no se audita, y nadie firma lo que
 * no puede auditar.
 *
 * Las tres piezas NO se suman igual, y conviene recordarlo al leerlo:
 *
 *   · Químico y mano de obra se reparten entre los lotes de SU EJECUCIÓN,
 *     por manzanas.
 *   · La bolsa de logística se reparte entre las manzanas de SU ZONA en
 *     la temporada. Por eso un lote puede cargar acarreo de un día en que
 *     no se regó: la bolsa es de la zona, no del turno.
 *
 * El reparto lo hace la vista `v_desinfeccion_costos` al leer, no esta
 * pantalla. Aquí sólo se suma lo que ya viene repartido.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alerta, Boton, Tarjeta } from '@/components/ui/Primitivos'
import { DataGrid } from '@/components/ui/DataGrid'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { n2 } from '@/lib/trasplante/formato'
import { canExecuteAction, type Reglas } from '@/lib/permisos/clientABAC'
import { leerCostos, leerPlan } from '@/lib/desinfeccion/repositorioCliente'
import type { FilaCosto, FilaPlan } from '@/lib/desinfeccion/tipos'
import { GraficoComposicion, GraficoPlanReal } from './GraficosCostos'

type Fila = FilaCosto & { id: string }

/** Cuántas tarjetas se dibujan antes de pedir «ver todas». */
const TARJETAS = 9

export function ReporteCostos({
  temporadaId,
  reglas,
  onSinMigracion,
}: {
  temporadaId: string
  reglas: Reglas
  onSinMigracion: (falta: boolean) => void
}) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [plan, setPlan] = useState<FilaPlan[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [todas, setTodas] = useState(false)

  const avisar = useCallback((falta: boolean) => onSinMigracion(falta), [onSinMigracion])

  useEffect(() => {
    let vivo = true
    async function cargar() {
      setCargando(true)
      const [c, p] = await Promise.all([
        leerCostos(temporadaId || null),
        leerPlan(temporadaId || null),
      ])
      if (!vivo) return
      setCargando(false)
      if (c.error) {
        avisar(true)
        setFilas([])
        setPlan([])
        return
      }
      avisar(false)
      setError(null)
      setFilas(c.datos)
      // El plan es para comparar; si no se puede leer, el reporte de
      // costos sigue valiendo y lo único que falta es el gráfico.
      setPlan(p.error ? [] : p.datos)
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [temporadaId, avisar])

  /* ------------------------------ Totales ------------------------------ */

  const total = useMemo(() => {
    const suma = (f: (x: Fila) => number | null) =>
      filas.reduce((a, x) => a + Number(f(x) ?? 0), 0)
    const mz = suma((x) => x.mz_regadas)
    const bruto = suma((x) => x.costo_total)
    return {
      mz,
      quimico: suma((x) => x.costo_quimico),
      personal: suma((x) => x.costo_personal),
      logistica: suma((x) => x.costo_logistica),
      total: bruto,
      // Promedio ponderado, no media de los promedios: el lote de media
      // manzana no pesa lo mismo que el de doce.
      costoMz: mz > 0 ? bruto / mz : null,
      lotes: filas.length,
    }
  }, [filas])

  /** El plan, sumado por lote, para poder comparar contra lo real. */
  const planPorLote = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of plan) {
      m.set(p.lote_temporada_id, (m.get(p.lote_temporada_id) ?? 0) + Number(p.total_costo))
    }
    return m
  }, [plan])

  const composicion = useMemo(
    () =>
      filas.map((f) => ({
        etiqueta: f.lote_nomenclatura,
        quimico: Number(f.costo_quimico ?? 0),
        personal: Number(f.costo_personal ?? 0),
        logistica: Number(f.costo_logistica ?? 0),
      })),
    [filas]
  )

  const planReal = useMemo(
    () =>
      filas.map((f) => ({
        etiqueta: f.lote_nomenclatura,
        plan: planPorLote.get(f.lote_temporada_id) ?? 0,
        real: Number(f.costo_total ?? 0),
      })),
    [filas, planPorLote]
  )

  const ordenadas = useMemo(
    () => [...filas].sort((a, b) => Number(b.costo_total ?? 0) - Number(a.costo_total ?? 0)),
    [filas]
  )

  /* ------------------------------ Columnas ----------------------------- */

  const columnas = useMemo<ColumnaGrid<Fila>[]>(
    () => [
      {
        campo: 'lote_nomenclatura',
        label: 'Lote',
        tipo: 'seleccion',
        ancho: '9rem',
        valor: (f) => f.lote_nomenclatura,
        render: (f) => <span className="font-bold text-slate-900">{f.lote_nomenclatura}</span>,
      },
      { campo: 'lote_nombre', label: 'Nombre', tipo: 'seleccion', valor: (f) => f.lote_nombre },
      { campo: 'zona_nombre', label: 'Zona', tipo: 'seleccion', valor: (f) => f.zona_nombre },
      {
        campo: 'mz_regadas',
        label: 'Mz regadas',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.mz_regadas),
        etiqueta: (f) => n2(f.mz_regadas),
      },
      {
        campo: 'costo_quimico',
        label: 'Químico',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_quimico ?? 0),
        etiqueta: (f) => n2(f.costo_quimico),
      },
      {
        campo: 'costo_personal',
        label: 'Mano de obra',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_personal ?? 0),
        etiqueta: (f) => n2(f.costo_personal),
      },
      {
        campo: 'costo_logistica',
        label: 'Logística',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_logistica ?? 0),
        etiqueta: (f) => n2(f.costo_logistica),
      },
      {
        campo: 'costo_total',
        label: 'Gran total',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_total ?? 0),
        etiqueta: (f) => n2(f.costo_total),
        render: (f) => (
          <span className="font-bold tabular-nums text-slate-900">{n2(f.costo_total)}</span>
        ),
      },
      {
        campo: 'costo_mz',
        label: 'Costo/mz',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_mz ?? 0),
        etiqueta: (f) => n2(f.costo_mz),
        render: (f) => (
          <span className="font-bold tabular-nums text-brand-700">{n2(f.costo_mz)}</span>
        ),
      },
      {
        campo: 'plan',
        label: 'Costo planificado',
        tipo: 'numero',
        numero: true,
        valor: (f) => planPorLote.get(f.lote_temporada_id) ?? 0,
        etiqueta: (f) => n2(planPorLote.get(f.lote_temporada_id) ?? 0),
      },
    ],
    [planPorLote]
  )

  /* -------------------------------- Vista ------------------------------ */

  return (
    <div className="flex flex-col gap-4">
      {error && <Alerta>{error}</Alerta>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Cifra etiqueta="Lotes" valor={String(total.lotes)} />
        <Cifra etiqueta="Manzanas regadas" valor={n2(total.mz)} />
        <Cifra etiqueta="Gran total" valor={`L ${n2(total.total)}`} destacado />
        <Cifra
          etiqueta="Costo por manzana"
          valor={total.costoMz === null ? '—' : `L ${n2(total.costoMz)}`}
          destacado
        />
        <Cifra
          etiqueta="Logística absorbida"
          valor={`L ${n2(total.logistica)}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Tarjeta className="p-4">
          <h3 className="text-sm font-semibold text-slate-900">De qué está hecho el costo</h3>
          <p className="mb-3 text-xs text-slate-400">
            Químico y mano de obra se reparten dentro de su turno; el acarreo, dentro de su zona.
          </p>
          <GraficoComposicion filas={composicion} />
        </Tarjeta>

        <Tarjeta className="p-4">
          <h3 className="text-sm font-semibold text-slate-900">Plan contra real</h3>
          <p className="mb-3 text-xs text-slate-400">
            El plan sólo cuenta el químico presupuestado; lo real lleva además cuadrilla y acarreo,
            así que lo normal es que lo real sea mayor.
          </p>
          <GraficoPlanReal filas={planReal} />
        </Tarjeta>
      </div>

      {/* La factura, lote por lote. */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Desglose por lote</h3>
          {ordenadas.length > TARJETAS && (
            <Boton variante="fantasma" tamano="sm" onClick={() => setTodas((v) => !v)}>
              {todas ? 'Ver sólo los mayores' : `Ver los ${ordenadas.length}`}
            </Boton>
          )}
        </div>

        {ordenadas.length === 0 && !cargando && (
          <Alerta tono="azul">
            Todavía no hay costos: hacen falta turnos ejecutados con sus lotes regados.
          </Alerta>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(todas ? ordenadas : ordenadas.slice(0, TARJETAS)).map((f) => (
            <TarjetaLote key={f.id} fila={f} plan={planPorLote.get(f.lote_temporada_id) ?? null} />
          ))}
        </div>
      </div>

      <DataGrid<Fila>
        filas={filas}
        cargando={cargando}
        columnas={columnas}
        titulo="Costos de desinfección por lote"
        nombreArchivo="desinfeccion-costos"
        ordenInicial={{ campo: 'costo_total', direccion: 'desc' }}
        minAncho="1400px"
        seleccionable={false}
        puedeExportar={canExecuteAction(reglas, 'desinfeccion', 'exportar')}
        vacio={{
          titulo: 'Sin costos todavía',
          descripcion: 'El costo aparece cuando un turno ejecutado tiene lotes regados.',
        }}
      />
    </div>
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
    <Tarjeta className="px-3.5 py-3">
      <p
        className={`text-xl font-bold tracking-tight tabular-nums ${
          destacado ? 'text-brand-700' : 'text-slate-900'
        }`}
      >
        {valor}
      </p>
      <p className="text-[11px] font-medium text-slate-400">{etiqueta}</p>
    </Tarjeta>
  )
}

/** Un lote con su desglose entero. Es lo que se lleva a gerencia. */
function TarjetaLote({ fila, plan }: { fila: Fila; plan: number | null }) {
  const real = Number(fila.costo_total ?? 0)
  const excedido = plan !== null && plan > 0 && real > plan

  return (
    <Tarjeta className="flex flex-col gap-2 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">{fila.lote_nomenclatura}</p>
          <p className="truncate text-xs text-slate-400">
            {fila.lote_nombre ?? '—'} · {fila.zona_nombre ?? 'sin zona'}
          </p>
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">
          {n2(fila.mz_regadas)} mz
        </span>
      </div>

      <dl className="flex flex-col gap-1 border-t border-slate-100 pt-2 text-xs">
        <Renglon etiqueta="Químico" valor={fila.costo_quimico} />
        <Renglon etiqueta="Mano de obra" valor={fila.costo_personal} />
        <Renglon etiqueta="Logística absorbida" valor={fila.costo_logistica} />
      </dl>

      <div className="flex items-baseline justify-between gap-2 border-t border-slate-200 pt-2">
        <span className="text-xs font-semibold text-slate-500">Gran total</span>
        <span className="text-base font-bold tabular-nums text-slate-900">
          L {n2(fila.costo_total)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-slate-500">Costo por manzana</span>
        <span className="text-sm font-bold tabular-nums text-brand-700">L {n2(fila.costo_mz)}</span>
      </div>

      {plan !== null && plan > 0 && (
        <p className={`text-[11px] ${excedido ? 'font-semibold text-red-700' : 'text-slate-400'}`}>
          Planificado L {n2(plan)}
          {excedido ? ` · ${n2(real - plan)} por encima` : ''}
        </p>
      )}
    </Tarjeta>
  )
}

function Renglon({ etiqueta, valor }: { etiqueta: string; valor: number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-slate-500">{etiqueta}</dt>
      <dd className="font-semibold tabular-nums text-slate-700">L {n2(valor)}</dd>
    </div>
  )
}
