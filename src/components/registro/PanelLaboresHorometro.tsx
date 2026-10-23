'use client'

/**
 * «Labores de este equipo»: las labores (`registros` + `registro_detalle`)
 * de UN horómetro.
 *
 * Un solo componente para los dos sitios donde se ve:
 *   · la página del horómetro dentro del ticket, que le pasa las filas ya
 *     leídas en el servidor (`inicial`);
 *   · el modal de «Labores» del control de horómetros (78), que no las
 *     tiene y las pide aquí con el cliente del navegador —mismo RLS—.
 *
 * Los permisos llegan resueltos (`puedeEnTicket` con el proceso y el
 * estado del ticket): este componente no decide nada, sólo dibuja.
 */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BotonLink, EstadoVacio, TarjetaEncabezado } from '@/components/ui/Primitivos'
import { IconGauge, IconPlus } from '@/components/ui/Icons'
import { TablaRegistros, type FilaRegistro } from './TablaRegistros'
import type { Registro, RegistroDetalle } from '@/lib/types'

export function PanelLaboresHorometro({
  ticketId,
  horometroId,
  puedeAgregar,
  puedeEditar,
  puedeEliminar,
  inicial,
  onCambio,
}: {
  ticketId: string
  horometroId: string
  puedeAgregar: boolean
  puedeEditar: boolean
  puedeEliminar: boolean
  /** Filas ya leídas en el servidor. Sin ellas, se piden aquí. */
  inicial?: FilaRegistro[]
  /** Se llama tras duplicar o eliminar una labor. */
  onCambio?: () => void
}) {
  const [registros, setRegistros] = useState<FilaRegistro[] | null>(inicial ?? null)
  const [error, setError] = useState<string | null>(null)

  // Con `inicial` las filas las refresca el servidor (`router.refresh()`
  // de la tabla); sin él, se vuelven a pedir aquí.
  const aplicar = useCallback((r: Leidas) => {
    if (r.error) return setError(r.error)
    setError(null)
    setRegistros(r.filas)
  }, [])

  const leer = useCallback(
    async () => aplicar(await pedirLabores(horometroId)),
    [horometroId, aplicar]
  )

  useEffect(() => {
    if (inicial) return
    let vivo = true
    pedirLabores(horometroId).then((r) => {
      if (vivo) aplicar(r)
    })
    return () => {
      vivo = false
    }
  }, [inicial, horometroId, aplicar])

  // Lo que manda el servidor gana cuando cambia (la página del ticket).
  const [inicialPrevio, setInicialPrevio] = useState(inicial)
  if (inicial !== inicialPrevio) {
    setInicialPrevio(inicial)
    setRegistros(inicial ?? null)
  }

  const nuevo = `/tickets/${ticketId}/horometros/${horometroId}/registros/nuevo`
  const lista = registros ?? []

  return (
    <>
      <TarjetaEncabezado
        titulo="Labores de este equipo"
        contador={registros === null ? undefined : lista.length}
        accion={
          puedeAgregar ? (
            <BotonLink href={nuevo} variante="suave" tamano="sm">
              <IconPlus className="h-4 w-4" />
              Agregar
            </BotonLink>
          ) : undefined
        }
      />

      <div className="p-3">
        {error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : registros === null ? (
          <p className="px-1 py-6 text-center text-sm text-slate-400">Cargando labores…</p>
        ) : lista.length === 0 ? (
          <EstadoVacio
            icono={<IconGauge />}
            titulo="Sin labores registradas"
            descripcion="Desglosa qué hizo este equipo durante las horas trabajadas."
            accion={
              puedeAgregar ? (
                <BotonLink href={nuevo} tamano="sm">
                  <IconPlus className="h-4 w-4" />
                  Agregar labor
                </BotonLink>
              ) : undefined
            }
          />
        ) : (
          <TablaRegistros
            ticketId={ticketId}
            ticketAbierto={puedeEditar}
            puedeEliminar={puedeEliminar}
            registros={lista}
            onCambio={() => {
              if (!inicial) void leer()
              onCambio?.()
            }}
          />
        )}
      </div>
    </>
  )
}

type Leidas = { filas: FilaRegistro[]; error: string | null }

/** Las labores de un horómetro con su detalle por lote. Mismo RLS. */
async function pedirLabores(horometroId: string): Promise<Leidas> {
  const supabase = createClient()
  const { data: regs, error: e1 } = await supabase
    .from('registros')
    .select('*, labores(*), tareas_sap(*), implementos(*)')
    .eq('horometro_id', horometroId)
    .order('created_at', { ascending: true })
  if (e1) return { filas: [], error: e1.message }
  const lista = (regs as Registro[] | null) ?? []
  const ids = lista.map((r) => r.id)
  let detalles: RegistroDetalle[] = []
  if (ids.length > 0) {
    const { data: det, error: e2 } = await supabase
      .from('registro_detalle')
      .select('*, lotes_temporada(*, lotes(*))')
      .in('registro_id', ids)
    if (e2) return { filas: [], error: e2.message }
    detalles = (det as RegistroDetalle[] | null) ?? []
  }
  return {
    filas: lista.map((r) => ({ ...r, detalle: detalles.filter((d) => d.registro_id === r.id) })),
    error: null,
  }
}
