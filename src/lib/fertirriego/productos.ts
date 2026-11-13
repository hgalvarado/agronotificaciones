/**
 * Productos por clase y productos creados en campo (piloto 1, sql/99). Puro: solo importa tipos.
 *
 * Orden del selector: primero los Fertilizantes (los que entran a los análisis, `analisis`), después cada otra clase
 * (`grupo`) en orden alfabético. Los creados en campo quedan «por validar» y nunca son fertilizantes.
 */

import type { Material, Operacion } from './tipos'

export const CLASE_FERTILIZANTES = 'Fertilizantes'
/** Piloto 2 (punto 5): sin grupo = «Otros insumos». */
export const CLASE_SIN_GRUPO = 'Otros insumos'
/** Clases que siempre se ofrecen al crear un producto en campo. */
export const CLASES_BASE = ['Otros insumos', 'Otros objetos']

export function claseDe(m: Pick<Material, 'analisis' | 'grupo'>): string {
  if (m.analisis) return CLASE_FERTILIZANTES
  return m.grupo?.trim() || CLASE_SIN_GRUPO
}

const porNombre = (a: Material, b: Material) => (a.descripcion ?? a.codigo).localeCompare(b.descripcion ?? b.codigo, 'es')

/** Materiales ordenados por clase (Fertilizantes primero, después alfabético) y por nombre dentro de cada clase. */
export function ordenarPorClase(materiales: Material[]): { material: Material; clase: string }[] {
  return materiales
    .map((material) => ({ material, clase: claseDe(material) }))
    .sort((a, b) => {
      const fa = a.clase === CLASE_FERTILIZANTES
      const fb = b.clase === CLASE_FERTILIZANTES
      if (fa !== fb) return fa ? -1 : 1
      return a.clase.localeCompare(b.clase, 'es') || porNombre(a.material, b.material)
    })
}

/**
 * Agrupa por clase (piloto 2, punto 5) cualquier lista con material: Fertilizantes primero (destacados), después cada
 * clase en orden alfabético; dentro, por nombre. Lo que no tiene material conocido va a «Otros insumos».
 */
export function agruparPorClase<T>(
  items: T[],
  materialDe: (item: T) => Material | undefined
): { clase: string; fertilizantes: boolean; items: T[] }[] {
  const grupos = new Map<string, { item: T; m: Material | undefined }[]>()
  for (const item of items) {
    const m = materialDe(item)
    const clase = m ? claseDe(m) : CLASE_SIN_GRUPO
    grupos.set(clase, [...(grupos.get(clase) ?? []), { item, m }])
  }
  const nombre = (m: Material | undefined) => m?.descripcion ?? m?.codigo ?? ''
  return [...grupos.entries()]
    .sort(([a], [b]) => (a === CLASE_FERTILIZANTES ? -1 : b === CLASE_FERTILIZANTES ? 1 : a.localeCompare(b, 'es')))
    .map(([clase, lista]) => ({
      clase,
      fertilizantes: clase === CLASE_FERTILIZANTES,
      items: lista.sort((x, y) => nombre(x.m).localeCompare(nombre(y.m), 'es')).map((x) => x.item),
    }))
}

/** Clases para elegir al crear un producto: las base y las de los productos que no son fertilizantes. */
export function clasesParaCrear(materiales: Material[]): string[] {
  const otras = new Set<string>()
  for (const m of materiales) if (!m.analisis && m.grupo?.trim()) otras.add(m.grupo.trim())
  for (const c of CLASES_BASE) otras.delete(c)
  return [...CLASES_BASE, ...[...otras].sort((a, b) => a.localeCompare(b, 'es'))]
}

/** El material que representa un producto creado en el teléfono (mismo código que pondrá la base). */
export function materialDeCampo(id: string, descripcion: string, unidad: string, grupo: string): Material {
  return {
    id,
    codigo: `CAMPO-${id.slice(0, 8)}`,
    descripcion: descripcion.trim(),
    unidad: unidad.trim() || null,
    grupo: grupo.trim() || CLASES_BASE[0],
    origen: 'CAMPO',
    validado: false,
    analisis: false,
    pendiente: true,
  }
}

/** Productos creados en el teléfono que aún no llegan al servidor. */
export function productosPendientes(cola: Operacion[]): Material[] {
  return cola
    .filter((o) => o.tipo === 'producto' && o.estado_local === 'PENDIENTE')
    .map((o) =>
      materialDeCampo(
        String(o.datos.material_id ?? o.id),
        String(o.datos.descripcion ?? ''),
        String(o.datos.unidad ?? ''),
        String(o.datos.grupo ?? '')
      )
    )
}

/** Solo las operaciones de productos nuevos que de verdad usa el registro (lo demás se queda sin crear). */
export function productosUsados(nuevos: Operacion[], usados: Iterable<string>): Operacion[] {
  const ids = new Set(usados)
  return nuevos.filter((o) => ids.has(String(o.datos.material_id)))
}
