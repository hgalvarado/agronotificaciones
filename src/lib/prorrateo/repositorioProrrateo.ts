'use client'

/**
 * Persistencia del prorrateo.
 *
 * Lee lo que el algoritmo necesita y manda aplicar lo que decidió. Nada
 * más: no calcula, no redondea y no decide si hay que repartir.
 *
 * El reparto se ESCRIBE llamando a `fn_prorratear_horas_horometro`, no
 * línea por línea desde aquí. Son tres escrituras encadenadas —las
 * líneas, y las labores que las suman— y un disparador que valida el
 * total contra el horómetro: hacerlas sueltas desde el navegador deja
 * estados intermedios que el disparador rechaza, y una red que se corta a
 * la mitad dejaría el horómetro descuadrado, que es exactamente lo que
 * esto viene a evitar. La función de la base lo hace en una transacción y
 * con la misma regla.
 */

import { createClient } from '@/lib/supabase/client'
import type { LineaHorometro } from './tipos'

type FilaDetalle = { id: string; avance_mz: number | null; horas_maquina?: number | null }
type FilaRegistro = { registro_detalle: FilaDetalle[] | null }

export type DatosHorometro = {
  horasTotales: number
  lineas: LineaHorometro[]
}

export async function leerHorometroParaProrrateo(
  horometroId: string
): Promise<{ datos: DatosHorometro | null; error: string | null }> {
  const supabase = createClient()

  const [{ data: horometro, error: e1 }, { data: registros, error: e2 }] = await Promise.all([
    supabase.from('horometros').select('horas_maquina').eq('id', horometroId).maybeSingle(),
    supabase
      .from('registros')
      .select('registro_detalle(id, avance_mz, horas_maquina)')
      .eq('horometro_id', horometroId),
  ])

  if (e1 || e2) return { datos: null, error: (e1 ?? e2)?.message ?? null }
  if (!horometro) return { datos: null, error: null }

  const lineas = ((registros as FilaRegistro[] | null) ?? []).flatMap((r) =>
    (r.registro_detalle ?? []).map((d) => ({
      detalleId: d.id,
      mz: d.avance_mz === null ? null : Number(d.avance_mz),
      horasActuales:
        d.horas_maquina === null || d.horas_maquina === undefined ? null : Number(d.horas_maquina),
    }))
  )

  return {
    datos: {
      horasTotales: Number((horometro as { horas_maquina: number | null }).horas_maquina ?? 0),
      lineas,
    },
    error: null,
  }
}

/** Aplica el reparto en la base, en una sola transacción. */
export async function aplicarProrrateo(horometroId: string): Promise<{ error: string | null }> {
  const supabase = createClient()
  const { error } = await supabase.rpc('fn_prorratear_horas_horometro', {
    p_horometro_id: horometroId,
  })
  return { error: error?.message ?? null }
}
