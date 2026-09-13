'use client'

/**
 * Gestor de vistas de tabla, al estilo de los layouts de SAP.
 *
 * El Administrador guarda el «Estándar de la empresa», que es lo que ve
 * todo el mundo al entrar; cada usuario puede además guardarse las suyas
 * y alternar entre ellas.
 *
 * No sabe filtrar ni dibujar la tabla: recibe las columnas que existen,
 * devuelve cuáles se ven y en qué orden. Combinar lo guardado con lo que
 * el código ofrece hoy es de `lib/grid/vistas` (puro), y leer y escribir
 * de `repositorioVistas`.
 */

import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Alerta, Boton, Campo, Entrada } from './Primitivos'
import { IconCheck, IconSettings, IconTrash } from './Icons'
import { mensajeDeError } from '@/lib/errores'
import { eliminarVista, guardarVista, leerVistas } from '@/lib/grid/repositorioVistas'
import {
  alternarVisible,
  aplicarVista,
  contarVisibles,
  fusionar,
  hayCambios,
  mover,
  vistaDeFabrica,
  type ColumnaVista,
  type VistaTabla,
} from '@/lib/grid/vistas'
import type { ColumnaGrid } from '@/lib/grid/tipos'

export { aplicarVista }

const FABRICA = '__fabrica__'

export function GestorVistas<T>({
  pantalla,
  columnas,
  vista,
  onVista,
  esAdmin,
}: {
  /** Clave con la que se guardan las vistas de esta tabla. */
  pantalla: string
  columnas: ColumnaGrid<T>[]
  /** La vista de trabajo actual; `null` mientras carga. */
  vista: ColumnaVista[] | null
  onVista: (v: ColumnaVista[]) => void
  esAdmin: boolean
}) {
  const [guardadas, setGuardadas] = useState<VistaTabla[]>([])
  const [elegida, setElegida] = useState<string>(FABRICA)
  const [abierto, setAbierto] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Al montar se traen las vistas y se aplica la que corresponde: la
  // personal marcada, o el estándar de la empresa, o todas las columnas.
  // Va en un efecto porque es una consulta, no un valor derivado.
  useEffect(() => {
    let vivo = true
    async function cargar() {
      const { vistas, error: e } = await leerVistas(pantalla)
      if (!vivo) return
      if (e) {
        // Sin la migración 30 la tabla no existe: la pantalla sigue
        // funcionando con todas las columnas en vez de quedarse en blanco.
        setError(null)
        onVista(vistaDeFabrica(columnas))
        return
      }
      setGuardadas(vistas)
      const estandar = vistas.find((v) => v.es_estandar)
      if (estandar) {
        setElegida(estandar.id)
        onVista(fusionar(columnas, estandar.columnas))
      } else {
        onVista(vistaDeFabrica(columnas))
      }
    }
    cargar()
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pantalla])

  function elegir(id: string) {
    setElegida(id)
    if (id === FABRICA) return onVista(vistaDeFabrica(columnas))
    const v = guardadas.find((x) => x.id === id)
    if (v) onVista(fusionar(columnas, v.columnas))
  }

  const actual = guardadas.find((v) => v.id === elegida) ?? null
  const modificada = vista !== null && hayCambios(vista, actual?.columnas ?? null)

  return (
    <>
      <div className="flex items-center gap-1.5">
        <select
          value={elegida}
          onChange={(e) => elegir(e.target.value)}
          aria-label="Vista de columnas"
          className="h-9 max-w-[190px] rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-600 focus:border-brand-600 focus:outline-none"
        >
          <option value={FABRICA}>Todas las columnas</option>
          {guardadas.map((v) => (
            <option key={v.id} value={v.id}>
              {v.es_estandar ? `★ ${v.nombre}` : v.nombre}
            </option>
          ))}
        </select>

        <Boton variante="secundario" tamano="sm" onClick={() => setAbierto(true)}>
          <IconSettings className="h-4 w-4" />
          Columnas
          {vista && <span className="ml-1 text-slate-400">({contarVisibles(vista)})</span>}
          {modificada && <span className="ml-0.5 text-brand-600">•</span>}
        </Boton>
      </div>

      {abierto && vista && (
        <ModalColumnas
          pantalla={pantalla}
          columnas={columnas}
          vista={vista}
          onVista={onVista}
          esAdmin={esAdmin}
          guardadas={guardadas}
          elegida={elegida}
          onCerrar={() => setAbierto(false)}
          onRecargar={async (idNuevo) => {
            const { vistas } = await leerVistas(pantalla)
            setGuardadas(vistas)
            if (idNuevo) setElegida(idNuevo)
          }}
        />
      )}

      {error && (
        <div className="w-full">
          <Alerta>{error}</Alerta>
        </div>
      )}
    </>
  )
}

function ModalColumnas<T>({
  pantalla,
  columnas,
  vista,
  onVista,
  esAdmin,
  guardadas,
  elegida,
  onCerrar,
  onRecargar,
}: {
  pantalla: string
  columnas: ColumnaGrid<T>[]
  vista: ColumnaVista[]
  onVista: (v: ColumnaVista[]) => void
  esAdmin: boolean
  guardadas: VistaTabla[]
  elegida: string
  onCerrar: () => void
  onRecargar: (idNuevo?: string) => Promise<void>
}) {
  const [nombre, setNombre] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [problema, setProblema] = useState<string | null>(null)

  const etiquetas = new Map(columnas.map((c) => [c.campo, c.label || c.campo]))
  const actual = guardadas.find((v) => v.id === elegida) ?? null

  async function guardar(esEstandar: boolean) {
    const comoSeLlama = esEstandar
      ? 'Estándar de la empresa'
      : nombre.trim() || actual?.nombre.trim() || ''
    if (!esEstandar && !comoSeLlama) {
      return setProblema('Ponle un nombre a tu vista para poder volver a ella.')
    }
    if (contarVisibles(vista) === 0) {
      return setProblema('Deja al menos una columna visible.')
    }

    setProblema(null)
    setGuardando(true)
    const { id, error } = await guardarVista(pantalla, comoSeLlama, vista, esEstandar)
    setGuardando(false)

    if (error) {
      return setProblema(
        mensajeDeError(
          error,
          'No se pudo guardar la vista. Si dice que no existe «vistas_tabla», falta correr la migración 30.'
        )
      )
    }
    setNombre('')
    setAviso(esEstandar ? 'Guardada como estándar de la empresa.' : `Vista «${comoSeLlama}» guardada.`)
    await onRecargar(id ?? undefined)
  }

  async function eliminar() {
    if (!actual) return
    if (!confirm(`Se va a eliminar la vista «${actual.nombre}». ¿Continuar?`)) return
    const { error } = await eliminarVista(actual.id)
    if (error) return setProblema(mensajeDeError(error, 'No se pudo eliminar la vista.'))
    onVista(vistaDeFabrica(columnas))
    await onRecargar()
    onCerrar()
  }

  const puedeEliminarEsta = actual !== null && (!actual.es_estandar || esAdmin)

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo="Columnas de la tabla"
      pie={
        <div className="flex flex-wrap gap-2">
          {puedeEliminarEsta && (
            <Boton variante="peligro" tamano="sm" onClick={eliminar} disabled={guardando}>
              <IconTrash className="h-4 w-4" />
              Eliminar vista
            </Boton>
          )}
          <div className="ml-auto flex gap-2">
            <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Boton>
            {esAdmin && (
              <Boton variante="secundario" onClick={() => guardar(true)} disabled={guardando}>
                Guardar como estándar
              </Boton>
            )}
            <Boton onClick={() => guardar(false)} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Boton>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {problema && <Alerta>{problema}</Alerta>}
        {aviso && <Alerta tono="azul">{aviso}</Alerta>}

        <p className="text-sm text-slate-500">
          Marca lo que quieres ver y ordénalo con las flechas. Los cambios se aplican en cuanto los
          tocas; guárdalos si quieres volver a esta vista otro día.
        </p>

        <Campo
          etiqueta="Nombre de la vista"
          ayuda={
            esAdmin
              ? 'Con «Guardar como estándar» pasa a ser la vista por omisión de toda la empresa.'
              : 'Tu vista es sólo tuya. Nadie más la ve.'
          }
        >
          <Entrada
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder={actual && !actual.es_estandar ? actual.nombre : 'ej. Mis columnas'}
          />
        </Campo>

        <div className="scroll-suave max-h-80 overflow-y-auto rounded-xl border border-slate-200">
          {vista.map((v, i) => (
            <div
              key={v.campo}
              className="flex items-center gap-2 border-b border-slate-100 px-2 py-1.5 last:border-0"
            >
              <button
                type="button"
                onClick={() => onVista(alternarVisible(vista, v.campo))}
                aria-label={`Mostrar ${etiquetas.get(v.campo)}`}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  v.visible
                    ? 'border-brand-700 bg-brand-700 text-white'
                    : 'border-slate-300 bg-white'
                }`}
              >
                {v.visible && <IconCheck className="h-3 w-3" />}
              </button>

              <span
                className={`flex-1 truncate text-sm ${
                  v.visible ? 'text-slate-700' : 'text-slate-400 line-through'
                }`}
              >
                {etiquetas.get(v.campo) ?? v.campo}
              </span>

              <button
                type="button"
                onClick={() => onVista(mover(vista, v.campo, -1))}
                disabled={i === 0}
                aria-label="Subir"
                className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => onVista(mover(vista, v.campo, 1))}
                disabled={i === vista.length - 1}
                aria-label="Bajar"
                className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
              >
                ▼
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onVista(vistaDeFabrica(columnas))}
          className="self-start text-xs font-semibold text-brand-700 hover:underline"
        >
          Restablecer todas las columnas
        </button>
      </div>
    </Modal>
  )
}
