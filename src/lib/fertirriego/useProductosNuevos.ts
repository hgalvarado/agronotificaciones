'use client'

/**
 * Productos creados en el formulario («Agregar producto que no está en la lista»), sin señal. Igual que los choferes
 * nuevos de la recepción: se guardan como operaciones `producto` y se mandan ANTES del registro que los usa
 * (`productosUsados`). Van en el borrador del formulario.
 */

import { useCallback, useMemo, useState } from 'react'
import { crearOperacion, nuevoId } from './operaciones'
import { materialDeCampo } from './productos'
import type { Material, Operacion } from './tipos'

export type ProductoNuevo = { descripcion: string; unidad: string; grupo: string }

export function useProductosNuevos(inicial?: Operacion[] | null) {
  const [nuevos, setNuevos] = useState<Operacion[]>(inicial ?? [])
  const materiales = useMemo<Material[]>(
    () =>
      nuevos.map((o) =>
        materialDeCampo(String(o.datos.material_id), String(o.datos.descripcion ?? ''), String(o.datos.unidad ?? ''), String(o.datos.grupo ?? ''))
      ),
    [nuevos]
  )
  const crear = useCallback((v: ProductoNuevo): Material => {
    const id = nuevoId()
    const m = materialDeCampo(id, v.descripcion, v.unidad, v.grupo)
    setNuevos((n) => [
      ...n,
      crearOperacion(
        'producto',
        { material_id: id, descripcion: m.descripcion, unidad: m.unidad, grupo: m.grupo },
        { id, ubicacion: null, resumen: `Producto nuevo · ${m.descripcion}` }
      ),
    ])
    return m
  }, [])
  return { nuevos, materiales, crear }
}
