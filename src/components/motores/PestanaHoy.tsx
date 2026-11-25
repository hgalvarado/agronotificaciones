'use client'

/**
 * «Hoy»: qué toca ahora en la estación, ordenado por urgencia (registro del día pendiente, tanque bajo, mantenimiento por vencer
 * o vencido). Todo se calcula en el teléfono con lo ya bajado, así que funciona sin señal. Arriba, una sola acción grande (lo más
 * urgente que se puede hacer); cada fila se toca para hacer esa tarea.
 */

import { Boton } from '@/components/ui/Primitivos'
import { peorNivel, queTocaAhora, type ItemAhora } from '@/lib/motores/senales'
import type { VistaMotor } from '@/lib/motores/vistaMotor'
import { FilaToque, IconoNivel, NOMBRE_NIVEL } from './ElementosMotor'

export type AccionHoy = { tipo: 'registro' | 'mantenimiento' | 'recibir'; equipoId: string }

export function PestanaHoy({
  vistas,
  estacionNombre,
  puedeRegistrar,
  puedeMantenimiento,
  onAccion,
}: {
  vistas: VistaMotor[]
  estacionNombre: string
  puedeRegistrar: boolean
  puedeMantenimiento: boolean
  onAccion: (a: AccionHoy) => void
}) {
  const items = queTocaAhora(vistas.map((v) => ({ motor: v.motor, ayuda: v.ayuda })))
  /** Qué se puede hacer con cada tipo de pendiente (según los permisos); null = solo informativo. */
  const accionDe = (i: ItemAhora): { texto: string; accion: AccionHoy } | null => {
    if (i.codigo === 'FALTA_REGISTRO' && puedeRegistrar) return { texto: 'Registrar el día', accion: { tipo: 'registro', equipoId: i.equipo_id } }
    if (i.codigo === 'MANTENIMIENTO' && puedeMantenimiento) return { texto: 'Registrar mantenimiento', accion: { tipo: 'mantenimiento', equipoId: i.equipo_id } }
    if (i.codigo === 'TANQUE' && puedeRegistrar) return { texto: 'Recibir diésel', accion: { tipo: 'recibir', equipoId: i.equipo_id } }
    return null
  }
  const nivel = peorNivel(items.map((i) => i.nivel))
  const urgentes = items.filter((i) => i.nivel === 'rojo').length
  const primera = items.map((i) => ({ i, a: accionDe(i) })).find((x) => x.a !== null)

  return (
    <div className="flex flex-col gap-2" data-pestana-hoy>
      <div className="flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200" data-resumen-hoy={nivel}>
        <IconoNivel nivel={nivel} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900">
            {vistas.length === 0
              ? 'Esta estación no tiene motores conectados'
              : items.length === 0
                ? `Todo al día en ${estacionNombre}`
                : `${items.length} cosa${items.length === 1 ? '' : 's'} por atender${urgentes > 0 ? ` · ${urgentes} urgente${urgentes === 1 ? '' : 's'}` : ''}`}
          </p>
          <p className="text-xs text-slate-600">{NOMBRE_NIVEL[nivel]} · lo más urgente va primero.</p>
        </div>
      </div>

      {primera?.a && (
        <Boton className="min-h-14 w-full text-base" onClick={() => onAccion(primera.a!.accion)} data-accion-principal-hoy>
          {primera.a.texto} · {primera.i.motor}
        </Boton>
      )}

      {items.map((i, k) => {
        const a = accionDe(i)
        return (
          <FilaToque
            key={`${i.equipo_id}-${i.codigo}-${k}`}
            atributos={{ 'data-pendiente-hoy': i.codigo }}
            nivel={i.nivel}
            titulo={i.motor}
            linea2={i.texto}
            linea3={a ? `Toca para: ${a.texto.toLowerCase()}` : undefined}
            onToque={a ? () => onAccion(a.accion) : undefined}
          />
        )
      })}

      {items.length === 0 && vistas.length > 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
          Nada pendiente: los registros están al día, los tanques tienen diésel y los mantenimientos no están cerca.
        </p>
      )}
    </div>
  )
}
