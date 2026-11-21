'use client'

/**
 * Los campos de las horas de riego (horas de fertilización y de riego, % de fertilización, ppm de cloro,
 * inicio y fin). Los usan el formulario de Horas y el de Aplicar. La validación está en lib/fertirriego/horas.
 */

import { Campo, Entrada } from '@/components/ui/Primitivos'
import type { DatosHoras } from '@/lib/fertirriego/horas'

const soloNumero = (v: string) => v.replace(/[^\d.,]/g, '')

export function CamposHoras({ valor, onCambiar }: { valor: DatosHoras; onCambiar: (v: DatosHoras) => void }) {
  const poner = (cambios: Partial<DatosHoras>) => onCambiar({ ...valor, ...cambios })
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Horas de fertilización">
          <Entrada inputMode="decimal" value={valor.hf} onChange={(e) => poner({ hf: soloNumero(e.target.value) })} placeholder="0" data-horas-fert />
        </Campo>
        <Campo etiqueta="Horas de riego">
          <Entrada inputMode="decimal" value={valor.hr} onChange={(e) => poner({ hr: soloNumero(e.target.value) })} placeholder="0" data-horas-riego />
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="% de fertilización">
          <Entrada inputMode="decimal" value={valor.pct} onChange={(e) => poner({ pct: soloNumero(e.target.value) })} placeholder="Ej. 100, 120" data-pct-fert />
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Ppm cloro (cabezal de riego)">
          <Entrada inputMode="decimal" value={valor.ppmCabezal} onChange={(e) => poner({ ppmCabezal: soloNumero(e.target.value) })} placeholder="Opcional" data-ppm-cabezal />
        </Campo>
        <Campo etiqueta="Ppm cloro (campo, en cinta)">
          <Entrada inputMode="decimal" value={valor.ppmCampo} onChange={(e) => poner({ ppmCampo: soloNumero(e.target.value) })} placeholder="Opcional" data-ppm-campo />
        </Campo>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo etiqueta="Inicio (opcional)">
          <Entrada type="datetime-local" value={valor.inicio} onChange={(e) => poner({ inicio: e.target.value })} />
        </Campo>
        <Campo etiqueta="Fin (opcional)">
          <Entrada type="datetime-local" value={valor.fin} onChange={(e) => poner({ fin: e.target.value })} />
        </Campo>
      </div>
    </>
  )
}
