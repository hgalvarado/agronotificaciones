'use client'

/**
 * Pestaña «General» de Fertirriego: por estación, cuánto cabe de cada solución (Calcio, Vegetativa, Generativa…), cuánto
 * hay y cuánto puede recibir, con el préstamo de tanque Vegetativa↔Generativa ya sumado. Las tarjetas van contraídas y las
 * más críticas (más llenas) arriba. Solo lectura; el único botón (uno por tarjeta) declara el préstamo.
 */

import { useMemo, useState } from 'react'
import { Insignia, Boton } from '@/components/ui/Primitivos'
import { IconChevronRight } from '@/components/ui/Icons'
import { capacidadesDeEstacion, resumenDeNiveles, type CapacidadSolucion } from '@/lib/fertirriego/capacidad'
import type { EstadoCampo, Estacion } from '@/lib/fertirriego/tipos'
import { MedidorCapacidad } from './MedidorCapacidad'

export function VistaGeneralCapacidad({
  estado,
  saldosPorEstacion,
  enLinea,
  onPrestar,
}: {
  estado: EstadoCampo
  /** Saldo por estación y material (incluye lo pendiente de enviar). */
  saldosPorEstacion: Map<string, Map<string, number>>
  enLinea: boolean
  onPrestar: (estacion: Estacion) => void
}) {
  const [abiertas, setAbiertas] = useState<string[]>([])
  const nombre = (id: string) => estado.materiales.find((m) => m.id === id)?.descripcion ?? 'Solución'
  const unidad = (id: string) => estado.materiales.find((m) => m.id === id)?.unidad ?? 'L'

  const tarjetas = useMemo(() => {
    return estado.estaciones
      .map((e) => {
        const caps = capacidadesDeEstacion(estado.capacidades, e.id)
        const saldos = saldosPorEstacion.get(e.id) ?? new Map<string, number>()
        const filas = [...caps.values()]
          .filter((c) => c.capacidad_base > 0)
          .map((c) => ({ c, saldo: saldos.get(c.material_id) ?? 0 }))
          .sort((a, b) => nombre(a.c.material_id).localeCompare(nombre(b.c.material_id), 'es'))
        const total = resumenDeNiveles(filas.map((f) => ({ saldo: f.saldo, capacidad: f.c.capacidad })))
        // Lo más crítico de cualquier solución (no el promedio): una solución llena ya es problema
        const peor = Math.max(-1, ...filas.map((f) => resumenDeNiveles([{ saldo: f.saldo, capacidad: f.c.capacidad }]).puntos))
        return { e, caps, filas, total, peor }
      })
      .filter((t) => t.filas.length > 0)
      .sort((a, b) => b.peor - a.peor || a.e.nombre.localeCompare(b.e.nombre, 'es', { numeric: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- el nombre sale de estado.materiales
  }, [estado.estaciones, estado.capacidades, estado.materiales, saldosPorEstacion])

  if (!Array.isArray(estado.capacidades)) {
    return <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600 ring-1 ring-inset ring-slate-200">Aún no hay capacidades. AGL las publica.</p>
  }
  if (tarjetas.length === 0) {
    return <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600 ring-1 ring-inset ring-slate-200">Sin capacidades para tus estaciones.</p>
  }

  return (
    <div className="flex flex-col gap-2" data-vista-general-capacidad>
      {tarjetas.map(({ e, caps, filas, total, peor }) => {
        const abierta = abiertas.includes(e.id)
        return (
          <section key={e.id} data-tarjeta-capacidad={e.nombre} className="flex flex-col gap-2">
            <button
              type="button"
              aria-expanded={abierta}
              onClick={() => setAbiertas((a) => (abierta ? a.filter((x) => x !== e.id) : [...a, e.id]))}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-left active:bg-slate-200"
            >
              <IconChevronRight className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${abierta ? 'rotate-90' : ''}`} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                {e.nombre}
                {e.zona ? <span className="ml-1 font-normal text-slate-600">· {e.zona}</span> : null}
              </span>
              {peor >= 100 ? <Insignia tono="rojo">Lleno</Insignia> : peor >= 85 ? <Insignia tono="ambar">Casi lleno</Insignia> : null}
              <span className="shrink-0 text-xs tabular-nums text-slate-600">{total.pct === null ? '' : `${total.pct} %`}</span>
            </button>
            {abierta && (
              <div className="flex flex-col gap-3 rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200">
                {filas.map(({ c, saldo }) => (
                  <MedidorCapacidad
                    key={c.material_id}
                    etiqueta={nombre(c.material_id)}
                    saldo={saldo}
                    capacidad={c.capacidad}
                    unidad={unidad(c.material_id)}
                    nota={notaPrestamo(c, nombre)}
                  />
                ))}
                {e.permisos.capacidad && [...caps.values()].some((c) => c.prestable_con) && (
                  <Boton tamano="sm" variante="secundario" className="min-h-11 self-start" disabled={!enLinea} onClick={() => onPrestar(e)} data-prestar-tanque>
                    {enLinea ? 'Prestar tanque' : 'Prestar tanque (necesita señal)'}
                  </Boton>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function notaPrestamo(c: CapacidadSolucion, nombre: (id: string) => string): string | null {
  if (c.cede_a) return `Su tanque llena ${nombre(c.cede_a)}`
  if (c.recibe_de) return `Usa también el tanque de ${nombre(c.recibe_de)}`
  return null
}
