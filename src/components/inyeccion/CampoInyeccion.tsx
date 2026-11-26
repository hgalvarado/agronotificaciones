'use client'

/**
 * Inyección / Drench / Aseguramiento de calidad por lote (Campo). Funciona sin señal igual que Fertirriego (misma cola,
 * misma custodia, misma bodega). Lo principal es REGISTRAR: tras elegir la estación sale arriba, grande, «Aplicar por
 * lote»; debajo, cuatro pestañas: «Historial» (lo registrado, la que abre), «Plan» (plan general por DDT, como en AGL) y
 * «Por lote» (qué le toca a cada lote) y «Bodega» (saldo de los productos de la estación). Solo se ve lo de las zonas de la persona. El cumplimiento y la tendencia son de AGL.
 * El estado de la conexión y los envíos están en el encabezado de toda la app.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AvisoDestinoPerdido, useAplicarDestino, useDestinoAlerta, useResaltarDestino } from '@/lib/alertas/useDestinoAlerta'
import { Alerta, Boton, ListaEsqueleto } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { RegistroServiceWorker } from '@/components/fertirriego/RegistroServiceWorker'
import { CLAVE_BODEGA_GENERAL, type BodegaGeneral } from '@/lib/fertirriego/bodegaGeneral'
import { conCustodiaLocal, saldosLocales } from '@/lib/fertirriego/calculos'
import { nombrePersona } from '@/lib/fertirriego/bitacora'
import { EVENTO_GUARDADO_FALLIDO, type GuardadoFallido } from '@/lib/fertirriego/guardadoFondo'
import { useCampo } from '@/lib/fertirriego/useCampo'
import { EncabezadoEnvios } from '@/components/fertirriego/EncabezadoEnvios'
import type { Operacion } from '@/lib/fertirriego/tipos'
import { useInyeccion } from '@/lib/inyeccion/useInyeccion'
import { permisoHistoricoDe, useCampoExtras } from '@/lib/campo/useCampoExtras'
import { AvisoModoPruebas } from '@/components/campo/AvisoModoPruebas'
import { FichaProducto } from './FichaProducto'
import { FormAplicacionLote } from './FormAplicacionLote'
import { VistaHistorialInyeccion } from './VistaHistorialInyeccion'
import { VistaPlanGeneral } from './VistaPlanGeneral'
import { VistaPorLote } from './VistaPorLote'
import { VistaBodegaInyeccion } from './VistaBodegaInyeccion'

const RUTAS_SW = ['/inyeccion']

type Pestana = 'historial' | 'plan' | 'lote' | 'bodega'
/** Enlace profundo de una alerta: sin pestana, un registro o un día llevan al Historial. */
const pestanaPorDefectoIny = (d: { registro?: string; fecha?: string }) => (d.registro || d.fecha ? 'historial' : null)

const PESTANAS: [Pestana, string][] = [
  ['historial', 'Historial'],
  ['plan', 'Plan'],
  ['lote', 'Por lote'],
  ['bodega', 'Bodega'],
]

export function CampoInyeccion({ usuarioId }: { usuarioId: string }) {
  const campo = useCampo(usuarioId)
  const iny = useInyeccion(usuarioId)
  // sql/140: permiso temporal de «Registro histórico» y «Eliminar por completo» (de Inyección)
  const extras = useCampoExtras(usuarioId, 'inyeccion')
  const { estado, cola } = campo
  const [estacionId, setEstacionId] = useState('')
  const [pestana, setPestana] = useState<Pestana>('historial')
  const [ventana, setVentana] = useState<{ lote?: string; categoria?: string } | null>(null)
  const [ficha, setFicha] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [fallo, setFallo] = useState<GuardadoFallido | null>(null)

  // La estación que eligió la última vez (en este teléfono; la misma preferencia que Fertirriego)
  const { preferencia, guardarPreferencia } = campo
  // Enlace profundo de una alerta (?pestana=&estacion=&registro=&fecha=): manda sobre la preferencia
  const alerta = useDestinoAlerta()
  const [preparado, setPreparado] = useState(false)
  const alListo = useCallback(() => setPreparado(true), [])
  const ponerPestana = useCallback((p: string) => setPestana(p as Pestana), [])
  const destinoEstacion = alerta.destino.estacion
  useEffect(() => {
    if (destinoEstacion) return
    void preferencia<string>('estacion').then((v) => v && setEstacionId(v))
  }, [preferencia, destinoEstacion])

  const estaciones = estado?.estaciones ?? []
  useAplicarDestino({ alerta, hayEstado: Boolean(estado), estaciones, pestanasValidas: PESTANAS.map(([id]) => id), pestanaPorDefecto: pestanaPorDefectoIny, setEstacionId, setPestana: ponerPestana, alListo })
  useResaltarDestino(alerta, { listo: preparado, ids: [alerta.destino.registro, alerta.destino.fecha] })
  const estacionServidor = estaciones.find((e) => e.id === estacionId) ?? estaciones[0] ?? null
  const estacion = useMemo(
    () => (estacionServidor && estado ? conCustodiaLocal(estacionServidor, cola, estado.yo) : estacionServidor),
    [estacionServidor, estado, cola]
  )
  const saldos = useMemo(() => (estado && estacion ? saldosLocales(estado, cola, estacion.id) : new Map<string, number>()), [estado, cola, estacion])

  // Bodega general: lo último que bajó la sincronización (solo se relee al terminar una sincronización)
  const [bodegaServidor, setBodegaServidor] = useState<BodegaGeneral | null>(null)
  const { preferencia: leerPreferencia, sincronizadoEn } = campo
  useEffect(() => {
    let vivo = true
    void leerPreferencia<BodegaGeneral>(CLAVE_BODEGA_GENERAL).then((b) => vivo && setBodegaServidor(b))
    return () => {
      vivo = false
    }
  }, [leerPreferencia, sincronizadoEn])

  const pendientes = cola.filter((o) => o.estado_local === 'PENDIENTE').length

  // Al terminar de enviar lo pendiente se trae lo nuevo de Inyección (una sola vez por transición)
  const antes = useRef(pendientes)
  const { actualizar } = iny
  // bucle-ok: «actualizar» es estable (useCallback sobre un cliente memorizado), solo corre al pasar de pendientes a 0 y la bajada pasa por el freno de useInyeccion
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

  // Los productos de Inyección y, si no están ahí, los demás publicados a las estaciones (mismo catálogo `materiales`)
  const nombreProducto = (id: string) => iny.estado?.materiales.find((m) => m.id === id)?.descripcion ?? estado?.materiales.find((m) => m.id === id)?.descripcion ?? 'un producto'
  const unidadProducto = (id: string) => iny.estado?.materiales.find((m) => m.id === id)?.unidad ?? estado?.materiales.find((m) => m.id === id)?.unidad ?? ''
  const puedeRegistrar = iny.estado?.permisos?.registrar ?? false

  /** «Corregir y reenviar» (Envíos): abre «Aplicar por lote» con el lote de ese envío. */
  function corregirEnvio(o: Operacion) {
    const lote = typeof o.datos.lote === 'string' ? o.datos.lote : undefined
    const categoria = typeof o.datos.categoria_clave === 'string' ? o.datos.categoria_clave : undefined
    setVentana({ lote, categoria })
    guardado('Corrige los datos y guarda. Después, en «Envíos», quita el registro que no se aceptó.')
  }

  if (campo.cargando && !estado) return <ListaEsqueleto filas={4} />

  return (
    <div className="flex flex-col gap-3 pb-6">
      <RegistroServiceWorker rutas={RUTAS_SW} />

      <EncabezadoEnvios campo={campo} onActualizar={iny.actualizar} actualizando={iny.cargando} onCorregir={corregirEnvio} />

      {campo.error && <Alerta>{campo.error}</Alerta>}
      {iny.error && <Alerta tono="ambar">{iny.error}</Alerta>}
      {aviso && (
        <div role="status" data-aviso className="rounded-xl bg-brand-700 px-3 py-2 text-sm font-semibold text-white">
          {aviso}
        </div>
      )}
      {fallo && (
        <div role="alert" data-guardado-fallido className="rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-inset ring-red-300">
          <p className="font-bold">No se pudo guardar «{fallo.formulario}» ({fallo.estacion}, {fallo.hora}).</p>
          <p className="mt-0.5 text-xs">Lo que escribiste quedó como borrador. Abre «Aplicar por lote» para continuarlo. Error: {fallo.error}</p>
          <button type="button" className="mt-2 min-h-11 text-xs font-semibold text-red-800 underline" onClick={() => setFallo(null)}>
            Cerrar
          </button>
        </div>
      )}

      {!estado || !iny.estado ? (
        <Alerta tono="ambar">Abre esta pantalla una vez con señal para descargar tus estaciones y el plan. Después funciona sin señal.</Alerta>
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
          <AvisoDestinoPerdido alerta={alerta} />
          <AvisoModoPruebas estacionNombre={estacion.nombre} />
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900" data-estacion={estacion.nombre}>
              Inyección · {estacion.nombre}
            </h1>
            <span className="text-xs text-slate-600">{estacion.zona}</span>
          </div>

          {puedeRegistrar ? (
            <Boton className="min-h-14 w-full text-lg" onClick={() => setVentana({})} data-aplicar-por-lote>
              Aplicar por lote
            </Boton>
          ) : (
            <Alerta tono="ambar">Tu rol puede ver Inyección pero no registrar. Se configura en Permisos.</Alerta>
          )}

          <div role="tablist" aria-label="Inyección" className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1" data-pestanas-inyeccion>
            {PESTANAS.map(([id, texto]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={pestana === id}
                onClick={() => setPestana(id)}
                data-pestana-iny={id}
                className={`min-h-11 rounded-lg px-2 text-sm font-bold transition-colors ${pestana === id ? 'bg-white text-brand-700 shadow-[var(--shadow-card)]' : 'text-slate-600'}`}
              >
                {texto}
              </button>
            ))}
          </div>

          {pestana === 'historial' && (
            <VistaHistorialInyeccion
              estado={iny.estado}
              cola={cola}
              estacion={estacion}
              yo={estado.yo}
              puedeAnular={iny.estado.permisos?.anular ?? false}
              puedeEliminar={extras.eliminar_definitivo}
              nombreProducto={nombreProducto}
              unidadProducto={unidadProducto}
              nombreQuien={(id) => nombrePersona(estado, id)}
              registrar={campo.registrar}
              onGuardado={guardado}
              onEliminado={(m) => {
                guardado(m)
                iny.actualizar()
              }}
            />
          )}
          {pestana === 'plan' && <VistaPlanGeneral estado={iny.estado} cola={cola} estacionId={estacion.id} onFicha={setFicha} />}
          {pestana === 'lote' && (
            <VistaPorLote
              estado={iny.estado}
              cola={cola}
              estacionId={estacion.id}
              puedeRegistrar={puedeRegistrar}
              onAplicar={(lote, categoria) => setVentana({ lote, categoria })}
            />
          )}

          {pestana === 'bodega' && (
            <VistaBodegaInyeccion estacionId={estacion.id} campoEstado={estado} inyeccion={iny.estado} saldos={saldos} servidor={bodegaServidor} />
          )}

          {ficha && iny.estado.materiales.find((m) => m.id === ficha) && (
            <FichaProducto producto={iny.estado.materiales.find((m) => m.id === ficha)!} onCerrar={() => setFicha(null)} />
          )}

          {ventana && (
            <FormAplicacionLote
              inyeccion={iny.estado}
              estacion={estacion}
              yo={estado.yo}
              saldos={saldos}
              loteInicial={ventana.lote}
              categoriaInicial={ventana.categoria}
              historico={permisoHistoricoDe(extras, estacion.id)}
              materialesCampo={estado.materiales}
              registrar={campo.registrar}
              onCerrar={() => setVentana(null)}
              onGuardado={guardado}
            />
          )}
        </>
      )}
    </div>
  )
}
