// Primitivas de UI reutilizables. Todo el look de la app sale de aquí,
// así que cambiar un color o un radio en este archivo lo cambia en toda
// la plataforma.

import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

/* ------------------------------------------------------------------ */
/* Botón                                                               */
/* ------------------------------------------------------------------ */

type Variante = 'primario' | 'secundario' | 'suave' | 'peligro' | 'fantasma'
type Tamano = 'sm' | 'md' | 'lg'

const variantes: Record<Variante, string> = {
  primario:
    'bg-brand-700 text-white shadow-[var(--shadow-raised)] hover:bg-brand-800 active:bg-brand-900',
  secundario:
    'bg-white text-slate-700 border border-slate-200 shadow-[var(--shadow-card)] hover:bg-slate-50 hover:border-slate-300',
  suave: 'bg-brand-50 text-brand-800 hover:bg-brand-100',
  peligro: 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
  fantasma: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
}

const tamanos: Record<Tamano, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-13 px-5 text-base gap-2 rounded-xl',
}

const baseBoton =
  'inline-flex items-center justify-center font-semibold transition-all duration-150 ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2'

export function Boton({
  variante = 'primario',
  tamano = 'md',
  className = '',
  ...props
}: ComponentProps<'button'> & { variante?: Variante; tamano?: Tamano }) {
  return (
    <button className={`${baseBoton} ${variantes[variante]} ${tamanos[tamano]} ${className}`} {...props} />
  )
}

export function BotonLink({
  variante = 'primario',
  tamano = 'md',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variante?: Variante; tamano?: Tamano }) {
  return (
    <Link className={`${baseBoton} ${variantes[variante]} ${tamanos[tamano]} ${className}`} {...props} />
  )
}

/* ------------------------------------------------------------------ */
/* Tarjeta                                                             */
/* ------------------------------------------------------------------ */

export function Tarjeta({
  className = '',
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200/80 bg-white shadow-[var(--shadow-card)] ${className}`}
    >
      {children}
    </div>
  )
}

export function TarjetaEncabezado({
  titulo,
  contador,
  accion,
}: {
  titulo: string
  contador?: number
  accion?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
        {contador !== undefined && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
            {contador}
          </span>
        )}
      </div>
      {accion}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Insignias de estado                                                 */
/* ------------------------------------------------------------------ */

const tonos = {
  verde: 'bg-brand-50 text-brand-800 ring-brand-600/20',
  ambar: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  azul: 'bg-sky-50 text-sky-800 ring-sky-600/20',
  violeta: 'bg-violet-50 text-violet-800 ring-violet-600/20',
  gris: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  rojo: 'bg-red-50 text-red-700 ring-red-600/20',
} as const

export type Tono = keyof typeof tonos

export function Insignia({
  tono = 'gris',
  punto = false,
  children,
}: {
  tono?: Tono
  punto?: boolean
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tonos[tono]}`}
    >
      {punto && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Estado vacío                                                        */
/* ------------------------------------------------------------------ */

export function EstadoVacio({
  icono,
  titulo,
  descripcion,
  accion,
}: {
  icono?: ReactNode
  titulo: string
  descripcion?: string
  accion?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icono && (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          {icono}
        </div>
      )}
      <div>
        <p className="text-sm font-semibold text-slate-700">{titulo}</p>
        {descripcion && <p className="mt-1 max-w-xs text-sm text-slate-400">{descripcion}</p>}
      </div>
      {accion}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Campos de formulario                                                */
/* ------------------------------------------------------------------ */

const baseCampo =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-900 shadow-[var(--shadow-card)] ' +
  'transition-colors placeholder:text-slate-300 ' +
  'focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10 ' +
  'disabled:bg-slate-50 disabled:text-slate-400'

export function Campo({
  etiqueta,
  ayuda,
  requerido,
  className = '',
  children,
}: {
  etiqueta: string
  ayuda?: string
  requerido?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {etiqueta}
        {requerido && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {ayuda && <span className="text-xs text-slate-400">{ayuda}</span>}
    </label>
  )
}

export function Entrada({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`${baseCampo} ${className}`} {...props} />
}

export function Selector({ className = '', ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={`${baseCampo} appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="%2394a3b8" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>')] bg-[length:20px_20px] bg-[right_0.75rem_center] bg-no-repeat pr-10 ${className}`}
      {...props}
    />
  )
}

export function AreaTexto({ className = '', ...props }: ComponentProps<'textarea'>) {
  return <textarea className={`${baseCampo} resize-none ${className}`} {...props} />
}

/* ------------------------------------------------------------------ */
/* Mensajes                                                            */
/* ------------------------------------------------------------------ */

export function Alerta({ tono = 'rojo', children }: { tono?: 'rojo' | 'ambar' | 'azul'; children: ReactNode }) {
  const estilos = {
    rojo: 'bg-red-50 text-red-700 ring-red-600/10',
    ambar: 'bg-amber-50 text-amber-800 ring-amber-600/10',
    azul: 'bg-sky-50 text-sky-800 ring-sky-600/10',
  }
  return (
    <p role="alert" className={`rounded-xl px-3.5 py-2.5 text-sm ring-1 ring-inset ${estilos[tono]}`}>
      {children}
    </p>
  )
}

/* ------------------------------------------------------------------ */
/* Esqueletos de carga                                                 */
/* ------------------------------------------------------------------ */

export function Esqueleto({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`esqueleto ${className}`} />
}

export function ListaEsqueleto({ filas = 4 }: { filas?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-slate-200/80 bg-white p-4">
          <Esqueleto className="h-4 w-40" />
          <Esqueleto className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
  )
}
