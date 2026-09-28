'use client'

/**
 * Los cinco resúmenes de la rotación.
 *
 * Todos son la misma cuadrícula —se filtran, se ordenan y se exportan
 * igual— porque son la misma pregunta mirada desde cinco sitios: qué se
 * planificó y qué se hizo, por variedad, por zona, por lote y por cómo
 * se sembró.
 *
 * Las cuentas vienen sumadas de la BASE y no de las filas de la
 * pantalla: un porcentaje recalculado sobre lo que está a la vista
 * cambiaría al filtrar la tabla, y entonces dos personas mirando la
 * misma pantalla leerían números distintos.
 */

import { useState } from 'react'
import { DataGrid } from '@/components/ui/DataGrid'
import { Insignia } from '@/components/ui/Primitivos'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import {
  etiquetaTipoSiembra,
  n0,
  n2,
  pct,
  type FilaAvance,
  type FilaPorLote,
  type FilaPorTipoSiembra,
  type FilaPorVariedad,
  type FilaPorZona,
} from '@/lib/rotacion/tipos'

type Vista = 'dia' | 'variedad' | 'zona' | 'lote' | 'tipo'

const VISTAS: [Vista, string][] = [
  ['dia', 'Avance del día'],
  ['variedad', 'Por variedad'],
  ['zona', 'Por zona'],
  ['lote', 'Por lote'],
  ['tipo', 'Por tipo de siembra'],
]

/** El `id` que la cuadrícula necesita, sobre filas que no lo traen. */
const conId = <T,>(filas: T[], llave: (f: T, i: number) => string) =>
  filas.map((f, i) => ({ ...f, id: llave(f, i) }))

export function Reportes({
  avance,
  porVariedad,
  porZona,
  porLote,
  porTipo,
  corte,
}: {
  avance: FilaAvance[]
  porVariedad: FilaPorVariedad[]
  porZona: FilaPorZona[]
  porLote: FilaPorLote[]
  porTipo: FilaPorTipoSiembra[]
  corte: string
}) {
  // Una tabla a la vez y no las cinco apiladas: en un teléfono, cinco
  // tablas son cinco pantallas de desplazamiento antes de llegar a la
  // que se venía a ver, y la pregunta que trae a alguien aquí es UNA.
  const [vista, setVista] = useState<Vista>('dia')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {VISTAS.map(([valor, etiqueta]) => (
          <button
            key={valor}
            onClick={() => setVista(valor)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
              vista === valor
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:text-slate-900'
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {vista === 'dia' && <TablaDia filas={avance} corte={corte} />}
      {vista === 'variedad' && <TablaVariedad filas={porVariedad} />}
      {vista === 'zona' && <TablaZona filas={porZona} />}
      {vista === 'lote' && <TablaLote filas={porLote} />}
      {vista === 'tipo' && <TablaTipo filas={porTipo} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 1 · El detalle del rango                                            */
/* ------------------------------------------------------------------ */

function TablaDia({ filas, corte }: { filas: FilaAvance[]; corte: string }) {
  const columnas: ColumnaGrid<FilaAvance>[] = [
    { campo: 'fecha', label: 'Fecha', tipo: 'fecha', valor: (f) => f.fecha },
    { campo: 'ut', label: 'Lote', tipo: 'seleccion', valor: (f) => f.ut },
    { campo: 'zona', label: 'Zona', tipo: 'seleccion', valor: (f) => f.zona },
    { campo: 'variedad', label: 'Variedad', tipo: 'seleccion', valor: (f) => f.variedad },
    { campo: 'producto', label: 'Producto', tipo: 'seleccion', valor: (f) => f.producto },
    {
      campo: 'avance_mz',
      label: 'Avance (mz)',
      tipo: 'numero',
      numero: true,
      valor: (f) => Number(f.avance_mz),
      etiqueta: (f) => n2(f.avance_mz),
    },
    {
      campo: 'semilla_mz',
      label: 'Semilla / mz',
      tipo: 'numero',
      numero: true,
      valor: (f) => (f.semilla_mz === null ? null : Number(f.semilla_mz)),
      etiqueta: (f) => n2(f.semilla_mz),
    },
    {
      campo: 'tipo_siembra',
      label: 'Tipo',
      tipo: 'seleccion',
      valor: (f) => f.tipo_siembra,
      etiqueta: (f) => etiquetaTipoSiembra(f.tipo_siembra),
      render: (f) => <Insignia tono="azul">{etiquetaTipoSiembra(f.tipo_siembra)}</Insignia>,
    },
    {
      campo: 'costo_total',
      label: 'Costo total',
      tipo: 'numero',
      numero: true,
      valor: (f) => (f.costo_total === null ? null : Number(f.costo_total)),
      etiqueta: (f) => n2(f.costo_total),
    },
    {
      campo: 'usuario_nombre',
      label: 'Registró',
      tipo: 'seleccion',
      valor: (f) => f.usuario_nombre,
    },
  ]

  return (
    <DataGrid<FilaAvance>
      filas={filas}
      columnas={columnas}
      titulo="Avance del día"
      nombreArchivo={`rotacion-avance-al-${corte}`}
      ordenInicial={{ campo: 'fecha', direccion: 'desc' }}
      minAncho="1400px"
      seleccionable={false}
      vacio={{ titulo: 'Sin avance hasta la fecha de corte' }}
      resumen={(v) => (
        <>
          <strong className="text-slate-900">
            {n2(v.reduce((a, f) => a + Number(f.avance_mz), 0))} mz
          </strong>{' '}
          en {v.length} {v.length === 1 ? 'registro' : 'registros'} · L{' '}
          {n2(v.reduce((a, f) => a + Number(f.costo_total ?? 0), 0))}
        </>
      )}
    />
  )
}

/* ------------------------------------------------------------------ */
/* 2 · Por variedad                                                    */
/* ------------------------------------------------------------------ */

type ConId<T> = T & { id: string }

function TablaVariedad({ filas }: { filas: FilaPorVariedad[] }) {
  const datos = conId(filas, (f) => f.variedad)
  const columnas: ColumnaGrid<ConId<FilaPorVariedad>>[] = [
    { campo: 'variedad', label: 'Variedad', tipo: 'seleccion', valor: (f) => f.variedad },
    { campo: 'producto', label: 'Producto', tipo: 'seleccion', valor: (f) => f.producto },
    ...columnasPlanReal<ConId<FilaPorVariedad>>(),
    {
      campo: 'gasto_semilla',
      label: 'Semilla usada',
      tipo: 'numero',
      numero: true,
      valor: (f) => Number(f.gasto_semilla),
      etiqueta: (f) => n2(f.gasto_semilla),
    },
    {
      campo: 'semilla_mz',
      label: 'Semilla / mz',
      tipo: 'numero',
      numero: true,
      valor: (f) => (f.semilla_mz === null ? null : Number(f.semilla_mz)),
      etiqueta: (f) => n2(f.semilla_mz),
    },
    columnaCosto<ConId<FilaPorVariedad>>(),
  ]

  return (
    <DataGrid<ConId<FilaPorVariedad>>
      filas={datos}
      columnas={columnas}
      titulo="Resumen por variedad"
      nombreArchivo="rotacion-por-variedad"
      ordenInicial={{ campo: 'area_real', direccion: 'desc' }}
      minAncho="1200px"
      seleccionable={false}
      vacio={{ titulo: 'Sin datos' }}
    />
  )
}

/* ------------------------------------------------------------------ */
/* 3 · Por zona                                                        */
/* ------------------------------------------------------------------ */

function TablaZona({ filas }: { filas: FilaPorZona[] }) {
  const datos = conId(filas, (f) => f.zona)
  const columnas: ColumnaGrid<ConId<FilaPorZona>>[] = [
    { campo: 'zona', label: 'Zona', tipo: 'seleccion', valor: (f) => f.zona },
    { campo: 'encargado', label: 'Encargado', tipo: 'seleccion', valor: (f) => f.encargado },
    {
      campo: 'lotes',
      label: 'Lotes',
      tipo: 'numero',
      numero: true,
      valor: (f) => Number(f.lotes),
      etiqueta: (f) => n0(f.lotes),
    },
    ...columnasPlanReal<ConId<FilaPorZona>>(),
    columnaCosto<ConId<FilaPorZona>>(),
  ]

  return (
    <DataGrid<ConId<FilaPorZona>>
      filas={datos}
      columnas={columnas}
      titulo="Resumen por zona"
      nombreArchivo="rotacion-por-zona"
      ordenInicial={{ campo: 'area_real', direccion: 'desc' }}
      minAncho="1100px"
      seleccionable={false}
      vacio={{ titulo: 'Sin datos' }}
    />
  )
}

/* ------------------------------------------------------------------ */
/* 4 · Por lote: lo planificado contra lo hecho                        */
/* ------------------------------------------------------------------ */

function TablaLote({ filas }: { filas: FilaPorLote[] }) {
  const datos = conId(filas, (f) => f.lote_temporada_id)
  const columnas: ColumnaGrid<ConId<FilaPorLote>>[] = [
    { campo: 'ut', label: 'Lote', tipo: 'seleccion', valor: (f) => f.ut },
    {
      campo: 'lote_nombre',
      label: 'Nomenclatura',
      tipo: 'seleccion',
      valor: (f) => f.lote_nombre,
    },
    { campo: 'zona', label: 'Zona', tipo: 'seleccion', valor: (f) => f.zona },
    {
      campo: 'variedad_plan',
      label: 'Variedad planificada',
      tipo: 'seleccion',
      valor: (f) => f.variedad_plan,
    },
    {
      campo: 'variedad_real',
      label: 'Variedad sembrada',
      tipo: 'seleccion',
      valor: (f) => f.variedad_real,
      // Se dice en la celda y no sólo con el color de la fila: en el
      // Excel exportado el color no viaja y la diferencia es justo lo
      // que se manda a revisar.
      render: (f) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate">{f.variedad_real ?? '—'}</span>
          {f.coincide === false && <Insignia tono="ambar">Cambió</Insignia>}
        </span>
      ),
    },
    ...columnasPlanReal<ConId<FilaPorLote>>(),
    columnaCosto<ConId<FilaPorLote>>(),
  ]

  return (
    <DataGrid<ConId<FilaPorLote>>
      filas={datos}
      columnas={columnas}
      titulo="Resumen por lote"
      nombreArchivo="rotacion-por-lote"
      ordenInicial={{ campo: 'ut', direccion: 'asc' }}
      minAncho="1500px"
      seleccionable={false}
      vacio={{ titulo: 'Sin datos' }}
      // Ámbar donde el lote lleva una variedad distinta de la
      // planificada: no es un error, es una decisión de campo, pero
      // tiene que verse sin buscarla.
      resaltar={(f) => (f.coincide === false ? 'bg-amber-50/70' : null)}
      resumen={(v) => {
        const cambiados = v.filter((f) => f.coincide === false).length
        return (
          <>
            {v.length} {v.length === 1 ? 'lote' : 'lotes'}
            {cambiados > 0 && (
              <span className="ml-1 font-semibold text-amber-700">
                · {cambiados} con variedad distinta a la planificada
              </span>
            )}
          </>
        )
      }}
    />
  )
}

/* ------------------------------------------------------------------ */
/* 5 · Por tipo de siembra y costos                                    */
/* ------------------------------------------------------------------ */

function TablaTipo({ filas }: { filas: FilaPorTipoSiembra[] }) {
  const datos = conId(filas, (f) => f.tipo_siembra)
  const columnas: ColumnaGrid<ConId<FilaPorTipoSiembra>>[] = [
    {
      campo: 'tipo_siembra',
      label: 'Tipo de siembra',
      tipo: 'seleccion',
      valor: (f) => f.tipo_siembra,
      etiqueta: (f) => etiquetaTipoSiembra(f.tipo_siembra),
      render: (f) => <Insignia tono="azul">{etiquetaTipoSiembra(f.tipo_siembra)}</Insignia>,
    },
    {
      campo: 'lineas',
      label: 'Registros',
      tipo: 'numero',
      numero: true,
      valor: (f) => Number(f.lineas),
      etiqueta: (f) => n0(f.lineas),
    },
    {
      campo: 'area_real',
      label: 'Área (mz)',
      tipo: 'numero',
      numero: true,
      valor: (f) => Number(f.area_real),
      etiqueta: (f) => n2(f.area_real),
    },
    {
      campo: 'pct_area',
      label: '% del área',
      tipo: 'numero',
      numero: true,
      valor: (f) => (f.pct_area === null ? null : Number(f.pct_area)),
      etiqueta: (f) => pct(f.pct_area),
    },
    {
      campo: 'costo_mz',
      label: 'Costo / mz',
      tipo: 'numero',
      numero: true,
      valor: (f) => (f.costo_mz === null ? null : Number(f.costo_mz)),
      etiqueta: (f) => n2(f.costo_mz),
      render: (f) => (
        <span className="font-semibold tabular-nums text-slate-900">L {n2(f.costo_mz)}</span>
      ),
    },
    columnaCosto<ConId<FilaPorTipoSiembra>>(),
  ]

  return (
    <DataGrid<ConId<FilaPorTipoSiembra>>
      filas={datos}
      columnas={columnas}
      titulo="Resumen por tipo de siembra"
      nombreArchivo="rotacion-por-tipo-siembra"
      ordenInicial={{ campo: 'costo_total', direccion: 'desc' }}
      minAncho="1000px"
      seleccionable={false}
      vacio={{ titulo: 'Sin datos' }}
      resumen={(v) => (
        <>
          <strong className="text-slate-900">
            L {n2(v.reduce((a, f) => a + Number(f.costo_total), 0))}
          </strong>{' '}
          en {n2(v.reduce((a, f) => a + Number(f.area_real), 0))} mz
        </>
      )}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Las tres columnas que comparten los cuatro resúmenes                */
/* ------------------------------------------------------------------ */

type ConPlanReal = { area_plan: number; area_real: number; pct: number | null }

function columnasPlanReal<T extends ConPlanReal>(): ColumnaGrid<T>[] {
  return [
    {
      campo: 'area_plan',
      label: 'Área plan (mz)',
      tipo: 'numero',
      numero: true,
      valor: (f) => Number(f.area_plan),
      etiqueta: (f) => n2(f.area_plan),
    },
    {
      campo: 'area_real',
      label: 'Área real (mz)',
      tipo: 'numero',
      numero: true,
      valor: (f) => Number(f.area_real),
      etiqueta: (f) => n2(f.area_real),
    },
    {
      campo: 'pct',
      label: '% avance',
      tipo: 'numero',
      numero: true,
      valor: (f) => (f.pct === null ? null : Number(f.pct)),
      etiqueta: (f) => pct(f.pct),
      render: (f) => (
        <span
          className={`font-semibold tabular-nums ${
            Number(f.pct ?? 0) >= 100 ? 'text-emerald-700' : 'text-slate-900'
          }`}
        >
          {pct(f.pct)}
        </span>
      ),
    },
  ]
}

function columnaCosto<T extends { costo_total: number }>(): ColumnaGrid<T> {
  return {
    campo: 'costo_total',
    label: 'Costo total',
    tipo: 'numero',
    numero: true,
    valor: (f) => Number(f.costo_total),
    etiqueta: (f) => n2(f.costo_total),
    render: (f) => (
      <span className="font-semibold tabular-nums text-slate-900">L {n2(f.costo_total)}</span>
    ),
  }
}
