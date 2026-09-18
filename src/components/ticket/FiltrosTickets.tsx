'use client'

/**
 * El panel de filtros del historial de tickets.
 *
 * Es una hoja que se abre desde la lista y no una barra siempre visible:
 * en la columna de tickets —que en el teléfono ocupa la pantalla entera—
 * cuatro selectores permanentes dejarían sitio para dos tickets.
 *
 * Sólo pantalla. No consulta nada ni decide nada: recibe lo que hay para
 * elegir y devuelve lo elegido; quien la abre es el que vuelve a
 * preguntarle a la base.
 */

import { useMemo, useState } from 'react'
import { Boton } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { ESTADOS_TICKET, PROCESOS } from '@/lib/estados'
import { cuantosFiltros, nombreDelMes, type Capturador, type FiltrosTickets } from '@/lib/tickets/tipos'

export function BotonFiltros({
  filtros,
  meses,
  capturadores,
  onCambiar,
}: {
  filtros: FiltrosTickets
  /** Los meses que de verdad tienen tickets, del más reciente al más viejo. */
  meses: string[]
  capturadores: Capturador[]
  onCambiar: (f: FiltrosTickets) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const puestos = cuantosFiltros(filtros)

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold transition-colors ${
          puestos > 0
            ? 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-300'
            : 'text-slate-500 hover:bg-slate-100'
        }`}
      >
        Filtros
        {puestos > 0 && (
          <span className="rounded-full bg-brand-700 px-1.5 text-xs font-bold text-white">
            {puestos}
          </span>
        )}
      </button>

      {abierto && (
        <PanelFiltrosTickets
          filtros={filtros}
          meses={meses}
          capturadores={capturadores}
          onCambiar={onCambiar}
          onCerrar={() => setAbierto(false)}
        />
      )}
    </>
  )
}

function PanelFiltrosTickets({
  filtros,
  meses,
  capturadores,
  onCambiar,
  onCerrar,
}: {
  filtros: FiltrosTickets
  meses: string[]
  capturadores: Capturador[]
  onCambiar: (f: FiltrosTickets) => void
  onCerrar: () => void
}) {
  // Se trabaja sobre un borrador y se aplica al final: cada cambio vuelve
  // a consultar la base, y cambiar cuatro filtros de uno en uno serían
  // cuatro viajes para una sola pregunta.
  const [borrador, setBorrador] = useState(filtros)

  const opcionesMes = useMemo(
    () => meses.map((m) => ({ valor: m, etiqueta: nombreDelMes(m) })),
    [meses]
  )
  const opcionesUsuario = useMemo(
    () =>
      capturadores.map((c) => ({
        valor: c.usuario_id,
        etiqueta: `${c.nombre} · ${c.cuantos}`,
      })),
    [capturadores]
  )
  const opcionesProceso = PROCESOS.map((p) => ({
    valor: p.valor,
    etiqueta: `${p.numero}. ${p.etiqueta}`,
  }))
  const opcionesEstado = ESTADOS_TICKET.map((e) => ({ valor: e.valor, etiqueta: e.etiqueta }))

  function aplicar() {
    onCambiar(borrador)
    onCerrar()
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo="Filtrar tickets"
      pie={
        <div className="flex gap-2">
          <Boton
            variante="secundario"
            className="flex-1"
            onClick={() => setBorrador({ ...borrador, meses: [], usuarios: [], procesos: [], estados: [] })}
          >
            Limpiar
          </Boton>
          <Boton className="flex-1" onClick={aplicar}>
            Aplicar
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">
          Los filtros buscan en <strong>todo el historial</strong>, no sólo en lo que está a la
          vista. Cada selector trae buscador y se puede poner en «Varios».
        </p>

        <SelectorMultiple
          etiqueta="Mes"
          opciones={opcionesMes}
          valores={borrador.meses}
          onCambiar={(v) => setBorrador({ ...borrador, meses: v })}
        />
        <SelectorMultiple
          etiqueta="Capturó"
          opciones={opcionesUsuario}
          valores={borrador.usuarios}
          onCambiar={(v) => setBorrador({ ...borrador, usuarios: v })}
        />
        <SelectorMultiple
          etiqueta="Proceso"
          opciones={opcionesProceso}
          valores={borrador.procesos}
          onCambiar={(v) => setBorrador({ ...borrador, procesos: v })}
        />
        <SelectorMultiple
          etiqueta="Estado"
          opciones={opcionesEstado}
          valores={borrador.estados}
          onCambiar={(v) => setBorrador({ ...borrador, estados: v })}
        />
      </div>
    </Modal>
  )
}
