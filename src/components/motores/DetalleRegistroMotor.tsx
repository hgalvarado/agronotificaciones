'use client'

/**
 * El detalle de un día de registro: TODOS los campos de la hoja física FTR_F-MA-103 (fecha, horómetro inicial y final, horas,
 * galones iniciales y finales del visor, gastados, rendimiento, revoluciones, suministro, lectura de caudal, firma del operador),
 * quién lo registró, las señales con su explicación y, solo aquí, las acciones (Anular / Eliminar por completo) si se permiten.
 */

import type { ReactNode } from 'react'
import { Insignia } from '@/components/ui/Primitivos'
import { formatearFechaHora } from '@/lib/estados'
import { cantidad } from '@/lib/fertirriego/calculos'
import type { RegistroMotor } from '@/lib/motores/estado'
import { OBS_MOTOR, type Aviso } from '@/lib/motores/senales'
import { DatoHoja, TONO_DE_NIVEL } from './ElementosMotor'

export const fechaCorta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const n = (v: number | null | undefined) => (v === null || v === undefined ? null : cantidad(v))

export function DetalleRegistroMotor({
  r,
  quien,
  senales,
  children,
}: {
  r: RegistroMotor
  quien: string | null
  senales: Aviso[]
  /** Las acciones (Anular, Eliminar por completo): solo van dentro del detalle. */
  children?: ReactNode
}) {
  const obs = (r.observaciones ?? []).filter((o) => OBS_MOTOR[o])
  return (
    <div className="mx-3 mb-2 mt-1 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200" data-detalle-registro-motor>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <DatoHoja etiqueta="Fecha" valor={fechaCorta(r.fecha)} />
        <DatoHoja etiqueta="Horas" valor={n(r.horas)} />
        <DatoHoja etiqueta="Horómetro inicial" valor={n(r.horo_ini)} />
        <DatoHoja etiqueta="Horómetro final" valor={n(r.horo_fin)} />
        <DatoHoja etiqueta="Galones iniciales" valor={n(r.visor_ini)} />
        <DatoHoja etiqueta="Galones finales" valor={n(r.visor_fin)} />
        <DatoHoja etiqueta="Galones gastados" valor={n(r.gastado_gal)} />
        <DatoHoja etiqueta="Rendimiento gal/h" valor={n(r.rendimiento_gal_h)} />
        <DatoHoja etiqueta="Rev. del motor" valor={r.rpm} />
        <DatoHoja etiqueta="Suministro de combustible" valor={r.recibido_gal > 0 ? n(r.recibido_gal) : null} />
        <DatoHoja etiqueta="Caudal inicial" valor={n(r.caudal_ini)} />
        <DatoHoja etiqueta="Caudal final" valor={n(r.caudal_fin)} />
        <DatoHoja etiqueta="Firma del operador" valor={r.operador} ancho />
        {r.horas_estimadas !== null && <DatoHoja etiqueta="Horas estimadas (solo mantenimiento)" valor={n(r.horas_estimadas)} ancho />}
        <DatoHoja etiqueta="Observaciones" valor={r.comentario} ancho />
      </dl>
      <p className="mt-2 text-xs text-slate-600">
        Registró: <strong className="text-slate-800">{quien ?? 'Persona sin nombre en este teléfono'}</strong> · {formatearFechaHora(r.fecha_hora)}
      </p>
      {r.horo_cambiado && <p className="text-xs text-slate-600">Se cambió el horómetro ese día.</p>}
      {r.visor_cambiado && <p className="text-xs text-slate-600">Se cambió el visor ese día.</p>}

      {(senales.length > 0 || obs.length > 0) && (
        <ul className="mt-2 flex flex-col gap-1.5" data-senales-detalle>
          {senales.map((s) => (
            <li key={s.codigo} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 text-xs text-slate-700">
              <Insignia tono={TONO_DE_NIVEL[s.nivel]}>{s.nivel === 'rojo' ? 'Urgente' : s.nivel === 'amarillo' ? 'Atención' : 'Aviso'}</Insignia>
              <span className="min-w-0 flex-1 break-words">{s.texto}</span>
            </li>
          ))}
          {obs.map((o) => (
            <li key={o} className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
              <Insignia tono={TONO_DE_NIVEL[OBS_MOTOR[o].nivel]}>{OBS_MOTOR[o].texto}</Insignia>
            </li>
          ))}
        </ul>
      )}
      {r.anulado_at && <p className="mt-2 text-xs font-semibold text-red-700">Anulado{r.motivo_anulacion ? `: ${r.motivo_anulacion}` : ''}</p>}
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}
