'use client'

/**
 * Devolver a bodega: sacar producto de la estación hacia Suministros, Bodega o Taller (fin de temporada, sobrante,
 * producto que no se usará). Es una salida del inventario que NO es consumo. Solo se puede devolver lo que hay en
 * la estación (la base rechaza lo que pase del saldo).
 */

import { useState } from 'react'
import { AreaTexto, Campo, Entrada } from '@/components/ui/Primitivos'
import { aEntradaLocal, ahoraIso, deEntradaLocal } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { cantidad } from '@/lib/fertirriego/calculos'
import {
  armarDevolucionBodega,
  DESTINOS_DEVOLUCION,
  primerExceso,
  SIN_PRODUCTOS_DEVOLUCION,
  type DestinoDevolucion,
} from '@/lib/fertirriego/devolucionBodega'
import { crearOperacion, nuevoId } from '@/lib/fertirriego/operaciones'
import type { EstadoCampo, Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import { EditorLineas, leerLineas, SIN_LINEAS, type LineaEditable } from './EditorLineas'
import { MarcoRegistro } from './MarcoRegistro'

export function FormDevolucionBodega({
  estado,
  estacion,
  yo,
  saldos,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  /** Saldo por producto de la estación (con lo pendiente de enviar). */
  saldos: Map<string, number>
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const borrador = useBorrador<{ fechaHora: string; destino: DestinoDevolucion | ''; motivo: string; lineas: LineaEditable[] }>(
    claveBorrador('devolucion_bodega', yo.id, estacion.id)
  )
  const b = borrador.inicial
  const [fechaHora, setFechaHora] = useState(b?.fechaHora ?? aEntradaLocal(ahoraIso()))
  const [destino, setDestino] = useState<DestinoDevolucion | ''>(b?.destino ?? '')
  const [motivo, setMotivo] = useState(b?.motivo ?? '')
  const [lineas, setLineas] = useState<LineaEditable[]>(b?.lineas ?? [{ clave: nuevoId(), material_id: '', cantidad: '' }])
  useAutoguardado(borrador, { fechaHora, destino, motivo, lineas })
  // Solo se devuelve lo que hay en la estación
  const conSaldo = estado.materiales.filter((m) => (saldos.get(m.id) ?? 0) > 0)
  const nombre = (id: string) => estado.materiales.find((m) => m.id === id)?.descripcion ?? 'un producto'

  return (
    <MarcoRegistro
      titulo="Devolver a bodega"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      rapido
      construir={({ ubicacion, enNombreDe }) => {
        if (!destino) return 'Elige a dónde se devuelve (Suministros, Bodega o Taller).'
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Indica la fecha y hora de la devolución.'
        if (Date.parse(fh) > Date.now() + 5 * 60_000) return 'La devolución no puede ser en el futuro.'
        const r = leerLineas(lineas)
        if ('error' in r) return r.error === SIN_LINEAS ? SIN_PRODUCTOS_DEVOLUCION : r.error
        const exceso = primerExceso(r.lineas, saldos)
        if (exceso) return `No puedes devolver más de lo que hay de ${nombre(exceso.material_id)}: en la estación hay ${cantidad(exceso.disponible)}.`
        const a = armarDevolucionBodega({ estacionId: estacion.id, destino, motivo, lineas: r.lineas, fechaHora: fh })
        if ('error' in a) return a.error
        const destinoNombre = DESTINOS_DEVOLUCION.find((d) => d.id === destino)?.nombre ?? destino
        return [
          crearOperacion('devolucion_bodega', a.datos, {
            ubicacion,
            enNombreDe,
            resumen: `Devolución a ${destinoNombre.toLowerCase()} · ${r.lineas.length} producto(s)`,
          }),
        ]
      }}
    >
      <Campo etiqueta="¿A dónde se devuelve?" requerido>
        <div className="grid grid-cols-3 gap-2" data-destinos-devolucion role="group" aria-label="Destino de la devolución">
          {DESTINOS_DEVOLUCION.map((d) => {
            const marcado = destino === d.id
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={marcado}
                data-destino={d.id}
                onClick={() => setDestino(d.id)}
                className={`min-h-12 rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-inset transition-colors ${
                  marcado ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'
                }`}
              >
                {marcado ? '✓ ' : ''}
                {d.nombre}
              </button>
            )
          })}
        </div>
      </Campo>
      <Campo etiqueta="Fecha y hora" requerido>
        <Entrada type="datetime-local" value={fechaHora} onChange={(e) => setFechaHora(e.target.value)} data-fecha-hora />
      </Campo>
      <Campo etiqueta="Motivo" requerido>
        <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ej. Fin de temporada" data-motivo-devolucion />
        <button
          type="button"
          onClick={() => setMotivo((m) => (m.trim() ? m : 'Fin de temporada'))}
          className="mt-1 min-h-11 rounded-lg px-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"
          data-motivo-sugerido
        >
          Usar «Fin de temporada»
        </button>
      </Campo>
      <Campo etiqueta="Productos a devolver" requerido>
        <EditorLineas materiales={conSaldo} lineas={lineas} onCambiar={setLineas} saldos={saldos} etiquetaCantidad="Devolver" />
      </Campo>
    </MarcoRegistro>
  )
}
