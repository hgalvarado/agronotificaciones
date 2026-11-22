'use client'

/**
 * AgroMétricas › «Mis registros»: lo que ESTA persona guardó desde ESTE teléfono (cola + rechazados + historial local
 * en IndexedDB). Solo presentación: la lista ya viene armada (lib/agrometricas/historialPura.ts). Sin señal funciona igual.
 */

import { useMemo, useState } from 'react'
import { Insignia, Boton, type Tono } from '@/components/ui/Primitivos'
import { Acordeon } from '@/components/ui/Acordeon'
import { ayerIso, hoyIso } from '@/lib/fechas/zona'
import { VISTA_INICIAL, agruparPorDia, horaLocal, type Estado, type ItemVista } from '@/lib/agrometricas/historialPura'

const ESTADOS: Record<Estado, { texto: string; tono: Tono }> = {
  sin_enviar: { texto: 'Sin enviar', tono: 'ambar' },
  enviado: { texto: 'Enviado', tono: 'verde' },
  rechazado: { texto: 'Rechazado', tono: 'rojo' },
}

export function MisRegistros({ items }: { items: ItemVista[] }) {
  const [abierto, setAbierto] = useState(false)
  const [todos, setTodos] = useState(false)
  const grupos = useMemo(() => agruparPorDia(items, hoyIso(), ayerIso(), todos ? Infinity : VISTA_INICIAL), [items, todos])
  const sinEnviar = items.filter((i) => i.estado === 'sin_enviar').length
  const rechazados = items.filter((i) => i.estado === 'rechazado').length

  return (
    <div data-mis-registros>
      <Acordeon titulo="Mis registros" abierto={abierto} onAlternar={() => setAbierto((a) => !a)}
        resumen={<Insignia tono={rechazados ? 'rojo' : sinEnviar ? 'ambar' : 'gris'}>{items.length}</Insignia>}>
        <div className="flex flex-col gap-3 px-3.5 pb-4">
          {!items.length && <p className="text-sm text-slate-500">Aún no has guardado registros en este teléfono.</p>}
          {grupos.map((g) => (
            <section key={g.dia} className="flex flex-col gap-2" data-dia={g.dia}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.etiqueta}</h3>
              {g.items.map((i) => (
                <div key={i.id} data-registro={i.estado} className="flex flex-col gap-1 rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-sm font-semibold text-slate-900">
                      {i.vista.turno}{i.vista.ddt != null ? ` · DDT ${i.vista.ddt}` : ''}
                    </p>
                    <Insignia tono={ESTADOS[i.estado].tono} punto>{ESTADOS[i.estado].texto}</Insignia>
                  </div>
                  <p className="text-xs text-slate-500">
                    {[horaLocal(i.cuando), i.vista.lugar, i.vista.fecha && i.vista.fecha !== g.dia ? `jornada ${i.vista.fecha}` : ''].filter(Boolean).join(' · ')}
                  </p>
                  {i.vista.datos.length > 0 && <p className="text-sm text-slate-700">{i.vista.datos.join(' · ')}</p>}
                  {i.mensaje && <p className="text-sm text-red-700">{i.mensaje}</p>}
                </div>
              ))}
            </section>
          ))}
          {!todos && items.length > VISTA_INICIAL && (
            <Boton type="button" tamano="md" variante="secundario" onClick={() => setTodos(true)}>Ver más ({items.length - VISTA_INICIAL})</Boton>
          )}
        </div>
      </Acordeon>
    </div>
  )
}
