'use client'

/** Insignia (icono + texto + color) de un tipo de movimiento y la leyenda corta de la bitácora. */

import { FAMILIAS, estiloInsignia, familiaDe, type FamiliaMovimiento } from '@/lib/fertirriego/coloresMovimiento'

export function InsigniaFamilia({ familia, texto }: { familia: FamiliaMovimiento; texto?: string }) {
  const f = FAMILIAS[familia]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold"
      style={estiloInsignia(familia)}
      data-familia-movimiento={familia}
    >
      <span aria-hidden="true">{f.icono}</span>
      {texto ?? f.nombre}
    </span>
  )
}

export function InsigniaMovimiento({ tipo, texto }: { tipo: string; texto?: string }) {
  return <InsigniaFamilia familia={familiaDe(tipo)} texto={texto} />
}

/** Leyenda: solo las familias que hay en pantalla, en una línea que se parte si hace falta. */
export function LeyendaMovimientos({ familias }: { familias: FamiliaMovimiento[] }) {
  const unicas = [...new Set(familias)]
  if (unicas.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-leyenda-movimientos aria-label="Colores de la bitácora">
      {unicas.map((f) => (
        <InsigniaFamilia key={f} familia={f} />
      ))}
    </div>
  )
}
