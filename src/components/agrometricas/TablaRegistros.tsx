'use client'

/**
 * Detalle en tabla (DataGrid estándar): filtros por columna, orden, selección múltiple, edición en línea de los valores
 * (solo las filas con `puede_editar`) y Excel. Solo presenta; guardar/eliminar lo hace la pantalla que la usa.
 */

import { useMemo } from 'react'
import { Boton } from '@/components/ui/Primitivos'
import { DataGrid, type ColumnaGrid } from '@/components/ui/DataGrid'
import { CAMPOS, type CampoParametro } from '@/lib/agrometricas/parametros'
import { CAMPOS_EDITABLES, valorNumero, type Registro } from '@/lib/agrometricas/registrosPura'

const CAMPOS_TABLA: CampoParametro[] = CAMPOS.filter((c) => CAMPOS_EDITABLES.includes(c.clave))
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export function TablaRegistros({ registros, cargando, onEditarCelda, onAbrir, onEliminarVarios }: {
  registros: Registro[]
  cargando: boolean
  onEditarCelda: (fila: Registro, campo: string, valor: unknown) => Promise<void>
  onAbrir: (r: Registro) => void
  /** Recibe los ids marcados; la pantalla abre la confirmación con motivo. */
  onEliminarVarios: (ids: string[], limpiar: () => void) => void
}) {
  const columnas = useMemo<ColumnaGrid<Registro>[]>(() => [
    { campo: 'fecha', label: 'Fecha', tipo: 'fecha', valor: (r) => r.fecha },
    { campo: 'turno', label: 'Turno', tipo: 'seleccion', valor: (r) => r.turno },
    { campo: 'ddt', label: 'DDT', tipo: 'numero', numero: true, valor: (r) => r.ddt },
    { campo: 'zona', label: 'Zona', tipo: 'seleccion', valor: (r) => r.zona ?? '' },
    { campo: 'estacion', label: 'Estación', tipo: 'seleccion', valor: (r) => r.estacion ?? '' },
    { campo: 'lotes', label: 'Lotes', tipo: 'texto', valor: (r) => (r.lotes ?? []).map((l) => l.lote).join(', ') },
    ...CAMPOS_TABLA.map<ColumnaGrid<Registro>>((c) => ({
      campo: c.clave, label: c.unidad ? `${c.etiqueta} (${c.unidad})` : c.etiqueta, tipo: 'numero', numero: true,
      valor: (r) => valorNumero(r, c.clave),
      editable: (r: Registro) => r.puede_editar, editor: 'numero',
      render: (r: Registro) => {
        const v = valorNumero(r, c.clave)
        const fuera = (r.fuera_rango ?? []).includes(c.clave)
        return <span className={fuera ? 'font-semibold text-red-700' : ''}>{v === null ? '' : v}</span>
      },
    })),
    { campo: 'comentario', label: 'Comentario', tipo: 'texto', valor: (r) => r.comentario ?? '' },
    { campo: 'capturo', label: 'Capturó', tipo: 'seleccion', valor: (r) => s(r.creado_por_nombre) },
  ], [])

  return (
    <div data-tabla>
      <DataGrid<Registro>
        filas={registros}
        columnas={columnas}
        titulo="Registros de la temporada"
        nombreArchivo="agrometricas-registros"
        ordenInicial={{ campo: 'fecha', direccion: 'desc' }}
        minAncho="1400px"
        cargando={cargando}
        memoria="agrometricas-registros"
        puedeEditarCelda
        onEditarCelda={onEditarCelda}
        resumen={(v) => <span className="text-sm text-slate-500">{v.length} registros</span>}
        accionFila={(r) => <Boton type="button" tamano="sm" variante="secundario" onClick={() => onAbrir(r)}>Ver</Boton>}
        accionesSeleccion={(ids, limpiar) => {
          const eliminables = registros.filter((r) => ids.includes(r.id) && r.puede_eliminar).map((r) => r.id)
          return eliminables.length
            ? <Boton type="button" tamano="sm" variante="peligro" onClick={() => onEliminarVarios(eliminables, limpiar)} data-eliminar-varios>Eliminar ({eliminables.length})</Boton>
            : null
        }}
        vacio={{ titulo: 'Sin registros', descripcion: 'Ajusta los filtros.' }}
      />
    </div>
  )
}
