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
import { BarraTanque, FilaToque } from './ElementosMotor'

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
          Recibir diésel
        </Boton>
      )}
      {tanques.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200" data-sin-tanques>
          Esta estación no tiene tanques asignados.{puedeConfigurar ? ' Asígnale uno en «Administrar tanques».' : ' Pide a Torre de Control que le asigne uno.'}
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
              derecha={
                <span>
                  {cantidad(saldo)} <span className="text-[11px] font-normal text-slate-500">gal</span>
                </span>
              }
              linea2={motor ? `Conectado a ${motor}` : 'Sin motor conectado'}
              linea3={
                <>
                  {t.capacidad_gal ? `${sem.pct ?? 0} % de ${cantidad(t.capacidad_gal)} gal` : 'Sin capacidad definida'}
                  <BarraTanque pct={sem.pct} nivel={sem.nivel} />
                </>
              }
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
        <FilaToque nivel={sem.nivel} titulo={`${cantidad(saldo)} gal`} linea2={sem.texto} linea3={<BarraTanque pct={sem.pct} nivel={sem.nivel} />} />
        <p className="text-xs text-slate-600">{motor ? `Conectado al motor ${motor}.` : 'Sin motor conectado.'}</p>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Últimas recepciones</p>
        {recientes.length === 0 && <p className="text-sm text-slate-500">Sin recepciones en los últimos 45 días.</p>}
        {recientes.map((r) => (
          <p key={r.id} className="text-sm text-slate-700">
            <strong className="tabular-nums text-slate-900">{cantidad(r.galones)} gal</strong> · {formatearFechaHora(r.fecha_hora)}
            {nombreQuien(estado, r.registrado_por) ? ` · ${nombreQuien(estado, r.registrado_por)}` : ''}
          </p>
        ))}
        {puedeRecibir && (
          <Boton className="mt-1 min-h-14 w-full text-base" onClick={onRecibir} data-recibir-en-tanque>
            Recibir diésel en este tanque
          </Boton>
        )}
        <Boton variante="fantasma" className="min-h-11" onClick={onCerrar}>
          Regresar
        </Boton>
      </div>
    </Modal>
  )
}
