'use client'

import { IconoMenu } from '@/components/ui/iconosMenu'
import { useLetraGrande } from '@/lib/campo/letraGrande'

/**
 * Franja de arriba de cada módulo de Campo: el nombre del módulo centrado y grande (que se vea a simple vista dónde está
 * la persona), la estación debajo y el botón «Ver mejor» (letra grande + alto contraste, guardado en el teléfono).
 * Envuelve también la clase `campo-legible` (contraste base para todos) a través de `ContenedorCampo`.
 */
export function EncabezadoModulo({ titulo, icono, subtitulo }: { titulo: string; icono: string; subtitulo?: string | null }) {
  const { activa, alternar } = useLetraGrande()
  return (
    <header data-encabezado-modulo={titulo} className="rounded-2xl bg-brand-700 px-3 py-3 text-white shadow-sm">
      <div className="flex items-center justify-center gap-2">
        <IconoMenu nombre={icono} className="h-7 w-7 shrink-0" />
        <h1 className="text-center text-2xl font-extrabold tracking-tight text-white">{titulo}</h1>
      </div>
      {subtitulo && <p className="mt-0.5 text-center text-base font-semibold text-white" data-subtitulo-modulo>{subtitulo}</p>}
      <div className="mt-2 flex justify-center">
        <button
          type="button"
          aria-pressed={activa}
          onClick={alternar}
          data-ver-mejor={activa ? 'si' : 'no'}
          className={`min-h-11 rounded-full px-4 text-sm font-bold ring-2 ring-inset ring-white focus:outline-none focus-visible:ring-4 ${activa ? 'bg-white text-brand-800' : 'bg-brand-800 text-white'}`}
        >
          {activa ? '✓ Ver mejor (activado)' : 'Aa  Ver mejor'}
        </button>
      </div>
    </header>
  )
}

/** Contenedor de un módulo de Campo: aplica el contraste base para todos (grises más oscuros, casillas con borde marcado). */
export function ContenedorCampo({ children }: { children: React.ReactNode }) {
  return <div className="campo-legible flex flex-col gap-3">{children}</div>
}
