'use client'

/**
 * Tarjeta de un motor de riego: nivel del tanque, horas para el próximo mantenimiento y los botones del día. No hace
 * cuentas: todo viene de lib/motores (puro). Cada botón sale solo con su permiso (sql/138): Mover, Retirar, Mantenimiento
 * y, para las horas y el combustible, «registrar». Solo se muestran los motores asignados a la estación.
 */

import { Boton, Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { cantidad } from '@/lib/fertirriego/calculos'
import { estadoMantenimiento, horasParaMantenimiento, type EstadoMant } from '@/lib/motores/mantenimiento'
import type { MotorEstacion } from '@/lib/motores/estado'

const TEXTO_MANT: Record<EstadoMant, { tono: 'verde' | 'ambar' | 'rojo' | 'gris'; texto: string }> = {
  al_dia: { tono: 'verde', texto: 'Mantenimiento al día' },
  proximo: { tono: 'ambar', texto: 'Mantenimiento próximo' },
  vencido: { tono: 'rojo', texto: 'Mantenimiento vencido' },
  sin_intervalo: { tono: 'gris', texto: 'Sin intervalo definido' },
}

const NOMBRE_ESTADO: Record<string, string> = { TALLER: 'En el taller', RETIRADO: 'Retirado', SIN_ASIGNAR: 'Sin asignar' }

export function TarjetaMotor({
  motor,
  saldoGal,
  horasDesdeMant,
  puedeRegistrar,
  puedeMover,
  puedeRetirar,
  puedeMantenimiento,
  onRegistro,
  onMover,
  onRetirar,
  onMantenimiento,
  onHistorial,
}: {
  motor: MotorEstacion
  /** Saldo del tanque con lo pendiente de enviar. */
  saldoGal: number | null
  /** Horas desde el último mantenimiento con lo pendiente de enviar. */
  horasDesdeMant: number
  puedeRegistrar: boolean
  puedeMover: boolean
  puedeRetirar: boolean
  puedeMantenimiento: boolean
  onRegistro: () => void
  onMover: () => void
  onRetirar: () => void
  onMantenimiento: () => void
  onHistorial: () => void
}) {
  const instalado = motor.estado === 'EN_ESTACION'
  const intervaloHoras = motor.intervalo_horas
  const est = estadoMantenimiento({ intervaloHoras, avisoHoras: motor.aviso_horas, horasDesdeMant })
  const faltan = horasParaMantenimiento({ intervaloHoras, horasDesdeMant })
  const capacidad = motor.tanque?.capacidad_gal ?? null
  const pct = capacidad && saldoGal !== null ? Math.max(0, Math.min(100, Math.round((saldoGal / capacidad) * 100))) : null

  return (
    <div data-motor={motor.codigo} className={instalado ? '' : 'opacity-70'}>
      <Tarjeta className="p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-base font-bold text-slate-900">{motor.codigo}</p>
            <p className="truncate text-xs text-slate-600">
              {motor.nombre}
              {motor.modelo ? ` · ${motor.modelo}` : ''}
            </p>
          </div>
          <span className="flex flex-wrap gap-1">
            {!instalado && <Insignia tono="gris">{NOMBRE_ESTADO[motor.estado] ?? motor.estado}</Insignia>}
            <span data-estado-mantenimiento={est}>
              <Insignia tono={TEXTO_MANT[est].tono}>{TEXTO_MANT[est].texto}</Insignia>
            </span>
          </span>
        </div>

        {instalado && motor.tanque && (
          <div className="mt-2" data-tanque-nivel>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-slate-600">Tanque {motor.tanque.nombre}</span>
              <strong className="tabular-nums text-slate-900">{saldoGal === null ? '—' : `${cantidad(saldoGal)} gal`}</strong>
            </div>
            {pct !== null && (
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Tanque al ${pct} %`}>
                <div className={`h-full ${pct < 15 ? 'bg-red-500' : pct < 35 ? 'bg-amber-500' : 'bg-brand-600'}`} style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        )}

        <p className="mt-2 text-xs text-slate-600" data-horas-mant>
          {faltan === null
            ? 'Define el intervalo de mantenimiento en AGL para ver cuántas horas faltan.'
            : faltan > 0
              ? `Faltan ${cantidad(faltan)} h para el mantenimiento (llevas ${cantidad(horasDesdeMant)} de ${intervaloHoras}).`
              : `Pasó ${cantidad(-faltan)} h del mantenimiento (llevas ${cantidad(horasDesdeMant)} de ${intervaloHoras}).`}
        </p>
        <p className="text-xs text-slate-500">
          {motor.fecha_ultimo
            ? `Último registro: ${motor.fecha_ultimo.slice(8, 10)}/${motor.fecha_ultimo.slice(5, 7)} · horómetro ${motor.horo_ultimo ?? '—'}`
            : 'Todavía sin registros.'}
        </p>

        {instalado && puedeRegistrar && (
          <div className="mt-3">
            <Boton className="min-h-12 w-full" onClick={onRegistro} data-registro-diario>
              Registro diario
            </Boton>
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <Boton tamano="sm" variante="fantasma" className="min-h-11" onClick={onHistorial} data-historial-motor>
            Historial
          </Boton>
          {instalado && puedeMover && (
            <Boton tamano="sm" variante="fantasma" className="min-h-11" onClick={onMover} data-mover-motor>
              Mover
            </Boton>
          )}
          {instalado && puedeRetirar && (
            <Boton tamano="sm" variante="fantasma" className="min-h-11" onClick={onRetirar} data-retirar-motor>
              Retirar
            </Boton>
          )}
          {puedeMantenimiento && (
            <Boton tamano="sm" variante="fantasma" className="min-h-11" onClick={onMantenimiento} data-registrar-mantenimiento>
              Mantenimiento
            </Boton>
          )}
        </div>
      </Tarjeta>
    </div>
  )
}
