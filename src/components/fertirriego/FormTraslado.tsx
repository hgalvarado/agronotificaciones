'use client'

/**
 * Nuevo traslado a otra estación: destino (primero las de la misma zona), motivo, quién lo autoriza y productos.
 * No mueve la bodega hasta que lo autoricen; autorizado, sale de aquí y queda «en camino» hasta que el destino lo
 * acepte (con lo que de verdad llegó) o lo rechace (vuelve).
 */

import { useState } from 'react'
import { Alerta, AreaTexto, Campo } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { crearOperacion, nuevoId } from '@/lib/fertirriego/operaciones'
import type { EstadoCampo, Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import { EditorLineas, leerLineas, type LineaEditable } from './EditorLineas'
import { MarcoRegistro } from './MarcoRegistro'

export function FormTraslado({
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
  saldos: Map<string, number>
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const destinos = (estado.destinos ?? []).filter((d) => d.id !== estacion.id)
  const autorizadores = (estacion.autorizadores ?? []).filter((a) => a.id !== yo.id)
  const [destino, setDestino] = useState('')
  const [autorizador, setAutorizador] = useState(autorizadores.length === 1 ? autorizadores[0].id : '')
  const [motivo, setMotivo] = useState('')
  const [lineas, setLineas] = useState<LineaEditable[]>([{ clave: nuevoId(), material_id: '', cantidad: '' }])
  const conSaldo = estado.materiales.filter((m) => (saldos.get(m.id) ?? 0) > 0)

  return (
    <MarcoRegistro
      titulo="Trasladar a otra estación"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      textoGuardar="Enviar a autorizar"
      construir={({ ubicacion, enNombreDe }) => {
        if (!destino) return 'Elige la estación de destino.'
        if (!autorizador) return 'Elige quién autoriza el traslado.'
        if (!motivo.trim()) return 'Escribe el motivo del traslado.'
        const r = leerLineas(lineas)
        if ('error' in r) return r.error
        const falta = r.lineas.find((l) => l.cantidad > (saldos.get(l.material_id) ?? 0))
        if (falta) return `No alcanza ${estado.materiales.find((m) => m.id === falta.material_id)?.descripcion ?? 'un producto'} en bodega para trasladar.`
        return [
          crearOperacion(
            'traslado_crear',
            { origen_id: estacion.id, destino_id: destino, autorizador_id: autorizador, motivo: motivo.trim(), lineas: r.lineas },
            { ubicacion, enNombreDe, resumen: `Traslado a ${destinos.find((d) => d.id === destino)?.nombre ?? 'otra estación'} · ${r.lineas.length} producto(s)` }
          ),
        ]
      }}
    >
      {autorizadores.length === 0 && (
        <Alerta tono="ambar">Nadie tiene «Autorizar traslado» para esta estación. Pide al administrador que lo configure en Permisos.</Alerta>
      )}
      <Campo etiqueta="Estación de destino" requerido>
        <div data-selector-destino>
          <SelectorBuscable
            valor={destino}
            opciones={destinos.map((d) => ({ id: d.id, titulo: d.nombre, subtitulo: `${d.zona ?? ''}${d.misma_zona ? '' : ' · otra zona'}` }))}
            onCambiar={setDestino}
            placeholder="Elegir estación…"
            etiquetaBusqueda="Buscar estación"
          />
        </div>
      </Campo>
      <Campo etiqueta="¿Quién lo autoriza?" requerido>
        <div data-selector-autorizador>
          <SelectorBuscable
            valor={autorizador}
            opciones={autorizadores.map((a) => ({ id: a.id, titulo: a.nombre }))}
            onCambiar={setAutorizador}
            placeholder="Elegir persona…"
            etiquetaBusqueda="Buscar persona"
          />
        </div>
      </Campo>
      <Campo etiqueta="Motivo" requerido>
        <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ej. a Zamora se le acabó el calcio" data-motivo-traslado />
      </Campo>
      <Campo etiqueta="Productos" requerido>
        <EditorLineas materiales={conSaldo} lineas={lineas} onCambiar={setLineas} saldos={saldos} etiquetaCantidad="Enviar" />
      </Campo>
    </MarcoRegistro>
  )
}
