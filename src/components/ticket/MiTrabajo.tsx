'use client'

/**
 * «Mi trabajo»: lo primero que ve un capturador al abrir Tickets en el teléfono.
 *
 * Antes la pantalla abría con el ARCHIVO (mes → proceso → ticket) y para continuar la jornada había que bajar tres
 * niveles. Lo que la persona viene a hacer es: registrar la JORNADA A NOTIFICAR —por regla la de AYER (así lo propone
 * «Generar ticket»), o la de hoy si se registra el mismo día— y terminar lo que dejó pendiente. Eso va arriba, con botones grandes para el pulgar; el historial queda debajo.
 *
 * «Pendientes» = mis tickets que siguen en 0 · Registrando (Torre de Control todavía no los revisa). Se actualiza
 * solo (useConsultaViva: al volver a la ventana y con avisos de la base).
 */

import Link from 'next/link'
import { useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useConsultaViva } from '@/lib/datos/useConsultaViva'
import { ayerIso, hoyIso } from '@/lib/fechas'
import { IconPlus } from '@/components/ui/Icons'

type MiTicket = {
  id: string
  codigo: string
  fecha: string
  estado: 'ABIERTO' | 'CERRADO'
  horometros: { count: number }[] | null
}

const VISIBLES = 4

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d, 12)).toLocaleDateString('es-HN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  })
}

const equipos = (t: MiTicket) => t.horometros?.[0]?.count ?? 0
const textoEquipos = (n: number) => (n === 0 ? 'sin equipos todavía' : n === 1 ? '1 equipo' : `${n} equipos`)

export function MiTrabajo({ usuarioId, onNuevo }: { usuarioId: string; onNuevo: () => void }) {
  const hoy = hoyIso()
  const ayer = ayerIso()
  const leer = useCallback(async () => {
    const { data, error } = await createClient()
      .from('tickets')
      .select('id, codigo, fecha, estado, horometros(count)')
      .eq('usuario_id', usuarioId)
      .eq('proceso', 'REGISTRADO')
      .order('fecha', { ascending: false })
      .limit(40)
    return { datos: (data as MiTicket[] | null) ?? [], error: error?.message ?? null }
  }, [usuarioId])

  const { filas, cargando } = useConsultaViva<MiTicket>({
    clave: `mi-trabajo:${usuarioId}`,
    leer,
    tablas: ['tickets', 'horometros'],
    habilitado: Boolean(usuarioId),
  })

  // La jornada actual: la de hoy si ya existe (se registra el mismo día), si no la de ayer (la que se notifica)
  const deHoy = useMemo(
    () => (filas ?? []).find((t) => t.fecha === hoy) ?? (filas ?? []).find((t) => t.fecha === ayer) ?? null,
    [filas, hoy, ayer]
  )
  const pendientes = useMemo(() => (filas ?? []).filter((t) => t.id !== deHoy?.id), [filas, deHoy])

  return (
    <section aria-label="Mi trabajo" className="mb-4 space-y-3" data-mi-trabajo>
      {/* Hoy: continuar o empezar */}
      <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Jornada a registrar · {fechaCorta(deHoy?.fecha ?? ayer)}
        </p>
        {cargando && !filas ? (
          <div className="mt-3 h-12 animate-pulse rounded-xl bg-brand-100/60" />
        ) : deHoy ? (
          <>
            <p className="mt-1 text-sm text-slate-600">
              Tu ticket lleva <strong>{textoEquipos(equipos(deHoy))}</strong>.
            </p>
            <Link
              href={`/tickets/${deHoy.id}`}
              className="mt-3 flex min-h-12 items-center justify-center rounded-xl bg-brand-700 px-4 text-base font-semibold text-white shadow-[var(--shadow-raised)] active:scale-[0.98]"
              data-continuar-hoy
            >
              Continuar jornada
            </Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-600">Todavía no registras la jornada de ayer.</p>
            <button
              type="button"
              onClick={onNuevo}
              className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 text-base font-semibold text-white shadow-[var(--shadow-raised)] active:scale-[0.98]"
              data-iniciar-hoy
            >
              <IconPlus className="h-5 w-5" />
              Registrar jornada
            </button>
          </>
        )}
      </div>

      {/* Lo que quedó sin enviar a revisión */}
      {pendientes.length > 0 && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3">
          <p className="px-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
            <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
            Pendientes de terminar · {pendientes.length}
          </p>
          <p className="px-1 pt-0.5 text-xs text-slate-500">
            Siguen en «Registrando»: complétalos para que Torre de Control los revise.
          </p>
          <ul className="mt-2 space-y-1.5">
            {pendientes.slice(0, VISIBLES).map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tickets/${t.id}`}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-slate-200 active:bg-slate-50"
                >
                  <span className="font-semibold capitalize text-slate-800">{fechaCorta(t.fecha)}</span>
                  <span className="text-xs text-slate-500">{textoEquipos(equipos(t))} ›</span>
                </Link>
              </li>
            ))}
          </ul>
          {pendientes.length > VISIBLES && (
            <p className="px-1 pt-2 text-xs text-slate-500">
              y {pendientes.length - VISIBLES} más en el historial (proceso 0 · Registrando).
            </p>
          )}
        </div>
      )}
    </section>
  )
}
