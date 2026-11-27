'use client'

import { useMemo } from 'react'

type EstacionFiltro = { id: string; nombre: string; zona?: string | null }

/**
 * Elegir estación con botones (no una lista): fila «Zona» (solo las zonas de sus estaciones; oculta si es una) y fila
 * «Estación» (las de la zona elegida). Botones de 44 px; la elegida en verde con ✓ (no solo color).
 */
export function FiltroEstaciones({
  estaciones,
  valor,
  onCambiar,
  zona,
  onZona,
}: {
  estaciones: EstacionFiltro[]
  valor: string
  onCambiar: (id: string) => void
  zona: string
  onZona: (zona: string) => void
}) {
  const zonas = useMemo(() => [...new Set(estaciones.map((e) => e.zona || 'Sin zona'))].sort((a, b) => a.localeCompare(b, 'es')), [estaciones])
  const zonaDeLaEstacion = estaciones.find((e) => e.id === valor)?.zona || 'Sin zona'
  // La zona guardada manda si existe; si no, la de la estación elegida
  const zonaActiva = zonas.includes(zona) ? zona : zonaDeLaEstacion
  const visibles = estaciones
    .filter((e) => zonas.length <= 1 || (e.zona || 'Sin zona') === zonaActiva)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))

  if (estaciones.length <= 1) return null

  return (
    <div className="flex flex-col gap-2" data-selector-estacion>
      {zonas.length > 1 && (
        <Fila titulo="Zona">
          {zonas.map((z) => (
            <Chip
              key={z}
              activo={z === zonaActiva}
              onClick={() => {
                onZona(z)
                // Al cambiar de zona se pasa a una estación de esa zona (la primera), para no mostrar datos de otra zona
                if (zonaDeLaEstacion !== z) {
                  const primera = estaciones.filter((e) => (e.zona || 'Sin zona') === z).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))[0]
                  if (primera) onCambiar(primera.id)
                }
              }}
              data-zona-boton={z}
            >
              {z}
            </Chip>
          ))}
        </Fila>
      )}
      <Fila titulo="Estación">
        {visibles.map((e) => (
          <Chip key={e.id} activo={e.id === valor} onClick={() => onCambiar(e.id)} data-estacion-boton={e.nombre}>
            {e.nombre}
          </Chip>
        ))}
      </Fila>
    </div>
  )
}

function Fila({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={titulo}>
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-700">{titulo}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function Chip({ activo, children, ...props }: { activo: boolean; children: React.ReactNode } & React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      className={`min-h-11 rounded-xl px-3 text-sm font-bold ring-2 ring-inset focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-400 ${
        activo ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-800 ring-slate-400 hover:ring-brand-500'
      }`}
      {...props}
    >
      {activo && '✓ '}
      {children}
    </button>
  )
}
