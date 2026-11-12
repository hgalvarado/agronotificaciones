'use client'

/**
 * Fertirriego · la app de campo (Etapa B). Funciona sin señal: muestra lo último que se bajó, guarda cada
 * registro en el teléfono y lo envía solo cuando vuelve la conexión.
 *
 * Pestañas: Estación (bodega y acciones) · Por turno (plan contra aplicado, horas) · Bitácora (kardex) ·
 * Envíos (pendientes, rechazados, observaciones).
 */

import { useEffect, useMemo, useState } from 'react'
import { Alerta, Boton, ListaEsqueleto } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { formatearFechaHora } from '@/lib/estados'
import { saldosLocales } from '@/lib/fertirriego/calculos'
import type { Chofer, Vehiculo } from '@/lib/fertirriego/tipos'
import { useCampo } from '@/lib/fertirriego/useCampo'
import { AsignarCustodia } from './AsignarCustodia'
import { DetalleDocumento } from './DetalleDocumento'
import { FormAplicacion } from './FormAplicacion'
import { FormBitacora } from './FormBitacora'
import { FormConteo } from './FormConteo'
import { FormRecepcion } from './FormRecepcion'
import { PanelEstacion } from './PanelEstacion'
import { RegistroServiceWorker } from './RegistroServiceWorker'
import { VistaBitacora } from './VistaBitacora'
import { VistaEnvios } from './VistaEnvios'
import { VistaTurnos } from './VistaTurnos'

type Pestana = 'estacion' | 'turnos' | 'bitacora' | 'envios'
type Ventana =
  | { tipo: 'recibir' }
  | { tipo: 'aplicar'; turno?: string; fecha?: string }
  | { tipo: 'contar' }
  | { tipo: 'horas'; turno: string; fecha: string }
  | { tipo: 'documento'; documentoTipo: string; documentoId: string }
  | { tipo: 'custodia' }
  | null

const PESTANAS: { clave: Pestana; nombre: string }[] = [
  { clave: 'estacion', nombre: 'Estación' },
  { clave: 'turnos', nombre: 'Por turno' },
  { clave: 'bitacora', nombre: 'Bitácora' },
  { clave: 'envios', nombre: 'Envíos' },
]

export function CampoFertirriego({ usuarioId }: { usuarioId: string }) {
  const campo = useCampo(usuarioId)
  const { estado, cola } = campo
  const [estacionId, setEstacionId] = useState('')
  const [pestana, setPestana] = useState<Pestana>('estacion')
  const [ventana, setVentana] = useState<Ventana>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [material, setMaterial] = useState('')

  // La estación que eligió la última vez (en este teléfono)
  useEffect(() => {
    void campo.preferencia<string>('estacion').then((v) => v && setEstacionId(v))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const estaciones = estado?.estaciones ?? []
  const estacion = estaciones.find((e) => e.id === estacionId) ?? estaciones[0] ?? null

  const saldos = useMemo(() => (estado && estacion ? saldosLocales(estado, cola, estacion.id) : new Map<string, number>()), [estado, cola, estacion])
  const pendientes = cola.filter((o) => o.estado_local === 'PENDIENTE').length
  const rechazados = cola.filter((o) => o.estado_local === 'RECHAZADO').length
  const choferesPendientes: Chofer[] = cola
    .filter((o) => o.tipo === 'chofer' && o.estado_local === 'PENDIENTE')
    .map((o) => ({ id: o.id, nombre: String(o.datos.nombre), validado: false, pendiente: true }))
  const vehiculosPendientes: Vehiculo[] = cola
    .filter((o) => o.tipo === 'vehiculo' && o.estado_local === 'PENDIENTE')
    .map((o) => ({ id: o.id, placa: String(o.datos.placa), tipo: (o.datos.tipo as string) ?? null, marca: null, color: null, validado: false, pendiente: true }))

  const enLinea = campo.conexion === 'en_linea'
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

      {campo.error && <Alerta>{campo.error}</Alerta>}
      {aviso && (
        <div role="status" data-aviso className="rounded-xl bg-brand-700 px-3 py-2 text-sm font-semibold text-white">
          {aviso}
        </div>
      )}

      {!estado ? (
        <Alerta tono="ambar">
          Abre esta pantalla una vez con señal para descargar tus estaciones. Después funciona sin señal.
        </Alerta>
      ) : estaciones.length === 0 ? (
        <Alerta tono="ambar">No tienes estaciones asignadas. Pide a tu jefe que te asigne en Usuarios → Estaciones de riego.</Alerta>
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
                    setMaterial('')
                    void campo.guardarPreferencia('estacion', id)
                  }}
                  placeholder="Elegir estación…"
                  etiquetaBusqueda="Buscar estación"
                />
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
                enLinea={enLinea}
                onAccion={(a) => setVentana(a === 'recibir' ? { tipo: 'recibir' } : a === 'aplicar' ? { tipo: 'aplicar' } : a === 'contar' ? { tipo: 'contar' } : { tipo: 'custodia' })}
                onAplicarTurno={(t) => setVentana({ tipo: 'aplicar', turno: t })}
                onVerProducto={(m) => {
                  setMaterial(m)
                  setPestana('bitacora')
                }}
              />
            )}
            {pestana === 'turnos' && (
              <VistaTurnos
                estado={estado}
                cola={cola}
                estacion={estacion}
                onAplicar={(turno, fecha) => setVentana({ tipo: 'aplicar', turno, fecha })}
                onHoras={(turno, fecha) => setVentana({ tipo: 'horas', turno, fecha })}
              />
            )}
            {pestana === 'bitacora' && (
              <VistaBitacora
                estado={estado}
                cola={cola}
                estacionId={estacion.id}
                material={material}
                onMaterial={setMaterial}
                onAbrir={(documentoTipo, documentoId) => setVentana({ tipo: 'documento', documentoTipo, documentoId })}
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
                turnoInicial={ventana.turno}
                fechaInicial={ventana.fecha}
                registrar={campo.registrar}
                onCerrar={() => setVentana(null)}
                onGuardado={guardado}
              />
            )}
            {ventana?.tipo === 'contar' && (
              <FormConteo estado={estado} estacion={estacion} yo={estado.yo} saldos={saldos} registrar={campo.registrar} onCerrar={() => setVentana(null)} onGuardado={guardado} />
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
