'use client'

/**
 * Fertirriego · la app de campo (Etapa B). Funciona sin señal: muestra lo último que se bajó, guarda cada
 * registro en el teléfono y lo envía solo cuando vuelve la conexión.
 *
 * Pestañas: Estación (bodega y acciones) · Por turno (plan contra aplicado, horas) · Bitácora (kardex) ·
 * Relevos (cambio de jornada con código) · Traslados (entre estaciones) · Envíos (pendientes, rechazados, observaciones).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alerta, Boton, ListaEsqueleto } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { formatearFechaHora } from '@/lib/estados'
import { conCustodiaLocal, saldosLocales } from '@/lib/fertirriego/calculos'
import { envasesPendientes, saldosEnvasesLocales } from '@/lib/fertirriego/envases'
import {
  compartirFallo,
  EVENTO_GUARDADO_FALLIDO,
  EVENTO_GUARDADO_INICIADO,
  type GuardadoFallido,
  type GuardadoIniciado,
} from '@/lib/fertirriego/guardadoFondo'
import { productosPendientes } from '@/lib/fertirriego/productos'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import { obtenerUbicacion } from '@/lib/fertirriego/ubicacion'
import type { Chofer, Estacion, Relevo, Traslado, Vehiculo } from '@/lib/fertirriego/tipos'
import { useCampo } from '@/lib/fertirriego/useCampo'
import { AsignarCustodia } from './AsignarCustodia'
import { AyudaFertirriego } from './AyudaFertirriego'
import { DetalleDocumento } from './DetalleDocumento'
import { FormAplicacion } from './FormAplicacion'
import { FormBitacora } from './FormBitacora'
import { FormConteo } from './FormConteo'
import { FormEntregarRelevo } from './FormEntregarRelevo'
import { FormEnvases } from './FormEnvases'
import { FormRecibirRelevo } from './FormRecibirRelevo'
import { FormTraslado } from './FormTraslado'
import { puedeRegistrar } from './MarcoRegistro'
import { PantallaCodigo } from './PantallaCodigo'
import { RechazarRelevo } from './RechazarRelevo'
import { ResolverTraslado, type AccionTraslado } from './ResolverTraslado'
import { FormRecepcion } from './FormRecepcion'
import { PanelEstacion } from './PanelEstacion'
import { RegistroServiceWorker } from './RegistroServiceWorker'
import { VistaBitacora } from './VistaBitacora'
import { VistaEnvios } from './VistaEnvios'
import { VistaRelevos } from './VistaRelevos'
import { VistaTraslados } from './VistaTraslados'
import { VistaTurnos } from './VistaTurnos'

type Pestana = 'estacion' | 'turnos' | 'bitacora' | 'relevos' | 'traslados' | 'envios'
type Ventana =
  | { tipo: 'recibir' }
  | { tipo: 'envases' }
  | { tipo: 'aplicar'; turno?: string; fecha?: string; eleccion?: string }
  | { tipo: 'contar' }
  | { tipo: 'horas'; turno: string; fecha: string }
  | { tipo: 'documento'; documentoTipo: string; documentoId: string }
  | { tipo: 'custodia' }
  | { tipo: 'entregar' }
  | { tipo: 'recibir_relevo'; pendiente: Relevo | null }
  | { tipo: 'codigo' }
  | { tipo: 'rechazar_relevo'; relevo: Relevo }
  | { tipo: 'traslado' }
  | { tipo: 'resolver_traslado'; traslado: Traslado; accion: AccionTraslado }
  | null

const PESTANAS: { clave: Pestana; nombre: string }[] = [
  { clave: 'estacion', nombre: 'Estación' },
  { clave: 'turnos', nombre: 'Por turno' },
  { clave: 'bitacora', nombre: 'Bitácora' },
  { clave: 'relevos', nombre: 'Relevos' },
  { clave: 'traslados', nombre: 'Traslados' },
  { clave: 'envios', nombre: 'Envíos' },
]

export function CampoFertirriego({ usuarioId, manual }: { usuarioId: string; manual?: string | null }) {
  const campo = useCampo(usuarioId)
  const estadoServidor = campo.estado
  const cola = campo.cola
  // Lo creado en el teléfono que aún no llega (productos y envases de campo) se ve en todas las listas al instante
  const estado = useMemo(() => {
    if (!estadoServidor) return null
    const productos = productosPendientes(cola).filter((p) => !estadoServidor.materiales.some((m) => m.id === p.id))
    const envases = envasesPendientes(cola).filter((e) => !(estadoServidor.envases_tipos ?? []).some((x) => x.id === e.id))
    if (!productos.length && !envases.length) return estadoServidor
    return {
      ...estadoServidor,
      materiales: [...estadoServidor.materiales, ...productos],
      envases_tipos: estadoServidor.envases_tipos ? [...estadoServidor.envases_tipos, ...envases] : estadoServidor.envases_tipos,
    }
  }, [estadoServidor, cola])
  const [estacionId, setEstacionId] = useState('')
  const [pestana, setPestana] = useState<Pestana>('estacion')
  const [ventana, setVentana] = useState<Ventana>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [productosBitacora, setProductosBitacora] = useState<string[]>([])

  // Guardado en segundo plano (MarcoRegistro rápido): qué ventana se estaba guardando, y los que fallaron
  const ultimaVentana = useRef<Ventana>(null)
  const estacionIdRef = useRef('')
  useEffect(() => {
    if (ventana) ultimaVentana.current = ventana
  }, [ventana])
  const enCurso = useRef(new Map<string, { ventana: Ventana; estacionId: string }>())
  const [fallos, setFallos] = useState<(GuardadoFallido & { ventana: Ventana; estacionId: string })[]>([])
  useEffect(() => {
    const iniciado = (e: Event) => {
      const { id } = (e as CustomEvent<GuardadoIniciado>).detail
      enCurso.current.set(id, { ventana: ultimaVentana.current, estacionId: estacionIdRef.current })
      // Se limpia solo: el guardado termina en segundos
      setTimeout(() => enCurso.current.delete(id), 120_000)
    }
    const fallido = (e: Event) => {
      const d = (e as CustomEvent<GuardadoFallido>).detail
      const origen = enCurso.current.get(d.id)
      setFallos((f) => [...f, { ...d, ventana: origen?.ventana ?? null, estacionId: origen?.estacionId ?? '' }])
    }
    window.addEventListener(EVENTO_GUARDADO_INICIADO, iniciado)
    window.addEventListener(EVENTO_GUARDADO_FALLIDO, fallido)
    return () => {
      window.removeEventListener(EVENTO_GUARDADO_INICIADO, iniciado)
      window.removeEventListener(EVENTO_GUARDADO_FALLIDO, fallido)
    }
  }, [])

  // La estación que eligió la última vez (en este teléfono)
  useEffect(() => {
    void campo.preferencia<string>('estacion').then((v) => v && setEstacionId(v))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const estaciones = estado?.estaciones ?? []
  const estacionServidor = estaciones.find((e) => e.id === estacionId) ?? estaciones[0] ?? null
  // La custodia como la ve ESTE teléfono (incluye los relevos que aún no se envían)
  const estacion = useMemo(
    () => (estacionServidor && estado ? conCustodiaLocal(estacionServidor, cola, estado.yo) : estacionServidor),
    [estacionServidor, estado, cola]
  )
  const miLlave = campo.llaves.find((l) => l.perfil_id === estado?.yo.id) ?? null
  // Una entrega de OTRA persona que ya está en la base (para recibirla)
  const entregaPendiente = (estado?.relevos ?? []).find((r) => r.estacion_id === estacion?.id && r.estado === 'EN_ENTREGA' && r.entrega_id !== estado?.yo.id) ?? null
  // Mi entrega ya registrada en la base (para cancelarla)
  const miEntrega = (estado?.relevos ?? []).find((r) => r.estacion_id === estacion?.id && r.estado === 'EN_ENTREGA' && r.entrega_id === estado?.yo.id) ?? null

  /** Cancelar mi entrega: si no se ha enviado, se quita del teléfono; si ya llegó, se avisa a la base. */
  async function cancelarEntrega() {
    const local = cola.find((o) => o.estado_local === 'PENDIENTE' && o.tipo === 'relevo_entregar' && o.datos.estacion_id === estacion?.id)
    if (local) await campo.descartar(local.id)
    else if (miEntrega) {
      const u = await obtenerUbicacion(4000)
      await campo.registrar(crearOperacion('relevo_cancelar', { estacion_id: estacion?.id, relevo_id: miEntrega.id }, { ubicacion: u.tipo === 'ok' ? u.ubicacion : null, resumen: 'Cancelar entrega de estación' }))
    }
    setVentana(null)
    guardado('Entrega cancelada: la estación sigue a tu cargo.')
  }

  useEffect(() => {
    estacionIdRef.current = estacion?.id ?? ''
  }, [estacion])

  const saldos = useMemo(() => (estado && estacion ? saldosLocales(estado, cola, estacion.id) : new Map<string, number>()), [estado, cola, estacion])
  const saldosEnvases = useMemo(
    () => (estado && estacion ? saldosEnvasesLocales(estado, cola, estacion.id) : new Map<string, number>()),
    [estado, cola, estacion]
  )

  /** «Reintentar»: vuelve a abrir ese formulario (con su borrador) en su estación. */
  function reintentar(f: (typeof fallos)[number]) {
    setFallos((x) => x.filter((y) => y.id !== f.id))
    if (f.estacionId && f.estacionId !== estacion?.id && estaciones.some((e) => e.id === f.estacionId)) setEstacionId(f.estacionId)
    if (f.ventana) setVentana(f.ventana)
    else guardado(`Abre otra vez «${f.formulario}»: tu borrador sigue ahí.`)
  }
  const pendientes = cola.filter((o) => o.estado_local === 'PENDIENTE').length
  const rechazados = cola.filter((o) => o.estado_local === 'RECHAZADO').length
  const choferesPendientes: Chofer[] = cola
    .filter((o) => o.tipo === 'chofer' && o.estado_local === 'PENDIENTE')
    .map((o) => ({ id: o.id, nombre: String(o.datos.nombre), validado: false, pendiente: true }))
  const vehiculosPendientes: Vehiculo[] = cola
    .filter((o) => o.tipo === 'vehiculo' && o.estado_local === 'PENDIENTE')
    .map((o) => ({ id: o.id, placa: String(o.datos.placa), tipo: (o.datos.tipo as string) ?? null, marca: null, color: null, validado: false, pendiente: true }))

  const enLinea = campo.conexion === 'en_linea'
  const porAutorizarSinEstacion = (estado?.traslados ?? []).filter((t) => t.estado === 'POR_AUTORIZAR' && t.autorizador_id === estado?.yo.id && !cola.some((o) => o.datos.traslado_id === t.id))
  const leerBloqueo = useCallback(() => campo.preferencia<{ intentos: number; hasta: number }>('bloqueo_relevo'), [campo])
  const guardarBloqueo = useCallback((b: { intentos: number; hasta: number }) => campo.guardarPreferencia('bloqueo_relevo', b), [campo])

  /**
   * La estación sobre la que se decide un traslado: el origen al autorizar o cancelar, el destino al recibir o
   * rechazar. Si no está entre las suyas (un jefe que solo autoriza), se arma con lo mínimo: la base revisa todo.
   */
  function estacionParaTraslado(t: Traslado, a: AccionTraslado): Estacion {
    const id = a === 'aceptar' || a === 'rechazar' ? t.destino_id : t.origen_id
    const propia = estaciones.find((e) => e.id === id)
    if (propia) return estado ? conCustodiaLocal(propia, cola, estado.yo) : propia
    return {
      id, nombre: a === 'aceptar' || a === 'rechazar' ? t.destino : t.origen, zona_id: null, zona: null,
      custodio_id: null, custodio: null, custodia_estado: null, custodia_desde: null, personas: [],
      permisos: { recibir: false, aplicar: false, contar: false, relevo: false, trasladar: true, autorizar_traslado: true, anular: false, en_nombre_de: false, administrar: false, gestionar_choferes: false },
    }
  }
  const guardado = (m: string) => {
    setAviso(m)
    setTimeout(() => setAviso((a) => (a === m ? null : a)), 6000)
  }

  if (campo.cargando && !estado) return <ListaEsqueleto filas={4} />

  return (
    <div className="flex flex-col gap-3">
      <RegistroServiceWorker />

      {/* ---- Barra de estado: señal, pendientes, última sincronización ---- */}
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
          <button type="button" onClick={() => void campo.sincronizarAhora()} disabled={campo.sincronizando} className="font-bold underline disabled:no-underline disabled:opacity-60" data-actualizar>
            {campo.sincronizando ? 'Actualizando…' : 'Actualizar'}
          </button>
        </span>
      </div>

      {manual && <AyudaFertirriego manual={manual} />}
      {campo.error && <Alerta>{campo.error}</Alerta>}
      {aviso && (
        <div role="status" data-aviso className="rounded-xl bg-brand-700 px-3 py-2 text-sm font-semibold text-white">
          {aviso}
        </div>
      )}
      {fallos.map((f) => (
        <div key={f.id} role="alert" data-guardado-fallido className="rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-inset ring-red-300">
          <p className="font-bold">No se pudo guardar «{f.formulario}» ({f.estacion}, {f.hora}).</p>
          <p className="mt-0.5 text-xs">Lo que escribiste quedó como borrador. Error: {f.error}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Boton tamano="sm" onClick={() => reintentar(f)} data-reintentar-guardado>
              Reintentar
            </Boton>
            <Boton tamano="sm" variante="secundario" onClick={() => void compartirFallo(f)} data-avisar-fallo>
              Avisar
            </Boton>
            <button type="button" className="ml-auto text-xs font-semibold text-red-800 underline" onClick={() => setFallos((x) => x.filter((y) => y.id !== f.id))}>
              Cerrar
            </button>
          </div>
        </div>
      ))}

      {!estado ? (
        <Alerta tono="ambar">
          Abre esta pantalla una vez con señal para descargar tus estaciones. Después funciona sin señal.
        </Alerta>
      ) : estaciones.length === 0 ? (
        <>
          {porAutorizarSinEstacion.length === 0 && (
            <Alerta tono="ambar">No tienes estaciones asignadas. Pide a tu jefe que te asigne en Usuarios → Estaciones de riego.</Alerta>
          )}
          {/* Quien solo autoriza traslados (sin estaciones propias) ve aquí lo que le toca */}
          {porAutorizarSinEstacion.map((t) => (
            <div key={t.id} className="rounded-xl bg-white p-3 ring-1 ring-inset ring-amber-300" data-traslado="POR_AUTORIZAR">
              <p className="text-sm font-bold text-slate-800">Traslado por autorizar: {t.origen} → {t.destino}</p>
              <p className="text-xs text-slate-600">{t.motivo} · pidió {t.creador}</p>
              <div className="mt-2 flex gap-3">
                <button type="button" className="text-xs font-bold text-brand-700 underline" data-accion-traslado="autorizar" onClick={() => setVentana({ tipo: 'resolver_traslado', traslado: t, accion: 'autorizar' })}>Autorizar</button>
                <button type="button" className="text-xs font-bold text-red-700 underline" data-accion-traslado="no_autorizar" onClick={() => setVentana({ tipo: 'resolver_traslado', traslado: t, accion: 'no_autorizar' })}>No autorizar</button>
              </div>
            </div>
          ))}
          {ventana?.tipo === 'resolver_traslado' && (
            <ResolverTraslado estado={estado} estacion={estacionParaTraslado(ventana.traslado, ventana.accion)} yo={estado.yo} traslado={ventana.traslado} accion={ventana.accion} registrar={campo.registrar} onCerrar={() => setVentana(null)} onGuardado={guardado} />
          )}
        </>
      ) : (
        estacion && (
          <>
            {estaciones.length > 1 && (
              <div data-selector-estacion>
                <SelectorBuscable
                  valor={estacion.id}
                  opciones={estaciones.map((e) => ({ id: e.id, titulo: e.nombre, subtitulo: e.zona ?? undefined }))}
                  onCambiar={(id) => {
                    setEstacionId(id)
                    setProductosBitacora([])
                    void campo.guardarPreferencia('estacion', id)
                  }}
                  placeholder="Elegir estación…"
                  etiquetaBusqueda="Buscar estación"
                />
              </div>
            )}
            {estacion.nombre.startsWith('PRUEBA · ') && (
              // 98: estación de prueba (la crea el modo de pruebas con ese prefijo)
              <div className="rounded-xl bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900 ring-1 ring-inset ring-amber-300" data-modo-prueba>
                MODO PRUEBA · Lo que registres aquí es de práctica: no cuenta y se borrará.
              </div>
            )}
            <div className="flex items-baseline justify-between gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900" data-estacion={estacion.nombre}>
                {estacion.nombre}
              </h1>
              <span className="text-xs text-slate-400">{estacion.zona}</span>
            </div>

            <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" role="tablist">
              {PESTANAS.map((p) => (
                <button
                  key={p.clave}
                  type="button"
                  role="tab"
                  aria-selected={pestana === p.clave}
                  data-pestana={p.clave}
                  onClick={() => setPestana(p.clave)}
                  className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    pestana === p.clave ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  {p.nombre}
                  {p.clave === 'envios' && pendientes + rechazados > 0 && ` (${pendientes + rechazados})`}
                </button>
              ))}
            </div>

            {pestana === 'estacion' && (
              <PanelEstacion
                estado={estado}
                estacion={estacion}
                yo={estado.yo}
                saldos={saldos}
                saldosEnvases={saldosEnvases}
                enLinea={enLinea}
                tieneEntregaPendiente={Boolean(entregaPendiente)}
                onAccion={(a) =>
                  setVentana(
                    a === 'recibir'
                      ? { tipo: 'recibir' }
                      : a === 'envases'
                        ? { tipo: 'envases' }
                      : a === 'aplicar'
                        ? { tipo: 'aplicar' }
                        : a === 'contar'
                          ? { tipo: 'contar' }
                          : a === 'entregar'
                            ? { tipo: 'entregar' }
                            : a === 'recibir_relevo'
                              ? { tipo: 'recibir_relevo', pendiente: entregaPendiente }
                              : a === 'codigo'
                                ? { tipo: 'codigo' }
                                : { tipo: 'custodia' }
                  )
                }
                onAplicarTurno={(t) => setVentana({ tipo: 'aplicar', turno: t })}
                onVerProducto={(m) => {
                  setProductosBitacora([m])
                  setPestana('bitacora')
                }}
              />
            )}
            {pestana === 'turnos' && (
              <VistaTurnos
                estado={estado}
                cola={cola}
                estacion={estacion}
                onAplicar={(turno, fecha, eleccion) => setVentana({ tipo: 'aplicar', turno, fecha, eleccion })}
                onHoras={(turno, fecha) => setVentana({ tipo: 'horas', turno, fecha })}
              />
            )}
            {pestana === 'bitacora' && (
              <VistaBitacora
                estado={estado}
                cola={cola}
                estacionId={estacion.id}
                productos={productosBitacora}
                onProductos={setProductosBitacora}
                onAbrir={(documentoTipo, documentoId) => setVentana({ tipo: 'documento', documentoTipo, documentoId })}
              />
            )}
            {pestana === 'relevos' && (
              <VistaRelevos
                estado={estado}
                cola={cola}
                estacion={estacion}
                yo={estado.yo}
                onRecibir={(r) => setVentana({ tipo: 'recibir_relevo', pendiente: r })}
                onRechazar={(r) => setVentana({ tipo: 'rechazar_relevo', relevo: r })}
                onMostrarCodigo={() => setVentana({ tipo: 'codigo' })}
              />
            )}
            {pestana === 'traslados' && (
              <VistaTraslados
                estado={estado}
                cola={cola}
                estacion={estacion}
                yo={estado.yo}
                puedeRegistrar={puedeRegistrar(estacion, estado.yo).si}
                onNuevo={() => setVentana({ tipo: 'traslado' })}
                onAccion={(traslado, accion) => setVentana({ tipo: 'resolver_traslado', traslado, accion })}
              />
            )}
            {pestana === 'envios' && (
              <VistaEnvios
                estado={estado}
                cola={cola}
                enLinea={enLinea}
                sincronizando={campo.sincronizando}
                onSincronizar={() => void campo.sincronizarAhora()}
                onDescartar={(id) => void campo.descartar(id)}
              />
            )}

            {/* ---- Ventanas ---- */}
            {ventana?.tipo === 'recibir' && (
              <FormRecepcion
                estado={estado}
                estacion={estacion}
                yo={estado.yo}
                saldos={saldos}
                saldosEnvases={saldosEnvases}
                choferesPendientes={choferesPendientes}
                vehiculosPendientes={vehiculosPendientes}
                registrar={campo.registrar}
                onCerrar={() => setVentana(null)}
                onGuardado={guardado}
              />
            )}
            {ventana?.tipo === 'envases' && (
              <FormEnvases
                estado={estado}
                estacion={estacion}
                yo={estado.yo}
                saldosEnvases={saldosEnvases}
                choferesPendientes={choferesPendientes}
                vehiculosPendientes={vehiculosPendientes}
                registrar={campo.registrar}
                onCerrar={() => setVentana(null)}
                onGuardado={guardado}
              />
            )}
            {ventana?.tipo === 'aplicar' && (
              <FormAplicacion
                estado={estado}
                estacion={estacion}
                yo={estado.yo}
                saldos={saldos}
                cola={cola}
                turnoInicial={ventana.turno}
                fechaInicial={ventana.fecha}
                eleccionInicial={ventana.eleccion}
                registrar={campo.registrar}
                onCerrar={() => setVentana(null)}
                onGuardado={guardado}
              />
            )}
            {ventana?.tipo === 'contar' && (
              <FormConteo estado={estado} estacion={estacion} yo={estado.yo} saldos={saldos} saldosEnvases={saldosEnvases} registrar={campo.registrar} onCerrar={() => setVentana(null)} onGuardado={guardado} />
            )}
            {ventana?.tipo === 'horas' && (
              <FormBitacora
                estacion={estacion}
                yo={estado.yo}
                turno={estado.turnos.find((t) => t.id === ventana.turno)!}
                fecha={ventana.fecha}
                actual={estado.bitacora_riego.find((b) => b.turno_ciclo_id === ventana.turno && b.fecha === ventana.fecha) ?? null}
                registrar={campo.registrar}
                onCerrar={() => setVentana(null)}
                onGuardado={guardado}
              />
            )}
            {ventana?.tipo === 'documento' && (
              <DetalleDocumento
                estado={estado}
                estacion={estacion}
                yo={estado.yo}
                documentoTipo={ventana.documentoTipo}
                documentoId={ventana.documentoId}
                registrar={campo.registrar}
                onCerrar={() => setVentana(null)}
                onGuardado={guardado}
              />
            )}
            {ventana?.tipo === 'entregar' && (
              <FormEntregarRelevo
                estado={estado}
                estacion={estacion}
                yo={estado.yo}
                registrar={campo.registrar}
                onCerrar={() => setVentana(null)}
                onGuardado={(m) => {
                  guardado(m)
                  setTimeout(() => setVentana({ tipo: 'codigo' }), 50)
                }}
              />
            )}
            {ventana?.tipo === 'codigo' && (
              <PantallaCodigo
                llave={miLlave}
                estacion={estacion.nombre}
                onCerrar={() => setVentana(null)}
                onCancelarEntrega={estacion.custodia_estado === 'EN_ENTREGA' && estacion.custodio_id === estado.yo.id ? () => void cancelarEntrega() : undefined}
              />
            )}
            {ventana?.tipo === 'recibir_relevo' && (
              <FormRecibirRelevo
                estado={estado}
                estacion={estacion}
                yo={estado.yo}
                llaves={campo.llaves}
                saldos={saldos}
                enLinea={enLinea}
                pendiente={ventana.pendiente}
                leerBloqueo={leerBloqueo}
                guardarBloqueo={guardarBloqueo}
                registrar={campo.registrar}
                onCerrar={() => setVentana(null)}
                onGuardado={guardado}
              />
            )}
            {ventana?.tipo === 'rechazar_relevo' && (
              <RechazarRelevo estacion={estacion} yo={estado.yo} relevo={ventana.relevo} registrar={campo.registrar} onCerrar={() => setVentana(null)} onGuardado={guardado} />
            )}
            {ventana?.tipo === 'traslado' && (
              <FormTraslado estado={estado} estacion={estacion} yo={estado.yo} saldos={saldos} registrar={campo.registrar} onCerrar={() => setVentana(null)} onGuardado={guardado} />
            )}
            {ventana?.tipo === 'resolver_traslado' && (
              <ResolverTraslado
                estado={estado}
                estacion={estacionParaTraslado(ventana.traslado, ventana.accion)}
                yo={estado.yo}
                traslado={ventana.traslado}
                accion={ventana.accion}
                registrar={campo.registrar}
                onCerrar={() => setVentana(null)}
                onGuardado={guardado}
              />
            )}
            {ventana?.tipo === 'custodia' && (
              <AsignarCustodia
                supabase={campo.supabase}
                estacion={estacion}
                onCerrar={() => setVentana(null)}
                onHecho={(m) => {
                  guardado(m)
                  void campo.sincronizarAhora()
                }}
              />
            )}
          </>
        )
      )}

      {estado && pestana !== 'envios' && (pendientes > 0 || rechazados > 0) && (
        <Boton variante="secundario" tamano="sm" onClick={() => setPestana('envios')} className="self-start">
          Ver envíos
        </Boton>
      )}
    </div>
  )
}
