'use client'

/**
 * Motores y combustible (Campo, bloque 3). Funciona sin señal igual que Fertirriego e Inyección (misma cola, misma custodia):
 * tarjetas de los motores de la estación con el nivel del tanque y las horas para el mantenimiento, registro diario, recibir
 * diésel, historial y, cada uno con su permiso, recibir un motor («Asignar nuevo motor»), mover, retirar y registrar mantenimiento. El consumo, el rendimiento y las
 * alertas son de AGL: aquí no hay pantalla de reportes.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Alerta, Boton, ListaEsqueleto } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { RegistroServiceWorker } from '@/components/fertirriego/RegistroServiceWorker'
import { conCustodiaLocal } from '@/lib/fertirriego/calculos'
import { EVENTO_GUARDADO_FALLIDO, type GuardadoFallido } from '@/lib/fertirriego/guardadoFondo'
import { useCampo } from '@/lib/fertirriego/useCampo'
import { EncabezadoEnvios } from '@/components/fertirriego/EncabezadoEnvios'
import type { Operacion } from '@/lib/fertirriego/tipos'
import { motoresDeEstacion, motoresParaRecibir, saldoTanqueLocal, type MotorEstacion } from '@/lib/motores/estado'
import { horasDesdeMantLocal } from '@/lib/motores/mantenimiento'
import { useMotores } from '@/lib/motores/useMotores'
import { FormMantenimiento } from './FormMantenimiento'
import { FormMoverMotor } from './FormMoverMotor'
import { FormRecibirDiesel } from './FormRecibirDiesel'
import { FormRegistroMotor } from './FormRegistroMotor'
import { TarjetaMotor } from './TarjetaMotor'
import { VistaHistorialMotor } from './VistaHistorialMotor'

const RUTAS_SW = ['/motores']

type Ventana = {
  tipo: 'registro' | 'recibir' | 'mover' | 'retirar' | 'mantenimiento' | 'historial' | 'elegir_motor' | 'recibir_motor'
  equipoId: string
}

export function CampoMotores({ usuarioId }: { usuarioId: string }) {
  const campo = useCampo(usuarioId)
  const mot = useMotores(usuarioId)
  const { estado, cola } = campo
  const [estacionId, setEstacionId] = useState('')
  const [ventana, setVentana] = useState<Ventana | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [fallo, setFallo] = useState<GuardadoFallido | null>(null)

  // La estación que eligió la última vez (en este teléfono; la misma preferencia que Fertirriego)
  const { preferencia, guardarPreferencia } = campo
  useEffect(() => {
    void preferencia<string>('estacion').then((v) => v && setEstacionId(v))
  }, [preferencia])

  const estaciones = estado?.estaciones ?? []
  const estacionServidor = estaciones.find((e) => e.id === estacionId) ?? estaciones[0] ?? null
  const estacion = useMemo(
    () => (estacionServidor && estado ? conCustodiaLocal(estacionServidor, cola, estado.yo) : estacionServidor),
    [estacionServidor, estado, cola]
  )

  const pendientes = cola.filter((o) => o.estado_local === 'PENDIENTE').length

  // Al terminar de enviar lo pendiente se trae lo nuevo de Motores (una sola vez por transición)
  const antes = useRef(pendientes)
  const { actualizar } = mot
  // bucle-ok: «actualizar» es estable (useCallback sobre un cliente memorizado), solo corre al pasar de pendientes a 0 y la bajada pasa por el freno de useMotores
  useEffect(() => {
    if (antes.current > 0 && pendientes === 0) actualizar()
    antes.current = pendientes
  }, [pendientes, actualizar])

  // Guardado en segundo plano que falló: el borrador sigue ahí
  useEffect(() => {
    const fallido = (e: Event) => setFallo((e as CustomEvent<GuardadoFallido>).detail)
    window.addEventListener(EVENTO_GUARDADO_FALLIDO, fallido)
    return () => window.removeEventListener(EVENTO_GUARDADO_FALLIDO, fallido)
  }, [])

  const guardado = (m: string) => {
    setAviso(m)
    setTimeout(() => setAviso((a) => (a === m ? null : a)), 6000)
  }

  const me = mot.estado
  const puedeRegistrar = me?.permisos?.registrar ?? false
  const p = me?.permisos
  const puedeConfigurar = p?.configurar ?? false
  const puedeRecibirMotor = puedeConfigurar || (p?.motor_recibir ?? false)
  const puedeMover = puedeConfigurar || (p?.motor_mover ?? false)
  const puedeRetirar = puedeConfigurar || (p?.motor_retirar ?? false)
  const puedeMantenimiento = puedeConfigurar || (p?.motor_mantenimiento ?? false)
  const motores = useMemo(() => (me && estacion ? motoresDeEstacion(me, estacion.id) : []), [me, estacion])
  // Motores que se pueden recibir aquí (nunca se muestran como tarjetas: solo en el buscador de «Asignar nuevo motor»)
  const elegibles = useMemo(
    () =>
      me && estacion
        ? motoresParaRecibir(me, estacion.id, (id) => estaciones.find((e) => e.id === id)?.nombre ?? null).filter(
            (m) => puedeRecibirMotor || (puedeMover && m.enEstacion)
          )
        : [],
    [me, estacion, estaciones, puedeRecibirMotor, puedeMover]
  )
  const motorVentana: MotorEstacion | null = me && ventana ? (me.motores.find((m) => m.equipo_id === ventana.equipoId) ?? null) : null
  const saldoDe = (m: MotorEstacion): number | null => (me && m.tanque ? saldoTanqueLocal(m.tanque.id, me, cola) : null)
  const horasDe = (m: MotorEstacion): number => horasDesdeMantLocal(m, cola)

  const tarjeta = (m: MotorEstacion) => (
    <TarjetaMotor
      key={m.equipo_id}
      motor={m}
      saldoGal={saldoDe(m)}
      horasDesdeMant={horasDe(m)}
      puedeRegistrar={puedeRegistrar}
      puedeMover={puedeMover}
      puedeRetirar={puedeRetirar}
      puedeMantenimiento={puedeMantenimiento}
      onRegistro={() => setVentana({ tipo: 'registro', equipoId: m.equipo_id })}
      onRecibir={() => setVentana({ tipo: 'recibir', equipoId: m.equipo_id })}
      onMover={() => setVentana({ tipo: 'mover', equipoId: m.equipo_id })}
      onRetirar={() => setVentana({ tipo: 'retirar', equipoId: m.equipo_id })}
      onMantenimiento={() => setVentana({ tipo: 'mantenimiento', equipoId: m.equipo_id })}
      onHistorial={() => setVentana({ tipo: 'historial', equipoId: m.equipo_id })}
    />
  )

  /** «Corregir y reenviar» (Envíos): abre el formulario del motor de ese envío. */
  function corregirEnvio(o: Operacion) {
    const equipoId = typeof o.datos.equipo_id === 'string' ? o.datos.equipo_id : ''
    const tipo: Ventana['tipo'] | null =
      o.tipo === 'motor_registro_diario' ? 'registro'
      : o.tipo === 'diesel_recibir' ? 'recibir'
      : o.tipo === 'motor_asignar' || o.tipo === 'motor_retiro' ? 'mover'
      : o.tipo === 'motor_mantenimiento' ? 'mantenimiento'
      : null
    if (tipo && equipoId) setVentana({ tipo, equipoId })
    guardado(tipo && equipoId ? 'Corrige los datos y guarda. Después, en «Envíos», quita el registro que no se aceptó.' : 'Vuelve a hacer el registro desde su pantalla y después quita el que no se aceptó en «Envíos».')
  }

  if (campo.cargando && !estado) return <ListaEsqueleto filas={4} />

  return (
    <div className="flex flex-col gap-3 pb-24">
      <RegistroServiceWorker rutas={RUTAS_SW} />

      <EncabezadoEnvios campo={campo} onActualizar={mot.actualizar} actualizando={mot.cargando} onCorregir={corregirEnvio} />

      {campo.error && <Alerta>{campo.error}</Alerta>}
      {mot.error && <Alerta tono="ambar">{mot.error}</Alerta>}
      {aviso && (
        <div role="status" data-aviso className="rounded-xl bg-brand-700 px-3 py-2 text-sm font-semibold text-white">
          {aviso}
        </div>
      )}
      {fallo && (
        <div role="alert" data-guardado-fallido className="rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-inset ring-red-300">
          <p className="font-bold">No se pudo guardar «{fallo.formulario}» ({fallo.estacion}, {fallo.hora}).</p>
          <p className="mt-0.5 text-xs">Lo que escribiste quedó como borrador. Ábrelo de nuevo para continuarlo. Error: {fallo.error}</p>
          <button type="button" className="mt-2 min-h-11 text-xs font-semibold text-red-800 underline" onClick={() => setFallo(null)}>
            Cerrar
          </button>
        </div>
      )}

      {!estado || !me ? (
        <Alerta tono="ambar">Abre esta pantalla una vez con señal para descargar tus estaciones y motores. Después funciona sin señal.</Alerta>
      ) : estaciones.length === 0 || !estacion ? (
        <Alerta tono="ambar">No tienes estaciones asignadas. Pide a tu jefe que te asigne en Usuarios → Estaciones de riego.</Alerta>
      ) : (
        <>
          {estaciones.length > 1 && (
            <div data-selector-estacion>
              <SelectorBuscable
                valor={estacion.id}
                opciones={estaciones.map((e) => ({ id: e.id, titulo: e.nombre, subtitulo: e.zona ?? undefined }))}
                onCambiar={(id) => {
                  setEstacionId(id)
                  void guardarPreferencia('estacion', id)
                }}
                placeholder="Elegir estación…"
                etiquetaBusqueda="Buscar estación"
              />
            </div>
          )}
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900" data-estacion={estacion.nombre}>
              Motores · {estacion.nombre}
            </h1>
            <span className="text-xs text-slate-600">{estacion.zona}</span>
          </div>

          {(puedeRecibirMotor || puedeMover) && (
            <Boton className="min-h-14 w-full text-base" onClick={() => setVentana({ tipo: 'elegir_motor', equipoId: '' })} data-asignar-motor>
              Asignar nuevo motor
            </Boton>
          )}

          <div data-motores className="flex flex-col gap-2">
            {motores.length === 0 ? (
              <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">
                Esta estación no tiene motores conectados.
                {puedeRecibirMotor || puedeMover ? ' Toca «Asignar nuevo motor» para recibir uno.' : ' Pide a quien te corresponda que te dé el permiso de recibir motores.'}
              </p>
            ) : (
              motores.map(tarjeta)
            )}
          </div>

          {me.tanques_sin_motor.filter((t) => t.estacion_id === estacion.id).length > 0 && (
            <div className="flex flex-col gap-1" data-tanques-sin-motor>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Tanques sin motor</p>
              {me.tanques_sin_motor
                .filter((t) => t.estacion_id === estacion.id)
                .map((t) => (
                  <p key={t.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
                    {t.nombre} · {t.saldo_gal} gal{t.capacidad_gal ? ` de ${t.capacidad_gal}` : ''}
                  </p>
                ))}
            </div>
          )}

          {!puedeRegistrar && <Alerta tono="ambar">Tu rol puede ver Motores pero no registrar. Se configura en Permisos.</Alerta>}

          {motorVentana && ventana?.tipo === 'registro' && (
            <FormRegistroMotor
              motor={motorVentana}
              estado={me}
              pendientes={cola}
              estacion={estacion}
              yo={estado.yo}
              registrar={campo.registrar}
              onAbrirRecibir={() => setVentana({ tipo: 'recibir', equipoId: motorVentana.equipo_id })}
              onCerrar={() => setVentana(null)}
              onGuardado={guardado}
            />
          )}
          {motorVentana && ventana?.tipo === 'recibir' && (
            <FormRecibirDiesel
              motor={motorVentana}
              saldoGal={saldoDe(motorVentana)}
              campo={estado}
              estacion={estacion}
              yo={estado.yo}
              registrar={campo.registrar}
              onCerrar={() => setVentana(null)}
              onGuardado={guardado}
            />
          )}
          {ventana?.tipo === 'elegir_motor' && (
            <Modal abierto titulo="Asignar nuevo motor" onCerrar={() => setVentana(null)}>
              <div className="flex flex-col gap-3" data-elegir-motor>
                <p className="text-sm text-slate-600">
                  Busca el motor por su código o nombre. Si está en otra estación, se mueve a <strong>{estacion.nombre}</strong>.
                </p>
                {elegibles.length === 0 ? (
                  <Alerta tono="ambar">No hay motores disponibles para recibir en esta estación.</Alerta>
                ) : (
                  <div data-selector-motor>
                    <SelectorBuscable
                      valor=""
                      opciones={elegibles.map((m) => ({
                        id: m.equipo_id,
                        titulo: m.codigo,
                        subtitulo: [m.nombre, m.modelo, m.enEstacion ? `en estación ${m.enEstacion}` : m.estado === 'TALLER' ? 'en el taller' : 'disponible']
                          .filter(Boolean)
                          .join(' · '),
                      }))}
                      onCambiar={(id) => id && setVentana({ tipo: 'recibir_motor', equipoId: id })}
                      placeholder="Buscar motor…"
                      etiquetaBusqueda="Buscar motor"
                      permitirVacio={false}
                    />
                  </div>
                )}
                <Boton variante="secundario" className="min-h-11" onClick={() => setVentana(null)}>
                  Regresar
                </Boton>
              </div>
            </Modal>
          )}
          {ventana?.tipo === 'recibir_motor' && (() => {
            const el = elegibles.find((m) => m.equipo_id === ventana.equipoId)
            const mt = me.motores.find((m) => m.equipo_id === ventana.equipoId)
            const motorElegido: MotorEstacion | null = mt ?? (el ? { equipo_id: el.equipo_id, codigo: el.codigo, nombre: el.nombre, modelo: el.modelo, estado: el.estado, estacion_id: null, tanque: null, horo_ultimo: null, visor_ultimo: null, fecha_ultimo: null, intervalo_horas: null, aviso_horas: null, horas_desde_mant: 0, horas_para_mant: null } : null)
            if (!motorElegido) return null
            return (
              <FormMoverMotor
                modo="recibir"
                onRegresar={() => setVentana({ tipo: 'elegir_motor', equipoId: '' })}
                motor={motorElegido}
                estado={me}
                estaciones={estaciones}
                saldoGal={saldoDe(motorElegido) ?? 0}
                estacion={estacion}
                yo={estado.yo}
                registrar={campo.registrar}
                onCerrar={() => setVentana(null)}
                onGuardado={guardado}
              />
            )
          })()}
          {motorVentana && (ventana?.tipo === 'mover' || ventana?.tipo === 'retirar') && (
            <FormMoverMotor
              modo={ventana.tipo}
              motor={motorVentana}
              estado={me}
              estaciones={estaciones}
              saldoGal={saldoDe(motorVentana) ?? 0}
              estacion={estacion}
              yo={estado.yo}
              registrar={campo.registrar}
              onCerrar={() => setVentana(null)}
              onGuardado={guardado}
            />
          )}
          {motorVentana && ventana?.tipo === 'mantenimiento' && (
            <FormMantenimiento
              motor={motorVentana}
              estacion={estacion}
              yo={estado.yo}
              registrar={campo.registrar}
              onCerrar={() => setVentana(null)}
              onGuardado={guardado}
            />
          )}
          {motorVentana && ventana?.tipo === 'historial' && (
            <VistaHistorialMotor
              motor={motorVentana}
              estado={me}
              cola={cola}
              estacion={estacion}
              yo={estado.yo}
              puedeAnular={me.permisos?.anular ?? false}
              registrar={campo.registrar}
              onGuardado={guardado}
              onCerrar={() => setVentana(null)}
            />
          )}
        </>
      )}
    </div>
  )
}
