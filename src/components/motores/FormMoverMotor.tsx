'use client'

/**
 * Mover un motor (solo con «configurar»): instalar, trasladar, llevar al taller, devolver del taller o retirar, siempre con
 * motivo. Si el tanque tiene diésel y el motor sale de la estación hay que decir qué pasa con ese diésel (nunca se pierde en
 * silencio): fin de temporada → se va con el motor (o se devuelve); daño y reemplazo → queda en el tanque de la estación.
 * Operaciones `motor_asignar` y `motor_retiro` (sql/130). Las estaciones son las del catálogo (`estaciones_riego`).
 */

import { useMemo, useState } from 'react'
import { AreaTexto, Campo } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { aEntradaLocal, ahoraIso, deEntradaLocal } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import type { EstadoMotores, MotorEstacion } from '@/lib/motores/estado'
import { armarMovimientoMotor, destinoSugerido, type DestinoSaldo, type TipoMovimientoMotor } from '@/lib/motores/registroDiario'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'

const MOTIVOS = [
  ['FIN_TEMPORADA', 'Fin de temporada'],
  ['DANO_REEMPLAZO', 'Daño y reemplazo'],
  ['CAMBIO_ESTACION', 'Cambio de estación'],
  ['MANTENIMIENTO', 'Mantenimiento'],
  ['OTRO', 'Otro'],
] as const

const NOMBRE_TIPO: Record<TipoMovimientoMotor, string> = {
  INSTALADO: 'Instalar en una estación',
  TRASLADADO: 'Trasladar a otra estación',
  AL_TALLER: 'Llevar al taller',
  DE_VUELTA: 'Devolver del taller a una estación',
  RETIRADO: 'Retirar (fin de temporada o baja)',
}

type Datos = {
  tipo: TipoMovimientoMotor | ''
  destino: string
  tanque: string
  tanqueNombre: string
  tanqueCapacidad: string
  motivoCodigo: string
  motivo: string
  destinoSaldo: DestinoSaldo | ''
  devolucion: 'SUMINISTROS' | 'BODEGA' | 'TALLER' | ''
  horasBase: string
  fechaHora: string
}

export function FormMoverMotor({
  motor,
  estado,
  estaciones,
  saldoGal,
  estacion,
  yo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  motor: MotorEstacion
  estado: EstadoMotores
  /** Las estaciones (catálogo) que la persona ve. */
  estaciones: Estacion[]
  saldoGal: number
  /** Estación desde la que se registra (la del motor, o la elegida en pantalla si el motor no tiene). */
  estacion: Estacion
  yo: Persona
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const instalado = motor.estado === 'EN_ESTACION'
  const tiposPosibles: TipoMovimientoMotor[] = instalado ? ['TRASLADADO', 'AL_TALLER', 'RETIRADO'] : motor.estado === 'TALLER' ? ['DE_VUELTA', 'INSTALADO'] : ['INSTALADO']
  const borrador = useBorrador<Datos>(claveBorrador('motor_mover', yo.id, estacion.id, motor.equipo_id))
  const b = borrador.inicial
  const [tipo, setTipo] = useState<TipoMovimientoMotor | ''>(b?.tipo ?? (tiposPosibles.length === 1 ? tiposPosibles[0] : ''))
  const [destino, setDestino] = useState(b?.destino ?? '')
  const [tanque, setTanque] = useState(b?.tanque ?? '')
  const [tanqueNombre, setTanqueNombre] = useState(b?.tanqueNombre ?? '')
  const [tanqueCapacidad, setTanqueCapacidad] = useState(b?.tanqueCapacidad ?? '')
  const [motivoCodigo, setMotivoCodigo] = useState(b?.motivoCodigo ?? '')
  const [motivo, setMotivo] = useState(b?.motivo ?? '')
  const [destinoSaldo, setDestinoSaldo] = useState<DestinoSaldo | ''>(b?.destinoSaldo ?? '')
  const [devolucion, setDevolucion] = useState<'SUMINISTROS' | 'BODEGA' | 'TALLER' | ''>(b?.devolucion ?? '')
  const [horasBase, setHorasBase] = useState(b?.horasBase ?? '')
  const [fechaHora, setFechaHora] = useState(b?.fechaHora ?? aEntradaLocal(ahoraIso()))
  useAutoguardado(borrador, { tipo, destino, tanque, tanqueNombre, tanqueCapacidad, motivoCodigo, motivo, destinoSaldo, devolucion, horasBase, fechaHora })

  const sale = tipo === 'TRASLADADO' || tipo === 'RETIRADO' || tipo === 'AL_TALLER'
  const entra = tipo === 'INSTALADO' || tipo === 'DE_VUELTA' || tipo === 'TRASLADADO'
  const sug = destinoSugerido(motivoCodigo)
  const destinoEf: DestinoSaldo | '' = sale && sug.fijo && sug.destino ? sug.destino : destinoSaldo || (sale && sug.destino ? sug.destino : '')
  const tanquesDestino = useMemo(() => estado.tanques_sin_motor.filter((t) => t.estacion_id === destino), [estado.tanques_sin_motor, destino])
  const traeTanque = Boolean(!instalado && motor.tanque)
  // Trasladar «con el motor» lleva su tanque: no se pide otro
  const viajaConMotor = tipo === 'TRASLADADO' && destinoEf === 'CON_EL_MOTOR'

  return (
    <MarcoRegistro
      titulo={`Mover motor · ${motor.codigo}`}
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      sinCustodia
      construir={({ ubicacion, enNombreDe }) => {
        if (!tipo) return 'Elige qué se hace con el motor.'
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Indica la fecha y hora del movimiento.'
        const horas = horasBase.trim() ? Number(horasBase.replace(',', '.')) : null
        const cap = tanqueCapacidad.trim() ? Number(tanqueCapacidad.replace(',', '.')) : null
        const a = armarMovimientoMotor({
          equipoId: motor.equipo_id,
          tipo,
          fechaHora: fh,
          estacionDestino: entra ? destino || null : null,
          tanqueId: tanque || null,
          tanqueNuevo: !tanque && tanqueNombre.trim() && entra && !viajaConMotor ? { nombre: tanqueNombre, capacidadGal: cap, materialId: estado.material_diesel_id } : null,
          motivo,
          motivoCodigo,
          destinoSaldo: destinoEf || null,
          destinoDevolucion: devolucion || null,
          horasBase: horas,
          saldoActual: sale ? saldoGal : 0,
          traeTanque: traeTanque || viajaConMotor,
          estacionOrigen: motor.estacion_id,
        })
        if ('error' in a) return a.error
        return [crearOperacion(a.operacion, a.datos, { ubicacion, enNombreDe, resumen: `${NOMBRE_TIPO[tipo]} · ${motor.codigo}` })]
      }}
    >
      {sale && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700" data-saldo-mover>
          El tanque tiene <strong>{saldoGal} gal</strong> de diésel.
        </p>
      )}

      <Campo etiqueta="¿Qué se hace?" requerido>
        <div className="flex flex-col gap-2" role="group" aria-label="Qué se hace">
          {tiposPosibles.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tipo === t}
              onClick={() => setTipo(t)}
              data-tipo-mov={t}
              className={`min-h-11 rounded-xl px-4 py-2 text-left text-sm font-semibold ring-1 ring-inset ${tipo === t ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'}`}
            >
              {NOMBRE_TIPO[t]}
            </button>
          ))}
        </div>
      </Campo>

      {entra && (
        <Campo etiqueta="Estación de destino" requerido>
          <div data-selector-destino>
            <SelectorBuscable
              valor={destino}
              opciones={estaciones.filter((e) => e.id !== motor.estacion_id).map((e) => ({ id: e.id, titulo: e.nombre, subtitulo: e.zona ?? undefined }))}
              onCambiar={(v) => {
                setDestino(v)
                setTanque('')
              }}
              placeholder="Elegir estación…"
              etiquetaBusqueda="Buscar estación"
              permitirVacio={false}
            />
          </div>
        </Campo>
      )}

      {entra && !viajaConMotor && !traeTanque && (
        <Campo etiqueta="Tanque del motor" requerido>
          {tanquesDestino.length > 0 && (
            <div data-selector-tanque className="mb-2">
              <SelectorBuscable
                valor={tanque}
                opciones={tanquesDestino.map((t) => ({ id: t.id, titulo: t.nombre, subtitulo: `${t.saldo_gal} gal` }))}
                onCambiar={setTanque}
                placeholder="Tanque de la estación sin motor…"
                etiquetaBusqueda="Buscar tanque"
              />
            </div>
          )}
          {!tanque && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={tanqueNombre}
                onChange={(e) => setTanqueNombre(e.target.value)}
                placeholder="Tanque nuevo: nombre"
                data-tanque-nombre
                className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-base focus:border-brand-600 focus:outline-none"
              />
              <input
                inputMode="decimal"
                value={tanqueCapacidad}
                onChange={(e) => setTanqueCapacidad(e.target.value.replace(/[^\d.,]/g, ''))}
                placeholder="Capacidad (gal)"
                data-tanque-capacidad
                className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base tabular-nums focus:border-brand-600 focus:outline-none"
              />
            </div>
          )}
        </Campo>
      )}

      <Campo etiqueta="Motivo" requerido>
        <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Código del motivo">
          {MOTIVOS.map(([id, nombre]) => (
            <button
              key={id}
              type="button"
              aria-pressed={motivoCodigo === id}
              onClick={() => setMotivoCodigo(motivoCodigo === id ? '' : id)}
              data-motivo-codigo={id}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-inset ${motivoCodigo === id ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'}`}
            >
              {nombre}
            </button>
          ))}
        </div>
        <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Explica el motivo" data-motivo />
      </Campo>

      {sale && saldoGal > 0.0001 && (
        <Campo etiqueta="¿Qué pasa con el diésel del tanque?" requerido>
          <div className="flex flex-col gap-2" role="group" aria-label="Destino del diésel" data-destino-saldo>
            {([['CON_EL_MOTOR', 'Se va con el motor'], ['DEVUELTO', 'Se devuelve'], ['QUEDA_EN_TANQUE', 'Queda en el tanque de la estación']] as const).map(([id, nombre]) => (
              <button
                key={id}
                type="button"
                aria-pressed={destinoEf === id}
                disabled={sug.fijo && id !== sug.destino}
                onClick={() => setDestinoSaldo(id)}
                data-saldo-opcion={id}
                className={`min-h-11 rounded-xl px-4 py-2 text-left text-sm font-semibold ring-1 ring-inset disabled:opacity-40 ${destinoEf === id ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'}`}
              >
                {nombre}
              </button>
            ))}
          </div>
          {sug.fijo && <p className="mt-1 text-xs text-slate-500">En daño y reemplazo el diésel queda en el tanque de la estación.</p>}
          {destinoEf === 'DEVUELTO' && (
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Devolver a" data-devolver-a>
              {([['SUMINISTROS', 'Suministros'], ['BODEGA', 'Bodega'], ['TALLER', 'Taller']] as const).map(([id, nombre]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={devolucion === id}
                  onClick={() => setDevolucion(id)}
                  className={`min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-inset ${devolucion === id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300'}`}
                >
                  {nombre}
                </button>
              ))}
            </div>
          )}
        </Campo>
      )}

      {entra && (
        <Campo etiqueta="Horas desde el último mantenimiento (opcional)">
          <input
            inputMode="decimal"
            value={horasBase}
            onChange={(e) => setHorasBase(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="0"
            data-horas-base
            className="min-h-11 w-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base tabular-nums focus:border-brand-600 focus:outline-none"
          />
        </Campo>
      )}

      <Campo etiqueta="Fecha y hora" requerido>
        <input
          type="datetime-local"
          value={fechaHora}
          onChange={(e) => setFechaHora(e.target.value)}
          data-fecha-hora
          className="min-h-11 w-60 rounded-lg border border-slate-200 bg-white px-3 py-2 text-base focus:border-brand-600 focus:outline-none"
        />
      </Campo>
    </MarcoRegistro>
  )
}
