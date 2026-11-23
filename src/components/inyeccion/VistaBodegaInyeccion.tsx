'use client'

/**
 * Pestaña «Bodega» de Inyección: los productos de inyección que hay en la bodega de la estación (la MISMA bodega de
 * Fertirriego). Saldo = lo del servidor + lo pendiente en la cola local (`saldos`); solo lectura.
 */

import { useMemo } from 'react'
import { FilaDeBodega } from '@/components/fertirriego/PanelEstacion'
import { armarBodega, type BodegaGeneral } from '@/lib/fertirriego/bodegaGeneral'
import type { EstadoCampo } from '@/lib/fertirriego/tipos'
import type { EstadoInyeccion } from '@/lib/inyeccion/estado'

export function VistaBodegaInyeccion({
  estacionId,
  campoEstado,
  inyeccion,
  saldos,
  servidor,
}: {
  estacionId: string
  campoEstado: EstadoCampo
  inyeccion: EstadoInyeccion
  saldos: Map<string, number>
  servidor: BodegaGeneral | null
}) {
  const filas = useMemo(() => {
    const idsIny = new Set(inyeccion.materiales.map((m) => m.id))
    return armarBodega({
      estacionId,
      saldos,
      saldosEnvases: new Map(),
      material: (id) => {
        const f = campoEstado.materiales.find((m) => m.id === id)
        if (f) return f
        const i = inyeccion.materiales.find((m) => m.id === id)
        return i ? { id: i.id, codigo: i.codigo, descripcion: i.descripcion, unidad: i.unidad, grupo: i.grupo, origen: 'MARA', validado: true, analisis: false } : undefined
      },
      nombreEnvase: () => '',
      servidor,
    })
      .filter((f) => f.tipo === 'INYECCION' || (f.materialId !== null && idsIny.has(f.materialId)))
      .map((f) => ({ ...f, materialId: null }))   // solo lectura: sin botón
  }, [estacionId, campoEstado, inyeccion, saldos, servidor])

  if (filas.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600 ring-1 ring-inset ring-slate-200" data-bodega-iny-vacia>
        Esta estación no tiene productos de inyección en bodega. Recíbelos desde <strong>Fertirriego › Bodega</strong>.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2" data-bodega-inyeccion>
      <p className="text-xs text-slate-600">Cada aplicación de Inyección descuenta de aquí. Es la misma bodega de Fertirriego.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {filas.map((f) => (
          <FilaDeBodega key={`${f.tipo}|${f.clave}`} fila={f} onVerProducto={() => {}} />
        ))}
      </div>
      {filas.some((f) => f.saldo < 0) && <p className="text-xs font-semibold text-red-700">Hay productos en negativo: falta registrar una recepción o un conteo.</p>}
    </div>
  )
}
