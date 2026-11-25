'use client'

/**
 * «Motores»: los motores conectados a la estación, una fila compacta por motor con su semáforo (mantenimiento, horas desde el
 * último mantenimiento con las estimadas, tanque y saldo). Tocar la fila abre el detalle con las acciones del motor, cada una con su
 * permiso. Arriba, el botón grande «Asignar nuevo motor» (recibir un motor).
 */

import { Boton } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { cantidad } from '@/lib/fertirriego/calculos'
import type { VistaMotor } from '@/lib/motores/vistaMotor'
import { BarraTanque, FilaToque } from './ElementosMotor'

const fecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export type AccionMotor = 'registro' | 'mover' | 'retirar' | 'mantenimiento' | 'historial'

export function PestanaMotores({
  vistas,
  puedeAsignar,
  onAsignar,
  onAbrir,
}: {
  vistas: VistaMotor[]
  puedeAsignar: boolean
  onAsignar: () => void
  onAbrir: (equipoId: string) => void
}) {
  return (
    <div className="flex flex-col gap-2" data-pestana-motores>
      {puedeAsignar && (
        <Boton className="min-h-14 w-full text-base" onClick={onAsignar} data-asignar-motor>
          Asignar nuevo motor
        </Boton>
      )}
      {vistas.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200" data-sin-motores>
          Esta estación no tiene motores conectados.{puedeAsignar ? ' Toca «Asignar nuevo motor» para recibir uno.' : ' Pide a quien te corresponda que te dé el permiso de recibir motores.'}
        </p>
      )}
      <div data-motores className="flex flex-col gap-1.5">
        {vistas.map((v) => (
          <FilaToque
            key={v.motor.equipo_id}
            atributos={{ 'data-motor': v.motor.codigo }}
            nivel={v.ayuda.nivel}
            titulo={
              <>
                {v.motor.codigo}
                {v.motor.nombre ? <span className="ml-1 text-xs font-normal text-slate-600">{v.motor.nombre}{v.motor.modelo ? ` · ${v.motor.modelo}` : ''}</span> : null}
              </>
            }
            linea2={v.ayuda.mantenimiento.texto}
            linea3={
              <>
                {v.motor.tanque ? `Tanque ${v.motor.tanque.nombre} · ${v.saldo === null ? '—' : cantidad(v.saldo)} gal` : 'Sin tanque conectado'}
                {v.fechaUltima ? ` · último registro ${fecha(v.fechaUltima)}` : ' · sin registros'}
              </>
            }
            onToque={() => onAbrir(v.motor.equipo_id)}
          />
        ))}
      </div>
    </div>
  )
}

/** Detalle de un motor: los tres semáforos con su explicación y, solo aquí, las acciones del motor. */
export function DetalleMotor({
  vista,
  puedeRegistrar,
  puedeMover,
  puedeRetirar,
  puedeMantenimiento,
  onAccion,
  onCerrar,
}: {
  vista: VistaMotor
  puedeRegistrar: boolean
  puedeMover: boolean
  puedeRetirar: boolean
  puedeMantenimiento: boolean
  onAccion: (a: AccionMotor) => void
  onCerrar: () => void
}) {
  const { motor, ayuda } = vista
  const instalado = motor.estado === 'EN_ESTACION'
  return (
    <Modal abierto titulo={`Motor ${motor.codigo}`} onCerrar={onCerrar}>
      <div className="flex flex-col gap-2" data-detalle-motor={motor.codigo}>
        <p className="text-xs text-slate-600">
          {motor.nombre}
          {motor.modelo ? ` · ${motor.modelo}` : ''}
        </p>
        <FilaToque nivel={ayuda.mantenimiento.nivel} titulo="Mantenimiento" linea2={ayuda.mantenimiento.texto} linea3={`Llevas ${cantidad(vista.horas)} h desde el último mantenimiento${vista.estimadas > 0 ? ` (${cantidad(vista.estimadas)} h son estimadas)` : ''}.`} />
        {ayuda.registro && <FilaToque nivel={ayuda.registro.nivel} titulo="Registro del día" linea2={ayuda.registro.texto} linea3={motor.horo_ultimo !== null ? `Último horómetro ${cantidad(motor.horo_ultimo)}${motor.visor_ultimo !== null ? ` · visor ${cantidad(motor.visor_ultimo)} gal` : ''}` : undefined} />}
        {ayuda.tanque && (
          <FilaToque
            nivel={ayuda.tanque.nivel}
            titulo={motor.tanque ? `Tanque ${motor.tanque.nombre}` : 'Tanque'}
            linea2={ayuda.tanque.texto}
            linea3={<BarraTanque pct={ayuda.tanque.pct} nivel={ayuda.tanque.nivel} />}
          />
        )}

        {instalado && puedeRegistrar && (
          <Boton className="mt-1 min-h-14 w-full text-base" onClick={() => onAccion('registro')} data-registro-diario>
            Registro diario
          </Boton>
        )}
        <div className="flex flex-wrap gap-2">
          <Boton tamano="sm" variante="secundario" className="min-h-11" onClick={() => onAccion('historial')} data-historial-motor>
            Ver historial
          </Boton>
          {instalado && puedeMover && (
            <Boton tamano="sm" variante="secundario" className="min-h-11" onClick={() => onAccion('mover')} data-mover-motor>
              Mover
            </Boton>
          )}
          {instalado && puedeRetirar && (
            <Boton tamano="sm" variante="secundario" className="min-h-11" onClick={() => onAccion('retirar')} data-retirar-motor>
              Retirar
            </Boton>
          )}
          {puedeMantenimiento && (
            <Boton tamano="sm" variante="secundario" className="min-h-11" onClick={() => onAccion('mantenimiento')} data-registrar-mantenimiento>
              Mantenimiento
            </Boton>
          )}
        </div>
        <Boton variante="fantasma" className="min-h-11" onClick={onCerrar}>
          Regresar
        </Boton>
      </div>
    </Modal>
  )
}
