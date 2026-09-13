'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Alerta, Boton, Campo, Entrada } from './Primitivos'
import { IconCheck, IconChevronDown, IconPlus, IconSearch, IconX } from './Icons'

export type OpcionBuscable = {
  id: string
  titulo: string
  subtitulo?: string
}

// Campo de selección pensado para catálogos largos en celular:
// al tocarlo abre un panel con el buscador ya enfocado (el teclado del
// teléfono se abre solo), y opcionalmente permite crear un registro nuevo
// sin salir de la pantalla en la que estás.
export function SelectorBuscable({
  valor,
  opciones,
  onCambiar,
  placeholder = 'Selecciona…',
  etiquetaBusqueda = 'Buscar…',
  permitirVacio = true,
  textoVacio = 'Sin asignar',
  creacionRapida,
  disabled,
}: {
  valor: string
  opciones: OpcionBuscable[]
  onCambiar: (id: string) => void
  placeholder?: string
  etiquetaBusqueda?: string
  permitirVacio?: boolean
  textoVacio?: string
  disabled?: boolean
  creacionRapida?: {
    etiqueta: string
    campos: { key: string; label: string; requerido?: boolean }[]
    onCrear: (valores: Record<string, string>) => Promise<OpcionBuscable>
  }
}) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [creando, setCreando] = useState(false)
  const [nuevo, setNuevo] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refBusqueda = useRef<HTMLInputElement>(null)

  const seleccionada = opciones.find((o) => o.id === valor)

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return opciones
    return opciones.filter(
      (o) =>
        o.titulo.toLowerCase().includes(q) || (o.subtitulo ?? '').toLowerCase().includes(q)
    )
  }, [opciones, busqueda])

  // Enfocar el buscador al abrir dispara el teclado en el teléfono.
  //
  // `preventScroll` es lo que evita el brinco: al enfocar, el navegador
  // desplaza la página para dejar el campo a la vista, y con el modal
  // dentro de un contenedor fijo ese desplazamiento movía el modal
  // entero. El modal ya está anclado arriba, así que el campo se ve sin
  // necesidad de desplazar nada.
  useEffect(() => {
    if (!abierto) return
    const t = setTimeout(() => refBusqueda.current?.focus({ preventScroll: true }), 120)
    return () => clearTimeout(t)
  }, [abierto])

  function cerrar() {
    setAbierto(false)
    setBusqueda('')
    setCreando(false)
    setNuevo({})
    setError(null)
  }

  function elegir(id: string) {
    onCambiar(id)
    cerrar()
  }

  async function crear() {
    if (!creacionRapida) return
    const faltante = creacionRapida.campos.find((c) => c.requerido && !nuevo[c.key]?.trim())
    if (faltante) {
      setError(`${faltante.label} es obligatorio.`)
      return
    }

    setError(null)
    setGuardando(true)
    try {
      const opcion = await creacionRapida.onCrear(nuevo)
      setGuardando(false)
      onCambiar(opcion.id)
      cerrar()
    } catch (e) {
      setGuardando(false)
      setError(e instanceof Error ? e.message : 'No se pudo crear.')
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAbierto(true)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left text-base shadow-[var(--shadow-card)] transition-colors hover:border-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10 disabled:bg-slate-50 disabled:text-slate-400"
      >
        <span className="min-w-0 flex-1">
          {seleccionada ? (
            <>
              <span className="block truncate text-slate-900">{seleccionada.titulo}</span>
              {seleccionada.subtitulo && (
                <span className="block truncate text-xs text-slate-400">
                  {seleccionada.subtitulo}
                </span>
              )}
            </>
          ) : (
            <span className="block truncate text-slate-300">{placeholder}</span>
          )}
        </span>
        <IconChevronDown className="h-5 w-5 shrink-0 text-slate-300" />
      </button>

      <Modal
        abierto={abierto}
        onCerrar={cerrar}
        titulo={creando ? creacionRapida?.etiqueta ?? 'Nuevo' : placeholder}
        pie={
          creando ? (
            <div className="flex gap-2">
              <Boton
                variante="secundario"
                className="flex-1"
                onClick={() => {
                  setCreando(false)
                  setError(null)
                }}
                disabled={guardando}
              >
                Volver
              </Boton>
              <Boton className="flex-1" onClick={crear} disabled={guardando}>
                {guardando ? 'Creando…' : 'Crear y usar'}
              </Boton>
            </div>
          ) : undefined
        }
      >
        {creando && creacionRapida ? (
          <div className="flex flex-col gap-4">
            {creacionRapida.campos.map((c) => (
              <Campo key={c.key} etiqueta={c.label} requerido={c.requerido}>
                <Entrada
                  value={nuevo[c.key] ?? ''}
                  onChange={(e) => setNuevo((p) => ({ ...p, [c.key]: e.target.value }))}
                  autoFocus={c === creacionRapida.campos[0]}
                />
              </Campo>
            ))}
            {error && <Alerta>{error}</Alerta>}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* El buscador queda pegado arriba mientras la lista corre
                por debajo: con el teclado abierto el alto útil es de
                unas pocas filas, y si el campo se fuera con el scroll no
                se vería lo que se está escribiendo. */}
            <div className="sticky -top-4 z-10 -mx-1 bg-white px-1 pb-1 pt-4">
              <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              <input
                ref={refBusqueda}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder={etiquetaBusqueda}
                inputMode="search"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-9 pr-9 text-base placeholder:text-slate-300 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-600/10"
              />
              {busqueda && (
                <button
                  type="button"
                  onClick={() => setBusqueda('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Limpiar"
                >
                  <IconX className="h-4 w-4" />
                </button>
              )}
              </div>
            </div>

            {creacionRapida && (
              <button
                type="button"
                onClick={() => {
                  // Lo que ya venía escrito se aprovecha como nombre inicial.
                  const primero = creacionRapida.campos[0]
                  setNuevo(busqueda.trim() ? { [primero.key]: busqueda.trim() } : {})
                  setCreando(true)
                }}
                className="flex items-center gap-2 rounded-xl border border-dashed border-brand-600/40 bg-brand-50/50 px-3.5 py-2.5 text-sm font-semibold text-brand-800 transition-colors hover:bg-brand-50"
              >
                <IconPlus className="h-4 w-4" />
                {creacionRapida.etiqueta}
                {busqueda.trim() && <span className="truncate font-normal">«{busqueda.trim()}»</span>}
              </button>
            )}

            <div className="flex flex-col">
              {permitirVacio && (
                <BotonOpcion
                  titulo={textoVacio}
                  marcado={!valor}
                  onClick={() => elegir('')}
                  tenue
                />
              )}

              {filtradas.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-slate-400">
                  Ningún resultado para «{busqueda}».
                </p>
              ) : (
                filtradas.map((o) => (
                  <BotonOpcion
                    key={o.id}
                    titulo={o.titulo}
                    subtitulo={o.subtitulo}
                    marcado={o.id === valor}
                    onClick={() => elegir(o.id)}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

function BotonOpcion({
  titulo,
  subtitulo,
  marcado,
  onClick,
  tenue,
}: {
  titulo: string
  subtitulo?: string
  marcado: boolean
  onClick: () => void
  tenue?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 border-b border-slate-50 px-2 py-3 text-left transition-colors last:border-0 ${
        marcado ? 'bg-brand-50/60' : 'hover:bg-slate-50'
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all ${
          marcado ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'
        }`}
      >
        {marcado && <IconCheck className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${tenue ? 'text-slate-400' : 'text-slate-800'}`}>
          {titulo}
        </span>
        {subtitulo && <span className="block truncate text-xs text-slate-400">{subtitulo}</span>}
      </span>
    </button>
  )
}
