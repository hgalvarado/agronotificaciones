'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alerta,
  Boton,
  EstadoVacio,
  Insignia,
  Tarjeta,
} from '@/components/ui/Primitivos'
import { IconGauge, IconPlus, IconSearch } from '@/components/ui/Icons'
import type { CategoriaLabor, Implemento, TareaSap } from '@/lib/types'
import { LaborModal } from '@/components/labores/LaborModal'
import { LABOR_NUEVA, type ImplementoFisicoOpcion, type LaborVinculada } from '@/lib/labores/tipos'

export type { ImplementoFisicoOpcion, LaborVinculada }

export function VinculacionLabores({
  labores,
  categorias,
  tareasSap,
  implementos,
  implementosFisicos = [],
  soportaProveedores = false,
}: {
  labores: LaborVinculada[]
  categorias: CategoriaLabor[]
  tareasSap: TareaSap[]
  implementos: Implemento[]
  /** Catálogo de máquinas concretas: ROMSR-01, ROMSR-08… */
  implementosFisicos?: ImplementoFisicoOpcion[]
  /**
   * Si la base ya tiene las columnas de la migración 15. Se comprueba en
   * el servidor con una consulta de prueba y no adivinando: mandar una
   * columna que no existe hace fallar el guardado completo, y esconder
   * los interruptores cuando sí existen lo dejaría sin poder decir qué
   * labor pide proveedor.
   */
  soportaProveedores?: boolean
}) {
  const router = useRouter()
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState<LaborVinculada | null>(null)

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return labores
    return labores.filter((l) => l.nombre.toLowerCase().includes(q))
  }, [labores, busqueda])

  const sinConfigurar = labores.filter((l) => l.labores_tareas.length === 0).length

  return (
    <div className="flex flex-col gap-4">
      {sinConfigurar > 0 && (
        <Alerta tono="ambar">
          Hay <strong>{sinConfigurar}</strong>{' '}
          {sinConfigurar === 1 ? 'labor sin tarea SAP asociada' : 'labores sin tarea SAP asociada'}.
          Mientras no tengan al menos una, no se pueden registrar en campo.
        </Alerta>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar labor…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>
        <Boton tamano="sm" onClick={() => setEditando(LABOR_NUEVA)}>
          <IconPlus className="h-4 w-4" />
          Nueva labor
        </Boton>
      </div>

      {filtradas.length === 0 ? (
        <Tarjeta>
          <EstadoVacio
            icono={<IconGauge />}
            titulo={busqueda ? 'Sin resultados' : 'Sin labores'}
            descripcion={
              busqueda
                ? 'Prueba con otro nombre.'
                : 'Crea la primera labor con el botón de arriba: nombre, categoría, tareas SAP y códigos físicos, todo de una vez.'
            }
          />
        </Tarjeta>
      ) : (
        <div className="flex flex-col gap-2">
          {filtradas.map((labor) => {
            const categoria = categorias.find((c) => c.id === labor.categoria_labor_id)
            const nTareas = labor.labores_tareas.length
            const nCodigos = labor.labores_implementos_fisicos?.length ?? 0

            return (
              <button
                key={labor.id}
                onClick={() => setEditando(labor)}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-[var(--shadow-card)] transition-all hover:border-slate-300"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-slate-900">{labor.nombre}</p>
                    {!labor.activo && <Insignia tono="gris">Inactiva</Insignia>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Insignia tono={categoria ? 'violeta' : 'ambar'}>
                      {categoria?.nombre ?? 'Sin categoría'}
                    </Insignia>
                    <Insignia tono={nTareas > 0 ? 'verde' : 'rojo'}>
                      {nTareas} {nTareas === 1 ? 'tarea SAP' : 'tareas SAP'}
                    </Insignia>
                    <Insignia tono={nCodigos > 0 ? 'azul' : 'gris'}>
                      {nCodigos} {nCodigos === 1 ? 'código físico' : 'códigos físicos'}
                    </Insignia>
                    {labor.usa_proveedor_plastico && <Insignia tono="ambar">Plástico</Insignia>}
                    {labor.usa_proveedor_manguera && <Insignia tono="ambar">Manguera</Insignia>}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold text-brand-700">Configurar</span>
              </button>
            )
          })}
        </div>
      )}

      {editando && (
        <LaborModal
          labor={editando}
          categorias={categorias}
          tareasSap={tareasSap}
          implementos={implementos}
          implementosFisicos={implementosFisicos}
          soportaProveedores={soportaProveedores}
          onCerrar={() => setEditando(null)}
          onGuardado={() => router.refresh()}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Modal: categoría, tareas SAP y códigos físicos de implemento        */
/* ------------------------------------------------------------------ */
