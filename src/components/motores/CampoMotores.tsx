'use client'

/**
 * Motores y combustible (Campo, bloque 3). Funciona sin señal igual que Fertirriego e Inyección (misma cola, misma custodia):
 * tarjetas de los motores de la estación con el nivel del tanque y las horas para el mantenimiento, registro diario, recibir
 * diésel, historial y (solo con «configurar») mover, retirar y registrar mantenimiento. El consumo, el rendimiento y las
 * alertas son de AGL: aquí no hay pantalla de reportes.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Alerta, ListaEsqueleto } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { RegistroServiceWorker } from '@/components/fertirriego/RegistroServiceWorker'
import { formatearFechaHora } from '@/lib/estados'
import { conCustodiaLocal } from '@/lib/fertirriego/calculos'
import { EVENTO_GUARDADO_FALLIDO, type GuardadoFallido } from '@/lib/fertirriego/guardadoFondo'
import { useCampo } from '@/lib/fertirriego/useCampo'
import { motoresDeEstacion, motoresSinEstacion, saldoTanqueLocal, type MotorEstacion } from '@/lib/motores/estado'
import { horasDesdeMantLocal } from '@/lib/motores/mantenimiento'
import { useMotores } from '@/lib/motores/useMotores'
import { FormMantenimiento } from './FormMantenimiento'
import { FormMoverMotor } from './FormMoverMotor'
import { FormRecibirDiesel } from './FormRecibirDiesel'
import { FormRegistroMotor } from './FormRegistroMotor'
import { TarjetaMotor } from './TarjetaMotor'
import { VistaHistorialMotor } from './VistaHistorialMotor'

const RUTAS_SW = ['/motores']

type Ventana = { tipo: 'registro' | 'recibir' | 'mover' | 'mantenimiento' | 'historial'; equipoId: string }

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
  const rechazados = cola.filter((o) => o.estado_local === 'RECHAZADO').length
  const enLinea = campo.conexion === 'en_linea'

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
  const puedeConfigurar = me?.permisos?.configurar ?? false
  const motores = useMemo(() => (me && estacion ? motoresDeEstacion(me, estacion.id) : []), [me, estacion])
  const fuera = useMemo(() => (me && puedeConfigurar ? motoresSinEstacion(me) : []), [me, puedeConfigurar])
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
      puedeConfigurar={puedeConfigurar}
      onRegistro={() => setVentana({ tipo: 'registro', equipoId: m.equipo_id })}
      onRecibir={() => setVentana({ tipo: 'recibir', equipoId: m.equipo_id })}
      onMover={() => setVentana({ tipo: 'mover', equipoId: m.equipo_id })}
      onMantenimiento={() => setVentana({ tipo: 'mantenimiento', equipoId: m.equipo_id })}
      onHistorial={() => setVentana({ tipo: 'historial', equipoId: m.equipo_id })}
    />
  )

  if (campo.cargando && !estado) return <ListaEsqueleto filas={4} />

  return (
    <div className="flex flex-col gap-3 pb-24">
      <RegistroServiceWorker rutas={RUTAS_SW} />

      <div
        data-barra-estado={campo.conexion}
        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs ring-1 ring-inset ${
          enLinea ? 'bg-brand-50 text-brand-800 ring-brand-600/20' : 'bg-amber-50 text-amber-800 ring-amber-600/20'
        }`}
      >
        <span className="flex items-center gap-2 font-semibold">
          <span className={`h-2 w-2 rounded-full ${enLinea ? 'bg-brand-600' : 'bg-amber-500'}`} />
          {enLinea ? 'Con señal' : 'Sin señal: se guarda en el teléfono'}
          {pendientes > 0 && <span data-pendientes-cuenta> · {pendientes} por enviar</span>}
          {rechazados > 0 && <span className="text-red-700"> · {rechazados} rechazado(s)</span>}
        </span>
        <span className="flex items-center gap-2">
          {campo.sincronizadoEn && <span className="text-slate-500">Actualizado {formatearFechaHora(campo.sincronizadoEn)}</span>}
          <button
            type="button"
            onClick={() => {
              void campo.sincronizarAhora()
              mot.actualizar()
            }}
            disabled={campo.sincronizando || mot.cargando}
            className="min-h-11 font-bold underline disabled:no-underline disabled:opacity-60"
            data-actualizar
          >
            {campo.sincronizando || mot.cargando ? 'Actualizando…' : 'Actualizar'}
          </button>
        </span>
      </div>

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

          <div data-motores className="flex flex-col gap-2">
            {motores.length === 0 ? (
              <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">
                Esta estación no tiene motores conectados.
                {puedeConfigurar ? ' Instala uno desde «Motores fuera de estación».' : ' Pide a quien configura que conecte uno.'}
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

          {puedeConfigurar && fuera.length > 0 && (
            <div className="flex flex-col gap-2" data-motores-fuera>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Motores fuera de estación</p>
              {fuera.map(tarjeta)}
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
          {motorVentana && ventana?.tipo === 'mover' && (
            <FormMoverMotor
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
