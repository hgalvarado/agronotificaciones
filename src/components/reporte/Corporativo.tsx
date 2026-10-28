/**
 * Piezas visuales de los reportes gerenciales impresos (guía de identidad
 * Agrolíbano, migración 82): membrete, secciones-tarjeta, KPI con barra
 * de semáforo, encabezado de tabla en Verde Agrícola, fila de total y pie
 * con las ondas lima / turquesa / naranja.
 *
 * Son las mismas formas que dibuja el reporte de Trasplante, sacadas aquí
 * para que cualquier otro reporte (Emplasticado, y los que vengan) salga
 * gemelo sin copiar estilos a mano. Sin estado ni efectos: sirven en
 * componentes de servidor y se imprimen igual que se ven.
 */

import type { ReactNode } from 'react'
import { COLOR_SEMAFORO, CORP, semaforo } from '@/lib/trasplante/formato'

export { CORP }

const EXACTO = '[-webkit-print-color-adjust:exact] [print-color-adjust:exact]'

/**
 * Hoja de impresión común: carta horizontal, márgenes de 15 mm (guía:
 * mínimo 1,5 cm), filas que no se parten y títulos de columna repetidos.
 */
export const IMPRESION_REPORTE = `
@media print {
  @page { size: letter landscape; margin: 15mm; }
  html, body { background: #fff; zoom: 1; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  .no-imprimir, .print\\:hidden { display: none !important; }
  .hoja-reporte { font-size: 9pt; line-height: 1.25; gap: 0.5rem; }
  .hoja-reporte table { width: 100%; font-size: 9pt; page-break-inside: auto; }
  .hoja-reporte thead { display: table-header-group; }
  .hoja-reporte tr { page-break-inside: avoid; break-inside: avoid; }
  .hoja-reporte .scroll-suave { overflow: visible !important; }
  .hoja-reporte section { break-inside: auto !important; page-break-inside: auto !important; }
}
`

/** Membrete institucional: banda verde, empresa en marino serif, línea marino. */
export function Membrete({
  titulo,
  subtitulo,
  lineas,
  marca,
}: {
  titulo: string
  subtitulo: string
  lineas: string[]
  marca?: ReactNode
}) {
  return (
    <header
      className={`overflow-hidden rounded-xl bg-white shadow-[var(--shadow-card)] print:rounded-none print:shadow-none ${EXACTO}`}
    >
      <div className="h-1.5" style={{ backgroundColor: CORP.verde }} />
      <div className="px-4 py-4 text-center">
        <p
          className="text-xl font-black tracking-tight sm:text-2xl"
          style={{ color: CORP.marino, fontFamily: 'var(--font-display)' }}
        >
          Agropecuaria Montelíbano S.A.
        </p>
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.25em]"
          style={{ color: CORP.marino }}
        >
          Grupo Agrolíbano
        </p>
        <p
          className="mt-2 text-base font-bold sm:text-lg"
          style={{ color: CORP.verde, fontFamily: 'var(--font-display)' }}
        >
          {titulo}
        </p>
        <p className="text-sm font-semibold" style={{ color: CORP.marino }}>
          {subtitulo}
        </p>
        {lineas.map((l) => (
          <p key={l} className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">
            {l}
          </p>
        ))}
        {marca}
      </div>
      <div className="h-0.5" style={{ backgroundColor: CORP.marino }} />
    </header>
  )
}

/** Una sección del reporte como tarjeta, con su número y su título. */
export function Bloque({
  numero,
  titulo,
  extra,
  children,
}: {
  numero: number
  titulo: string
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      className="rounded-xl border bg-white p-4 shadow-[var(--shadow-card)] sm:p-5 print:rounded-none print:border-0 print:p-0 print:shadow-none"
      style={{ borderColor: CORP.borde }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Titulo numero={numero}>{titulo}</Titulo>
        {extra}
      </div>
      {children}
    </section>
  )
}

export function Titulo({ numero, children }: { numero: number; children: ReactNode }) {
  return (
    <h2
      className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide"
      style={{ color: CORP.marino }}
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-white ${EXACTO}`}
        style={{ backgroundColor: CORP.verde }}
      >
        {numero}
      </span>
      {children}
    </h2>
  )
}

/**
 * Indicador en tarjeta. `tono` pinta el VALOR: verde para lo fuerte,
 * naranja para lo que alerta (pendiente, atraso).
 */
export function Kpi({
  etiqueta,
  valor,
  barra,
  fuerte,
  tono,
}: {
  etiqueta: string
  valor: string
  barra?: number | null
  fuerte?: boolean
  tono?: 'alerta' | 'ok'
}) {
  const color =
    tono === 'alerta' ? CORP.naranja : tono === 'ok' ? '#4F7A1F' : fuerte ? CORP.verde : CORP.marino
  return (
    <div
      className={`flex flex-col gap-1 rounded-xl border bg-white p-3 ${EXACTO}`}
      style={{
        borderColor: CORP.borde,
        borderTop: `3px solid ${tono === 'alerta' ? CORP.naranja : fuerte ? CORP.verde : CORP.lima}`,
      }}
    >
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{etiqueta}</span>
      <span className="text-lg font-bold tabular-nums tracking-tight sm:text-xl" style={{ color }}>
        {valor}
      </span>
      {barra !== undefined && <Barra valor={barra} />}
    </div>
  )
}

export function Dato({ etiqueta, valor, fuerte, alerta }: { etiqueta: string; valor: string; fuerte?: boolean; alerta?: boolean }) {
  return (
    <div>
      <dt className="text-slate-400">{etiqueta}</dt>
      <dd
        className={`tabular-nums ${fuerte ? 'font-bold' : ''}`}
        style={{ color: alerta ? CORP.naranja : CORP.marino }}
      >
        {valor}
      </dd>
    </div>
  )
}

/** Barra de avance con el semáforo de la guía. Se corta en 100 % al dibujar. */
export function Barra({ valor, fina }: { valor: number | null | undefined; fina?: boolean }) {
  const v = valor === null || valor === undefined ? 0 : Math.max(0, Math.min(100, Number(valor)))
  const s = semaforo(valor)
  const tono = s ? COLOR_SEMAFORO[s] : CORP.borde
  return (
    <div className={`${fina ? 'h-1.5' : 'mt-1 h-2'} w-full overflow-hidden rounded-full bg-slate-100 ${EXACTO}`}>
      <div className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: tono }} />
    </div>
  )
}

/** Cabecera de tabla en Verde Agrícola, texto blanco. */
export function Encabezado({ children }: { children: ReactNode }) {
  return (
    <thead className="table-header-group">
      <tr
        className={`text-left text-[10px] font-semibold uppercase tracking-wide text-white ${EXACTO}`}
        style={{ backgroundColor: CORP.verde }}
      >
        {children}
      </tr>
    </thead>
  )
}

/** Fila de cuerpo con cebra #FAFAFA y bordes #E2E8F0. */
export const CLASE_FILA = 'border-b even:bg-[#FAFAFA]'
export const ESTILO_FILA = { borderColor: CORP.borde, color: CORP.marino } as const

/** Subtotal (día, zona): fondo #F4F6F8, negrita. */
export const CLASE_SUBTOTAL = `border-b font-bold ${EXACTO}`
export const ESTILO_SUBTOTAL = { backgroundColor: CORP.fondo, borderColor: CORP.borde, color: CORP.marino } as const

/** «Total general»: negrita con línea Verde Agrícola arriba. */
export function TotalGeneral({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr className="border-t-2 text-sm font-bold" style={{ borderColor: CORP.verde, color: CORP.marino }}>
      <td className="px-2 py-1.5" colSpan={colSpan}>
        Total general
      </td>
      {children}
    </tr>
  )
}

/** Pie institucional: ondas entrelazadas lima, turquesa y naranja. */
export function PieOndas({ children }: { children?: ReactNode }) {
  return (
    <footer className={`mt-2 break-inside-avoid ${EXACTO}`}>
      <svg viewBox="0 0 1200 60" preserveAspectRatio="none" className="block h-10 w-full" aria-hidden>
        <path d="M0 40 C 200 10, 400 60, 600 32 S 1000 8, 1200 30 L1200 60 L0 60 Z" fill={CORP.lima} opacity="0.9" />
        <path d="M0 46 C 220 22, 430 64, 640 40 S 1020 20, 1200 42 L1200 60 L0 60 Z" fill={CORP.turquesa} opacity="0.85" />
        <path d="M0 54 C 240 38, 460 66, 680 50 S 1040 36, 1200 52 L1200 60 L0 60 Z" fill={CORP.naranja} opacity="0.9" />
      </svg>
      {children}
      <p className="mt-1 text-center text-[10px]" style={{ color: CORP.marino }}>
        Agropecuaria Montelíbano S.A. · Grupo Agrolíbano · AgroNotificaciones
      </p>
    </footer>
  )
}
