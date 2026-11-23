'use client'

/**
 * Historial de Inyección de la estación (últimos 120 días): lo que ya llegó a la base y lo que todavía está por
 * enviar. Anular solo con «Anular» (la base lo vuelve a comprobar). Sin pantalla de reportes: el cumplimiento y la
 * tendencia son de AGL.
 */

import { useMemo, useState } from 'react'
import { AreaTexto, Boton, Campo, Insignia } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'
import { EliminarPorCompleto } from '@/components/fertirriego/EliminarPorCompleto'
import { formatearFechaHora } from '@/lib/estados'
import { cantidad } from '@/lib/fertirriego/calculos'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import { hoyIso } from '@/lib/fechas/zona'
import type { Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import { type AplicacionInyeccion, type EstadoInyeccion, historialDeEstacion, objetivosDeLinea } from '@/lib/inyeccion/estado'


function FormAnular({
  aplicacion,
  estacion,
  yo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  aplicacion: AplicacionInyeccion
  estacion: Estacion
  yo: Persona
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const [motivo, setMotivo] = useState('')
  return (
    <MarcoRegistro
      titulo="Anular aplicación por lote"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      permiso="anular"
      sinCustodia
      textoGuardar="Anular"
      construir={({ ubicacion, enNombreDe }) => {
        if (!motivo.trim()) return 'Escribe por qué se anula.'
        return [
          crearOperacion(
            'anulacion',
            { estacion_id: estacion.id, documento_tipo: 'aplicacion_lote', documento_id: aplicacion.id, motivo: motivo.trim() },
            { ubicacion, enNombreDe, resumen: `Anulación · Inyección por lote · ${aplicacion.lote}` }
          ),
        ]
      }}
    >
      <p className="text-sm text-slate-700">
        Lote <strong>{aplicacion.lote}</strong> · {aplicacion.fecha}. Los productos vuelven al inventario de la estación.
      </p>
      <Campo etiqueta="Motivo" requerido>
        <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} data-motivo-anulacion />
      </Campo>
    </MarcoRegistro>
  )
}

export function VistaHistorialInyeccion({
  estado,
  cola,
  estacion,
  yo,
  puedeAnular,
  puedeEliminar = false,
  nombreProducto,
  registrar,
  onGuardado,
  onEliminado,
}: {
  estado: EstadoInyeccion
  cola: Operacion[]
  estacion: Estacion
  yo: Persona
  puedeAnular: boolean
  /** sql/140: «Eliminar por completo» (solo con el permiso; en línea). */
  puedeEliminar?: boolean
  nombreProducto: (id: string) => string
  registrar: (...ops: Operacion[]) => Promise<void>
  onGuardado: (m: string) => void
  onEliminado?: (mensaje: string) => void
}) {
  const [anulando, setAnulando] = useState<AplicacionInyeccion | null>(null)
  const [eliminando, setEliminando] = useState<AplicacionInyeccion | null>(null)
  const [rango, setRango] = useState<'todo' | 'hoy' | '7' | '30'>('todo')
  const [loteFiltro, setLoteFiltro] = useState('')
  const todas = useMemo(() => historialDeEstacion(estado, estacion.id), [estado, estacion.id])
  const filas = useMemo(() => {
    const hoy = hoyIso()
    const desde = rango === 'todo' ? '' : rango === 'hoy' ? hoy : new Date(Date.parse(`${hoy}T12:00:00Z`) - Number(rango) * 86_400_000).toISOString().slice(0, 10)
    return todas.filter((a) => (!desde || a.fecha >= desde) && (!loteFiltro || a.lote === loteFiltro))
  }, [todas, rango, loteFiltro])
  const lotesEnHistorial = useMemo(() => [...new Set(todas.map((a) => a.lote))].sort((x, y) => x.localeCompare(y, 'es', { numeric: true })), [todas])
  const pendientes = cola.filter((o) => o.tipo === 'aplicacion_lote' && o.datos.estacion_id === estacion.id && o.estado_local !== 'ACEPTADO')

  return (
    <div className="flex flex-col gap-2" data-historial-inyeccion>
      {todas.length > 0 && (
        <div className="flex flex-col gap-2" data-filtros-historial>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Periodo">
            {([['todo', 'Todo'], ['hoy', 'Hoy'], ['7', '7 días'], ['30', '30 días']] as const).map(([v, t]) => (
              <button
                key={v}
                type="button"
                aria-pressed={rango === v}
                onClick={() => setRango(v)}
                data-rango-historial={v}
                className={`min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-inset ${rango === v ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <SelectorBuscable
            valor={loteFiltro}
            opciones={lotesEnHistorial.map((l) => ({ id: l, titulo: l }))}
            onCambiar={setLoteFiltro}
            placeholder="Todos los lotes"
            etiquetaBusqueda="Buscar lote"
            textoVacio="Todos los lotes"
          />
        </div>
      )}
      {pendientes.map((o) => (
        <div key={o.id} className="rounded-xl bg-white p-3 ring-1 ring-inset ring-amber-300" data-aplicacion-pendiente>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-800">{o.resumen}</p>
            <Insignia tono={o.estado_local === 'RECHAZADO' ? 'rojo' : 'ambar'}>{o.estado_local === 'RECHAZADO' ? 'Rechazado' : 'Por enviar'}</Insignia>
          </div>
          {o.estado_local === 'RECHAZADO' && o.mensaje && <p className="mt-1 text-xs text-red-700">{o.mensaje}</p>}
        </div>
      ))}
      {filas.length === 0 && pendientes.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">
          {todas.length === 0 ? 'Todavía no hay aplicaciones por lote en esta estación.' : 'No hay aplicaciones con ese filtro.'}
        </p>
      )}
      {filas.map((a) => (
        <div key={a.id} className={`rounded-xl bg-white p-3 ring-1 ring-inset ${a.anulado_at ? 'ring-slate-200 opacity-70' : 'ring-slate-200'}`} data-aplicacion-lote={a.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-800">{a.lote}</p>
            <span className="flex flex-wrap gap-1">
              {a.anulado_at && <Insignia tono="rojo">Anulada</Insignia>}
              {a.observaciones?.includes('REGISTRO_HISTORICO') && <Insignia tono="azul">Histórico</Insignia>}
              {a.lineas.some((l) => !l.en_plan) && <Insignia tono="ambar">Sin plan</Insignia>}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {formatearFechaHora(a.fecha_hora)} · {cantidad(a.area_mz)} mz
          </p>
          <ul className="mt-1 text-xs text-slate-700">
            {a.lineas.map((l) => (
              <li key={l.material_id}>
                {nombreProducto(l.material_id)}: <strong>{cantidad(l.cantidad)}</strong>
                {l.dosis_mz !== null ? ` (${cantidad(l.dosis_mz)}/mz)` : ''}
                {objetivosDeLinea(a, l).length > 0 && <span className="text-slate-500"> · {objetivosDeLinea(a, l).join(', ')}</span>}
              </li>
            ))}
          </ul>
          {a.anulado_at && a.motivo_anulacion && <p className="mt-1 text-xs text-red-700">Motivo: {a.motivo_anulacion}</p>}
          {puedeEliminar && onEliminado && (
            <Boton tamano="sm" variante="peligro" className="mt-2 ml-2" onClick={() => setEliminando(a)} data-eliminar-por-completo-iny>
              Eliminar por completo
            </Boton>
          )}
          {puedeAnular && estacion.permisos.anular && !a.anulado_at && (
            <Boton tamano="sm" variante="peligro" className="mt-2" onClick={() => setAnulando(a)} data-anular-aplicacion-lote>
              Anular
            </Boton>
          )}
        </div>
      ))}
      {eliminando && (
        <EliminarPorCompleto
          tipo="iny_aplicacion"
          documentoId={eliminando.id}
          descripcion={`Inyección por lote · ${eliminando.lote} · ${eliminando.fecha}`}
          onCerrar={() => setEliminando(null)}
          onEliminado={(m) => {
            setEliminando(null)
            onEliminado?.(m)
          }}
        />
      )}
      {anulando && (
        <FormAnular aplicacion={anulando} estacion={estacion} yo={yo} registrar={registrar} onCerrar={() => setAnulando(null)} onGuardado={onGuardado} />
      )}
    </div>
  )
}
