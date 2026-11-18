/**
 * Cómo se enseña un lote: el NOMBRE manda (es lo que la gente reconoce) y el código (nomenclatura) va
 * al lado como dato secundario en negrita. Las áreas: «Neta 12.5 mz · Bruta 13.8 mz»; si no hay área
 * bruta se muestra solo la neta. Nada se corta con «…»: con texto grande del teléfono baja de línea.
 */
import type { RegistroDetalle } from '@/lib/types'

const mz = (n: number) => String(Math.round(n * 100) / 100)

export function AreasLote({
  neta,
  bruta,
  className = '',
}: {
  neta: number | null | undefined
  bruta?: number | null
  className?: string
}) {
  const hayNeta = neta != null && Number.isFinite(Number(neta))
  const hayBruta = bruta != null && Number.isFinite(Number(bruta))
  if (!hayNeta && !hayBruta) return null
  return (
    <span data-areas-lote className={`text-xs text-slate-500 ${className}`}>
      {hayNeta && (
        <span className="whitespace-nowrap">
          Neta <strong className="font-bold text-slate-800">{mz(Number(neta))} mz</strong>
        </span>
      )}
      {hayNeta && hayBruta && <span className="mx-1 text-slate-300">·</span>}
      {hayBruta && (
        <span className="whitespace-nowrap">
          Bruta <strong className="font-bold text-slate-800">{mz(Number(bruta))} mz</strong>
        </span>
      )}
    </span>
  )
}

/** Nombre del lote (línea principal) y código (negrita pequeña). Sin nombre: solo el código. */
export function NombreLote({
  nombre,
  codigo,
  className = '',
}: {
  nombre?: string | null
  codigo: string
  className?: string
}) {
  const n = (nombre ?? '').trim()
  if (!n) {
    return <span className={`break-words font-semibold text-slate-900 ${className}`}>{codigo}</span>
  }
  return (
    <span className={`block min-w-0 ${className}`}>
      <span data-lote-nombre className="block break-words font-semibold text-slate-900">{n}</span>
      <span data-lote-codigo className="block break-words text-xs font-bold text-slate-600">{codigo}</span>
    </span>
  )
}

/** Etiqueta de un lote ya guardado en una labor (tabla del horómetro). */
export function ChipLoteGuardado({ d }: { d: RegistroDetalle }) {
  const lt = d.lotes_temporada
  const cod = lt?.lotes?.nomenclatura ?? '—'
  return (
    <span
      data-chip-lote
      className="inline-flex max-w-full flex-col rounded-lg bg-slate-50 px-2 py-1 text-left ring-1 ring-inset ring-slate-200/70"
    >
      <span className="flex items-baseline gap-1.5">
        <span className="break-words text-xs font-semibold text-slate-900">
          {lt?.lotes?.nombre?.trim() || cod}
        </span>
        {d.avance_mz != null && <span className="text-xs font-bold text-brand-700">{d.avance_mz} mz</span>}
      </span>
      {lt?.lotes?.nombre?.trim() && (
        <span className="break-words text-[11px] font-bold text-slate-600">{cod}</span>
      )}
      <AreasLote neta={lt?.area_neta} bruta={lt?.area_bruta} className="!text-[11px]" />
    </span>
  )
}
