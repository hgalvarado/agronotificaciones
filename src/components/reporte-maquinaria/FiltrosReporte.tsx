import Link from 'next/link'
import { BotonImprimir } from '@/components/plan/BotonImprimir'
import type { FiltrosReporte as Filtros, OpcionesFiltro } from '@/lib/reporte-maquinaria/tipos'

/**
 * Filtros del visor público.
 *
 * Formulario GET a propósito: la dirección lleva el día y los filtros, se
 * puede mandar por WhatsApp y el que la abre ve exactamente el mismo
 * reporte. Nada de estado en el navegador, nada de JavaScript.
 *
 * Las opciones vienen ya recortadas por el servidor: aquí no se decide
 * qué es visible.
 */
export function FiltrosReporte({
  filtros,
  opciones,
  hoy,
}: {
  filtros: Filtros
  opciones: OpcionesFiltro
  hoy: string
}) {
  const clase =
    'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10'

  return (
    <form action="/reporte-maquinaria" className="flex flex-wrap items-end gap-2">
      <Etiqueta texto="Fecha">
        <input type="date" name="fecha" defaultValue={filtros.fecha} max={hoy} className={clase} />
      </Etiqueta>

      <Etiqueta texto="Departamento">
        <select name="departamento" defaultValue={filtros.departamento ?? ''} className={clase}>
          <option value="">Todos</option>
          {opciones.departamentos.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </select>
      </Etiqueta>

      <Etiqueta texto="Usuario">
        <select name="usuario" defaultValue={filtros.usuarioId ?? ''} className={clase}>
          <option value="">Todos</option>
          {opciones.usuarios.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </select>
      </Etiqueta>

      <Etiqueta texto="Ticket">
        <select name="ticket" defaultValue={filtros.ticketId ?? ''} className={clase}>
          <option value="">Todos</option>
          {opciones.tickets.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </select>
      </Etiqueta>

      <button
        type="submit"
        className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
      >
        Ver
      </button>

      <BotonImprimir />

      <Link
        href="/login"
        className="rounded-lg px-2.5 py-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
      >
        Ingresar
      </Link>
    </form>
  )
}

function Etiqueta({ texto, children }: { texto: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{texto}</span>
      {children}
    </label>
  )
}
