'use client'

/**
 * Registrar el mantenimiento hecho a un motor (solo con «configurar»): fecha y hora, horómetro, tipo y nota. Al guardar
 * el contador de horas vuelve a 0 (operación `motor_mantenimiento`, sql/130; en el teléfono se ve al instante con
 * horasDesdeMantLocal).
 */

import { useState } from 'react'
import { AreaTexto, Campo } from '@/components/ui/Primitivos'
import { aEntradaLocal, ahoraIso, deEntradaLocal } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import type { MotorEstacion } from '@/lib/motores/estado'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'

type Datos = { fechaHora: string; horometro: string; tipo: 'PREVENTIVO' | 'CORRECTIVO'; nota: string }

export function FormMantenimiento({
  motor,
  estacion,
  yo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  motor: MotorEstacion
  estacion: Estacion
  yo: Persona
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const borrador = useBorrador<Datos>(claveBorrador('motor_mantenimiento', yo.id, estacion.id, motor.equipo_id))
  const b = borrador.inicial
  const [fechaHora, setFechaHora] = useState(b?.fechaHora ?? aEntradaLocal(ahoraIso()))
  const [horometro, setHorometro] = useState(b?.horometro ?? (motor.horo_ultimo !== null ? String(motor.horo_ultimo) : ''))
  const [tipo, setTipo] = useState<'PREVENTIVO' | 'CORRECTIVO'>(b?.tipo ?? 'PREVENTIVO')
  const [nota, setNota] = useState(b?.nota ?? '')
  useAutoguardado(borrador, { fechaHora, horometro, tipo, nota })

  return (
    <MarcoRegistro
      titulo={`Mantenimiento · ${motor.codigo}`}
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      sinCustodia
      construir={({ ubicacion, enNombreDe }) => {
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Falta la fecha y hora.'
        if (Date.parse(fh) > Date.now() + 5 * 60_000) return 'La fecha no puede ser futura.'
        const h = horometro.trim() ? Number(horometro.replace(',', '.')) : null
        if (h !== null && (!Number.isFinite(h) || h < 0)) return 'Horómetro: escribe un número.'
        return [
          crearOperacion(
            'motor_mantenimiento',
            { equipo_id: motor.equipo_id, estacion_id: motor.estacion_id ?? undefined, fecha_hora: fh, horometro: h, tipo, nota: nota.trim() || null },
            { ubicacion, enNombreDe, resumen: `Mantenimiento ${tipo === 'PREVENTIVO' ? 'preventivo' : 'correctivo'} · ${motor.codigo}` }
          ),
        ]
      }}
    >
      <Campo etiqueta="Tipo" requerido>
        <div className="flex gap-2" role="group" aria-label="Tipo de mantenimiento">
          {([['PREVENTIVO', 'Preventivo'], ['CORRECTIVO', 'Correctivo']] as const).map(([id, nombre]) => (
            <button
              key={id}
              type="button"
              aria-pressed={tipo === id}
              onClick={() => setTipo(id)}
              data-tipo-mantenimiento={id}
              className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-semibold ring-1 ring-inset ${tipo === id ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'}`}
            >
              {nombre}
            </button>
          ))}
        </div>
      </Campo>
      <Campo etiqueta="Fecha y hora" requerido>
        <input
          type="datetime-local"
          value={fechaHora}
          onChange={(e) => setFechaHora(e.target.value)}
          data-fecha-hora
          className="min-h-11 w-60 rounded-lg border border-slate-200 bg-white px-3 py-2 text-base focus:border-brand-600 focus:outline-none"
        />
      </Campo>
      <Campo etiqueta="Horómetro al hacerlo">
        <input
          inputMode="decimal"
          value={horometro}
          onChange={(e) => setHorometro(e.target.value.replace(/[^\d.,]/g, ''))}
          data-horometro
          className="min-h-11 w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base tabular-nums focus:border-brand-600 focus:outline-none"
        />
      </Campo>
      <Campo etiqueta="Nota">
        <AreaTexto value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder="Qué se hizo (aceite, filtros…)" data-nota />
      </Campo>
    </MarcoRegistro>
  )
}
