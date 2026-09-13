'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { EstadoVacio, Insignia } from '@/components/ui/Primitivos'
import {
  IconChevronRight,
  IconCopy,
  IconMoon,
  IconSearch,
  IconSun,
  IconTractor,
  IconTrash,
} from '@/components/ui/Icons'
import type { Horometro } from '@/lib/types'

type Fila = Horometro & { cantidadLabores: number }

// En una jornada se registran hasta 30 equipos, así que la lista necesita
// buscador y filas densas. En computadora se muestra como tabla real
// (Torre de Control revisa muchos de golpe); en celular como filas
// compactas de una sola línea, que es lo que se puede tocar con el pulgar.
export function TablaHorometros({
  horometros,
  ticketId,
  ticketAbierto,
  esAdmin,
}: {
  horometros: Fila[]
  ticketId: string
  ticketAbierto: boolean
  esAdmin: boolean
}) {
  const [busqueda, setBusqueda] = useState('')

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return horometros
    return horometros.filter(
      (h) =>
        (h.equipos?.codigo ?? '').toLowerCase().includes(q) ||
        (h.equipos?.nombre ?? '').toLowerCase().includes(q) ||
        (h.operadores?.nombre ?? '').toLowerCase().includes(q)
    )
  }, [horometros, busqueda])

  if (horometros.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {/* El buscador sólo aparece cuando ya hay suficientes filas como para
          que valga la pena; con 3 equipos estorbaría. */}
      {horometros.length >= 6 && (
        <div className="relative px-1">
          <IconSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar equipo u operador…"
            inputMode="search"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>
      )}

      {filtrados.length === 0 ? (
        <EstadoVacio
          icono={<IconTractor />}
          titulo="Sin resultados"
          descripcion={`Ningún equipo coincide con «${busqueda}».`}
        />
      ) : (
        <>
          {/* ---------------- Celular: filas compactas ---------------- */}
          <div className="flex flex-col divide-y divide-slate-100 lg:hidden">
            {filtrados.map((h) => (
              <FilaCompacta
                key={h.id}
                horometro={h}
                ticketId={ticketId}
                ticketAbierto={ticketAbierto}
                esAdmin={esAdmin}
              />
            ))}
          </div>

          {/* ---------------- Computadora: tabla ---------------- */}
          <div className="hidden lg:block">
            <div className="scroll-suave overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2">Equipo</th>
                    <th className="px-3 py-2">Turno</th>
                    <th className="px-3 py-2 text-right">Inicial</th>
                    <th className="px-3 py-2 text-right">Final</th>
                    <th className="px-3 py-2 text-right">H. máq.</th>
                    <th className="px-3 py-2 text-right">H. hom.</th>
                    <th className="px-3 py-2">Operador</th>
                    <th className="px-3 py-2 text-center">Labores</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((h) => (
                    <FilaTabla
                      key={h.id}
                      horometro={h}
                      ticketId={ticketId}
                      ticketAbierto={ticketAbierto}
                      esAdmin={esAdmin}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {busqueda && (
            <p className="px-1 text-xs text-slate-400">
              {filtrados.length} de {horometros.length} equipos
            </p>
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Acciones compartidas                                                */
/* ------------------------------------------------------------------ */

function useAcciones(horometro: Horometro, ticketId: string) {
  const supabase = createClient()
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)

  async function duplicar(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setOcupado(true)
    const { data, error } = await supabase.rpc('duplicar_horometro', {
      p_horometro_id: horometro.id,
    })
    setOcupado(false)
    if (error) return alert(error.message)
    router.push(`/tickets/${ticketId}/horometros/${data}/editar`)
  }

  async function eliminar(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Se eliminará este horómetro y las labores registradas en él. ¿Continuar?')) return
    setOcupado(true)
    const { error } = await supabase.from('horometros').delete().eq('id', horometro.id)
    setOcupado(false)
    if (error) return alert(error.message)
    router.refresh()
  }

  return { duplicar, eliminar, ocupado }
}

function BotonAccion({
  onClick,
  disabled,
  titulo,
  peligro,
  children,
}: {
  onClick: (e: React.MouseEvent) => void
  disabled?: boolean
  titulo: string
  peligro?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={titulo}
      aria-label={titulo}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition-colors disabled:opacity-50 ${
        peligro ? 'hover:border-red-200 hover:text-red-600' : 'hover:text-brand-700'
      }`}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Celular                                                             */
/* ------------------------------------------------------------------ */

function FilaCompacta({
  horometro: h,
  ticketId,
  ticketAbierto,
  esAdmin,
}: {
  horometro: Fila
  ticketId: string
  ticketAbierto: boolean
  esAdmin: boolean
}) {
  const { duplicar, eliminar, ocupado } = useAcciones(h, ticketId)
  const esDiurno = h.turno === 'DIURNO'

  return (
    <div className="flex items-center gap-2 py-2">
      <Link
        href={`/tickets/${ticketId}/horometros/${h.id}`}
        className="flex min-w-0 flex-1 items-center gap-2.5"
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
            esDiurno ? 'bg-amber-50 text-amber-600' : 'bg-sky-50 text-sky-600'
          }`}
          title={esDiurno ? 'Diurno' : 'Nocturno'}
        >
          {esDiurno ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-bold text-slate-900">
              {h.equipos?.codigo ?? '—'}
            </span>
            <span className="shrink-0 text-xs font-semibold text-brand-700">
              {h.horas_maquina} h
            </span>
          </span>
          <span className="block truncate text-xs text-slate-400">
            {h.horometro_inicial} → {h.horometro_final}
            {h.operadores?.nombre ? ` · ${h.operadores.nombre}` : ''}
          </span>
        </span>

        <Insignia tono={h.cantidadLabores > 0 ? 'verde' : 'ambar'}>{h.cantidadLabores}</Insignia>
        <IconChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
      </Link>

      {(ticketAbierto || esAdmin) && (
        <div className="flex shrink-0 gap-1">
          {ticketAbierto && (
            <BotonAccion onClick={duplicar} disabled={ocupado} titulo="Duplicar horómetro">
              <IconCopy className="h-4 w-4" />
            </BotonAccion>
          )}
          {esAdmin && (
            <BotonAccion onClick={eliminar} disabled={ocupado} titulo="Eliminar horómetro" peligro>
              <IconTrash className="h-4 w-4" />
            </BotonAccion>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Computadora                                                         */
/* ------------------------------------------------------------------ */

function FilaTabla({
  horometro: h,
  ticketId,
  ticketAbierto,
  esAdmin,
}: {
  horometro: Fila
  ticketId: string
  ticketAbierto: boolean
  esAdmin: boolean
}) {
  const router = useRouter()
  const { duplicar, eliminar, ocupado } = useAcciones(h, ticketId)
  const esDiurno = h.turno === 'DIURNO'

  return (
    <tr
      onClick={() => router.push(`/tickets/${ticketId}/horometros/${h.id}`)}
      className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/60"
    >
      <td className="px-3 py-2">
        <p className="font-bold text-slate-900">{h.equipos?.codigo ?? '—'}</p>
        {h.equipos?.nombre && <p className="text-xs text-slate-400">{h.equipos.nombre}</p>}
      </td>
      <td className="px-3 py-2">
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          {esDiurno ? <IconSun className="h-3.5 w-3.5" /> : <IconMoon className="h-3.5 w-3.5" />}
          {esDiurno ? 'Diurno' : 'Nocturno'}
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{h.horometro_inicial}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{h.horometro_final}</td>
      <td className="px-3 py-2 text-right font-bold tabular-nums text-brand-700">
        {h.horas_maquina}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{h.horas_hombre ?? '—'}</td>
      <td className="max-w-[160px] truncate px-3 py-2 text-slate-600">
        {h.operadores?.nombre ?? '—'}
      </td>
      <td className="px-3 py-2 text-center">
        <Insignia tono={h.cantidadLabores > 0 ? 'verde' : 'ambar'}>{h.cantidadLabores}</Insignia>
      </td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-1">
          {ticketAbierto && (
            <BotonAccion onClick={duplicar} disabled={ocupado} titulo="Duplicar horómetro">
              <IconCopy className="h-4 w-4" />
            </BotonAccion>
          )}
          {esAdmin && (
            <BotonAccion onClick={eliminar} disabled={ocupado} titulo="Eliminar horómetro" peligro>
              <IconTrash className="h-4 w-4" />
            </BotonAccion>
          )}
        </div>
      </td>
    </tr>
  )
}
