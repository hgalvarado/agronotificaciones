'use client'

/**
 * Historial de un motor (últimos 45 días): registros diarios, recepciones de diésel y movimientos. Lo que ya llegó a la
 * base y lo que todavía está por enviar. Anular solo con «Anular» (la base lo vuelve a comprobar). Sin pantalla de
 * reportes: el consumo, el rendimiento y las alertas son de AGL.
 */

import { useState } from 'react'
import { AreaTexto, Boton, Campo, Insignia } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'
import { formatearFechaHora } from '@/lib/estados'
import { cantidad } from '@/lib/fertirriego/calculos'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import { NOMBRE_OBSERVACION } from '@/lib/fertirriego/operaciones'
import type { Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import type { EstadoMotores, MotorEstacion } from '@/lib/motores/estado'

type Anulable = { tipo: 'motor_registro' | 'diesel_recepcion' | 'motor_asignacion'; id: string; texto: string }

const NOMBRE_MOV: Record<string, string> = {
  INSTALADO: 'Instalado',
  TRASLADADO: 'Trasladado',
  RETIRADO: 'Retirado',
  AL_TALLER: 'Al taller',
  DE_VUELTA: 'De vuelta del taller',
}

function FormAnular({
  doc,
  estacion,
  yo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  doc: Anulable
  estacion: Estacion
  yo: Persona
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const [motivo, setMotivo] = useState('')
  return (
    <MarcoRegistro
      titulo="Anular registro del motor"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      permiso="anular"
      sinCustodia
      textoGuardar="Anular"
      construir={({ ubicacion, enNombreDe }) => {
        if (!motivo.trim()) return 'Escribe por qué se anula.'
        return [
          crearOperacion('anulacion', { estacion_id: estacion.id, documento_tipo: doc.tipo, documento_id: doc.id, motivo: motivo.trim() }, { ubicacion, enNombreDe, resumen: `Anulación · ${doc.texto}` }),
        ]
      }}
    >
      <p className="text-sm text-slate-700">{doc.texto}. El tanque vuelve a como estaba antes de este registro.</p>
      <Campo etiqueta="Motivo" requerido>
        <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} data-motivo-anulacion />
      </Campo>
    </MarcoRegistro>
  )
}

export function VistaHistorialMotor({
  motor,
  estado,
  cola,
  estacion,
  yo,
  puedeAnular,
  registrar,
  onGuardado,
  onCerrar,
}: {
  motor: MotorEstacion
  estado: EstadoMotores
  cola: Operacion[]
  estacion: Estacion
  yo: Persona
  puedeAnular: boolean
  registrar: (...ops: Operacion[]) => Promise<void>
  onGuardado: (m: string) => void
  onCerrar: () => void
}) {
  const [anulando, setAnulando] = useState<Anulable | null>(null)
  const registros = estado.registros.filter((r) => r.equipo_id === motor.equipo_id)
  const tanqueId = motor.tanque?.id
  const recepciones = estado.recepciones.filter((r) => r.tanque_id === tanqueId)
  const movimientos = estado.asignaciones.filter((a) => a.equipo_id === motor.equipo_id)
  const pendientes = cola.filter(
    (o) =>
      ['motor_registro_diario', 'diesel_recibir', 'motor_mantenimiento', 'motor_asignar', 'motor_retiro'].includes(o.tipo) &&
      (o.datos.equipo_id === motor.equipo_id || o.datos.tanque_id === tanqueId) &&
      o.estado_local !== 'ACEPTADO'
  )
  const puede = puedeAnular && estacion.permisos.anular

  return (
    <Modal abierto onCerrar={onCerrar} titulo={`Historial · ${motor.codigo}`}>
      <div className="flex flex-col gap-2" data-historial-motor-vista>
        {pendientes.map((o) => (
          <div key={o.id} className="rounded-xl bg-white p-3 ring-1 ring-inset ring-amber-300" data-motor-pendiente>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-800">{o.resumen}</p>
              <Insignia tono={o.estado_local === 'RECHAZADO' ? 'rojo' : 'ambar'}>{o.estado_local === 'RECHAZADO' ? 'Rechazado' : 'Por enviar'}</Insignia>
            </div>
            {o.estado_local === 'RECHAZADO' && o.mensaje && <p className="mt-1 text-xs text-red-700">{o.mensaje}</p>}
          </div>
        ))}

        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Registros diarios (45 días)</p>
        {registros.length === 0 && <p className="rounded-xl bg-slate-50 p-3 text-center text-sm text-slate-500">Sin registros en los últimos 45 días.</p>}
        <div className="overflow-x-auto">
          {registros.length > 0 && (
            <table className="w-full min-w-[28rem] text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-2">Fecha</th>
                  <th className="pr-2 text-right">Horas</th>
                  <th className="pr-2 text-right">Gastado</th>
                  <th className="pr-2 text-right">gal/h</th>
                  <th>Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {registros.map((r) => (
                  <tr key={r.id} className={r.anulado_at ? 'opacity-50 line-through' : ''} data-registro-motor={r.id}>
                    <td className="py-1 pr-2">{r.fecha.slice(8, 10)}/{r.fecha.slice(5, 7)}</td>
                    <td className="pr-2 text-right tabular-nums">{cantidad(r.horas)}</td>
                    <td className="pr-2 text-right tabular-nums">{cantidad(r.gastado_gal)}</td>
                    <td className="pr-2 text-right tabular-nums">{r.rendimiento_gal_h === null ? '—' : cantidad(r.rendimiento_gal_h)}</td>
                    <td>
                      {(r.observaciones ?? []).map((o) => NOMBRE_OBSERVACION[o] ?? o).join(', ')}
                      {puede && !r.anulado_at && (
                        <Boton tamano="sm" variante="peligro" className="ml-2 min-h-11" onClick={() => setAnulando({ tipo: 'motor_registro', id: r.id, texto: `Registro del ${r.fecha}` })} data-anular-registro-motor>
                          Anular
                        </Boton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">Diésel recibido</p>
        {recepciones.length === 0 && <p className="text-sm text-slate-500">Sin recepciones.</p>}
        {recepciones.map((r) => (
          <div key={r.id} className={`flex flex-wrap items-center justify-between gap-2 text-sm ${r.anulado_at ? 'opacity-50 line-through' : ''}`}>
            <span>
              {formatearFechaHora(r.fecha_hora)} · <strong>{cantidad(r.galones)} gal</strong>
            </span>
            {puede && !r.anulado_at && (
              <Boton tamano="sm" variante="peligro" className="min-h-11" onClick={() => setAnulando({ tipo: 'diesel_recepcion', id: r.id, texto: `Recepción de ${r.galones} gal` })} data-anular-recepcion-motor>
                Anular
              </Boton>
            )}
          </div>
        ))}

        <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-400">Movimientos del motor</p>
        {movimientos.length === 0 && <p className="text-sm text-slate-500">Sin movimientos.</p>}
        {movimientos.map((a) => (
          <div key={a.id} className={`flex flex-wrap items-center justify-between gap-2 text-sm ${a.anulado_at ? 'opacity-50 line-through' : ''}`}>
            <span>
              {formatearFechaHora(a.fecha_hora)} · <strong>{NOMBRE_MOV[a.tipo] ?? a.tipo}</strong> · {a.motivo}
            </span>
            {puede && !a.anulado_at && (
              <Boton tamano="sm" variante="peligro" className="min-h-11" onClick={() => setAnulando({ tipo: 'motor_asignacion', id: a.id, texto: `${NOMBRE_MOV[a.tipo] ?? a.tipo} del ${a.fecha_hora.slice(0, 10)}` })} data-anular-movimiento-motor>
                Anular
              </Boton>
            )}
          </div>
        ))}

        {anulando && <FormAnular doc={anulando} estacion={estacion} yo={yo} registrar={registrar} onCerrar={() => setAnulando(null)} onGuardado={onGuardado} />}
      </div>
    </Modal>
  )
}
