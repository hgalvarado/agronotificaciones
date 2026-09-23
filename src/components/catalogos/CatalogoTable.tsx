'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { Alerta, Boton, Campo, Entrada, Selector } from '@/components/ui/Primitivos'
import { IconPlus } from '@/components/ui/Icons'
import {
  TablaAvanzada,
  type ColumnaTabla,
  type FilaTabla,
  type PermisosTabla,
} from '@/components/ui/TablaAvanzada'
import { ImportarExcel, type RelacionCatalogo } from './ImportarExcel'

export type CampoCatalogo = {
  key: string
  label: string
  /**
   * `multiseleccion` guarda un ARRAY en la columna, no un valor suelto.
   * Existe porque hay atributos que no son excluyentes: la misma persona
   * maneja el tractor y lleva el teléfono de la finca, y obligarla a ser
   * una cosa sola la sacaría de una de las dos listas.
   */
  tipo: 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'multiseleccion'
  requerido?: boolean
  /** Para 'select' y 'multiseleccion': los valores que admite la columna. */
  opciones?: { value: string; label: string }[]
}

type Fila = Record<string, string | number | boolean | null>

/** Traduce la definición del catálogo a columnas de la tabla genérica. */
const TIPOS = {
  text: 'texto',
  number: 'numero',
  date: 'fecha',
  checkbox: 'booleano',
  select: 'seleccion',
  // Se filtra y se ordena como texto: es la lista de valores, legible.
  multiseleccion: 'texto',
} as const

/**
 * Una columna que guarda varios valores, editada en la celda.
 *
 * De sólo lectura son etiquetas; con permiso de editar es el mismo
 * selector múltiple del resto del sistema —con buscador y con el
 * interruptor de uno solo o varios—, así que quien lo usa ya sabe
 * usarlo.
 */
function SelectorArray({
  valores,
  opciones,
  editable,
  onCambiar,
}: {
  valores: string[]
  opciones: { value: string; label: string }[]
  editable: boolean
  onCambiar: (valores: string[]) => void
}) {
  if (!editable) {
    if (valores.length === 0) return <span className="text-xs text-slate-300">—</span>
    return (
      <span className="flex flex-wrap gap-1">
        {valores.map((v) => (
          <span
            key={v}
            className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600"
          >
            {opciones.find((o) => o.value === v)?.label ?? v}
          </span>
        ))}
      </span>
    )
  }

  return (
    <SelectorMultiple
      etiqueta=""
      opciones={opciones.map((o) => ({ valor: o.value, etiqueta: o.label }))}
      valores={valores}
      onCambiar={onCambiar}
      className="min-w-[150px]"
    />
  )
}

export function CatalogoTable({
  tabla,
  titulo,
  campos,
  filas,
  clave = 'nombre',
  soloLectura = false,
  permisos,
  relaciones,
}: {
  tabla: string
  /** Nombre visible del catálogo; se usa en la plantilla y el importador. */
  titulo: string
  campos: CampoCatalogo[]
  filas: Fila[]
  /**
   * Campo que identifica una fila del mundo real: el código del puesto, el
   * nombre de la zona. Es lo que permite al importador actualizar lo que ya
   * existe en vez de duplicarlo.
   */
  clave?: string
  soloLectura?: boolean
  permisos?: PermisosTabla
  /**
   * Vinculaciones de muchos a muchos que el importador puede cargar. Las
   * labores las usan para sus tareas SAP y sus implementos.
   */
  relaciones?: RelacionCatalogo[]
}) {
  const supabase = createClient()
  const router = useRouter()
  const [abrirNuevo, setAbrirNuevo] = useState(false)
  const [abrirImportar, setAbrirImportar] = useState(false)
  const [nuevaFila, setNuevaFila] = useState<Record<string, string>>({})
  // Los campos de array van aparte: no son texto y no se pueden guardar
  // en el mismo diccionario sin convertirlos al vuelo en cada lectura.
  const [nuevos, setNuevos] = useState<Record<string, string[]>>({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const camposTexto = campos.filter((c) => c.tipo !== 'checkbox')
  const campoBool = campos.find((c) => c.tipo === 'checkbox')

  const efectivos: PermisosTabla = {
    editar: !soloLectura && permisos?.editar !== false,
    eliminar: !soloLectura && permisos?.eliminar !== false,
    descargar: permisos?.descargar !== false,
  }

  const columnas: ColumnaTabla[] = campos.map((c) => ({
    key: c.key,
    label: c.label,
    tipo: TIPOS[c.tipo],
    opciones: c.opciones,
    // Un array no se escribe en una celda de una línea: se elige en el
    // selector múltiple, que es el mismo control del resto del sistema.
    editable: c.tipo !== 'multiseleccion',
    render:
      c.tipo === 'multiseleccion'
        ? (f) => (
            <SelectorArray
              valores={Array.isArray(f[c.key]) ? (f[c.key] as string[]) : []}
              opciones={c.opciones ?? []}
              editable={efectivos.editar === true}
              onCambiar={(v) => editarCelda(String(f.id), c.key, v)}
            />
          )
        : undefined,
    // La clave natural no entra en los cambios en masa: poner el mismo
    // código en veinte filas sólo puede terminar mal.
    sinMasivo: c.key === clave,
    alinear: c.tipo === 'number' ? 'derecha' : undefined,
  }))

  async function editarCelda(id: string, key: string, valor: unknown) {
    const { error: e } = await supabase.from(tabla).update({ [key]: valor }).eq('id', id)
    if (e) {
      alert(e.message)
      return
    }
    router.refresh()
  }

  async function editarMasivo(ids: string[], cambios: Record<string, unknown>) {
    // Un solo UPDATE con `in`: es una sola vuelta al servidor por más filas
    // que se hayan marcado.
    const { error: e } = await supabase.from(tabla).update(cambios).in('id', ids)
    if (e) throw new Error(e.message)
    router.refresh()
  }

  async function eliminar(ids: string[]) {
    const { error: e } = await supabase.from(tabla).delete().in('id', ids)
    if (e) {
      // 23503 es la violación de llave foránea: el registro está en uso.
      throw new Error(
        e.code === '23503'
          ? 'No se puede eliminar: hay movimientos que usan alguno de estos registros. Desactívalos con el interruptor en vez de borrarlos, así el histórico no se rompe.'
          : e.message
      )
    }
    router.refresh()
  }

  async function crearFila() {
    setError(null)
    const faltante = campos.find(
      (c) => c.requerido && !(nuevaFila[c.key] ?? '').trim()
    )
    if (faltante) return setError(`Falta «${faltante.label}».`)

    setGuardando(true)
    const payload: Record<string, unknown> = Object.fromEntries(
      Object.entries(nuevaFila).filter(([, v]) => v !== '')
    )
    for (const [k, v] of Object.entries(nuevos)) if (v.length > 0) payload[k] = v

    const { error: e } = await supabase.from(tabla).insert(payload)
    setGuardando(false)
    if (e) return setError(e.message)
    setNuevaFila({})
    setNuevos({})
    setAbrirNuevo(false)
    router.refresh()
  }

  return (
    <>
      <TablaAvanzada
        titulo={titulo}
        columnas={columnas}
        filas={filas as FilaTabla[]}
        permisos={efectivos}
        vacio={{
          titulo: 'Sin registros',
          descripcion: 'Agrega el primero, o cárgalos todos desde Excel.',
        }}
        onEditarCelda={efectivos.editar ? editarCelda : undefined}
        onEditarMasivo={efectivos.editar ? editarMasivo : undefined}
        onEliminar={efectivos.eliminar ? eliminar : undefined}
        acciones={
          !soloLectura && (
            <>
              <Boton variante="secundario" tamano="sm" onClick={() => setAbrirImportar(true)}>
                Importar
              </Boton>
              <Boton tamano="sm" onClick={() => setAbrirNuevo(true)}>
                <IconPlus className="h-4 w-4" />
                Agregar
              </Boton>
            </>
          )
        }
      />

      <Modal
        abierto={abrirNuevo}
        onCerrar={() => setAbrirNuevo(false)}
        titulo={`Agregar a ${titulo}`}
        pie={
          <div className="flex gap-2">
            <Boton variante="secundario" className="flex-1" onClick={() => setAbrirNuevo(false)}>
              Cancelar
            </Boton>
            <Boton className="flex-1" onClick={crearFila} disabled={guardando}>
              {guardando ? 'Agregando…' : 'Agregar'}
            </Boton>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {camposTexto.map((c, i) => (
            <Campo key={c.key} etiqueta={c.label} requerido={c.requerido}>
              {c.tipo === 'multiseleccion' ? (
                <SelectorMultiple
                  etiqueta=""
                  opciones={(c.opciones ?? []).map((o) => ({ valor: o.value, etiqueta: o.label }))}
                  valores={nuevos[c.key] ?? []}
                  onCambiar={(v) => setNuevos((prev) => ({ ...prev, [c.key]: v }))}
                />
              ) : c.tipo === 'select' ? (
                <Selector
                  value={nuevaFila[c.key] ?? ''}
                  onChange={(e) => setNuevaFila((prev) => ({ ...prev, [c.key]: e.target.value }))}
                >
                  <option value="">—</option>
                  {(c.opciones ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Selector>
              ) : (
                <Entrada
                  type={c.tipo}
                  autoFocus={i === 0}
                  value={nuevaFila[c.key] ?? ''}
                  onChange={(e) => setNuevaFila((prev) => ({ ...prev, [c.key]: e.target.value }))}
                />
              )}
            </Campo>
          ))}
          {campoBool && (
            <p className="text-xs text-slate-400">
              El registro se crea activo por defecto; puedes desactivarlo después con el interruptor
              de la tabla.
            </p>
          )}
          {error && <Alerta>{error}</Alerta>}
        </div>
      </Modal>

      <ImportarExcel
        abierto={abrirImportar}
        onCerrar={() => setAbrirImportar(false)}
        tabla={tabla}
        titulo={titulo}
        campos={campos}
        filas={filas}
        clave={clave}
        relaciones={relaciones}
      />
    </>
  )
}
