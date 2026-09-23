'use client'

/**
 * Los dos resúmenes de arriba: cuántas líneas hay de cada estado y en
 * qué departamento y centro de costo están las entregas abiertas.
 *
 * Son las preguntas que se hacen antes de mirar la tabla —«¿cuántos
 * números libres me quedan?», «¿cuántos teléfonos carga Contabilidad?»—
 * y contestarlas contando filas a mano es lo que hace que nadie las
 * conteste.
 *
 * Se calculan sobre las filas que ya están en la pantalla, no con otra
 * consulta: así siguen siendo ciertas en el mismo instante en que se
 * corrige una celda.
 */

import { useMemo } from 'react'
import { Tarjeta } from '@/components/ui/Primitivos'
import {
  agrupar,
  estaAbierta,
  etiquetaCentro,
  ESTADOS_LINEA,
  type FilaAsignacion,
  type FilaLinea,
  type Grupo,
} from '@/lib/telecom/tipos'

/* ================================================================== */
/* Líneas: cuántas hay de cada estado                                  */
/* ================================================================== */

const TONOS: Record<string, string> = {
  DISPONIBLE: 'text-emerald-700',
  ASIGNADA: 'text-brand-700',
  SUSPENDIDA: 'text-amber-700',
}

export function TarjetasLineas({ filas }: { filas: FilaLinea[] }) {
  const cuenta = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const f of filas) mapa.set(f.estado, (mapa.get(f.estado) ?? 0) + 1)
    return mapa
  }, [filas])

  const costo = useMemo(
    () =>
      filas
        .filter((f) => f.estado !== 'SUSPENDIDA')
        .reduce((a, f) => a + Number(f.plan_costo ?? 0), 0),
    [filas]
  )

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {ESTADOS_LINEA.map((e) => (
        <Tarjeta key={e.valor} className="px-3.5 py-3">
          <p className={`text-xl font-bold tracking-tight ${TONOS[e.valor] ?? 'text-slate-900'}`}>
            {cuenta.get(e.valor) ?? 0}
          </p>
          <p className="text-[11px] font-medium text-slate-400">{e.etiqueta}s</p>
        </Tarjeta>
      ))}
      <Tarjeta className="px-3.5 py-3">
        <p className="text-xl font-bold tracking-tight text-slate-900">L {costo.toFixed(2)}</p>
        <p className="text-[11px] font-medium text-slate-400">Al mes, sin suspendidas</p>
      </Tarjeta>
    </div>
  )
}

/* ================================================================== */
/* Asignaciones: dónde están las entregas abiertas                     */
/* ================================================================== */

export function ResumenAsignaciones({ filas }: { filas: FilaAsignacion[] }) {
  // Sólo las abiertas: una entrega finalizada no carga a nadie, y
  // contarla haría que Contabilidad pareciera tener nueve teléfonos
  // cuando tiene dos.
  const abiertas = useMemo(() => filas.filter(estaAbierta), [filas])

  const porDepartamento = useMemo(() => agrupar(abiertas, (f) => f.departamento), [abiertas])
  const porCentro = useMemo(
    () =>
      agrupar(abiertas, (f) =>
        f.centro_costo_etiqueta ?? etiquetaCentro(f.centro_costo, f.centro_costo_nombre)
      ),
    [abiertas]
  )

  if (abiertas.length === 0) return null

  return (
    <Tarjeta className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-sm font-bold text-slate-900">
          {abiertas.length} {abiertas.length === 1 ? 'entrega abierta' : 'entregas abiertas'}
        </h2>
        <p className="text-xs text-slate-400">
          Vigentes y en revisión. Las finalizadas no cargan a nadie y no se cuentan.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Columna titulo="Por departamento" grupos={porDepartamento} total={abiertas.length} />
        <Columna titulo="Por centro de costo" grupos={porCentro} total={abiertas.length} />
      </div>
    </Tarjeta>
  )
}

/**
 * Una lista de grupos con su barra.
 *
 * La barra es proporcional al grupo más grande y no al total: con doce
 * departamentos, todas las barras contra el total serían astillas
 * indistinguibles.
 */
function Columna({
  titulo,
  grupos,
  total,
}: {
  titulo: string
  grupos: Grupo[]
  total: number
}) {
  const tope = Math.max(...grupos.map((g) => g.cuantos), 1)

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{titulo}</h3>

      {grupos.length === 0 ? (
        <p className="text-xs text-slate-400">Sin datos.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {grupos.map((g) => (
            <li key={g.clave} className="flex flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-semibold text-slate-700">
                  {g.clave}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">
                  {g.cuantos}
                  <span className="ml-1 text-slate-400">
                    {Math.round((g.cuantos / total) * 100)}%
                  </span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-600"
                  style={{ width: `${(g.cuantos / tope) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
