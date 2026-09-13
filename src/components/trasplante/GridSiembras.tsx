'use client'

/**
 * Cuadrícula de siembra diaria.
 *
 * Es una TABLA analítica y no una lista agrupada por fecha: el cuadre se
 * hace ordenando y filtrando por lote, variedad o cumplimiento, y una
 * agrupación fija impide justamente eso.
 *
 * Toda la mecánica de la tabla es la estándar (`DataGrid`). Aquí sólo se
 * declara qué columnas tiene una siembra y qué se puede hacer con ella.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alerta, Boton } from '@/components/ui/Primitivos'
import { DataGrid } from '@/components/ui/DataGrid'
import { BotonFila } from '@/components/ui/BotonFila'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { mensajeDeError } from '@/lib/errores'
import { borrarSiembras } from '@/lib/trasplante/repositorioCliente'
import { cumplimiento } from '@/lib/trasplante/tabla'
import { n0, n2, pct } from '@/lib/trasplante/formato'
import type { FilaSiembra, LoteOpcion, Variedad } from '@/lib/trasplante/tipos'
import { EditarSiembraModal } from './EditarSiembraModal'
import { ImportarSiembras } from './ImportarSiembras'

export function GridSiembras({
  temporadaId,
  filas,
  lotes,
  variedades,
  puedeEditar,
  puedeEliminar,
}: {
  temporadaId: string
  filas: FilaSiembra[]
  lotes: LoteOpcion[]
  variedades: Variedad[]
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  const router = useRouter()
  const [editando, setEditando] = useState<FilaSiembra | null>(null)
  const [enMasa, setEnMasa] = useState<string[] | null>(null)
  const [importar, setImportar] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const columnas = useMemo<ColumnaGrid<FilaSiembra>[]>(
    () => [
      { campo: 'fecha_siembra', label: 'Fecha', tipo: 'fecha', valor: (f) => f.fecha_siembra },
      { campo: 'semana', label: 'Semana', tipo: 'seleccion', valor: (f) => f.semana },
      {
        campo: 'ut',
        label: 'UT',
        tipo: 'seleccion',
        valor: (f) => f.ut,
        render: (f) => <span className="font-semibold text-slate-800">{f.ut}</span>,
      },
      { campo: 'zona', label: 'Zona', tipo: 'seleccion', valor: (f) => f.zona },
      { campo: 'ciclo', label: 'Ciclo', tipo: 'seleccion', numero: true, valor: (f) => f.ciclo },
      { campo: 'variedad', label: 'Variedad', tipo: 'seleccion', valor: (f) => f.variedad },
      { campo: 'cultivo', label: 'Cultivo', tipo: 'seleccion', valor: (f) => f.cultivo },
      {
        campo: 'lote_variedad',
        label: 'Lote variedad',
        tipo: 'texto',
        valor: (f) => f.lote_variedad,
      },
      {
        campo: 'avance_mz',
        label: 'Avance mz',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.avance_mz),
        render: (f) => <span className="font-bold text-slate-900">{n2(f.avance_mz)}</span>,
      },
      {
        campo: 'acumulado_lote',
        label: 'Acum. lote',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.acumulado_lote === null ? null : Number(f.acumulado_lote)),
        etiqueta: (f) => n2(f.acumulado_lote),
      },
      {
        campo: 'plan_lote',
        label: 'Plan lote',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.plan_lote === null ? null : Number(f.plan_lote)),
        etiqueta: (f) => n2(f.plan_lote),
      },
      {
        campo: 'cumplimiento',
        label: '% Cumpl.',
        tipo: 'numero',
        numero: true,
        valor: cumplimiento,
        etiqueta: (f) => pct(cumplimiento(f)),
        render: (f) => <Cumplimiento valor={cumplimiento(f)} />,
      },
      {
        campo: 'plantas_reportadas',
        label: 'Plantas',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.plantas_reportadas === null ? null : Number(f.plantas_reportadas)),
        etiqueta: (f) => n0(f.plantas_reportadas),
      },
      {
        campo: 'plantas_mz',
        label: 'Plantas/mz',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.plantas_mz === null ? null : Number(f.plantas_mz)),
        etiqueta: (f) => n2(f.plantas_mz),
      },
      {
        campo: 'observaciones',
        label: 'Observaciones',
        tipo: 'texto',
        valor: (f) => f.observaciones,
        render: (f) => (
          <span className="block max-w-[160px] truncate text-xs">{f.observaciones ?? '—'}</span>
        ),
      },
      {
        campo: 'usuario_nombre',
        label: 'Capturó',
        tipo: 'seleccion',
        valor: (f) => f.usuario_nombre,
        render: (f) => (
          <span className="block max-w-[130px] truncate text-xs text-slate-400">
            {f.usuario_nombre ?? '—'}
          </span>
        ),
      },
    ],
    []
  )

  async function eliminar(ids: string[], limpiar: () => void) {
    if (ids.length === 0) return
    if (
      !confirm(
        `Se van a eliminar ${ids.length} ${
          ids.length === 1 ? 'registro' : 'registros'
        } de siembra. Esto no se puede deshacer. ¿Continuar?`
      )
    ) {
      return
    }
    setOcupado(true)
    const { error: e } = await borrarSiembras(ids)
    setOcupado(false)
    if (e) return setError(mensajeDeError(e, 'No se pudieron eliminar los registros.'))
    limpiar()
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alerta>{error}</Alerta>}

      <DataGrid<FilaSiembra>
        filas={filas}
        columnas={columnas}
        titulo="Siembra diaria"
        nombreArchivo={`siembra-diaria-${temporadaId.slice(0, 8)}`}
        ordenInicial={{ campo: 'fecha_siembra', direccion: 'desc' }}
        minAncho="1320px"
        vacio={{
          titulo: 'No hay siembras capturadas',
          descripcion: 'Ajusta el rango de fechas o registra una siembra nueva.',
        }}
        resumen={(visibles) => {
          const mz = Math.round(visibles.reduce((a, f) => a + Number(f.avance_mz), 0) * 100) / 100
          const plantas = visibles.reduce((a, f) => a + Number(f.plantas_reportadas ?? 0), 0)
          const lotesVistos = new Set(visibles.map((f) => f.ut)).size
          return (
            <>
              <strong className="text-slate-900">{n2(mz)} mz</strong> · {visibles.length}{' '}
              {visibles.length === 1 ? 'registro' : 'registros'} · {lotesVistos}{' '}
              {lotesVistos === 1 ? 'lote' : 'lotes'} · {n0(plantas)} plantas
            </>
          )
        }}
        acciones={
          puedeEditar && (
            <Boton variante="secundario" tamano="sm" onClick={() => setImportar(true)}>
              Importar
            </Boton>
          )
        }
        accionesSeleccion={(ids, limpiar) => (
          <>
            {puedeEditar && (
              <Boton variante="secundario" tamano="sm" onClick={() => setEnMasa(ids)}>
                Editar {ids.length}
              </Boton>
            )}
            {puedeEliminar && (
              <Boton
                variante="peligro"
                tamano="sm"
                disabled={ocupado}
                onClick={() => eliminar(ids, limpiar)}
              >
                Eliminar {ids.length}
              </Boton>
            )}
          </>
        )}
        accionFila={(f) => (
          <span className="flex justify-end gap-1">
            {puedeEditar && (
              <BotonFila onClick={() => setEditando(f)}>Editar</BotonFila>
            )}
            {puedeEliminar && (
              <BotonFila peligro onClick={() => eliminar([f.id], () => {})}>
                Eliminar
              </BotonFila>
            )}
          </span>
        )}
      />

      <EditarSiembraModal
        fila={editando}
        enMasa={enMasa}
        lotes={lotes}
        variedades={variedades}
        onCerrar={() => {
          setEditando(null)
          setEnMasa(null)
        }}
        onGuardado={() => router.refresh()}
      />

      <ImportarSiembras
        abierto={importar}
        onCerrar={() => setImportar(false)}
        temporadaId={temporadaId}
        lotes={lotes}
        variedades={variedades}
      />
    </div>
  )
}

function Cumplimiento({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-slate-300">—</span>
  const tono =
    valor >= 99
      ? 'bg-emerald-100 text-emerald-800'
      : valor >= 50
        ? 'bg-brand-50 text-brand-800'
        : 'bg-amber-100 text-amber-800'
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${tono}`}>
      {pct(valor)}
    </span>
  )
}
