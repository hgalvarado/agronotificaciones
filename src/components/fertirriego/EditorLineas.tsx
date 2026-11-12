'use client'

/**
 * Productos y cantidades de un registro (recepción, aplicación, devolución). Pensado para el pulgar: una fila por
 * producto, teclado numérico, y al lado lo que hay en bodega (y lo planificado, en la aplicación).
 */

import { useMemo } from 'react'
import { SelectorBuscable, type OpcionBuscable } from '@/components/ui/SelectorBuscable'
import { IconPlus, IconTrash } from '@/components/ui/Icons'
import { cantidad } from '@/lib/fertirriego/calculos'
import { nuevoId } from '@/lib/fertirriego/operaciones'
import { clasesParaCrear, ordenarPorClase } from '@/lib/fertirriego/productos'
import type { Material, Operacion } from '@/lib/fertirriego/tipos'
import { useProductosNuevos, type ProductoNuevo } from '@/lib/fertirriego/useProductosNuevos'

export type LineaEditable = { clave: string; material_id: string; cantidad: string }

export type CrearProducto = { clases: string[]; unidades: string[]; onCrear: (v: ProductoNuevo) => Material }

/**
 * Opciones del selector de productos por clase: Fertilizantes primero, después cada otra clase (con encabezados
 * solo si hay más de una), «por validar» en los que no están validados.
 */
export function opcionesPorClase(materiales: Material[]): OpcionBuscable[] {
  const ordenados = ordenarPorClase(materiales)
  const conGrupos = new Set(ordenados.map((o) => o.clase)).size > 1
  return ordenados.map(({ material: m, clase }) => ({
    id: m.id,
    titulo: m.descripcion ?? m.codigo,
    subtitulo: [m.codigo, m.unidad, m.validado === false ? 'por validar' : null].filter(Boolean).join(' · '),
    grupo: conGrupos ? clase : undefined,
  }))
}

/** «Agregar producto que no está en la lista» para SelectorBuscable (descripción, unidad y clase). */
export function creacionDeProducto(crear: CrearProducto | undefined) {
  if (!crear) return undefined
  return {
    etiqueta: 'Agregar producto que no está en la lista',
    campos: [
      { key: 'descripcion', label: 'Nombre del producto', requerido: true },
      { key: 'unidad', label: 'Unidad (L, kg, unidad…)', requerido: true, opciones: crear.unidades },
      { key: 'grupo', label: 'Clase (elige o escribe una nueva)', requerido: true, opciones: crear.clases },
    ],
    onCrear: async (v: Record<string, string>): Promise<OpcionBuscable> => {
      const m = crear.onCrear({ descripcion: v.descripcion, unidad: v.unidad, grupo: v.grupo })
      return { id: m.id, titulo: m.descripcion ?? m.codigo, subtitulo: 'nuevo · por validar' }
    },
  }
}

export function EditorLineas({
  materiales,
  lineas,
  onCambiar,
  saldos,
  plan,
  etiquetaPlan = 'Plan',
  etiquetaCantidad = 'Cantidad',
  crearProducto,
}: {
  /**
   * «Agregar producto que no está en la lista» (sin señal; queda «por validar»). El formulario guarda la operación
   * y la manda antes del registro (useProductosNuevos). Sin esto, no se ofrece.
   */
  crearProducto?: CrearProducto
  /** Texto junto a lo planificado (ej. «Plan 7 días» en la recepción). */
  etiquetaPlan?: string
  materiales: Material[]
  lineas: LineaEditable[]
  onCambiar: (lineas: LineaEditable[]) => void
  /** Saldo en bodega por material (con lo pendiente de enviar). */
  saldos?: Map<string, number>
  /** Lo planificado por material (aplicación). */
  plan?: Map<string, number>
  etiquetaCantidad?: string
}) {
  const unidad = (id: string) => materiales.find((m) => m.id === id)?.unidad ?? ''
  const usados = new Set(lineas.map((l) => l.material_id))
  const todas = opcionesPorClase(materiales)
  const opcionesDe = (actual: string) => todas.filter((o) => o.id === actual || !usados.has(o.id))

  function cambiar(clave: string, cambios: Partial<LineaEditable>) {
    onCambiar(lineas.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)))
  }

  return (
    <div className="flex flex-col gap-2" data-lineas>
      {lineas.map((l, i) => {
        const saldo = saldos?.get(l.material_id)
        const planificado = plan?.get(l.material_id)
        return (
          <div
            key={l.clave}
            className="rounded-xl p-2.5 ring-1 ring-inset ring-slate-200"
            data-linea={i}
            data-linea-codigo={materiales.find((m) => m.id === l.material_id)?.codigo ?? ''}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <SelectorBuscable
                  valor={l.material_id}
                  opciones={opcionesDe(l.material_id)}
                  onCambiar={(id) => cambiar(l.clave, { material_id: id })}
                  placeholder="Elegir producto…"
                  etiquetaBusqueda="Buscar producto"
                  creacionRapida={creacionDeProducto(crearProducto)}
                />
              </div>
              <button
                type="button"
                aria-label="Quitar producto"
                onClick={() => onCambiar(lineas.filter((x) => x.clave !== l.clave))}
                className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-red-600"
              >
                <IconTrash className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">{etiquetaCantidad}</span>
                <input
                  inputMode="decimal"
                  value={l.cantidad}
                  onChange={(e) => cambiar(l.clave, { cantidad: e.target.value.replace(/[^\d.,]/g, '') })}
                  placeholder="0"
                  data-cantidad={i}
                  className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base font-semibold tabular-nums focus:border-brand-600 focus:outline-none"
                />
                <span className="text-xs text-slate-500">{unidad(l.material_id)}</span>
              </label>
              <span className="ml-auto flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                {planificado !== undefined && (
                  <span data-plan-linea>
                    {etiquetaPlan}: <strong>{cantidad(planificado)}</strong>
                  </span>
                )}
                {saldo !== undefined && l.material_id && (
                  <span className={saldo < 0 ? 'text-red-600' : ''}>
                    En bodega: <strong>{cantidad(saldo)}</strong>
                  </span>
                )}
              </span>
            </div>
          </div>
        )
      })}
      <button
        type="button"
        data-agregar-linea
        onClick={() => onCambiar([...lineas, { clave: nuevoId(), material_id: '', cantidad: '' }])}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
      >
        <IconPlus className="h-4 w-4" />
        Agregar producto
      </button>
    </div>
  )
}

/**
 * Para los formularios que permiten crear productos en campo: la lista con los creados aquí, las operaciones a
 * mandar antes del registro (`nuevos`, filtrar con productosUsados) y la prop `crearProducto` de EditorLineas.
 * `habilitado` = la base ya tiene la 99 y la persona tiene «Recibir» en la estación (la base lo exige).
 */
export function useCrearProducto(materiales: Material[], inicial: Operacion[] | null | undefined, habilitado: boolean) {
  const p = useProductosNuevos(inicial)
  const todos = useMemo(() => [...materiales, ...p.materiales.filter((n) => !materiales.some((m) => m.id === n.id))], [materiales, p.materiales])
  const crearProducto = useMemo(() => {
    if (!habilitado) return undefined
    const cuenta = new Map<string, number>()
    for (const m of todos) if (m.unidad?.trim()) cuenta.set(m.unidad.trim(), (cuenta.get(m.unidad.trim()) ?? 0) + 1)
    const unidades = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([u]) => u)
    return { clases: clasesParaCrear(todos), unidades, onCrear: p.crear }
  }, [habilitado, todos, p.crear])
  return { nuevos: p.nuevos, materiales: todos, crearProducto }
}

/** Error de leerLineas cuando ninguna fila trae cantidad (cada formulario puede explicarlo a su manera). */
export const SIN_LINEAS = 'Agrega al menos un producto con su cantidad.'

/** Lee las líneas: número válido > 0, sin repetidos. Devuelve el error para mostrar, o las líneas. */
export function leerLineas(lineas: LineaEditable[]): { error: string } | { lineas: { material_id: string; cantidad: number }[] } {
  const validas: { material_id: string; cantidad: number }[] = []
  for (const l of lineas) {
    // Cantidad vacía = ese producto no va (p. ej. del plan no se aplicó el ácido, o solo sobró uno de dos)
    if (!l.cantidad.trim()) continue
    if (!l.material_id) return { error: 'Elige el producto de cada fila (o quita la fila).' }
    const n = Number(l.cantidad.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return { error: 'Cada producto necesita una cantidad mayor que cero.' }
    if (n > 1_000_000) return { error: 'Una cantidad es demasiado grande. Revisa la unidad.' }
    if (validas.some((v) => v.material_id === l.material_id)) return { error: 'Un producto está repetido: súmalo en una sola fila.' }
    validas.push({ material_id: l.material_id, cantidad: Math.round(n * 10000) / 10000 })
  }
  if (validas.length === 0) return { error: SIN_LINEAS }
  return { lineas: validas }
}
