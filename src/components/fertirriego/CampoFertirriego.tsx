'use client'

/**
 * Fertirriego · la app de campo (Etapa B). Funciona sin señal: muestra lo último que se bajó, guarda cada
 * registro en el teléfono y lo envía solo cuando vuelve la conexión.
 *
 * Pestañas: Bodega (TODO lo que hay en la estación, con filtros, y las acciones) · Por turno (plan contra aplicado, horas) · Bitácora (kardex) ·
 * Relevos (cambio de jornada con código) · Traslados (entre estaciones) · Envíos (pendientes, rechazados, observaciones).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AvisoDestinoPerdido, useAplicarDestino, useDestinoAlerta, useResaltarDestino } from '@/lib/alertas/useDestinoAlerta'
import { Alerta, Boton, ListaEsqueleto } from '@/components/ui/Primitivos'
import { EncabezadoModulo } from '@/components/campo/EncabezadoModulo'
import { FiltroEstaciones } from '@/components/campo/FiltroEstaciones'
import { useEstacionElegida } from '@/lib/campo/estacionElegida'
import { formatearFechaHora } from '@/lib/estados'
import { hoyIso } from '@/lib/fechas/zona'
import { CLAVE_BODEGA_GENERAL, armarBodega, type BodegaGeneral } from '@/lib/fertirriego/bodegaGeneral'
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
import type { Chofer, EstadoCampo, Estacion, Operacion, PermisoHistorico, Relevo, Traslado, Vehiculo } from '@/lib/fertirriego/tipos'
import { useCampo } from '@/lib/fertirriego/useCampo'
import { useInyeccionGuardada } from '@/lib/inyeccion/useInyeccionGuardada'
import { AsignarCustodia } from './AsignarCustodia'
import { FormPrestamoTanque } from './FormPrestamoTanque'
import { VistaGeneralCapacidad } from './VistaGeneralCapacidad'
import { capacidadesDeEstacion } from '@/lib/fertirriego/capacidad'
import { AyudaFertirriego } from './AyudaFertirriego'
import { DetalleDocumento } from './DetalleDocumento'
import { EncabezadoEnvios } from './EncabezadoEnvios'
import { FormAnularDiferencia } from './FormAnularDiferencia'
import { FormAplicacion } from './FormAplicacion'
import { FormBitacora } from './FormBitacora'
import { FormConteo } from './FormConteo'
import { FormDevolucionBodega } from './FormDevolucionBodega'
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
import { AvisoModoPruebas } from '@/components/campo/AvisoModoPruebas'

type Pestana = 'estacion' | 'general' | 'turnos' | 'bitacora' | 'relevos' | 'traslados'
type Ventana =
  | { tipo: 'recibir' }
  | { tipo: 'envases' }
  | { tipo: 'aplicar'; turno?: string; fecha?: string; eleccion?: string }
  | { tipo: 'historico' }
  | { tipo: 'contar' }
  | { tipo: 'devolver_bodega' }
  | { tipo: 'horas'; turno: string; fecha: string }
  | { tipo: 'documento'; documentoTipo: string; documentoId: string }
  | { tipo: 'custodia' }
  | { tipo: 'prestamo'; estacionId: string }
  | { tipo: 'entregar' }
  | { tipo: 'recibir_relevo'; pendiente: Relevo | null }
  | { tipo: 'codigo' }
  | { tipo: 'rechazar_relevo'; relevo: Relevo }
  | { tipo: 'traslado' }
  | { tipo: 'anular_diferencia'; relevo: Relevo; materialId: string }
  | { tipo: 'resolver_traslado'; traslado: Traslado; accion: AccionTraslado }
  | null

/** Enlace profundo de una alerta: sin pestana, un registro o un día llevan a la Bitácora. */
const pestanaPorDefectoFert = (d: { registro?: string; fecha?: string }) => (d.registro || d.fecha ? 'bitacora' : null)

const PESTANAS: { clave: Pestana; nombre: string }[] = [
  { clave: 'estacion', nombre: 'Bodega' },
  { clave: 'general', nombre: 'General' },
  { clave: 'turnos', nombre: 'Por turno' },
  { clave: 'bitacora', nombre: 'Bitácora' },
  { clave: 'relevos', nombre: 'Relevos' },
  { clave: 'traslados', nombre: 'Traslados' },
]

export function CampoFertirriego({ usuarioId, manual }: { usuarioId: string; manual?: string | null }) {
  const campo = useCampo(usuarioId)
  // Lo último de Inyección que ya bajó este teléfono (solo lectura, sin red): detalle de los movimientos de Inyección en la bitácora
  const inyGuardada = useInyeccionGuardada(usuarioId)
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
  const { estacionId, elegirEstacion: setEstacionId, zona, elegirZona } = useEstacionElegida(usuarioId)
  const [pestana, setPestana] = useState<Pestana>('estacion')
  const [ventana, setVentana] = useState<Ventana>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // 115: tras anular la diferencia de un relevo se ofrece registrar la aplicación olvidada
  const [olvidada, setOlvidada] = useState(false)
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

  // Enlace profundo de una alerta (?pestana=&estacion=&registro=&fecha=): manda sobre la preferencia
  const alerta = useDestinoAlerta()
  const [preparado, setPreparado] = useState(false)
  const alListo = useCallback(() => setPreparado(true), [])
  const ponerPestana = useCallback((p: string) => setPestana(p as Pestana), [])
  const destinoEstacion = alerta.destino.estacion

  const estaciones = estado?.estaciones ?? []
  useAplicarDestino({ alerta, hayEstado: Boolean(estado), estaciones, pestanasValidas: PESTANAS.map((p) => p.clave), pestanaPorDefecto: pestanaPorDefectoFert, setEstacionId, setPestana: ponerPestana, alListo })
  useResaltarDestino(alerta, { listo: preparado, ids: [alerta.destino.registro, alerta.destino.fecha] })
  const estacionServidor = estaciones.find((e) => e.id === estacionId) ?? estaciones[0] ?? null
  // La custodia como la ve ESTE teléfono (incluye los relevos que aún no se envían)
  const estacion = useMemo(
    () => (estacionServidor && estado ? conCustodiaLocal(estacionServidor, cola, estado.yo) : estacionServidor),
    [estacionServidor, estado, cola]
  )
  // sql/116: permiso vigente de «Registro histórico» en esta estación. Se vuelve a calcular con la fecha de HOY en el
  // teléfono: si venció (aunque no haya señal), el botón desaparece; la base de todos modos lo rechazaría.
  const permisoHistorico = useMemo<PermisoHistorico | null>(() => {
    const hoy = hoyIso()
    const p = (estado?.historico_permisos ?? []).find((x) => x.estacion_id === estacion?.id && x.hasta >= hoy)
    if (!p) return null
    return { ...p, dias_restantes: Math.round((Date.parse(`${p.hasta}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86400000) }
  }, [estado?.historico_permisos, estacion?.id])
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

  const saldosPorEstacion = useMemo(
    () => new Map((estado?.estaciones ?? []).map((e) => [e.id, saldosLocales(estado as EstadoCampo, cola, e.id)] as const)),
    [estado, cola]
  )
  const saldos = useMemo(() => (estado && estacion ? saldosLocales(estado, cola, estacion.id) : new Map<string, number>()), [estado, cola, estacion])
  const saldosEnvases = useMemo(
    () => (estado && estacion ? saldosEnvasesLocales(estado, cola, estacion.id) : new Map<string, number>()),
    [estado, cola, estacion]
  )

  // Bodega general (139): lo último que bajó la sincronización; se relee solo cuando termina una sincronización
  const [bodegaServidor, setBodegaServidor] = useState<BodegaGeneral | null>(null)
  const { preferencia: leerPreferencia, sincronizadoEn } = campo
  useEffect(() => {
    let vivo = true
    void leerPreferencia<BodegaGeneral>(CLAVE_BODEGA_GENERAL).then((b) => vivo && setBodegaServidor(b))
    return () => {
      vivo = false
    }
  }, [leerPreferencia, sincronizadoEn])
  const filasBodega = useMemo(
    () =>
      estado && estacion
        ? armarBodega({
            estacionId: estacion.id,
            saldos,
            saldosEnvases,
            material: (id) => estado.materiales.find((m) => m.id === id),
            nombreEnvase: (id) => estado.envases_tipos?.find((e) => e.id === id)?.nombre ?? '',
            servidor: bodegaServidor,
          })
        : [],
    [estado, estacion, saldos, saldosEnvases, bodegaServidor]
  )

  /** «Reintentar»: vuelve a abrir ese formulario (con su borrador) en su estación. */
  function reintentar(f: (typeof fallos)[number]) {
    setFallos((x) => x.filter((y) => y.id !== f.id))
    if (f.estacionId && f.estacionId !== estacion?.id && estaciones.some((e) => e.id === f.estacionId)) setEstacionId(f.estacionId)
    if (f.ventana) setVentana(f.ventana)
    else guardado(`Abre otra vez «${f.formulario}»: tu borrador sigue ahí.`)
  }
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

  /** «Corregir y reenviar» (Envíos): abre el formulario de ese tipo, en su estación, para registrarlo bien. */
  function corregirEnvio(o: Operacion) {
    const est = typeof o.datos.estacion_id === 'string' ? o.datos.estacion_id : ''
    if (est && est !== estacion?.id && estaciones.some((e) => e.id === est)) setEstacionId(est)
    const v: Ventana =
      o.tipo === 'recepcion' ? { tipo: 'recibir' }
      : o.tipo === 'aplicacion' ? { tipo: 'aplicar' }
      : o.tipo === 'aplicacion_historica' && permisoHistorico ? { tipo: 'historico' }
      : o.tipo === 'conteo' ? { tipo: 'contar' }
      : o.tipo === 'devolucion_bodega' ? { tipo: 'devolver_bodega' }
      : null
    if (v) setVentana(v)
    guardado(v ? 'Corrige los datos y guarda. Después, en «Envíos», quita el registro que no se aceptó.' : 'Vuelve a hacer el registro desde su pantalla y después quita el que no se aceptó en «Envíos».')
  }

  if (campo.cargando && !estado) return <ListaEsqueleto filas={4} />

  return (
    <div className="campo-legible flex flex-col gap-3">
      <RegistroServiceWorker />
      <EncabezadoModulo titulo="Fertirriego" icono="gota" subtitulo={estacion ? `${estacion.nombre}${estacion.zona ? ` · ${estacion.zona}` : ''}` : null} />

      {/* ---- Regresar + estado de conexión (como WhatsApp) + panel Envíos ---- */}
      <EncabezadoEnvios campo={campo} onCorregir={corregirEnvio} />

      {manual && <AyudaFertirriego manual={manual} />}
      {campo.error && <Alerta>{campo.error}</Alerta>}
      {aviso && (
        <div role="status" data-aviso className="rounded-xl bg-brand-700 px-3 py-2 text-sm font-semibold text-white">
          {aviso}
        </div>
      )}
      {olvidada && !ventana && (
        <div role="status" data-aviso-aplicacion-olvidada className="flex flex-col gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-300">
          <p className="font-semibold">La diferencia quedó anulada y el producto volvió al inventario. Ahora registra la aplicación que se olvidó.</p>
          <div className="flex gap-2">
            <Boton
              className="flex-1"
              onClick={() => {
                setOlvidada(false)
                setVentana({ tipo: 'aplicar' })
              }}
              data-registrar-aplicacion-olvidada
            >
              Registrar la aplicación olvidada
            </Boton>
            <Boton variante="secundario" onClick={() => setOlvidada(false)} data-cerrar-aviso-olvidada>
              Ahora no
            </Boton>
          </div>
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
            <FiltroEstaciones
              estaciones={estaciones}
              valor={estacion.id}
              onCambiar={(id) => {
                setEstacionId(id)
                setProductosBitacora([])
              }}
              zona={zona}
              onZona={elegirZona}
            />
            <AvisoModoPruebas estacionNombre={estacion.nombre} />
            <span hidden data-estacion={estacion.nombre} />

            <AvisoDestinoPerdido alerta={alerta} />
            <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" role="tablist">
              {PESTANAS.map((p) => (
                <button
                  key={p.clave}
                  type="button"
                  role="tab"
                  aria-selected={pestana === p.clave}
                  data-pestana={p.clave}
                  onClick={() => setPestana(p.clave)}
                  className={`min-h-11 flex-1 basis-24 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    pestana === p.clave ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  {p.nombre}
                </button>
              ))}
            </div>

            {pestana === 'general' && (
              <VistaGeneralCapacidad
                estado={estado}
                saldosPorEstacion={saldosPorEstacion}
                enLinea={enLinea}
                onPrestar={(e) => setVentana({ tipo: 'prestamo', estacionId: e.id })}
              />
            )}

            {pestana === 'estacion' && (
              <PanelEstacion
                estado={estado}
                estacion={estacion}
                yo={estado.yo}
                saldos={saldos}
                filasBodega={filasBodega}
                enLinea={enLinea}
                tieneEntregaPendiente={Boolean(entregaPendiente)}
                permisoHistorico={permisoHistorico}
                onAccion={(a) =>
                  setVentana(
                    a === 'recibir'
                      ? { tipo: 'recibir' }
                      : a === 'envases'
                        ? { tipo: 'envases' }
                      : a === 'aplicar'
                        ? { tipo: 'aplicar' }
                        : a === 'historico'
                        ? { tipo: 'historico' }
                        : a === 'contar'
                          ? { tipo: 'contar' }
                          : a === 'devolver_bodega'
                          ? { tipo: 'devolver_bodega' }
                          : a === 'trasladar'
                          ? { tipo: 'traslado' }
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
                yo={estado.yo}
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
                inyeccion={inyGuardada}
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
                onAnularDiferencia={(r, materialId) => setVentana({ tipo: 'anular_diferencia', relevo: r, materialId })}
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
            {ventana?.tipo === 'historico' && permisoHistorico && (
              <FormAplicacion
                estado={estado}
                estacion={estacion}
                yo={estado.yo}
                saldos={saldos}
                cola={cola}
                historico={permisoHistorico}
                registrar={campo.registrar}
                onCerrar={() => setVentana(null)}
                onGuardado={guardado}
              />
            )}
            {ventana?.tipo === 'contar' && (
              <FormConteo estado={estado} estacion={estacion} yo={estado.yo} saldos={saldos} saldosEnvases={saldosEnvases} registrar={campo.registrar} onCerrar={() => setVentana(null)} onGuardado={guardado} />
            )}
            {ventana?.tipo === 'devolver_bodega' && (
              <FormDevolucionBodega estado={estado} estacion={estacion} yo={estado.yo} saldos={saldos} choferesPendientes={choferesPendientes} vehiculosPendientes={vehiculosPendientes} registrar={campo.registrar} onCerrar={() => setVentana(null)} onGuardado={guardado} />
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
                cola={cola}
                estado={estado}
                estacion={estacion}
                yo={estado.yo}
                documentoTipo={ventana.documentoTipo}
                documentoId={ventana.documentoId}
                registrar={campo.registrar}
                onCerrar={() => setVentana(null)}
                onGuardado={guardado}
                onEliminado={(m, documentoId) => {
                  setVentana(null)
                  campo.quitarDocumento(documentoId)   // desaparece al instante; la sincronización trae después la verdad
                  guardado(m)
                  void campo.sincronizarAhora()
                }}
              />
            )}
            {ventana?.tipo === 'anular_diferencia' && (
              <FormAnularDiferencia
                estado={estado}
                estacion={estacion}
                yo={estado.yo}
                relevo={ventana.relevo}
                materialId={ventana.materialId}
                registrar={campo.registrar}
                onCerrar={() => setVentana(null)}
                onGuardado={(m) => {
                  guardado(m)
                  setOlvidada(true)
                }}
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
            {ventana?.tipo === 'prestamo' && (() => {
              const destino = estaciones.find((x) => x.id === ventana.estacionId)
              return destino ? (
                <FormPrestamoTanque
                  supabase={campo.supabase}
                  estacion={destino}
                  caps={capacidadesDeEstacion(estado.capacidades, destino.id)}
                  materiales={estado.materiales}
                  onCerrar={() => setVentana(null)}
                  onHecho={(m) => {
                    guardado(m)
                    void campo.sincronizarAhora()
                  }}
                />
              ) : null
            })()}
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

    </div>
  )
}
