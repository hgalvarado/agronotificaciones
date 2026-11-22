'use client'

/**
 * Historial de Inyección de la estación (últimos 120 días): lo que ya llegó a la base y lo que todavía está por
 * enviar. Anular solo con «Anular» (la base lo vuelve a comprobar). Sin pantalla de reportes: el cumplimiento y la
 * tendencia son de AGL.
 */

import { useState } from 'react'
import { AreaTexto, Boton, Campo, Insignia } from '@/components/ui/Primitivos'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'
import { formatearFechaHora } from '@/lib/estados'
import { cantidad } from '@/lib/fertirriego/calculos'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import { OBJETIVOS } from '@/lib/inyeccion/aplicarLote'
import { type AplicacionInyeccion, type EstadoInyeccion, historialDeEstacion } from '@/lib/inyeccion/estado'

const nombreObjetivo = (id: string) => OBJETIVOS.find((o) => o.id === id)?.nombre ?? id

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
  nombreProducto,
  registrar,
  onGuardado,
}: {
  estado: EstadoInyeccion
  cola: Operacion[]
  estacion: Estacion
  yo: Persona
  puedeAnular: boolean
  nombreProducto: (id: string) => string
  registrar: (...ops: Operacion[]) => Promise<void>
  onGuardado: (m: string) => void
}) {
  const [anulando, setAnulando] = useState<AplicacionInyeccion | null>(null)
  const filas = historialDeEstacion(estado, estacion.id)
  const pendientes = cola.filter((o) => o.tipo === 'aplicacion_lote' && o.datos.estacion_id === estacion.id && o.estado_local !== 'ACEPTADO')

  return (
    <div className="flex flex-col gap-2" data-historial-inyeccion>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Historial (120 días)</p>
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
        <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">Todavía no hay aplicaciones por lote en esta estación.</p>
      )}
      {filas.map((a) => (
        <div key={a.id} className={`rounded-xl bg-white p-3 ring-1 ring-inset ${a.anulado_at ? 'ring-slate-200 opacity-70' : 'ring-slate-200'}`} data-aplicacion-lote={a.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-800">{a.lote}</p>
            <span className="flex flex-wrap gap-1">
              {a.anulado_at && <Insignia tono="rojo">Anulada</Insignia>}
              {a.lineas.some((l) => !l.en_plan) && <Insignia tono="ambar">Sin plan</Insignia>}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {formatearFechaHora(a.fecha_hora)} · {cantidad(a.area_mz)} mz · {a.objetivos.map(nombreObjetivo).join(', ')}
          </p>
          <ul className="mt-1 text-xs text-slate-700">
            {a.lineas.map((l) => (
              <li key={l.material_id}>
                {nombreProducto(l.material_id)}: <strong>{cantidad(l.cantidad)}</strong>
                {l.dosis_mz !== null ? ` (${cantidad(l.dosis_mz)}/mz)` : ''}
              </li>
            ))}
          </ul>
          {a.anulado_at && a.motivo_anulacion && <p className="mt-1 text-xs text-red-700">Motivo: {a.motivo_anulacion}</p>}
          {puedeAnular && estacion.permisos.anular && !a.anulado_at && (
            <Boton tamano="sm" variante="peligro" className="mt-2" onClick={() => setAnulando(a)} data-anular-aplicacion-lote>
              Anular
            </Boton>
          )}
        </div>
      ))}
      {anulando && (
        <FormAnular aplicacion={anulando} estacion={estacion} yo={yo} registrar={registrar} onCerrar={() => setAnulando(null)} onGuardado={onGuardado} />
      )}
    </div>
  )
}
