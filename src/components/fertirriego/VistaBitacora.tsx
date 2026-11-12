'use client'

/**
 * Bitácora (kardex) de la estación: cada movimiento con su entrada, salida y saldo, agrupado por día (lo más
 * reciente arriba). Lo pendiente de enviar sale marcado. Tocar una fila abre el registro (anular / devolver).
 */

import { useMemo } from 'react'
import { Insignia } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { NOMBRE_MOVIMIENTO, cantidad, kardex } from '@/lib/fertirriego/calculos'
import type { EstadoCampo, Operacion } from '@/lib/fertirriego/tipos'

const RELOJ = new Intl.DateTimeFormat('es-HN', { timeZone: 'America/Tegucigalpa', hour: '2-digit', minute: '2-digit' })
const DIA = new Intl.DateTimeFormat('es-HN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })

export function VistaBitacora({
  estado,
  cola,
  estacionId,
  material,
  onMaterial,
  onAbrir,
}: {
  estado: EstadoCampo
  cola: Operacion[]
  estacionId: string
  material: string
  onMaterial: (id: string) => void
  onAbrir: (documentoTipo: string, documentoId: string) => void
}) {
  const filas = useMemo(() => kardex(estado, cola, estacionId, material || undefined).reverse(), [estado, cola, estacionId, material])
  const nombre = (id: string) => estado.materiales.find((m) => m.id === id)
  const turno = (id: string | null) => (id ? estado.turnos.find((t) => t.id === id)?.turno : null)
  const usados = useMemo(() => new Set(estado.movimientos.filter((m) => m.estacion_id === estacionId).map((m) => m.material_id)), [estado.movimientos, estacionId])

  const porDia = new Map<string, typeof filas>()
  for (const f of filas) porDia.set(f.dia, [...(porDia.get(f.dia) ?? []), f])

  return (
    <div className="flex flex-col gap-3">
      <SelectorBuscable
        valor={material}
        opciones={estado.materiales.filter((m) => usados.has(m.id)).map((m) => ({ id: m.id, titulo: m.descripcion ?? m.codigo, subtitulo: m.codigo }))}
        onCambiar={onMaterial}
        placeholder="Todos los productos"
        etiquetaBusqueda="Buscar producto"
        permitirVacio
        textoVacio="Todos los productos"
      />
      {filas.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Sin movimientos todavía.</p>}
      {[...porDia.entries()].map(([dia, lista]) => (
        <div key={dia} data-dia={dia}>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{DIA.format(new Date(`${dia}T12:00:00Z`))}</p>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200">
            {lista.map((f) => (
              <button
                key={f.clave}
                type="button"
                disabled={f.pendiente}
                onClick={() => onAbrir(f.documento_tipo, f.documento_id)}
                data-movimiento={f.tipo}
                className={`grid w-full grid-cols-[3rem_1fr_auto] items-center gap-2 px-3 py-2 text-left ${f.anulado ? 'opacity-50' : ''} ${f.pendiente ? 'bg-amber-50/60' : 'hover:bg-slate-50'}`}
              >
                <span className="text-xs tabular-nums text-slate-500">{RELOJ.format(new Date(f.fecha_hora))}</span>
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-semibold text-slate-800 ${f.anulado ? 'line-through' : ''}`}>
                    {NOMBRE_MOVIMIENTO[f.tipo]}
                    {turno(f.turno_ciclo_id) ? ` · ${turno(f.turno_ciclo_id)}` : ''}
                  </span>
                  {!material && <span className="block truncate text-[11px] text-slate-500">{nombre(f.material_id)?.descripcion}</span>}
                  {f.pendiente && <Insignia tono="ambar">por enviar</Insignia>}
                </span>
                <span className="text-right tabular-nums">
                  <span className={`block text-sm font-bold ${f.entrada ? 'text-brand-700' : 'text-red-700'}`}>
                    {f.entrada ? `+${cantidad(f.entrada)}` : `−${cantidad(f.salida)}`}
                  </span>
                  <span className="block text-[11px] text-slate-500">saldo {cantidad(f.saldo)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
