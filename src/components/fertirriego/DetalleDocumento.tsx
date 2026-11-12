'use client'

/**
 * El detalle de un registro (recepción, aplicación, conteo, devolución) con sus dos salidas:
 *   - Anular (con motivo): el original queda visible; se asienta el movimiento contrario.
 *   - Devolver a bodega (solo aplicaciones): el sobrante que no se usó.
 * La base decide si se puede (autor en su jornada, o quien tiene «Anular»); aquí solo se ofrece lo posible.
 */

import { useState } from 'react'
import { Alerta, AreaTexto, Campo } from '@/components/ui/Primitivos'
import { formatearFechaHora } from '@/lib/estados'
import { NOMBRE_MOVIMIENTO, cantidad } from '@/lib/fertirriego/calculos'
import { crearOperacion, nuevoId } from '@/lib/fertirriego/operaciones'
import type { EstadoCampo, Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import { EditorLineas, leerLineas, type LineaEditable } from './EditorLineas'
import { MarcoRegistro } from './MarcoRegistro'

const NOMBRE_DOC: Record<string, string> = {
  recepcion: 'Recepción',
  aplicacion: 'Aplicación',
  conteo: 'Conteo',
  devolucion: 'Devolución',
}

export function DetalleDocumento({
  estado,
  estacion,
  yo,
  documentoTipo,
  documentoId,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  documentoTipo: string
  documentoId: string
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const [modo, setModo] = useState<'anular' | 'devolver'>('anular')
  const [motivo, setMotivo] = useState('')
  const movs = estado.movimientos.filter((m) => m.documento_id === documentoId)
  const material = (id: string) => estado.materiales.find((m) => m.id === id)
  const anulado = movs.some((m) => estado.movimientos.some((x) => x.anula_id === m.id))
  const recepcion = estado.recepciones.find((r) => r.id === documentoId)
  const aplicacion = estado.aplicaciones.find((a) => a.id === documentoId)
  const autor = recepcion?.registrado_por ?? aplicacion?.registrado_por ?? movs[0]?.registrado_por
  const suyo = autor === yo.id
  const puedeAnular = !anulado && (estacion.permisos.anular || suyo) && movs.length > 0
  const puedeDevolver = documentoTipo === 'aplicacion' && !anulado && !!aplicacion
  const [lineas, setLineas] = useState<LineaEditable[]>(() =>
    (aplicacion?.lineas ?? []).map((l) => ({ clave: nuevoId(), material_id: l.material_id, cantidad: '' }))
  )

  return (
    <MarcoRegistro
      titulo={NOMBRE_DOC[documentoTipo] ?? 'Registro'}
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      textoGuardar={modo === 'anular' ? 'Anular' : 'Devolver a bodega'}
      // Quien tiene «Anular» anula sin tener la estación a cargo (como en la base); el autor, en su jornada
      sinCustodia={modo === 'anular' && estacion.permisos.anular}
      permiso="anular"
      construir={({ ubicacion, enNombreDe }) => {
        if (!motivo.trim()) return modo === 'anular' ? 'Escribe por qué se anula.' : 'Escribe por qué sobró.'
        if (modo === 'anular') {
          if (!puedeAnular) return 'No puedes anular este registro.'
          return [
            crearOperacion(
              'anulacion',
              { estacion_id: estacion.id, documento_tipo: documentoTipo, documento_id: documentoId, motivo: motivo.trim() },
              { ubicacion, enNombreDe, resumen: `Anulación · ${NOMBRE_DOC[documentoTipo] ?? documentoTipo}` }
            ),
          ]
        }
        const r = leerLineas(lineas)
        if ('error' in r) return r.error
        return [
          crearOperacion(
            'devolucion',
            { estacion_id: estacion.id, aplicacion_id: documentoId, motivo: motivo.trim(), lineas: r.lineas },
            { ubicacion, enNombreDe, resumen: `Devolución a bodega · ${r.lineas.length} producto(s)` }
          ),
        ]
      }}
    >
      <div className="rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200" data-detalle-documento>
        {recepcion && (
          <p className="text-slate-600">
            {formatearFechaHora(recepcion.fecha_hora)} · entregó {estado.choferes.find((c) => c.id === recepcion.chofer_id)?.nombre ?? '—'}
            {recepcion.vehiculo_id ? ` (${estado.vehiculos.find((v) => v.id === recepcion.vehiculo_id)?.placa ?? ''})` : ''}
            {recepcion.documento ? ` · doc. ${recepcion.documento}` : ''}
          </p>
        )}
        {aplicacion && (
          <p className="text-slate-600">
            Turno {estado.turnos.find((t) => t.id === aplicacion.turno_ciclo_id)?.turno ?? '—'} · día {aplicacion.fecha}
          </p>
        )}
        <ul className="mt-1">
          {movs.map((m) => (
            <li key={m.id} className="flex justify-between gap-2">
              <span>
                {NOMBRE_MOVIMIENTO[m.tipo]} · {material(m.material_id)?.descripcion ?? '—'}
              </span>
              <strong className={m.cantidad < 0 ? 'text-red-700' : 'text-brand-700'}>
                {m.cantidad > 0 ? '+' : ''}
                {cantidad(m.cantidad)} {material(m.material_id)?.unidad ?? ''}
              </strong>
            </li>
          ))}
        </ul>
        {anulado && <p className="mt-1 font-semibold text-red-700">Anulado{recepcion?.motivo_anulacion || aplicacion?.motivo_anulacion ? `: ${recepcion?.motivo_anulacion ?? aplicacion?.motivo_anulacion}` : ''}</p>}
      </div>

      {(puedeAnular || puedeDevolver) && (
        <div className="flex gap-2" role="tablist">
          {puedeAnular && (
            <button type="button" role="tab" aria-selected={modo === 'anular'} onClick={() => setModo('anular')} className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${modo === 'anular' ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200'}`}>
              Anular
            </button>
          )}
          {puedeDevolver && (
            <button type="button" role="tab" aria-selected={modo === 'devolver'} onClick={() => setModo('devolver')} data-modo-devolver className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${modo === 'devolver' ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200'}`}>
              Devolver sobrante
            </button>
          )}
        </div>
      )}
      {!puedeAnular && !puedeDevolver && !anulado && (
        <Alerta tono="ambar">Solo quien lo registró (en su jornada) o quien tiene «Anular» puede anularlo.</Alerta>
      )}

      {modo === 'devolver' && puedeDevolver && (
        <Campo etiqueta="Lo que vuelve a la bodega">
          <EditorLineas materiales={estado.materiales.filter((m) => aplicacion!.lineas?.some((l) => l.material_id === m.id))} lineas={lineas} onCambiar={setLineas} etiquetaCantidad="Devuelto" />
        </Campo>
      )}
      {(puedeAnular || puedeDevolver) && (
        <Campo etiqueta={modo === 'anular' ? 'Motivo de la anulación' : 'Motivo (por qué sobró)'} requerido>
          <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} data-motivo />
        </Campo>
      )}
    </MarcoRegistro>
  )
}
