'use client'

/**
 * Piezas visuales compartidas de Motores y combustible: el icono de nivel (color + icono + texto, nunca solo color), la fila
 * compacta que se toca para ver el detalle, los chips de señal y la barra del tanque. Solo usan los colores del proyecto
 * (Insignia / CLASES_TONO), así que respetan el tema claro y oscuro.
 */

import type { ReactNode } from 'react'
import { IconCheck, IconChevronRight, IconClock, IconInfo, IconX } from '@/components/ui/Icons'
import { CLASES_TONO, Insignia, type Tono } from '@/components/ui/Primitivos'
import type { Aviso } from '@/lib/motores/senales'

export const TONO_DE_NIVEL: Record<string, Tono> = { rojo: 'rojo', amarillo: 'ambar', verde: 'verde', gris: 'gris', info: 'azul' }
export const NOMBRE_NIVEL: Record<string, string> = { rojo: 'Urgente', amarillo: 'Atención', verde: 'Bien', gris: 'Sin dato', info: 'Aviso' }

const ICONO: Record<string, typeof IconX> = { rojo: IconX, amarillo: IconInfo, verde: IconCheck, gris: IconClock, info: IconInfo }

/** Cuadro de color con icono; el texto del nivel va para el lector de pantalla y en el chip. */
export function IconoNivel({ nivel }: { nivel: string }) {
  const Icono = ICONO[nivel] ?? IconInfo
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${CLASES_TONO[TONO_DE_NIVEL[nivel] ?? 'gris']}`} data-nivel={nivel}>
      <Icono className="h-5 w-5" />
      <span className="sr-only">{NOMBRE_NIVEL[nivel] ?? nivel}</span>
    </span>
  )
}

/** Fila compacta (≈56 px): lo principal en negrita, contexto y detalle más chicos. Toda la fila es el botón; el detalle se abre debajo. */
export function FilaToque({
  nivel,
  titulo,
  linea2,
  linea3,
  derecha,
  onToque,
  abierta = false,
  children,
  atributos,
}: {
  nivel: string
  titulo: ReactNode
  linea2?: ReactNode
  linea3?: ReactNode
  derecha?: ReactNode
  /** Sin esto la fila es solo informativa (no se puede tocar). */
  onToque?: () => void
  abierta?: boolean
  children?: ReactNode
  atributos?: Record<string, string | boolean | undefined>
}) {
  const cuerpo = (
    <>
      <IconoNivel nivel={nivel} />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-bold leading-tight text-slate-900">{titulo}</span>
        {linea2 && <span className="mt-0.5 block break-words text-xs leading-snug text-slate-700">{linea2}</span>}
        {linea3 && <span className="mt-0.5 block break-words text-[11px] leading-snug text-slate-500">{linea3}</span>}
      </span>
      {derecha && <span className="shrink-0 text-right text-sm font-bold tabular-nums text-slate-900">{derecha}</span>}
      {onToque && <IconChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${abierta ? 'rotate-90' : ''}`} />}
    </>
  )
  const clase = 'flex min-h-14 w-full items-center gap-3 rounded-xl bg-white px-3 py-2 text-left ring-1 ring-inset ring-slate-200'
  return (
    <div {...atributos}>
      {onToque ? (
        <button type="button" onClick={onToque} aria-expanded={abierta} className={`${clase} active:bg-slate-50`}>
          {cuerpo}
        </button>
      ) : (
        <div className={clase}>{cuerpo}</div>
      )}
      {abierta && children}
    </div>
  )
}

/** Hasta dos chips de señal y «+N»; el texto completo de cada señal se lee en el detalle. */
export function ChipsSenales({ avisos, maximo = 2 }: { avisos: Pick<Aviso, 'nivel' | 'codigo'>[]; maximo?: number }) {
  if (avisos.length === 0) return null
  const orden = { rojo: 0, amarillo: 1, info: 2 } as const
  const lista = [...avisos].sort((a, b) => orden[a.nivel] - orden[b.nivel])
  return (
    <span className="mt-1 flex flex-wrap gap-1" data-senales>
      {lista.slice(0, maximo).map((a) => (
        <Insignia key={a.codigo} tono={TONO_DE_NIVEL[a.nivel]}>
          {NOMBRE_CORTO[a.codigo] ?? a.codigo}
        </Insignia>
      ))}
      {lista.length > maximo && <Insignia tono="gris">+{lista.length - maximo}</Insignia>}
    </span>
  )
}

export const NOMBRE_CORTO: Record<string, string> = {
  HORO_RETROCEDE: 'Horómetro retrocede',
  HORO_SALTA: 'Horómetro salta',
  HUECO_DIAS: 'Días sin registro',
  VISOR_FALTA: 'Visor: faltan gal',
  VISOR_SOBRA: 'Visor: sobran gal',
  SALDO_FALTA: 'Tanque: faltan gal',
  SALDO_SOBRA: 'Tanque: sobran gal',
  RENDIMIENTO: 'Rendimiento raro',
  HORO_SIN_AVANCE_CON_CONSUMO: 'Horómetro sin avance',
  HORAS_SIN_CONSUMO: 'Horas sin consumo',
  HORAS_IMPOSIBLES: 'Más de 24 h',
  SIN_RPM: 'Sin revoluciones',
  VISOR_NO_CONTINUA: 'Visor no continúa',
}

/** Barra del nivel de un tanque (color según el semáforo). */
export function BarraTanque({ pct, nivel }: { pct: number | null; nivel: string }) {
  if (pct === null) return null
  const color = nivel === 'rojo' ? 'bg-red-500' : nivel === 'amarillo' ? 'bg-amber-500' : 'bg-brand-600'
  return (
    <span className="mt-1 block h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Tanque al ${pct} %`}>
      <span className={`block h-full ${color}`} style={{ width: `${pct}%` }} />
    </span>
  )
}

/** Un dato de la hoja: etiqueta chica y valor. */
export function DatoHoja({ etiqueta, valor, ancho = false }: { etiqueta: string; valor: ReactNode; ancho?: boolean }) {
  return (
    <div className={ancho ? 'col-span-2' : ''}>
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{etiqueta}</dt>
      <dd className="break-words text-sm font-semibold tabular-nums text-slate-900">{valor === null || valor === undefined || valor === '' ? '—' : valor}</dd>
    </div>
  )
}

/** Carga o vacío o error de una consulta con señal. */
export function EstadoConsulta({ cargando, error, vacio, textoVacio }: { cargando: boolean; error: string | null; vacio: boolean; textoVacio: string }) {
  if (cargando && vacio) return <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600 ring-1 ring-inset ring-slate-200">Cargando…</p>
  if (error) return <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-inset ring-red-600/20">{error}</p>
  if (vacio) return <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">{textoVacio}</p>
  return null
}
