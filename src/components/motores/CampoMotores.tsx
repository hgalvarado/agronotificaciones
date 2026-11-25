'use client'

/**
 * Motores y combustible (Campo, bloque 3 + rediseño sql/147). Funciona sin señal igual que Fertirriego e Inyección (misma cola,
 * misma custodia). Cuatro pestañas claras: «Hoy» (qué toca ahora, por urgencia), «Motores» (semáforos y acciones de cada motor),
 * «Historial» (por día, todos los campos de la hoja) y «Tanques» (diésel por tanque fijo); con «Vista general» o «Auditar», una quinta («General») con todos los
 * motores, al día, y su ficha completa. Semáforos y señales se calculan en el teléfono (lib/motores/senales). El diésel entra a los
 * TANQUES, no a la bodega. El consumo, el rendimiento y los reportes largos son de AGL.
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
import { hoyIso } from '@/lib/fechas/zona'
import { motoresDeEstacion, motoresParaRecibir, saldoTanqueLocal, tanquesDeEstacion, type MotorEstacion } from '@/lib/motores/estado'
import { queTocaAhora } from '@/lib/motores/senales'
import { useMotores } from '@/lib/motores/useMotores'
import { vistaMotor } from '@/lib/motores/vistaMotor'
import { permisoHistoricoDe, useCampoExtras } from '@/lib/campo/useCampoExtras'
import { AdministrarTanques } from './AdministrarTanques'
import { FormMantenimiento } from './FormMantenimiento'
import { FormMoverMotor } from './FormMoverMotor'
import { FormRecibirDiesel } from './FormRecibirDiesel'
import { AvisoModoPruebas } from '@/components/campo/AvisoModoPruebas'
import { FormRegistroMotor } from './FormRegistroMotor'
import { PestanaHistorial } from './PestanaHistorial'
import { PestanaHoy, type AccionHoy } from './PestanaHoy'
import { DetalleMotor, PestanaMotores, type AccionMotor } from './PestanaMotores'
import { DetalleTanque, PestanaTanques } from './PestanaTanques'
import { VistaGeneral } from './VistaGeneral'

const RUTAS_SW = ['/motores']

type Pestana = 'hoy' | 'motores' | 'historial' | 'tanques' | 'general'

type Ventana = {
  tipo: 'registro' | 'corregir' | 'corregir_recepcion' | 'recibir' | 'mover' | 'retirar' | 'mantenimiento' | 'detalle_motor' | 'detalle_tanque' | 'elegir_motor' | 'recibir_motor' | 'administrar_tanques'
  equipoId: string
  tanqueId?: string
  /** Día del registro que pidió recibir combustible (la recepción viene con esa fecha). */
  fecha?: string
  /** Registro del día que se corrige (solo administrador). */
  registroId?: string
  recepcionId?: string
}

export function CampoMotores({ usuarioId }: { usuarioId: string }) {
  const campo = useCampo(usuarioId)
  const mot = useMotores(usuarioId)
  // sql/140: permiso temporal de «Registro histórico» y «Eliminar por completo» (de Motores)
  const extras = useCampoExtras(usuarioId, 'motores')
  const { estado, cola } = campo
  const [estacionId, setEstacionId] = useState('')
  const [pestana, setPestana] = useState<Pestana>('hoy')
  const [ventana, setVentana] = useState<Ventana | null>(null)
  const [motorHistorial, setMotorHistorial] = useState<string | undefined>(undefined)
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
  const p = me?.permisos
  const puedeRegistrar = p?.registrar ?? false
  const puedeConfigurar = p?.configurar ?? false
  const puedeGeneral = (p?.auditar ?? false) || (p?.ver_general ?? false)
  const puedeRecibirMotor = puedeConfigurar || (p?.motor_recibir ?? false)
  const puedeMover = puedeConfigurar || (p?.motor_mover ?? false)
  const puedeRetirar = puedeConfigurar || (p?.motor_retirar ?? false)
  const puedeMantenimiento = puedeConfigurar || (p?.motor_mantenimiento ?? false)
  const hoy = hoyIso()
  const motores = useMemo(() => (me && estacion ? motoresDeEstacion(me, estacion.id) : []), [me, estacion])
  const vistas = useMemo(() => (me ? motores.map((m) => vistaMotor(m, me, cola, hoy)) : []), [me, motores, cola, hoy])
  const tanques = useMemo(() => (me && estacion ? tanquesDeEstacion(me, estacion.id) : []), [me, estacion])
  const saldoDe = (id: string): number => (me ? saldoTanqueLocal(id, me, cola) : 0)
  const urgentes = useMemo(() => queTocaAhora(vistas.map((v) => ({ motor: v.motor, ayuda: v.ayuda }))).filter((i) => i.nivel === 'rojo').length, [vistas])
  const pendientesHoy = useMemo(() => queTocaAhora(vistas.map((v) => ({ motor: v.motor, ayuda: v.ayuda }))).length, [vistas])

  // Motores que se pueden recibir aquí (nunca se muestran como filas: solo en el buscador de «Asignar nuevo motor»)
  const elegibles = useMemo(
    () =>
      me && estacion
        ? motoresParaRecibir(me, estacion.id, (id) => estaciones.find((e) => e.id === id)?.nombre ?? null).filter((m) => puedeRecibirMotor || (puedeMover && m.enEstacion))
        : [],
    [me, estacion, estaciones, puedeRecibirMotor, puedeMover]
  )
  const motorVentana: MotorEstacion | null = me && ventana ? (me.motores.find((m) => m.equipo_id === ventana.equipoId) ?? null) : null
  const vistaVentana = vistas.find((v) => v.motor.equipo_id === ventana?.equipoId) ?? null

  /** Qué tanque viene elegido al recibir diésel: el que se tocó, o el del motor que se tocó. */
  const tanqueInicial = (v: Ventana): string | undefined => v.tanqueId ?? me?.motores.find((m) => m.equipo_id === v.equipoId)?.tanque?.id

  function alAccionHoy(a: AccionHoy) {
    if (a.tipo === 'recibir') setVentana({ tipo: 'recibir', equipoId: a.equipoId })
    else setVentana({ tipo: a.tipo, equipoId: a.equipoId })
  }
  function alAccionMotor(a: AccionMotor, equipoId: string) {
    if (a === 'historial') {
      setMotorHistorial(equipoId)
      setPestana('historial')
      setVentana(null)
    } else setVentana({ tipo: a, equipoId })
  }

  /** «Corregir y reenviar» (Envíos): abre el formulario del motor de ese envío. */
  function corregirEnvio(o: Operacion) {
    const equipoId = typeof o.datos.equipo_id === 'string' ? o.datos.equipo_id : ''
    const tanqueId = typeof o.datos.tanque_id === 'string' ? o.datos.tanque_id : undefined
    const tipo: Ventana['tipo'] | null =
      o.tipo === 'motor_registro_diario' ? 'registro'
      : o.tipo === 'diesel_recibir' ? 'recibir'
      : o.tipo === 'motor_asignar' || o.tipo === 'motor_retiro' ? 'mover'
      : o.tipo === 'motor_mantenimiento' ? 'mantenimiento'
      : null
    if (tipo === 'recibir') setVentana({ tipo, equipoId: '', tanqueId })
    else if (tipo && equipoId) setVentana({ tipo, equipoId })
    guardado(tipo && (equipoId || tipo === 'recibir') ? 'Corrige y guarda. Luego quita el rechazado en «Envíos».' : 'Haz el registro de nuevo. Luego quita el rechazado en «Envíos».')
  }

  if (campo.cargando && !estado) return <ListaEsqueleto filas={4} />

  const pestanas: [Pestana, string][] = [
    ['hoy', pendientesHoy > 0 ? `Hoy · ${pendientesHoy}` : 'Hoy'],
    ['motores', 'Motores'],
    ['historial', 'Historial'],
    ['tanques', 'Tanques'],
    ...(puedeGeneral ? ([['general', 'General']] as [Pestana, string][]) : []),
  ]

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
        <div role="alert" data-guardado-fallido className="rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-inset ring-red-600/20">
          <p className="font-medium">No se guardó «{fallo.formulario}» ({fallo.estacion}, {fallo.hora}).</p>
          <p className="mt-0.5 text-xs">Quedó como borrador. Ábrelo y guarda de nuevo. {fallo.error}</p>
          <button type="button" className="mt-2 min-h-11 text-xs font-semibold text-red-800 underline" onClick={() => setFallo(null)}>
            Cerrar
          </button>
        </div>
      )}

      {!estado || !me ? (
        <Alerta tono="ambar">Abre con señal una vez. Luego funciona sin señal.</Alerta>
      ) : estaciones.length === 0 || !estacion ? (
        <Alerta tono="ambar">Sin estaciones. Pide a tu jefe que te asigne.</Alerta>
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
          <AvisoModoPruebas estacionNombre={estacion.nombre} />
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900" data-estacion={estacion.nombre}>
              Motores · {estacion.nombre}
            </h1>
            <span className="text-xs text-slate-600">{estacion.zona}</span>
          </div>

          <div role="tablist" aria-label="Motores" className={`grid gap-1 rounded-xl bg-slate-100 p-1 ${pestanas.length > 4 ? 'grid-cols-5' : 'grid-cols-4'}`} data-pestanas-motores>
            {pestanas.map(([id, texto]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={pestana === id}
                onClick={() => {
                  if (id !== 'historial') setMotorHistorial(undefined)
                  setPestana(id)
                }}
                data-pestana-mot={id}
                className={`min-h-11 rounded-lg px-1 font-bold transition-colors ${pestanas.length > 4 ? 'text-xs' : 'text-sm'} ${pestana === id ? 'bg-white text-brand-700 shadow-[var(--shadow-card)]' : urgentes > 0 && id === 'hoy' ? 'text-red-700' : 'text-slate-600'}`}
              >
                {texto}
              </button>
            ))}
          </div>

          {!puedeRegistrar && <Alerta tono="ambar">Solo puedes ver. No puedes registrar.</Alerta>}

          {pestana === 'hoy' && <PestanaHoy vistas={vistas} estacionNombre={estacion.nombre} puedeRegistrar={puedeRegistrar} puedeMantenimiento={puedeMantenimiento} onAccion={alAccionHoy} />}
          {pestana === 'motores' && (
            <PestanaMotores
              vistas={vistas}
              puedeAsignar={puedeRecibirMotor || puedeMover}
              puedeRegistrar={puedeRegistrar}
              onAsignar={() => setVentana({ tipo: 'elegir_motor', equipoId: '' })}
              onAbrir={(id) => setVentana({ tipo: 'detalle_motor', equipoId: id })}
              onRegistrar={(id) => setVentana({ tipo: 'registro', equipoId: id })}
              onRecibir={(id) => setVentana({ tipo: 'recibir', equipoId: id })}
            />
          )}
          {pestana === 'historial' && (
            <PestanaHistorial
              key={motorHistorial ?? 'todos'}
              estado={me}
              cola={cola}
              estacion={estacion}
              yo={estado.yo}
              motores={motores}
              motorInicial={motorHistorial}
              choferes={estado.choferes}
              vehiculos={estado.vehiculos}
              nombreEstacion={(id) => (id ? (estaciones.find((e) => e.id === id)?.nombre ?? null) : null)}
              puedeAnular={p?.anular ?? false}
              onCorregir={(r) => setVentana({ tipo: 'corregir', equipoId: r.equipo_id, registroId: r.id })}
              // Corregir recepciones: apagado hasta el sql/150 (la prueba mostró descuadre del registro del día y posibles duplicados)
              puedeEliminar={extras.eliminar_definitivo}
              registrar={campo.registrar}
              onGuardado={guardado}
              onEliminado={(m) => {
                guardado(m)
                mot.actualizar()
              }}
            />
          )}
          {pestana === 'tanques' && (
            <PestanaTanques
              tanques={tanques}
              saldoDe={saldoDe}
              codigoMotor={(id) => (id ? (me.motores.find((m) => m.equipo_id === id)?.codigo ?? null) : null)}
              puedeRecibir={puedeRegistrar}
              puedeConfigurar={puedeConfigurar}
              onRecibir={() => setVentana({ tipo: 'recibir', equipoId: '' })}
              onAbrir={(id) => setVentana({ tipo: 'detalle_tanque', equipoId: '', tanqueId: id })}
              onAdministrar={() => setVentana({ tipo: 'administrar_tanques', equipoId: '' })}
            />
          )}
          {pestana === 'general' && puedeGeneral && <VistaGeneral generadoPor={estado.yo.nombre} />}

          {vistaVentana && ventana?.tipo === 'detalle_motor' && (
            <DetalleMotor
              vista={vistaVentana}
              puedeRegistrar={puedeRegistrar}
              puedeMover={puedeMover}
              puedeRetirar={puedeRetirar}
              puedeMantenimiento={puedeMantenimiento}
              onAccion={(a) => alAccionMotor(a, vistaVentana.motor.equipo_id)}
              onCerrar={() => setVentana(null)}
            />
          )}
          {ventana?.tipo === 'detalle_tanque' && ventana.tanqueId && (() => {
            const t = tanques.find((x) => x.id === ventana.tanqueId)
            if (!t) return null
            return (
              <DetalleTanque
                tanque={t}
                saldo={saldoDe(t.id)}
                motor={t.motor_equipo_id ? (me.motores.find((m) => m.equipo_id === t.motor_equipo_id)?.codigo ?? null) : null}
                estado={me}
                puedeRecibir={puedeRegistrar}
                onRecibir={() => setVentana({ tipo: 'recibir', equipoId: '', tanqueId: t.id })}
                onCerrar={() => setVentana(null)}
              />
            )
          })()}
          {motorVentana && ventana?.tipo === 'corregir' && me.registros.find((x) => x.id === ventana.registroId) && (
            <FormRegistroMotor
              motor={motorVentana}
              estado={me}
              pendientes={cola}
              estacion={estacion}
              yo={estado.yo}
              corregir={me.registros.find((x) => x.id === ventana.registroId)}
              registrar={campo.registrar}
              onAbrirRecibir={(f) => setVentana({ tipo: 'recibir', equipoId: motorVentana.equipo_id, fecha: f })}
              onCerrar={() => setVentana(null)}
              onGuardado={guardado}
            />
          )}
          {motorVentana && ventana?.tipo === 'registro' && (
            <FormRegistroMotor
              motor={motorVentana}
              estado={me}
              pendientes={cola}
              estacion={estacion}
              yo={estado.yo}
              historico={permisoHistoricoDe(extras, estacion.id)}
              registrar={campo.registrar}
              onAbrirRecibir={(f) => setVentana({ tipo: 'recibir', equipoId: motorVentana.equipo_id, fecha: f })}
              onCerrar={() => setVentana(null)}
              onGuardado={guardado}
            />
          )}
          {ventana?.tipo === 'corregir_recepcion' && me.recepciones.find((x) => x.id === ventana.recepcionId) && (
            <FormRecibirDiesel
              tanques={tanques}
              saldoDe={saldoDe}
              corregir={me.recepciones.find((x) => x.id === ventana.recepcionId)}
              campo={estado}
              estacion={estacion}
              yo={estado.yo}
              registrar={campo.registrar}
              onCerrar={() => setVentana(null)}
              onGuardado={guardado}
            />
          )}
          {ventana?.tipo === 'recibir' && (
            <FormRecibirDiesel
              tanques={tanques}
              tanqueInicial={tanqueInicial(ventana)}
              fechaInicial={ventana.fecha}
              saldoDe={saldoDe}
              campo={estado}
              estacion={estacion}
              yo={estado.yo}
              registrar={campo.registrar}
              onCerrar={() => setVentana(null)}
              onGuardado={guardado}
            />
          )}
          {ventana?.tipo === 'administrar_tanques' && puedeConfigurar && (
            <AdministrarTanques estaciones={estaciones} onCambio={mot.actualizar} onCerrar={() => setVentana(null)} />
          )}
          {ventana?.tipo === 'elegir_motor' && (
            <Modal abierto titulo="Asignar motor" onCerrar={() => setVentana(null)}>
              <div className="flex flex-col gap-3" data-elegir-motor>
                <p className="text-sm text-slate-600">Busca el motor. Pasa a <strong>{estacion.nombre}</strong>.</p>
                {elegibles.length === 0 ? (
                  <Alerta tono="ambar">Sin motores disponibles.</Alerta>
                ) : (
                  <div data-selector-motor>
                    <SelectorBuscable
                      valor=""
                      opciones={elegibles.map((m) => ({
                        id: m.equipo_id,
                        titulo: m.codigo,
                        subtitulo: [m.nombre, m.modelo, m.enEstacion ? `en estación ${m.enEstacion}` : m.estado === 'TALLER' ? 'en el taller' : 'disponible'].filter(Boolean).join(' · '),
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
            const motorElegido: MotorEstacion | null =
              mt ??
              (el
                ? { equipo_id: el.equipo_id, codigo: el.codigo, nombre: el.nombre, modelo: el.modelo, estado: el.estado, estacion_id: null, tanque: null, horo_ultimo: null, visor_ultimo: null, fecha_ultimo: null, intervalo_horas: null, aviso_horas: null, horas_desde_mant: 0, horas_para_mant: null }
                : null)
            if (!motorElegido) return null
            return (
              <FormMoverMotor
                modo="recibir"
                onRegresar={() => setVentana({ tipo: 'elegir_motor', equipoId: '' })}
                motor={motorElegido}
                estado={me}
                estaciones={estaciones}
                puedeCrearTanque={puedeConfigurar}
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
              puedeCrearTanque={puedeConfigurar}
              estacion={estacion}
              yo={estado.yo}
              registrar={campo.registrar}
              onCerrar={() => setVentana(null)}
              onGuardado={guardado}
            />
          )}
          {motorVentana && ventana?.tipo === 'mantenimiento' && (
            <FormMantenimiento motor={motorVentana} estacion={estacion} yo={estado.yo} registrar={campo.registrar} onCerrar={() => setVentana(null)} onGuardado={guardado} />
          )}
        </>
      )}
    </div>
  )
}
