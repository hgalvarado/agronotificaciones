'use client'

/**
 * Selector de OBJETIVOS de Inyección (sql/132): lista del catálogo con buscador, interruptor «Uno solo / Varios» y alta
 * rápida («No encuentro el objetivo → Agregar») con revisión de duplicados MIENTRAS se escribe. Con señal el alta pasa
 * por `fn_iny_objetivo_agregar` (devuelve el existente si ya estaba); sin señal queda creado en el teléfono (id propio)
 * y la base vuelve a validar al enviar la aplicación: si ya existe, la enlaza al existente y no crea otro.
 */

import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo, Entrada } from '@/components/ui/Primitivos'
import { IconCheck, IconChevronDown, IconSearch } from '@/components/ui/Icons'
import { nuevoId } from '@/lib/fertirriego/operaciones'
import { createClient } from '@/lib/supabase/client'
import {
  buscarDuplicado,
  crearObjetivoLocal,
  normalizarObjetivo,
  objetivosElegibles,
  TIPOS_SUGERIDOS,
  validarNombreObjetivo,
  type ObjetivoCatalogo,
} from '@/lib/inyeccion/objetivos'

type Modo = 'unica' | 'varios'

export function SelectorObjetivos({
  catalogo,
  locales,
  seleccion,
  onCambiar,
  onAgregado,
}: {
  /** Catálogo bajado de la base (todos: activos, inactivos y fusionados). */
  catalogo: ObjetivoCatalogo[]
  /** Creados en este teléfono y aún no bajados con el catálogo. */
  locales: ObjetivoCatalogo[]
  seleccion: string[]
  onCambiar: (ids: string[]) => void
  onAgregado: (o: ObjetivoCatalogo) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [modo, setModo] = useState<Modo>('varios')
  const [agregando, setAgregando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('Plaga')
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const todos = useMemo(() => [...catalogo, ...locales.filter((l) => !catalogo.some((c) => c.id === l.id))], [catalogo, locales])
  const elegibles = useMemo(() => objetivosElegibles(todos), [todos])
  const marcados = useMemo(() => new Set(seleccion), [seleccion])
  const nombres = (id: string) => todos.find((o) => o.id === id)?.nombre ?? '(objetivo)'

  const filtrados = useMemo(() => {
    const q = normalizarObjetivo(busqueda)
    const crudo = busqueda.trim().toLowerCase()
    if (!q && !crudo) return elegibles
    return elegibles.filter((o) => normalizarObjetivo(o.nombre).includes(q) || o.nombre.toLowerCase().includes(crudo) || o.tipo.toLowerCase().includes(crudo))
  }, [elegibles, busqueda])

  const dup = useMemo(() => (nombre.trim() ? buscarDuplicado(nombre, catalogo, locales) : null), [nombre, catalogo, locales])
  const errorNombre = nombre.trim() ? validarNombreObjetivo(nombre) : null

  function cerrar() {
    setAbierto(false)
    setBusqueda('')
    setAgregando(false)
    setNombre('')
    setAviso(null)
  }

  function alternar(id: string) {
    if (modo === 'unica') {
      onCambiar(marcados.has(id) && marcados.size === 1 ? [] : [id])
      cerrar()
      return
    }
    onCambiar(marcados.has(id) ? seleccion.filter((x) => x !== id) : [...seleccion, id])
  }

  function cambiarModo(m: Modo) {
    setModo(m)
    if (m === 'unica' && seleccion.length > 1) onCambiar([seleccion[0]])
  }

  function marcar(id: string) {
    onCambiar(modo === 'unica' ? [id] : marcados.has(id) ? seleccion : [...seleccion, id])
  }

  async function agregar() {
    const e = validarNombreObjetivo(nombre)
    if (e) return setAviso(e)
    if (dup?.duplicado) {
      marcar(dup.existente.id)
      setAviso(null)
      return cerrar()
    }
    setGuardando(true)
    setAviso(null)
    const id = nuevoId()
    let objetivo: ObjetivoCatalogo | null = null
    if (typeof navigator === 'undefined' || navigator.onLine) {
      try {
        const supabase = createClient()
        const { data, error } = await supabase.rpc('fn_iny_objetivo_agregar', { p: { id, nombre: nombre.trim(), tipo } })
        if (error) throw new Error(error.message)
        const r = data as { creado: boolean; existente: boolean; objetivo: ObjetivoCatalogo }
        objetivo = r.objetivo
      } catch (err) {
        const m = err instanceof Error ? err.message : ''
        // Un rechazo claro de la base (nombre inválido, sin permiso) se muestra; un corte de red cae al alta local
        if (!/fetch|network|Failed|Load failed/i.test(m)) {
          setGuardando(false)
          return setAviso(m || 'No se pudo agregar el objetivo.')
        }
      }
    }
    if (!objetivo) objetivo = crearObjetivoLocal(nombre, tipo, id)
    onAgregado(objetivo)
    marcar(objetivo.id)
    setGuardando(false)
    cerrar()
  }

  const resumen =
    seleccion.length === 0 ? null : seleccion.length <= 2 ? seleccion.map(nombres).join(', ') : `${seleccion.length} objetivos`

  return (
    <div data-selector-objetivos>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        data-abrir-objetivos
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left text-base shadow-[var(--shadow-card)] focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
      >
        <span className="min-w-0 flex-1 break-words">
          {resumen ? <span className="text-slate-900">{resumen}</span> : <span className="text-slate-400">Elegir objetivos…</span>}
        </span>
        <IconChevronDown className="h-5 w-5 shrink-0 text-slate-300" />
      </button>
      {seleccion.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" data-objetivos-elegidos>
          {seleccion.map((id) => (
            <span key={id} data-objetivo={id} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800 ring-1 ring-inset ring-brand-200">
              {nombres(id)}
            </span>
          ))}
        </div>
      )}

      <Modal
        abierto={abierto}
        onCerrar={cerrar}
        titulo={agregando ? 'Agregar objetivo' : 'Objetivos'}
        pie={
          agregando ? (
            <div className="flex gap-2">
              <Boton variante="secundario" className="min-h-11 flex-1" onClick={() => setAgregando(false)} disabled={guardando}>
                Volver
              </Boton>
              <Boton className="min-h-11 flex-1" onClick={agregar} disabled={guardando || !nombre.trim() || Boolean(errorNombre)} data-guardar-objetivo>
                {guardando ? 'Guardando…' : dup?.duplicado ? 'Usar el existente' : 'Guardar'}
              </Boton>
            </div>
          ) : (
            <Boton className="min-h-11 w-full" onClick={cerrar} data-listo-objetivos>
              Listo{seleccion.length ? ` (${seleccion.length})` : ''}
            </Boton>
          )
        }
      >
        {agregando ? (
          <div className="flex flex-col gap-4">
            <Campo etiqueta="Nombre del objetivo" requerido>
              <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus maxLength={80} data-nombre-objetivo />
            </Campo>
            {dup?.duplicado && (
              <div data-objetivo-duplicado>
                <Alerta tono="ambar">
                  Ya existe: <strong>{dup.existente.nombre}</strong>
                  {dup.existente.activo ? '' : ' (inactivo)'}. Elige ese en lugar de crear otro.
                </Alerta>
              </div>
            )}
            {errorNombre && <Alerta>{errorNombre}.</Alerta>}
            <Campo etiqueta="Tipo (puedes escribir otro)">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de objetivo">
                {TIPOS_SUGERIDOS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={tipo === t}
                    onClick={() => setTipo(t)}
                    className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-inset ${tipo === t ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <Entrada value={tipo} onChange={(e) => setTipo(e.target.value)} maxLength={40} className="mt-2" data-tipo-objetivo />
            </Campo>
            <p className="text-xs text-slate-500">Queda «por revisar»: la Torre de Control lo aprueba, lo renombra o lo une a otro. Sin señal se guarda en el teléfono.</p>
            {aviso && <Alerta>{aviso}</Alerta>}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar objetivo…"
                inputMode="search"
                data-buscar-objetivo
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-9 pr-3 text-base focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-600/10"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="Modo de selección">
              {([['unica', 'Uno solo'], ['varios', 'Varios']] as [Modo, string][]).map(([m, t]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={modo === m}
                  onClick={() => cambiarModo(m)}
                  data-modo-objetivos={m}
                  className={`min-h-11 flex-1 rounded-md px-2 text-sm font-semibold ${modo === m ? 'bg-white text-brand-700 shadow-[var(--shadow-card)]' : 'text-slate-500'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex flex-col">
              {filtrados.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => alternar(o.id)}
                  data-opcion-objetivo={o.id}
                  aria-pressed={marcados.has(o.id)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-base text-slate-800 hover:bg-slate-50"
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center border ${modo === 'unica' ? 'rounded-full' : 'rounded'} ${marcados.has(o.id) ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'}`}>
                    {marcados.has(o.id) && <IconCheck className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 break-words">
                    {o.nombre} <span className="text-xs text-slate-500">· {o.tipo}</span>
                    {!o.revisado && <span className="ml-1 text-xs font-semibold text-amber-700">por revisar</span>}
                  </span>
                </button>
              ))}
              {filtrados.length === 0 && <p className="px-2 py-3 text-sm text-slate-500">Ningún objetivo coincide.</p>}
            </div>
            <button
              type="button"
              onClick={() => {
                setNombre(busqueda.trim())
                setTipo('Plaga')
                setAviso(null)
                setAgregando(true)
              }}
              data-agregar-objetivo
              className="min-h-11 rounded-xl border border-dashed border-brand-600/40 bg-brand-50/50 px-3.5 py-2.5 text-left text-sm font-semibold text-brand-800 hover:bg-brand-50"
            >
              + No encuentro el objetivo → Agregar{busqueda.trim() ? ` «${busqueda.trim()}»` : ''}
            </button>
            {aviso && <Alerta tono="ambar">{aviso}</Alerta>}
          </div>
        )}
      </Modal>
    </div>
  )
}
