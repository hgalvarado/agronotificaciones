'use client'

/**
 * El formulario de alta de un catálogo, en un modal.
 *
 * ── Por qué vive aparte (migración 68) ──────────────────────────────
 *
 * Estaba dentro de `CatalogoTable`, y eso lo dejaba encerrado en la
 * pantalla de Catálogos. Pero el alta de una persona hace falta en medio
 * de otra captura: se está anotando la cuadrilla del preriego, falta un
 * jornal, y salir a Catálogos a crearlo significa perder el formulario a
 * medio llenar.
 *
 * Lo que se reutiliza es el formulario ENTERO, no una copia reducida: si
 * mañana el catálogo de personal gana una columna obligatoria, la gana
 * en los dos sitios a la vez. Un segundo formulario «rápido» escrito a
 * mano es justo lo que acaba guardando fichas a las que les falta algo.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { Alerta, Boton, Campo, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { EntradaEtiquetas } from '@/components/ui/EntradaEtiquetas'
import type { CampoCatalogo } from './CatalogoTable'

export function FormularioCatalogo({
  abierto,
  tabla,
  titulo,
  campos,
  valoresIniciales,
  recargarRuta = true,
  onCerrar,
  onCreado,
}: {
  abierto: boolean
  tabla: string
  /** Nombre visible del catálogo. Da el título del modal. */
  titulo: string
  campos: CampoCatalogo[]
  /**
   * Lo que el alta trae ya decidido por el sitio desde el que se abre.
   *
   * El selector de cuadrilla manda `es_jornal: true`: quien se crea
   * desde ahí es un jornal, y preguntarlo sería pedirle al capataz que
   * conteste algo que el contexto ya contestó.
   */
  valoresIniciales?: Record<string, unknown>
  /**
   * Si al crear hay que pedirle al servidor que vuelva a renderizar.
   *
   * En Catálogos sí: la tabla la pinta el servidor. Dentro de un
   * formulario de captura **no**, porque un `router.refresh()` rehace el
   * árbol y se lleva por delante lo que se llevaba escrito.
   */
  recargarRuta?: boolean
  onCerrar: () => void
  /** El id de lo recién creado, para poder elegirlo en el acto. */
  onCreado?: (id: string, fila: Record<string, unknown>) => void
}) {
  const supabase = createClient()
  const router = useRouter()
  const [valores, setValores] = useState<Record<string, string>>({})
  // Los campos de array van aparte: no son texto y no se pueden guardar
  // en el mismo diccionario sin convertirlos al vuelo en cada lectura.
  const [arrays, setArrays] = useState<Record<string, string[]>>({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const camposTexto = campos.filter((c) => c.tipo !== 'checkbox')
  const campoBool = campos.find((c) => c.tipo === 'checkbox')

  async function crearEnCatalogo(destino: { tabla: string; campo?: string }, texto: string) {
    const fila: Record<string, unknown> = { [destino.campo ?? 'nombre']: texto.trim() }
    const { data, error: e } = await supabase
      .from(destino.tabla)
      .insert(fila as never)
      .select('id')
      .single()
    if (e) throw new Error(e.message)
    if (recargarRuta) router.refresh()
    return String((data as { id: string }).id)
  }

  function limpiar() {
    setValores({})
    setArrays({})
    setError(null)
  }

  async function crear() {
    setError(null)
    const faltante = campos.find((c) => c.requerido && !(valores[c.key] ?? '').trim())
    if (faltante) return setError(`Falta «${faltante.label}».`)

    setGuardando(true)
    const payload: Record<string, unknown> = {
      ...(valoresIniciales ?? {}),
      ...Object.fromEntries(Object.entries(valores).filter(([, v]) => v !== '')),
    }
    for (const [k, v] of Object.entries(arrays)) if (v.length > 0) payload[k] = v

    const { data, error: e } = await supabase
      .from(tabla)
      .insert(payload as never)
      .select('id')
      .single()
    setGuardando(false)

    if (e) {
      // El código repetido tiene su propio aviso desde la 68: «duplicate
      // key value violates unique constraint» no le dice nada a quien
      // está dando de alta a una persona en el campo.
      return setError(
        e.code === '23505'
          ? 'Ese código ya lo tiene otra persona. Búscala en la lista o ponle el suyo.'
          : e.message
      )
    }

    const id = String((data as { id: string }).id)
    limpiar()
    onCreado?.(id, payload)
    onCerrar()
    if (recargarRuta) router.refresh()
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={() => {
        limpiar()
        onCerrar()
      }}
      titulo={`Agregar a ${titulo}`}
      pie={
        <div className="flex gap-2">
          <Boton
            variante="secundario"
            className="flex-1"
            onClick={() => {
              limpiar()
              onCerrar()
            }}
          >
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={crear} disabled={guardando}>
            {guardando ? 'Agregando…' : 'Agregar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {camposTexto.map((c, i) => (
          <Campo key={c.key} etiqueta={c.label} requerido={c.requerido}>
            {c.tipo === 'etiquetas' ? (
              <EntradaEtiquetas
                valores={arrays[c.key] ?? []}
                onCambiar={(v) => setArrays((prev) => ({ ...prev, [c.key]: v }))}
                aria-label={c.label}
              />
            ) : c.tipo === 'multiseleccion' ? (
              <SelectorMultiple
                etiqueta=""
                opciones={(c.opciones ?? []).map((o) => ({ valor: o.value, etiqueta: o.label }))}
                valores={arrays[c.key] ?? []}
                onCambiar={(v) => setArrays((prev) => ({ ...prev, [c.key]: v }))}
                /* Crear lo que falta sin salir del formulario (migración
                   75). Lo que se guarda en la columna es el NOMBRE —es
                   un `text[]`—, así que se devuelve el texto y no el
                   identificador que acaba de nacer. */
                onCrear={
                  c.catalogo
                    ? async (texto) => {
                        try {
                          await crearEnCatalogo(c.catalogo!, texto)
                          return texto.trim()
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'No se pudo crear.')
                          return null
                        }
                      }
                    : undefined
                }
              />
            ) : c.tipo === 'select' ? (
              <SelectorBuscable
                valor={valores[c.key] ?? ''}
                onCambiar={(v) => setValores((prev) => ({ ...prev, [c.key]: v }))}
                opciones={(c.opciones ?? []).map((o) => ({ id: o.value, titulo: o.label }))}
                placeholder="—"
                creacionRapida={
                  c.catalogo
                    ? {
                        etiqueta: `Crear ${c.label.toLowerCase()}`,
                        campos: [{ key: 'nombre', label: 'Nombre', requerido: true }],
                        onCrear: async (vals) => {
                          const id = await crearEnCatalogo(c.catalogo!, vals.nombre ?? '')
                          return { id, titulo: (vals.nombre ?? '').trim() }
                        },
                      }
                    : undefined
                }
              />
            ) : (
              <Entrada
                type={c.tipo}
                autoFocus={i === 0}
                value={valores[c.key] ?? ''}
                onChange={(e) => setValores((prev) => ({ ...prev, [c.key]: e.target.value }))}
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
  )
}

/**
 * Los campos del catálogo de Personal.
 *
 * Están aquí y no en la página de Catálogos porque ahora los usan dos
 * sitios, y la página es un componente de servidor del que un formulario
 * de captura no puede importar. `tipo_perfil` se queda fuera a
 * propósito: lo pregunta Catálogos, donde se da de alta a alguien con
 * calma, y no el capataz que está anotando la cuadrilla del preriego.
 */
export const CAMPOS_PERSONAL: CampoCatalogo[] = [
  { key: 'codigo', label: 'Código', tipo: 'text' },
  { key: 'nombre', label: 'Nombre', tipo: 'text', requerido: true },
]

/** Los campos del catálogo de Planes nutricionales, por lo mismo. */
export const CAMPOS_PLAN_NUTRICIONAL: CampoCatalogo[] = [
  { key: 'codigo', label: 'Código', tipo: 'text' },
  { key: 'nombre', label: 'Plan nutricional', tipo: 'text', requerido: true },
  { key: 'descripcion', label: 'Descripción', tipo: 'text' },
]
