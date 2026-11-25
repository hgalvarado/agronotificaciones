'use client'

/**
 * «Motores»: los motores de la estación, una tarjeta por motor con su medidor de combustible y su barra de mantenimiento. Tocar la
 * tarjeta abre el detalle; las acciones de todos los días (Registrar día, Recibir combustible) van a la vista en cada motor.
 * «Asignar motor» es secundario y va al final.
 */

import { Boton } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { IconChevronRight } from '@/components/ui/Icons'
import { cantidad } from '@/lib/fertirriego/calculos'
import type { VistaMotor } from '@/lib/motores/vistaMotor'
import { BandaNivel, etiquetaMotor, FilaToque, InsigniaNivel } from './ElementosMotor'
import { BarraMantenimiento } from './BarraMantenimiento'
import { MedidorTanque } from './MedidorTanque'

const fecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export type AccionMotor = 'registro' | 'recibir' | 'mover' | 'retirar' | 'mantenimiento' | 'historial'

function TarjetaMotor({ v, puedeRegistrar, onAbrir, onRegistrar, onRecibir }: { v: VistaMotor; puedeRegistrar: boolean; onAbrir: () => void; onRegistrar: () => void; onRecibir: () => void }) {
  const m = v.motor
  return (
    <div data-motor={m.codigo} className="rounded-xl bg-white ring-1 ring-inset ring-slate-200">
      <button type="button" onClick={onAbrir} className="flex min-h-14 w-full items-stretch gap-2.5 py-2.5 pl-2.5 pr-3 text-left active:bg-slate-50">
        <BandaNivel nivel={v.ayuda.nivel} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="block min-w-0 break-words text-[15px] font-medium leading-tight text-slate-900">
              {etiquetaMotor(m.codigo, m.nombre)}
              {m.modelo ? <span className="ml-1 text-xs font-normal text-slate-600">{m.modelo}</span> : null}
            </span>
            {v.ayuda.nivel !== 'gris' && <InsigniaNivel nivel={v.ayuda.nivel} />}
          </span>
          <span className="mt-2 block">
            {m.tanque ? <MedidorTanque saldo={v.saldo} capacidad={m.tanque.capacidad_gal} /> : <span className="text-xs text-slate-600">Sin tanque</span>}
          </span>
          <span className="mt-1.5 block">
            <BarraMantenimiento horas={v.horas} estimadas={v.estimadas} intervalo={m.intervalo_horas} aviso={m.aviso_horas} />
          </span>
          <span className="mt-1.5 block text-xs text-slate-600">{v.fechaUltima ? `Último registro ${fecha(v.fechaUltima)}` : 'Sin registros'}</span>
        </span>
        <IconChevronRight className="h-4 w-4 shrink-0 self-center text-slate-400" />
      </button>
      {puedeRegistrar && (
        <div className="flex gap-2 border-t border-slate-100 px-2.5 py-1.5">
          <Boton tamano="sm" className="min-h-11 flex-1" onClick={onRegistrar} data-registrar-dia>
            Registrar día
          </Boton>
          {m.tanque && (
            <Boton tamano="sm" variante="secundario" className="min-h-11 flex-1" onClick={onRecibir} data-recibir-combustible>
              Recibir combustible
            </Boton>
          )}
        </div>
      )}
    </div>
  )
}

export function PestanaMotores({
  vistas,
  puedeAsignar,
  puedeRegistrar,
  onAsignar,
  onAbrir,
  onRegistrar,
  onRecibir,
}: {
  vistas: VistaMotor[]
  puedeAsignar: boolean
  puedeRegistrar: boolean
  onAsignar: () => void
  onAbrir: (equipoId: string) => void
  onRegistrar: (equipoId: string) => void
  onRecibir: (equipoId: string) => void
}) {
  return (
    <div className="flex flex-col gap-2" data-pestana-motores>
      {vistas.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200" data-sin-motores>
          {puedeAsignar ? 'Sin motores. Asigna uno.' : 'Sin motores en esta estación.'}
        </p>
      )}
      <div data-motores className="flex flex-col gap-2">
        {vistas.map((v) => (
          <TarjetaMotor
            key={v.motor.equipo_id}
            v={v}
            puedeRegistrar={puedeRegistrar}
            onAbrir={() => onAbrir(v.motor.equipo_id)}
            onRegistrar={() => onRegistrar(v.motor.equipo_id)}
            onRecibir={() => onRecibir(v.motor.equipo_id)}
          />
        ))}
      </div>
      {puedeAsignar && (
        <button type="button" onClick={onAsignar} className="min-h-11 self-center rounded-lg px-3 text-sm font-medium text-brand-700 underline" data-asignar-motor>
          Asignar motor
        </button>
      )}
    </div>
  )
}

/** Detalle de un motor: el medidor y la barra con su dato, y, solo aquí, las acciones menos frecuentes. */
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
        <FilaToque
          nivel={ayuda.mantenimiento.nivel}
          titulo="Mantenimiento"
          linea2={<BarraMantenimiento horas={vista.horas} estimadas={vista.estimadas} intervalo={motor.intervalo_horas} aviso={motor.aviso_horas} />}
          linea3={`${cantidad(vista.horas)} h desde el último${vista.estimadas > 0 ? ` · ${cantidad(vista.estimadas)} h estimadas` : ''}`}
        />
        {ayuda.registro && (
          <FilaToque
            nivel={ayuda.registro.nivel}
            titulo="Registro del día"
            linea2={ayuda.registro.texto}
            linea3={motor.horo_ultimo !== null ? `Horómetro ${cantidad(motor.horo_ultimo)}${motor.visor_ultimo !== null ? ` · visor ${cantidad(motor.visor_ultimo)} gal` : ''}` : undefined}
          />
        )}
        {ayuda.tanque && (
          <FilaToque nivel={ayuda.tanque.nivel} titulo={motor.tanque ? `Tanque ${motor.tanque.nombre}` : 'Tanque'} linea2={<MedidorTanque saldo={vista.saldo} capacidad={motor.tanque?.capacidad_gal ?? null} grande />} />
        )}

        {instalado && puedeRegistrar && (
          <div className="mt-1 flex gap-2">
            <Boton className="min-h-14 flex-1 text-base" onClick={() => onAccion('registro')} data-registro-diario>
              Registrar día
            </Boton>
            {motor.tanque && (
              <Boton variante="secundario" className="min-h-14 flex-1 text-base" onClick={() => onAccion('recibir')} data-recibir-combustible-detalle>
                Recibir combustible
              </Boton>
            )}
          </div>
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
