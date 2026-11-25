'use client'

/**
 * «Resumen de la temporada»: cuatro cifras grandes (horas, galones gastados, rendimiento, RPM) y una línea con el resto (días, recibido,
 * horas estimadas, mantenimientos). Compacto en 412 px (2 columnas). Sirve para un motor, una estación o el total; las cifras vienen
 * de la base (fn_mot_resumen_temporada) o del teléfono (resumirRegistros).
 */

import type { ReactNode } from 'react'
import { cantidad } from '@/lib/fertirriego/calculos'
import type { CifrasTemporada } from '@/lib/motores/auditoria'

function Cifra({ etiqueta, valor, unidad }: { etiqueta: string; valor: string; unidad?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{etiqueta}</dt>
      <dd className="text-xl font-bold leading-tight tabular-nums text-slate-900">
        {valor}
        {unidad && <span className="ml-1 text-xs font-normal text-slate-500">{unidad}</span>}
      </dd>
    </div>
  )
}

export function ResumenTemporada({ titulo = 'Resumen de la temporada', cifras, subtitulo, children }: { titulo?: string; cifras: CifrasTemporada | null; subtitulo?: string; children?: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200" data-resumen-temporada>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-900">{titulo}</h3>
        {subtitulo && <span className="truncate text-xs text-slate-600">{subtitulo}</span>}
      </div>
      {!cifras ? (
        <p className="mt-1 text-sm text-slate-500">Sin datos de la temporada.</p>
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
            <Cifra etiqueta="Horas (horómetro)" valor={cantidad(cifras.horas)} unidad="h" />
            {cifras.horas_estimadas > 0 && <Cifra etiqueta="Horas estimadas" valor={cantidad(cifras.horas_estimadas)} unidad="h" />}
            {cifras.horas_estimadas > 0 && <Cifra etiqueta="Horas proyectadas" valor={cantidad(cifras.horas + cifras.horas_estimadas)} unidad="h" />}
            <Cifra etiqueta="Gastado" valor={cantidad(cifras.gal_gastados)} unidad="gal" />
            <Cifra etiqueta="Rendimiento" valor={cifras.rendimiento_gal_h === null ? '—' : cantidad(cifras.rendimiento_gal_h)} unidad="gal/h" />
            <Cifra etiqueta="RPM promedio" valor={cifras.rpm_prom === null ? '—' : String(cifras.rpm_prom)} />
          </dl>
          <p className="mt-2 text-xs leading-snug text-slate-600">
            {cifras.dias} día{cifras.dias === 1 ? '' : 's'} trabajado{cifras.dias === 1 ? '' : 's'} · recibido {cantidad(cifras.gal_recibidos)} gal
            {cifras.mantenimientos === undefined ? '' : ` · ${cifras.mantenimientos} mantenimiento${cifras.mantenimientos === 1 ? '' : 's'}`}
          </p>
        </>
      )}
      {children}
    </section>
  )
}
