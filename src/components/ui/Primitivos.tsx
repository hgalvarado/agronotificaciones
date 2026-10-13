// Primitivas de UI reutilizables. Todo el look de la app sale de aquí,
// así que cambiar un color o un radio en este archivo lo cambia en toda
// la plataforma.

import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { Ayuda } from './Ayuda'

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

/**
 * Un campo con su etiqueta.
 *
 * **`ayuda` ya no se escribe debajo (migración 71)**: va detrás de una
 * «i» junto a la etiqueta. Dicha una vez aclara; repetida en diecisiete
 * campos duplica el alto del formulario, y en un teléfono con el teclado
 * subido eso son dos campos a la vista en vez de cinco.
 *
 * `ayudaVisible` deja la explicación a la vista para el caso contrario:
 * un aviso que hay que leer SIEMPRE, no una aclaración que se lee una
 * vez. Son pocos y se marcan a mano.
 */
export function Campo({
  etiqueta,
  ayuda,
  ayudaVisible = false,
  requerido,
  className = '',
  children,
}: {
  etiqueta: string
  ayuda?: string
  /** Deja la ayuda escrita debajo, como antes. Para avisos, no para aclaraciones. */
  ayudaVisible?: boolean
  requerido?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    // Sigue siendo un `<label>` que ENVUELVE el campo: así tocar el
    // texto enfoca el control sin necesidad de inventar un `id` para
    // cada uno. El botón de la «i» vive dentro y cancela el gesto del
    // `label` con `preventDefault`, para que tocarlo abra el globo en
    // vez de enfocar el campo de atrás.
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {etiqueta}
        {requerido && <span className="ml-0.5 text-red-500">*</span>}
        {ayuda && !ayudaVisible && <Ayuda texto={ayuda} etiqueta={etiqueta} />}
      </span>
      {children}
      {ayuda && ayudaVisible && <span className="text-xs text-slate-400">{ayuda}</span>}
    </label>
  )
}

/**
 * Un bloque de campos que van juntos, con su nombre encima.
 *
 * Es un `<fieldset>` de verdad y no un `<div>` con un título: el lector
 * de pantalla anuncia la leyenda al entrar en cada campo, así que «CE
 * antes» se oye como «Lecturas de la conductividad eléctrica, CE antes»
 * y no suelto.
 *
 * Existe porque una rejilla larga de campos numéricos en un teléfono se
 * convierte en una columna donde dos medidas de cosas distintas quedan
 * pegadas y se leen como si fueran la misma serie. El marco es lo que
 * dice dónde acaba una cosa y empieza la otra.
 */
export function Grupo({
  titulo,
  ayuda,
  columnas = 'grid-cols-1 sm:grid-cols-3',
  className = '',
  children,
}: {
  titulo: string
  ayuda?: string
  /**
   * Las clases de rejilla, ENTERAS.
   *
   * Antes esto sólo decía las columnas anchas y el componente añadía
   * `grid-cols-1` por su cuenta. Con eso, pasar `grid-cols-2` para el
   * teléfono dejaba las dos clases puestas a la vez y mandaba la que
   * estuviera más abajo en la hoja de estilos, no la que se pidió.
   */
  columnas?: string
  className?: string
  children: ReactNode
}) {
  return (
    <fieldset
      className={`mt-3 rounded-xl border border-slate-200/80 px-3 pb-3 pt-1 ${className}`}
    >
      {/* La ayuda del marco va detrás de la «i», igual que la de los
          campos (migración 71): un párrafo bajo cada leyenda son tres
          renglones más de formulario por cada grupo. */}
      <legend className="flex items-center gap-1.5 px-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {titulo}
        {ayuda && <Ayuda texto={ayuda} etiqueta={titulo} />}
      </legend>
      <div className={`grid gap-3 ${columnas}`}>{children}</div>
    </fieldset>
  )
}

export function Entrada({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`${baseCampo} ${className}`} {...props} />
}

// El desplegable vive en su propio archivo porque lleva estado —el
// buscador que se abre cuando la lista es larga— y esto es un módulo de
// servidor. Se reexporta para que las pantallas lo sigan importando de
// aquí, como siempre.
export { Selector } from './Selector'

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

/**
 * La ruedita de «estoy trabajando».
 *
 * Es SVG y no un `div` con borde girando porque dentro de un botón hay
 * que poder teñirla con `currentColor` sin repetir la clase del tono.
 */
export function Girador({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Una tabla todavía sin datos.
 *
 * Es el esqueleto que ya dibujaban a mano media docena de pantallas, con
 * el mismo número de líneas en todas: si cada una elige el suyo, pasar de
 * Labores a Horómetros parece que cargan cosas distintas.
 */
export function TablaEsqueleto({ filas = 8 }: { filas?: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-card)]">
      <Esqueleto className="h-8 w-full" />
      {Array.from({ length: filas }).map((_, i) => (
        <Esqueleto key={i} className="h-8 w-full" />
      ))}
    </div>
  )
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
