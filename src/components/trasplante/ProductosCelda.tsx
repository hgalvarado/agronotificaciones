'use client'

/**
 * Los productos aplicados, editados EN LA CELDA.
 *
 * Estaban en la base desde la 26 pero no se veían en la tabla: para saber
 * si a una siembra se le aplicó algo había que abrir su modal, y para
 * corregir una cantidad, abrirlo y guardarlo entero. Con doscientas
 * siembras al mes eso es media mañana.
 *
 * Cerrada, la celda es una línea de etiquetas —«UREA 2.5 kg»— que se lee
 * de un vistazo. Abierta, es una lista corta: material, cantidad, unidad
 * y una cruz por renglón. No es un modal: es un panel anclado a la celda
 * que no tapa la fila y se cierra solo al tocar fuera.
 *
 * Guarda de una vez toda la lista (`fn_guardar_productos_siembra`) en vez
 * de un alta y dos bajas sueltas: a media lista, una red que se corta
 * dejaría la siembra diciendo que se aplicó algo que ya no está.
 */

import { useEffect, useRef, useState } from 'react'
import { Boton, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { IconPlus, IconX } from '@/components/ui/Icons'
import type { ProductoParaGuardar } from '@/lib/trasplante/repositorioCliente'
import { textoProducto, type Material, type ProductoDeSiembra } from '@/lib/trasplante/tipos'

function aBorrador(productos: ProductoDeSiembra[] | null | undefined): ProductoParaGuardar[] {
  return (productos ?? []).map((p) => ({
    material_id: p.material_id,
    cantidad: p.cantidad === null || p.cantidad === undefined ? '' : String(p.cantidad),
    unidad: p.unidad ?? '',
  }))
}

export function ProductosCelda({
  productos,
  materiales,
  editable,
  onGuardar,
}: {
  productos: ProductoDeSiembra[] | null | undefined
  materiales: Material[]
  editable: boolean
  onGuardar: (lista: ProductoParaGuardar[]) => Promise<void>
}) {
  const [abierto, setAbierto] = useState(false)
  const lista = productos ?? []

  if (!editable) {
    return <Etiquetas lista={lista} />
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Productos aplicados"
        className="flex w-full min-w-[150px] items-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors hover:border-slate-200 hover:bg-white"
      >
        <Etiquetas lista={lista} />
      </button>

      {abierto && (
        <Panel
          inicial={aBorrador(productos)}
          materiales={materiales}
          onCerrar={() => setAbierto(false)}
          onGuardar={async (l) => {
            await onGuardar(l)
            setAbierto(false)
          }}
        />
      )}
    </div>
  )
}

function Etiquetas({ lista }: { lista: ProductoDeSiembra[] }) {
  if (lista.length === 0) {
    return <span className="text-xs text-slate-300">Sin productos</span>
  }
  return (
    <span className="flex flex-wrap gap-1">
      {lista.map((p) => (
        <span
          key={p.id}
          title={p.descripcion ?? p.codigo}
          className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800"
        >
          {textoProducto(p)}
        </span>
      ))}
    </span>
  )
}

function Panel({
  inicial,
  materiales,
  onCerrar,
  onGuardar,
}: {
  inicial: ProductoParaGuardar[]
  materiales: Material[]
  onCerrar: () => void
  onGuardar: (lista: ProductoParaGuardar[]) => Promise<void>
}) {
  const [lineas, setLineas] = useState<ProductoParaGuardar[]>(
    inicial.length > 0 ? inicial : [{ material_id: '', cantidad: '', unidad: '' }]
  )
  const [guardando, setGuardando] = useState(false)
  const caja = useRef<HTMLDivElement>(null)

  // Tocar fuera cierra SIN guardar: lo escrito a medias en una celda no
  // se guarda solo, igual que en el resto de la cuadrícula.
  useEffect(() => {
    function fuera(e: MouseEvent) {
      if (caja.current && !caja.current.contains(e.target as Node)) onCerrar()
    }
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar()
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [onCerrar])

  const opciones = materiales.map((m) => ({
    id: m.id,
    titulo: m.codigo,
    subtitulo: m.descripcion ?? undefined,
  }))

  function cambiar(i: number, campo: keyof ProductoParaGuardar, valor: string) {
    setLineas((antes) => antes.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)))
  }

  async function guardar() {
    setGuardando(true)
    await onGuardar(lineas.filter((l) => l.material_id))
    setGuardando(false)
  }

  return (
    <div
      ref={caja}
      className="anim-aparecer absolute right-0 top-full z-30 mt-1 flex w-[min(92vw,22rem)] flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[var(--shadow-raised)]"
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Productos aplicados
      </p>

      <div className="scroll-suave flex max-h-64 flex-col gap-2 overflow-y-auto">
        {lineas.map((l, i) => (
          <div key={i} className="flex items-end gap-1.5">
            <div className="min-w-0 flex-1">
              <SelectorBuscable
                valor={l.material_id}
                opciones={opciones}
                onCambiar={(v) => cambiar(i, 'material_id', v)}
                placeholder="Material…"
                etiquetaBusqueda="Buscar material…"
                textoVacio="Sin material"
              />
            </div>
            <Entrada
              inputMode="decimal"
              value={l.cantidad}
              onChange={(e) => cambiar(i, 'cantidad', e.target.value)}
              placeholder="Cant."
              className="w-16 text-right"
              aria-label="Cantidad"
            />
            <Entrada
              value={l.unidad}
              onChange={(e) => cambiar(i, 'unidad', e.target.value)}
              placeholder="Un."
              className="w-14"
              aria-label="Unidad"
            />
            <button
              type="button"
              aria-label="Quitar producto"
              onClick={() => setLineas((antes) => antes.filter((_, j) => j !== i))}
              className="mb-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          setLineas((antes) => [...antes, { material_id: '', cantidad: '', unidad: '' }])
        }
        className="inline-flex items-center gap-1 self-start text-xs font-semibold text-brand-700 hover:underline"
      >
        <IconPlus className="h-3.5 w-3.5" />
        Agregar producto
      </button>

      <div className="flex gap-2 border-t border-slate-100 pt-2">
        <Boton variante="secundario" tamano="sm" className="flex-1" onClick={onCerrar}>
          Cancelar
        </Boton>
        <Boton tamano="sm" className="flex-1" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Boton>
      </div>
    </div>
  )
}
