'use client'

/**
 * Inyección / Drench / Aseguramiento de calidad por lote (Campo, bloque 2). Funciona sin señal igual que Fertirriego
 * (misma cola, misma custodia, misma bodega): lista los lotes con plan de la estación, «Aplicar por lote» y el
 * historial. El cumplimiento y la tendencia son de AGL: aquí no hay pantalla de reportes.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Alerta, Boton, Insignia, ListaEsqueleto, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { RegistroServiceWorker } from '@/components/fertirriego/RegistroServiceWorker'
import { hoyIso } from '@/lib/fechas/zona'
import { conCustodiaLocal, saldosLocales } from '@/lib/fertirriego/calculos'
import { EVENTO_GUARDADO_FALLIDO, type GuardadoFallido } from '@/lib/fertirriego/guardadoFondo'
import { useCampo } from '@/lib/fertirriego/useCampo'
import { EncabezadoEnvios } from '@/components/fertirriego/EncabezadoEnvios'
import type { Operacion } from '@/lib/fertirriego/tipos'
import { lotesConPlan } from '@/lib/inyeccion/estado'
import { useInyeccion } from '@/lib/inyeccion/useInyeccion'
import { permisoHistoricoDe, useCampoExtras } from '@/lib/campo/useCampoExtras'
import { FormAplicacionLote } from './FormAplicacionLote'
import { VistaHistorialInyeccion } from './VistaHistorialInyeccion'

const RUTAS_SW = ['/inyeccion']

export function CampoInyeccion({ usuarioId }: { usuarioId: string }) {
  const campo = useCampo(usuarioId)
  const iny = useInyeccion(usuarioId)
  // sql/140: permiso temporal de «Registro histórico» y «Eliminar por completo» (de Inyección)
  const extras = useCampoExtras(usuarioId, 'inyeccion')
  const { estado, cola } = campo
  const [estacionId, setEstacionId] = useState('')
  const [ventana, setVentana] = useState<{ lote?: string; categoria?: string } | null>(null)
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
  const saldos = useMemo(() => (estado && estacion ? saldosLocales(estado, cola, estacion.id) : new Map<string, number>()), [estado, cola, estacion])

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

  const lotes = useMemo(
    () => (iny.estado && estacion ? lotesConPlan(iny.estado, cola, estacion.id, hoyIso()) : []),
    [iny.estado, cola, estacion]
  )
  const nombreProducto = (id: string) => iny.estado?.materiales.find((m) => m.id === id)?.descripcion ?? 'un producto'
  const categoriaNombre = (clave: string) => {
    const c = iny.estado?.categorias.find((x) => x.clave === clave)
    return c?.etiqueta ?? c?.categoria ?? clave
  }
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
    <div className="flex flex-col gap-3 pb-24">
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
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900" data-estacion={estacion.nombre}>
              Inyección · {estacion.nombre}
            </h1>
            <span className="text-xs text-slate-600">{estacion.zona}</span>
          </div>

          <div data-lotes-con-plan className="flex flex-col gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Lotes con plan</p>
            {lotes.length === 0 ? (
              <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">
                Esta estación no tiene lotes con plan de inyección. Igual puedes registrar una aplicación (quedará «sin plan»).
              </p>
            ) : (
              lotes.map((l) => (
                <button
                  key={`${l.lote}|${l.categoria_clave}`}
                  type="button"
                  disabled={!puedeRegistrar}
                  onClick={() => setVentana({ lote: l.lote, categoria: l.categoria_clave })}
                  data-lote-plan={l.lote}
                  className="block min-h-11 rounded-2xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-60"
                >
                  <Tarjeta className="p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-800">{l.lote}</p>
                      <Insignia tono={l.hecho ? 'verde' : 'ambar'}>{l.hecho ? 'Hecho' : 'Pendiente'}</Insignia>
                    </div>
                    <p className="text-xs text-slate-500">
                      {categoriaNombre(l.categoria_clave)} · DDT {l.ddt ?? '—'}
                      {l.fecha_plan ? ` · ${l.fecha_plan}` : ''}
                    </p>
                  </Tarjeta>
                </button>
              ))
            )}
          </div>

          <VistaHistorialInyeccion
            estado={iny.estado}
            cola={cola}
            estacion={estacion}
            yo={estado.yo}
            puedeAnular={iny.estado.permisos?.anular ?? false}
            puedeEliminar={extras.eliminar_definitivo}
            nombreProducto={nombreProducto}
            registrar={campo.registrar}
            onGuardado={guardado}
            onEliminado={(m) => {
              guardado(m)
              iny.actualizar()
            }}
          />

          {!puedeRegistrar && <Alerta tono="ambar">Tu rol puede ver Inyección pero no registrar. Se configura en Permisos.</Alerta>}

          {puedeRegistrar && (
            <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
              <div className="mx-auto max-w-2xl">
                <Boton className="min-h-12 w-full" onClick={() => setVentana({})} data-aplicar-por-lote>
                  Aplicar por lote
                </Boton>
              </div>
            </div>
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
