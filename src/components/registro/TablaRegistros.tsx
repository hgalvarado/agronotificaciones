'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { EstadoVacio } from '@/components/ui/Primitivos'
import { IconCopy, IconGauge, IconMapPin, IconPencil, IconSearch, IconTrash } from '@/components/ui/Icons'
import type { Registro, RegistroDetalle } from '@/lib/types'

export type FilaRegistro = Registro & {
  detalle: RegistroDetalle[]
  equipoCodigo?: string
}

export function TablaRegistros({
  registros,
  ticketId,
  ticketAbierto,
  esAdmin,
  mostrarEquipo = false,
}: {
  registros: FilaRegistro[]
  ticketId: string
  ticketAbierto: boolean
  esAdmin: boolean
  mostrarEquipo?: boolean
}) {
  const [busqueda, setBusqueda] = useState('')

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return registros
    return registros.filter(
      (r) =>
        (r.labores?.nombre ?? '').toLowerCase().includes(q) ||
        (r.tareas_sap?.nombre ?? '').toLowerCase().includes(q) ||
        (r.tareas_sap?.codigo ?? '').toLowerCase().includes(q) ||
        (r.equipoCodigo ?? '').toLowerCase().includes(q) ||
        r.detalle.some((d) =>
          (d.lotes_temporada?.lotes?.nomenclatura ?? '').toLowerCase().includes(q)
        )
    )
  }, [registros, busqueda])

  if (registros.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {registros.length >= 6 && (
        <div className="relative px-1">
          <IconSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar labor, tarea SAP o lote…"
            inputMode="search"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>
      )}

      {filtrados.length === 0 ? (
        <EstadoVacio
          icono={<IconGauge />}
          titulo="Sin resultados"
          descripcion={`Ninguna labor coincide con «${busqueda}».`}
        />
      ) : (
        <>
          {/* ---------------- Celular ---------------- */}
          <div className="flex flex-col divide-y divide-slate-100 lg:hidden">
            {filtrados.map((r) => (
              <FilaCompacta
                key={r.id}
                registro={r}
                ticketId={ticketId}
                ticketAbierto={ticketAbierto}
                esAdmin={esAdmin}
                mostrarEquipo={mostrarEquipo}
              />
            ))}
          </div>

          {/* ---------------- Computadora ---------------- */}
          <div className="hidden lg:block">
            <div className="scroll-suave overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    {mostrarEquipo && <th className="px-3 py-2">Equipo</th>}
                    <th className="px-3 py-2">Labor</th>
                    <th className="px-3 py-2">Tarea SAP</th>
                    <th className="px-3 py-2">Implemento</th>
                    <th className="px-3 py-2">Lotes</th>
                    <th className="px-3 py-2 text-right">Mz</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((r) => (
                    <FilaTabla
                      key={r.id}
                      registro={r}
                      ticketId={ticketId}
                      ticketAbierto={ticketAbierto}
                      esAdmin={esAdmin}
                      mostrarEquipo={mostrarEquipo}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {busqueda && (
            <p className="px-1 text-xs text-slate-400">
              {filtrados.length} de {registros.length} labores
            </p>
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function totalMz(r: FilaRegistro) {
  return r.detalle.reduce((acc, d) => acc + (d.avance_mz ?? 0), 0)
}

function useAcciones(registro: FilaRegistro, ticketId: string) {
  const supabase = createClient()
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)

  function editar(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    router.push(
      `/tickets/${ticketId}/horometros/${registro.horometro_id}/registros/${registro.id}/editar`
    )
  }

  async function duplicar(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setOcupado(true)
    const { error } = await supabase.rpc('duplicar_registro', {
      p_registro_id: registro.id,
      p_copiar_detalle: true,
    })
    setOcupado(false)
    if (error) return alert(error.message)
    router.refresh()
  }

  async function eliminar(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Se eliminará esta labor y su avance por lote. ¿Continuar?')) return
    setOcupado(true)
    const { error } = await supabase.from('registros').delete().eq('id', registro.id)
    setOcupado(false)
    if (error) return alert(error.message)
    router.refresh()
  }

  return { editar, duplicar, eliminar, ocupado }
}

function Acciones({
  registro,
  ticketId,
  ticketAbierto,
  esAdmin,
}: {
  registro: FilaRegistro
  ticketId: string
  ticketAbierto: boolean
  esAdmin: boolean
}) {
  const { editar, duplicar, eliminar, ocupado } = useAcciones(registro, ticketId)

  const boton =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition-colors disabled:opacity-50'

  return (
    <div className="flex shrink-0 gap-1">
      {ticketAbierto && (
        <>
          <button
            onClick={editar}
            className={`${boton} hover:text-brand-700`}
            title="Editar labor"
            aria-label="Editar labor"
          >
            <IconPencil className="h-4 w-4" />
          </button>
          <button
            onClick={duplicar}
            disabled={ocupado}
            className={`${boton} hover:text-brand-700`}
            title="Duplicar labor"
            aria-label="Duplicar labor"
          >
            <IconCopy className="h-4 w-4" />
          </button>
        </>
      )}
      {esAdmin && (
        <button
          onClick={eliminar}
          disabled={ocupado}
          className={`${boton} hover:border-red-200 hover:text-red-600`}
          title="Eliminar labor"
          aria-label="Eliminar labor"
        >
          <IconTrash className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function FilaCompacta({
  registro: r,
  ticketId,
  ticketAbierto,
  esAdmin,
  mostrarEquipo,
}: {
  registro: FilaRegistro
  ticketId: string
  ticketAbierto: boolean
  esAdmin: boolean
  mostrarEquipo: boolean
}) {
  const mz = totalMz(r)

  return (
    <div className="flex items-start gap-2 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-bold text-slate-900">{r.labores?.nombre ?? '—'}</span>
          {mostrarEquipo && r.equipoCodigo && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500">
              {r.equipoCodigo}
            </span>
          )}
          {mz > 0 && <span className="text-xs font-bold text-brand-700">{mz} mz</span>}
        </div>

        <p className="truncate text-xs text-slate-400">
          {r.tareas_sap?.codigo ? `${r.tareas_sap.codigo} · ` : ''}
          {r.tareas_sap?.nombre ?? 'Sin tarea SAP'}
          {r.implementos?.nombre ? ` · ${r.implementos.nombre}` : ''}
        </p>

        {r.detalle.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {r.detalle.map((d) => (
              <span
                key={d.id}
                className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200/70"
              >
                <IconMapPin className="h-3 w-3 text-slate-400" />
                {d.lotes_temporada?.lotes?.nomenclatura ?? '—'}
                {d.avance_mz != null && (
                  <span className="font-bold text-brand-700">{d.avance_mz}</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <Acciones
        registro={r}
        ticketId={ticketId}
        ticketAbierto={ticketAbierto}
        esAdmin={esAdmin}
      />
    </div>
  )
}

function FilaTabla({
  registro: r,
  ticketId,
  ticketAbierto,
  esAdmin,
  mostrarEquipo,
}: {
  registro: FilaRegistro
  ticketId: string
  ticketAbierto: boolean
  esAdmin: boolean
  mostrarEquipo: boolean
}) {
  const mz = totalMz(r)

  return (
    <tr className="border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/60">
      {mostrarEquipo && (
        <td className="px-3 py-2 font-bold text-slate-700">{r.equipoCodigo ?? '—'}</td>
      )}
      <td className="px-3 py-2 font-semibold text-slate-900">{r.labores?.nombre ?? '—'}</td>
      <td className="max-w-[200px] px-3 py-2 text-slate-600">
        <span className="block truncate">
          {r.tareas_sap?.codigo ? `${r.tareas_sap.codigo} · ` : ''}
          {r.tareas_sap?.nombre ?? '—'}
        </span>
      </td>
      <td className="max-w-[140px] truncate px-3 py-2 text-slate-500">
        {r.implementos?.nombre ?? '—'}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {r.detalle.map((d) => (
            <span
              key={d.id}
              className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-200/70"
            >
              {d.lotes_temporada?.lotes?.nomenclatura ?? '—'}
              {d.avance_mz != null && (
                <span className="font-bold text-brand-700">{d.avance_mz}</span>
              )}
            </span>
          ))}
        </div>
      </td>
      <td className="px-3 py-2 text-right font-bold tabular-nums text-brand-700">
        {mz > 0 ? mz : '—'}
      </td>
      <td className="px-3 py-2">
        <div className="flex justify-end">
          <Acciones
            registro={r}
            ticketId={ticketId}
            ticketAbierto={ticketAbierto}
            esAdmin={esAdmin}
          />
        </div>
      </td>
    </tr>
  )
}
