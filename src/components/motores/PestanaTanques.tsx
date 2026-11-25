'use client'

/**
 * «Tanques»: los tanques fijos asignados a la estación, una fila compacta por tanque con su nivel, saldo y el motor conectado.
 * Tocar la fila abre el detalle (lo último que se recibió) con la acción «Recibir diésel» en ese tanque. Arriba, el botón grande
 * «Recibir diésel»; quien tiene «Configurar» ve además «Administrar tanques».
 */

import { Boton } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { formatearFechaHora } from '@/lib/estados'
import { cantidad } from '@/lib/fertirriego/calculos'
import { nombreQuien, type EstadoMotores, type TanqueFijo } from '@/lib/motores/estado'
import { semaforoTanque } from '@/lib/motores/senales'
import { FilaToque } from './ElementosMotor'
import { MedidorTanque } from './MedidorTanque'

export function PestanaTanques({
  tanques,
  saldoDe,
  codigoMotor,
  puedeRecibir,
  puedeConfigurar,
  onRecibir,
  onAbrir,
  onAdministrar,
}: {
  tanques: TanqueFijo[]
  saldoDe: (id: string) => number
  codigoMotor: (equipoId: string | null) => string | null
  puedeRecibir: boolean
  puedeConfigurar: boolean
  onRecibir: () => void
  onAbrir: (id: string) => void
  onAdministrar: () => void
}) {
  return (
    <div className="flex flex-col gap-2" data-pestana-tanques>
      {puedeRecibir && tanques.length > 0 && (
        <Boton className="min-h-14 w-full text-base" onClick={onRecibir} data-recibir-diesel>
          Recibir combustible
        </Boton>
      )}
      {tanques.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200" data-sin-tanques>
          {puedeConfigurar ? 'Sin tanques. Asigna uno.' : 'Sin tanques en esta estación.'}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        {tanques.map((t) => {
          const saldo = saldoDe(t.id)
          const sem = semaforoTanque(saldo, t.capacidad_gal)
          const motor = codigoMotor(t.motor_equipo_id)
          return (
            <FilaToque
              key={t.id}
              atributos={{ 'data-tanque': t.nombre }}
              nivel={sem.nivel}
              titulo={t.nombre}
              linea2={<MedidorTanque saldo={saldo} capacidad={t.capacidad_gal} />}
              linea3={motor ? `Motor ${motor}` : 'Sin motor'}
              onToque={() => onAbrir(t.id)}
            />
          )
        })}
      </div>
      {puedeConfigurar && (
        <Boton variante="secundario" className="min-h-11" onClick={onAdministrar} data-administrar-tanques>
          Administrar tanques
        </Boton>
      )}
    </div>
  )
}

export function DetalleTanque({
  tanque,
  saldo,
  motor,
  estado,
  puedeRecibir,
  onRecibir,
  onCerrar,
}: {
  tanque: TanqueFijo
  saldo: number
  motor: string | null
  estado: EstadoMotores
  puedeRecibir: boolean
  onRecibir: () => void
  onCerrar: () => void
}) {
  const sem = semaforoTanque(saldo, tanque.capacidad_gal)
  const recientes = estado.recepciones.filter((r) => r.tanque_id === tanque.id && !r.anulado_at).slice(0, 5)
  return (
    <Modal abierto titulo={`Tanque ${tanque.nombre}`} onCerrar={onCerrar}>
      <div className="flex flex-col gap-2" data-detalle-tanque={tanque.nombre}>
        <FilaToque nivel={sem.nivel} titulo="Nivel" linea2={<MedidorTanque saldo={saldo} capacidad={tanque.capacidad_gal} grande />} linea3={motor ? `Motor ${motor}` : 'Sin motor'} />
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Últimas entradas</p>
        {recientes.length === 0 && <p className="text-sm text-slate-500">Sin entradas en 45 días.</p>}
        {recientes.map((r) => (
          <p key={r.id} className="text-sm text-slate-700">
            <strong className="tabular-nums text-slate-900">{cantidad(r.galones)} gal</strong> · {formatearFechaHora(r.fecha_hora)}
            {nombreQuien(estado, r.registrado_por) ? ` · ${nombreQuien(estado, r.registrado_por)}` : ''}
          </p>
        ))}
        {puedeRecibir && (
          <Boton className="mt-1 min-h-14 w-full text-base" onClick={onRecibir} data-recibir-en-tanque>
            Recibir combustible
          </Boton>
        )}
        <Boton variante="fantasma" className="min-h-11" onClick={onCerrar}>
          Regresar
        </Boton>
      </div>
    </Modal>
  )
}
