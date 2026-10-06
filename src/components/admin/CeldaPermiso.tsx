'use client'

/**
 * Una celda de la matriz de permisos.
 *
 * Hasta la 52 era una casilla: marcada o no. Desde la 53 un permiso son
 * tres decisiones —si se permite, sobre qué filas, y bajo qué estado del
 * registro— y una casilla no puede expresar tres cosas. Aquí el botón
 * sigue leyéndose de un vistazo —vacío, o con la letra del alcance— y al
 * tocarlo se abre el panel con las tres.
 *
 * El panel va por `createPortal` sobre `document.body` con
 * `position: fixed` y su sitio lo calcula `anclarPanel`: dentro de la
 * tabla, con su `overflow-x-auto`, cualquier otra cosa queda recortada,
 * y la fila de abajo abriría el panel fuera de la ventana.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { anclarA, type Anclaje } from '@/lib/ui/anclaje'
import { Boton } from '@/components/ui/Primitivos'
import { IconCheck } from '@/components/ui/Icons'
import {
  ALCANCES,
  CONDICIONES,
  letraDeAlcance,
  resumenPermiso,
  type ConfigPermiso,
} from '@/lib/permisos/abac'

const ANCHO = 280

export function CeldaPermiso({
  config,
  escribe,
  titulo,
  etiqueta,
  ocupada = false,
  compacta = false,
  onGuardar,
}: {
  config: ConfigPermiso
  /** La acción modifica datos: sólo entonces la condición significa algo. */
  escribe: boolean
  /** Lo que encabeza el panel: «Editar · Tickets». */
  titulo: string
  /** Para el lector de pantalla y para la ficha del celular. */
  etiqueta: string
  ocupada?: boolean
  /** En el celular la celda es una ficha con su nombre, no un cuadrito. */
  compacta?: boolean
  onGuardar: (config: ConfigPermiso) => void
}) {
  const [posicion, setPosicion] = useState<Anclaje | null>(null)
  const boton = useRef<HTMLButtonElement>(null)

  // La posición se calcula en el CLIC: leer `ref.current` durante el
  // render es lo que prohíbe `react-hooks/refs`.
  function alternar(e: React.MouseEvent<HTMLButtonElement>) {
    if (posicion) return setPosicion(null)
    setPosicion(anclarA(e.currentTarget, { ancho: ANCHO, altoDeseado: 420 }))
  }

  const letra = letraDeAlcance(config)
  const acotado = config.permitido && escribe && config.condicion !== 'sin_restriccion'

  return (
    <>
      <button
        ref={boton}
        type="button"
        onClick={alternar}
        disabled={ocupada}
        aria-haspopup="dialog"
        aria-expanded={posicion !== null}
        aria-label={`${etiqueta}: ${resumenPermiso(config, escribe)}`}
        title={resumenPermiso(config, escribe)}
        className={
          compacta
            ? `inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold transition-all disabled:opacity-40 ${
                config.permitido
                  ? 'bg-brand-700 text-white'
                  : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200'
              }`
            : `relative mx-auto flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-bold transition-all disabled:opacity-40 ${
                config.permitido
                  ? 'border-brand-700 bg-brand-700 text-white'
                  : 'border-slate-300 bg-white text-transparent hover:border-brand-400'
              }`
        }
      >
        {compacta ? (
          <>
            {config.permitido && <IconCheck className="h-3 w-3" />}
            {etiqueta}
            {config.permitido && letra !== 'G' && (
              <span className="rounded bg-white/25 px-1 text-[10px] leading-4">{letra}</span>
            )}
          </>
        ) : (
          config.permitido && letra
        )}

        {/* El punto dice que la condición recorta, sin gastar otra
            columna. La matriz ya es ancha. */}
        {acotado && (
          <span
            className={
              compacta
                ? 'h-1.5 w-1.5 rounded-full bg-amber-300'
                : 'absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white'
            }
          />
        )}
      </button>

      {posicion && (
        <Panel
          posicion={posicion}
          anclaje={boton}
          config={config}
          escribe={escribe}
          titulo={titulo}
          onCerrar={() => setPosicion(null)}
          onGuardar={(c) => {
            setPosicion(null)
            onGuardar(c)
          }}
        />
      )}
    </>
  )
}

function Panel({
  posicion,
  anclaje,
  config,
  escribe,
  titulo,
  onCerrar,
  onGuardar,
}: {
  posicion: Anclaje
  anclaje: React.RefObject<HTMLButtonElement | null>
  config: ConfigPermiso
  escribe: boolean
  titulo: string
  onCerrar: () => void
  onGuardar: (config: ConfigPermiso) => void
}) {
  const [borrador, setBorrador] = useState<ConfigPermiso>(config)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      // Aquí sí se puede leer `.current`: es un manejador de eventos, no
      // el cuerpo del render.
      if (panel.current?.contains(e.target as Node)) return
      if (anclaje.current?.contains(e.target as Node)) return
      onCerrar()
    }
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [anclaje, onCerrar])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={titulo}
      style={{
        left: posicion.left,
        top: posicion.top,
        width: posicion.ancho,
        maxHeight: posicion.maxAlto,
      }}
      className="scroll-suave fixed z-50 flex flex-col overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white text-left normal-case shadow-[var(--shadow-raised)]"
    >
      <div className="sticky top-0 border-b border-slate-100 bg-white px-3 py-2">
        <p className="truncate text-xs font-bold uppercase tracking-wide text-slate-400">
          {titulo}
        </p>
      </div>

      {/* ------------------------- ¿Se permite? ------------------------- */}
      <button
        type="button"
        onClick={() => setBorrador({ ...borrador, permitido: !borrador.permitido })}
        className="flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50"
      >
        <span className="text-sm font-semibold text-slate-800">Se permite</span>
        <span
          className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
            borrador.permitido ? 'bg-brand-700' : 'bg-slate-200'
          }`}
        >
          <span
            className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
              borrador.permitido ? 'translate-x-4' : ''
            }`}
          />
        </span>
      </button>

      {/* ---------------------------- Alcance ---------------------------- */}
      <Grupo titulo="Alcance" activo={borrador.permitido}>
        {ALCANCES.map((a) => (
          <Opcion
            key={a.valor}
            nombre={a.nombre}
            detalle={a.detalle}
            marcada={borrador.alcance === a.valor}
            deshabilitada={!borrador.permitido}
            onElegir={() => setBorrador({ ...borrador, alcance: a.valor })}
          />
        ))}
      </Grupo>

      {/* --------------------------- Condición --------------------------- */}
      {/* Sólo en las acciones que escriben: `fn_verificar_permiso` salta
          la condición en las de lectura, así que ofrecerla en «Ver»
          sería prometer un candado que la base no aplica. */}
      {escribe && (
        <Grupo titulo="Condición" activo={borrador.permitido}>
          {CONDICIONES.map((c) => (
            <Opcion
              key={c.valor}
              nombre={c.nombre}
              detalle={c.detalle}
              marcada={borrador.condicion === c.valor}
              deshabilitada={!borrador.permitido}
              onElegir={() => setBorrador({ ...borrador, condicion: c.valor })}
            />
          ))}
        </Grupo>
      )}

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-100 bg-white px-3 py-2">
        <Boton variante="secundario" tamano="sm" onClick={onCerrar}>
          Cancelar
        </Boton>
        <Boton tamano="sm" onClick={() => onGuardar(borrador)}>
          Guardar
        </Boton>
      </div>
    </div>,
    document.body
  )
}

function Grupo({
  titulo,
  activo,
  children,
}: {
  titulo: string
  activo: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`border-t border-slate-100 py-1 ${activo ? '' : 'opacity-40'}`}>
      <p className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        {titulo}
      </p>
      {children}
    </div>
  )
}

function Opcion({
  nombre,
  detalle,
  marcada,
  deshabilitada,
  onElegir,
}: {
  nombre: string
  detalle: string
  marcada: boolean
  deshabilitada: boolean
  onElegir: () => void
}) {
  return (
    <button
      type="button"
      disabled={deshabilitada}
      onClick={onElegir}
      className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all ${
          marcada ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'
        }`}
      >
        {marcada && <IconCheck className="h-2.5 w-2.5" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">{nombre}</span>
        <span className="block text-xs leading-snug text-slate-400">{detalle}</span>
      </span>
    </button>
  )
}
