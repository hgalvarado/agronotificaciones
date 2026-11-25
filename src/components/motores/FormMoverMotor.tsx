'use client'

/**
 * Recibir, mover o retirar un motor, cada uno con su permiso (sql/138: motor_recibir, motor_mover, motor_retirar).
 * Recibir NO pide motivo (solo horómetro y observación); el motivo es de mover y retirar.
 * sql/147: los tanques son FIJOS y se quedan en su estación con su diésel. Al recibir o mover el motor se elige uno de los tanques
 * LIBRES de la estación de destino (si hay uno solo ya viene elegido); al sacarlo, solo se desconecta el motor: ya no se pregunta
 * qué pasa con el diésel. Crear un tanque nuevo es solo de quien tiene «Configurar».
 * Operaciones `motor_asignar` y `motor_retiro` (sql/130). Las estaciones son las del catálogo (`estaciones_riego`).
 */

import { useMemo, useState } from 'react'
import { AreaTexto, Campo } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { aEntradaLocal, ahoraIso, deEntradaLocal } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import { tanquesLibres, type EstadoMotores, type MotorEstacion } from '@/lib/motores/estado'
import { armarMovimientoMotor, ETIQUETA_MOTIVO, type TipoMovimientoMotor } from '@/lib/motores/registroDiario'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'

export type ModoMovimiento = 'recibir' | 'mover' | 'retirar'

/** Motivos de cada modo (recibir no tiene). */
const MOTIVOS_MOVER = ['CAMBIO_ESTACION', 'OTRO']
const MOTIVOS_RETIRAR = ['FIN_TEMPORADA', 'DANO_REEMPLAZO', 'OTRO']

const NOMBRE_TIPO: Record<TipoMovimientoMotor, string> = {
  INSTALADO: 'Recibir motor en esta estación',
  TRASLADADO: 'Mover a otra estación',
  AL_TALLER: 'Llevar al taller',
  DE_VUELTA: 'Recibir del taller en esta estación',
  RETIRADO: 'Retirar de la estación',
}

const TITULO: Record<ModoMovimiento, string> = { recibir: 'Recibir motor', mover: 'Mover motor', retirar: 'Retirar motor' }

const AYUDA: Record<ModoMovimiento, string> = {
  recibir: 'Escribe el horómetro y elige un tanque libre.',
  mover: 'Elige la estación destino. El tanque se queda aquí.',
  retirar: 'Elige el motivo. El tanque se queda aquí.',
}

type Datos = {
  tipo: TipoMovimientoMotor | ''
  destino: string
  tanque: string
  tanqueNombre: string
  tanqueCapacidad: string
  motivoCodigo: string
  motivo: string
  horasBase: string
  fechaHora: string
  horometro: string
  observacion: string
}

export function FormMoverMotor({
  modo,
  onRegresar,
  motor,
  estado,
  estaciones,
  puedeCrearTanque = false,
  estacion,
  yo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  modo: ModoMovimiento
  /** Solo al recibir: volver a la lista para elegir otro motor. */
  onRegresar?: () => void
  motor: MotorEstacion
  estado: EstadoMotores
  /** Las estaciones (catálogo) que la persona ve. */
  estaciones: Estacion[]
  /** Solo con «Configurar»: se puede crear un tanque que no exista (con control de duplicados en la base). */
  puedeCrearTanque?: boolean
  /** Estación desde la que se registra (la del motor, o la elegida en pantalla si el motor no tiene). */
  estacion: Estacion
  yo: Persona
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const instalado = motor.estado === 'EN_ESTACION'
  const tiposPosibles: TipoMovimientoMotor[] =
    modo === 'mover'
      ? ['TRASLADADO']
      : modo === 'retirar'
        ? ['AL_TALLER', 'RETIRADO']
        : instalado
          ? ['TRASLADADO']
          : motor.estado === 'TALLER'
            ? ['DE_VUELTA']
            : ['INSTALADO']
  const motivosModo = modo === 'mover' ? MOTIVOS_MOVER : MOTIVOS_RETIRAR
  const borrador = useBorrador<Datos>(claveBorrador(`motor_${modo}`, yo.id, estacion.id, motor.equipo_id))
  const b = borrador.inicial
  const [tipo, setTipo] = useState<TipoMovimientoMotor | ''>(b?.tipo ?? (tiposPosibles.length === 1 ? tiposPosibles[0] : ''))
  const [destino, setDestino] = useState(b?.destino ?? (modo === 'recibir' ? estacion.id : ''))
  const [tanque, setTanque] = useState(b?.tanque ?? '')
  const [tanqueNombre, setTanqueNombre] = useState(b?.tanqueNombre ?? '')
  const [tanqueCapacidad, setTanqueCapacidad] = useState(b?.tanqueCapacidad ?? '')
  const [motivoCodigo, setMotivoCodigo] = useState(b?.motivoCodigo ?? (modo === 'mover' ? 'CAMBIO_ESTACION' : ''))
  const [motivo, setMotivo] = useState(b?.motivo ?? '')
  const [horasBase, setHorasBase] = useState(b?.horasBase ?? '')
  const [fechaHora, setFechaHora] = useState(b?.fechaHora ?? aEntradaLocal(ahoraIso()))
  const [horometro, setHorometro] = useState(b?.horometro ?? (motor.horo_ultimo !== null ? String(motor.horo_ultimo) : ''))
  const [observacion, setObservacion] = useState(b?.observacion ?? '')
  useAutoguardado(borrador, { tipo, destino, tanque, tanqueNombre, tanqueCapacidad, motivoCodigo, motivo, horasBase, fechaHora, horometro, observacion })

  const entra = tipo === 'INSTALADO' || tipo === 'DE_VUELTA' || tipo === 'TRASLADADO'
  // Al llevar el motor al taller el motivo es «Mantenimiento»; al recibir un motor que viene de otra estación es el traslado
  const codigoEf = modo === 'recibir' ? (tipo === 'TRASLADADO' ? 'CAMBIO_ESTACION' : '') : tipo === 'AL_TALLER' ? 'MANTENIMIENTO' : motivoCodigo
  const libres = useMemo(() => (destino ? tanquesLibres(estado, destino, motor.equipo_id) : []), [estado, destino, motor.equipo_id])
  // Con un solo tanque libre ya viene elegido (la base hace lo mismo si no se envía ninguno)
  const tanqueEf = tanque || (libres.length === 1 ? libres[0].id : '')

  return (
    <MarcoRegistro
      titulo={`${TITULO[modo]} · ${motor.codigo}`}
      textoGuardar={TITULO[modo]}
      textoCancelar="Regresar"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onRegresar ?? onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      sinCustodia
      construir={({ ubicacion, enNombreDe }) => {
        if (!tipo) return 'Elige qué hacer.'
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Falta la fecha y hora.'
        const horas = horasBase.trim() ? Number(horasBase.replace(',', '.')) : null
        const cap = tanqueCapacidad.trim() ? Number(tanqueCapacidad.replace(',', '.')) : null
        const a = armarMovimientoMotor({
          equipoId: motor.equipo_id,
          tipo,
          fechaHora: fh,
          estacionDestino: entra ? destino || null : null,
          tanqueId: tanqueEf || null,
          tanqueNuevo: !tanqueEf && puedeCrearTanque && tanqueNombre.trim() && entra ? { nombre: tanqueNombre, capacidadGal: cap, materialId: estado.material_diesel_id } : null,
          motivo,
          motivoCodigo: codigoEf,
          horasBase: horas,
          horometro: modo === 'recibir' && horometro.trim() ? Number(horometro.replace(',', '.')) : null,
          observacion: modo === 'recibir' ? observacion : '',
          estacionOrigen: motor.estacion_id,
        })
        if ('error' in a) return a.error
        return [crearOperacion(a.operacion, a.datos, { ubicacion, enNombreDe, resumen: `${NOMBRE_TIPO[tipo]} · ${motor.codigo}` })]
      }}
    >
      <p className="rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-800" data-ayuda-motor>
        {AYUDA[modo]}
      </p>

      {modo === 'recibir' && instalado && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20" data-motor-en-otra>
          Este motor está en <strong>{estaciones.find((e) => e.id === motor.estacion_id)?.nombre ?? 'otra estación'}</strong>. Se va a mover aquí.
        </p>
      )}

      {tiposPosibles.length > 1 && (
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
      )}

      {entra && modo === 'mover' && (
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

      {entra && destino && (
        <Campo etiqueta="Tanque del motor (libres de la estación)" requerido>
          {libres.length > 0 ? (
            <div data-selector-tanque>
              <SelectorBuscable
                valor={tanqueEf}
                opciones={libres.map((t) => ({ id: t.id, titulo: t.nombre, subtitulo: `${t.saldo_gal} gal${t.capacidad_gal ? ` de ${t.capacidad_gal}` : ''}` }))}
                onCambiar={setTanque}
                placeholder="Elegir tanque libre…"
                etiquetaBusqueda="Buscar tanque"
                permitirVacio={false}
              />
            </div>
          ) : (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-600/20" data-sin-tanque-libre>
              Sin tanque libre. Pide uno a Torre de Control.
            </p>
          )}
          {libres.length === 0 && puedeCrearTanque && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                value={tanqueNombre}
                onChange={(e) => setTanqueNombre(e.target.value)}
                placeholder="Tanque nuevo: nombre"
                aria-label="Nombre del tanque nuevo"
                data-tanque-nombre
                className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-base focus:border-brand-600 focus:outline-none"
              />
              <input
                inputMode="decimal"
                value={tanqueCapacidad}
                onChange={(e) => setTanqueCapacidad(e.target.value.replace(/[^\d.,]/g, ''))}
                placeholder="Capacidad (gal)"
                aria-label="Capacidad del tanque nuevo"
                data-tanque-capacidad
                className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base tabular-nums focus:border-brand-600 focus:outline-none"
              />
            </div>
          )}
        </Campo>
      )}

      {modo !== 'recibir' && (
        <Campo etiqueta="Motivo" requerido>
          <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Código del motivo">
            {(tipo === 'AL_TALLER' ? ['MANTENIMIENTO'] : motivosModo).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={codigoEf === id}
                onClick={() => setMotivoCodigo(motivoCodigo === id && modo !== 'mover' ? '' : id)}
                data-motivo-codigo={id}
                className={`min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-inset ${codigoEf === id ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'}`}
              >
                {ETIQUETA_MOTIVO[id]}
              </button>
            ))}
          </div>
          <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder={codigoEf === 'OTRO' ? 'Escribe cuál es el motivo' : 'Detalle (opcional)'} data-motivo />
        </Campo>
      )}

      {modo === 'recibir' && (
        <>
          <Campo etiqueta="Horómetro del motor">
            <input
              inputMode="decimal"
              value={horometro}
              onChange={(e) => setHorometro(e.target.value.replace(/[^\d.,]/g, ''))}
              aria-label="Horómetro del motor"
              data-horometro-recibir
              className="min-h-11 w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base tabular-nums focus:border-brand-600 focus:outline-none"
            />
          </Campo>
          <Campo etiqueta="Observación">
            <AreaTexto value={observacion} onChange={(e) => setObservacion(e.target.value)} rows={2} placeholder="Cómo llegó el motor (opcional)" data-observacion />
          </Campo>
        </>
      )}

      {entra && (
        <Campo etiqueta="Horas desde el último mantenimiento (opcional)">
          <input
            inputMode="decimal"
            value={horasBase}
            onChange={(e) => setHorasBase(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="0"
            aria-label="Horas desde el último mantenimiento"
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
          aria-label="Fecha y hora"
          data-fecha-hora
          className="min-h-11 w-60 rounded-lg border border-slate-200 bg-white px-3 py-2 text-base focus:border-brand-600 focus:outline-none"
        />
      </Campo>
    </MarcoRegistro>
  )
}
