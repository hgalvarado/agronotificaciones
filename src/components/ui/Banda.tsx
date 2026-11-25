/**
 * Lenguaje visual de las listas: el COLOR vive en una banda vertical fina al margen izquierdo de la fila
 * (nunca en el fondo ni en puntos) y en una insignia sobria (borde + texto + icono, sin relleno).
 * Una sola pieza para bitácora, Inyección y lo que venga.
 */

import type { CSSProperties, ReactNode } from 'react'
import type { Tono } from '@/components/ui/Primitivos'

/**
 * Banda de 4 px con esquinas redondeadas.
 * - `absoluta`: se coloca en el margen izquierdo de un contenedor `relative` (la fila completa).
 * - por defecto: ocupa una columna de una rejilla y se estira a la altura de su línea.
 * El color llega como clase Tailwind (`clase`) o como valor CSS (`color`, p. ej. `var(--mov-recepcion-borde)`).
 */
export function BandaLateral({ clase = '', color, absoluta = false }: { clase?: string; color?: string; absoluta?: boolean }) {
  const estilo: CSSProperties | undefined = color ? { backgroundColor: color } : undefined
  return (
    <span
      aria-hidden="true"
      data-banda
      className={`block shrink-0 rounded-full ${absoluta ? 'absolute inset-y-2 left-1' : 'self-stretch'} ${clase}`}
      style={{ width: 4, minHeight: 12, ...estilo }}
    />
  )
}

/** Fila con banda: banda de 4 px + contenido que ocupa el resto (flex estándar, sin clases arbitrarias). */
export function FilaConBanda({ clase, color, className = '', children }: { clase?: string; color?: string; className?: string; children: ReactNode }) {
  return (
    <span className={`flex items-stretch gap-2.5 ${className}`}>
      <BandaLateral clase={clase} color={color} />
      <span className="min-w-0 flex-1">{children}</span>
    </span>
  )
}

const SOBRIA: Record<Tono, string> = {
  verde: 'text-emerald-800 ring-emerald-600/30',
  ambar: 'text-amber-800 ring-amber-600/30',
  azul: 'text-sky-800 ring-sky-600/30',
  rojo: 'text-red-800 ring-red-600/30',
  gris: 'text-slate-600 ring-slate-300',
  violeta: 'text-violet-800 ring-violet-600/30',
} as Record<Tono, string>

/** Insignia sobria: solo borde fino + texto del color + icono; sin fondo de color. */
export function InsigniaSobria({ tono = 'gris', children }: { tono?: Tono; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none ring-1 ring-inset ${SOBRIA[tono]}`}>{children}</span>
  )
}
