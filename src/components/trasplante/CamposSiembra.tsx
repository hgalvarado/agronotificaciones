'use client'

/**
 * Las dos piezas del formulario de siembra que se comparten entre el
 * alta (`SiembraForm`) y la edición (`EditarSiembraModal`):
 *
 *   · el LOTE DE VARIEDAD, que deja de ser texto libre y se elige de lo
 *     que de verdad llegó del vivero (Recepción de plántulas, campo
 *     `lote_semilla`), de esa variedad y recibido hasta la fecha de la
 *     siembra. Escrito a mano, el mismo lote salía de tres formas y la
 *     trazabilidad hacia el vivero no cruzaba;
 *   · los PRODUCTOS aplicados, con un selector que busca en el catálogo
 *     de materiales en vez de una lista estática de cientos de códigos.
 */

import { Boton, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable, type OpcionBuscable } from '@/components/ui/SelectorBuscable'
import type { FilaRecepcion, Material, ProductoAplicado } from '@/lib/trasplante/tipos'
import { n0 } from '@/lib/trasplante/formato'

/**
 * Los lotes de plántula elegibles para una siembra.
 *
 * Sólo los de la MISMA variedad y recibidos hasta la fecha de siembra:
 * no se puede sembrar una plántula que todavía no llegó. Lo que la fila
 * ya traía se conserva al final aunque no cuadre, marcado, para que
 * editar una siembra vieja no borre en silencio su lote.
 */
export function opcionesLoteVariedad(
  recepciones: FilaRecepcion[],
  variedadId: string,
  fechaSiembra: string,
  actual: string
): OpcionBuscable[] {
  const porLote = new Map<string, { fecha: string; plantulas: number }>()
  for (const r of recepciones) {
    const lote = (r.lote_semilla ?? '').trim()
    if (!lote || r.variedad_id !== variedadId) continue
    if (fechaSiembra && r.fecha > fechaSiembra) continue
    const previo = porLote.get(lote)
    const plantulas = Number(r.plantulas_enviadas ?? r.plantulas_facturadas ?? 0)
    porLote.set(lote, {
      fecha: previo && previo.fecha > r.fecha ? previo.fecha : r.fecha,
      plantulas: (previo?.plantulas ?? 0) + plantulas,
    })
  }

  const opciones: OpcionBuscable[] = [...porLote.entries()]
    .sort((a, b) => b[1].fecha.localeCompare(a[1].fecha))
    .map(([lote, x]) => ({
      id: lote,
      titulo: lote,
      subtitulo: `Recibido ${x.fecha} · ${n0(x.plantulas)} plántulas`,
    }))

  const t = actual.trim()
  if (t && !porLote.has(t)) {
    opciones.push({ id: t, titulo: t, subtitulo: 'Escrito antes · no está en Recepción de plántulas' })
  }
  return opciones
}

/** La ayuda bajo el selector, según por qué la lista sale como sale. */
export function ayudaLoteVariedad(variedadId: string, opciones: OpcionBuscable[]): string {
  if (!variedadId) return 'Elige primero la variedad: el lote sale de sus recepciones.'
  if (opciones.length === 0) {
    return 'Esta variedad no tiene recepciones con lote hasta esa fecha. Regístrala en Recepción de plántulas.'
  }
  return 'Lotes recibidos del vivero para esta variedad, hasta la fecha de siembra.'
}

/** Lista editable de productos aplicados, con buscador de material. */
export function EditorProductos({
  productos,
  onCambiar,
  materiales,
}: {
  productos: ProductoAplicado[]
  onCambiar: (lista: ProductoAplicado[]) => void
  materiales: Material[]
}) {
  const opciones: OpcionBuscable[] = materiales.map((m) => ({
    id: m.id,
    titulo: m.codigo,
    subtitulo: [m.descripcion, m.grupo].filter(Boolean).join(' · ') || undefined,
  }))

  const cambiar = (i: number, campo: keyof ProductoAplicado, valor: string) =>
    onCambiar(productos.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)))

  return (
    <div className="flex flex-col gap-2">
      {productos.length === 0 ? (
        <p className="text-sm text-slate-400">Sin productos. No es obligatorio.</p>
      ) : (
        productos.map((p, i) => (
          <div
            key={i}
            className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_110px_110px_auto]"
          >
            <div className="col-span-2 sm:col-span-1">
              <SelectorBuscable
                valor={p.material_id}
                onCambiar={(id) => cambiar(i, 'material_id', id)}
                opciones={opciones}
                placeholder="Buscar material…"
                etiquetaBusqueda="Código o descripción…"
                permitirVacio={false}
              />
            </div>
            <Entrada
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0"
              placeholder="Cantidad"
              value={p.cantidad}
              onChange={(e) => cambiar(i, 'cantidad', e.target.value)}
            />
            <Entrada
              placeholder="Unidad"
              value={p.unidad}
              onChange={(e) => cambiar(i, 'unidad', e.target.value)}
            />
            <Boton
              type="button"
              variante="peligro"
              tamano="sm"
              className="col-span-2 sm:col-span-1"
              onClick={() => onCambiar(productos.filter((_, j) => j !== i))}
            >
              Quitar
            </Boton>
          </div>
        ))
      )}
      <Boton
        type="button"
        variante="secundario"
        tamano="sm"
        className="self-start"
        onClick={() => onCambiar([...productos, { material_id: '', cantidad: '', unidad: '' }])}
      >
        Agregar producto
      </Boton>
    </div>
  )
}
