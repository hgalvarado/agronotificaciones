'use client'

/**
 * sql/160 · Reemplazo temporal de un motor (pedido 2026-11-27).
 * `inicio`: el motor dañado queda «En reparación» en su estación (no se mueve) y otro motor trabaja en su tanque. El otro puede
 *   ser de repuesto o venir de otra estación/pozo; al terminar vuelve solo a donde estaba.
 * `fin` («Reactivar»): el reparado vuelve a su tanque y el sustituto se quita. Un solo Guardar en cada caso.
 */

import { useMemo, useState } from 'react'
import { AreaTexto, Campo } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { aEntradaLocal, ahoraIso, deEntradaLocal } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import { candidatosReemplazo, type EstadoMotores, type ReemplazoMotor } from '@/lib/motores/estado'
import { armarReemplazoMotor } from '@/lib/motores/registroDiario'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'

type Datos = { sustituto: string; horometro: string; horometroOtro: string; fechaHora: string; motivo: string }

const numero = (t: string): number | null => (t.trim() ? Number(t.replace(',', '.')) : null)
const claseNumero =
  'min-h-11 w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base tabular-nums focus:border-brand-600 focus:outline-none'

export function FormReemplazoMotor({
  modo,
  equipoId,
  codigo,
  horoUltimo,
  reemplazo,
  estado,
  estaciones,
  estacion,
  yo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  modo: 'inicio' | 'fin'
  /** El motor dañado (inicio) o el reparado (fin). */
  equipoId: string
  codigo: string
  horoUltimo: number | null
  /** Solo en `fin`: el reemplazo abierto. */
  reemplazo?: ReemplazoMotor | null
  estado: EstadoMotores
  estaciones: Estacion[]
  estacion: Estacion
  yo: Persona
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const borrador = useBorrador<Datos>(claveBorrador(`motor_reemplazo_${modo}`, yo.id, estacion.id, equipoId))
  const b = borrador.inicial
  const [sustituto, setSustituto] = useState(b?.sustituto ?? '')
  const [horometro, setHorometro] = useState(b?.horometro ?? (modo === 'fin' && horoUltimo !== null ? String(horoUltimo) : ''))
  const [horometroOtro, setHorometroOtro] = useState(b?.horometroOtro ?? (modo === 'inicio' && horoUltimo !== null ? String(horoUltimo) : ''))
  const [fechaHora, setFechaHora] = useState(b?.fechaHora ?? aEntradaLocal(ahoraIso()))
  const [motivo, setMotivo] = useState(b?.motivo ?? '')
  useAutoguardado(borrador, { sustituto, horometro, horometroOtro, fechaHora, motivo })

  const nombreEstacion = (id: string) => estaciones.find((e) => e.id === id)?.nombre ?? null
  const candidatos = useMemo(() => (modo === 'inicio' ? candidatosReemplazo(estado, estacion.id, nombreEstacion) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modo, estado, estacion.id, estaciones])
  const elegido = candidatos.find((c) => c.equipo_id === sustituto) ?? null
  const sustitutoCodigo = reemplazo?.sustituto_codigo ?? 'el sustituto'
  const titulo = modo === 'inicio' ? `Reemplazo temporal · ${codigo}` : `Reactivar · ${codigo}`

  return (
    <MarcoRegistro
      titulo={titulo}
      textoGuardar={modo === 'inicio' ? 'Poner en reparación' : 'Reactivar motor'}
      textoCancelar="Regresar"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      sinCustodia
      construir={({ ubicacion, enNombreDe }) => {
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Falta la fecha y hora.'
        const a = armarReemplazoMotor({
          modo,
          equipoId,
          sustitutoId: sustituto || null,
          estacionId: estacion.id,
          fechaHora: fh,
          horometro: numero(horometro),
          horometroOtro: numero(horometroOtro),
          motivo,
        })
        if ('error' in a) return a.error
        const resumen = modo === 'inicio' ? `En reparación · ${codigo} → ${elegido?.codigo ?? ''}` : `Reactivar · ${codigo}`
        return [crearOperacion(a.operacion, a.datos, { ubicacion, enNombreDe, resumen })]
      }}
    >
      <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800" data-ayuda-reemplazo>
        {modo === 'inicio'
          ? `${codigo} queda en reparación aquí. El otro motor usa su tanque.`
          : `${codigo} vuelve a su tanque. ${sustitutoCodigo} ${reemplazo?.origen_estacion ? `regresa a ${reemplazo.origen_estacion}` : 'queda sin estación'}.`}
      </p>

      {modo === 'inicio' && (
        <Campo etiqueta="Motor que lo reemplaza" requerido>
          {candidatos.length > 0 ? (
            <div data-selector-sustituto>
              <SelectorBuscable
                valor={sustituto}
                opciones={candidatos.map((c) => ({ id: c.equipo_id, titulo: c.codigo, subtitulo: c.enEstacion ? `En ${c.enEstacion}` : 'De repuesto (sin estación)' }))}
                onCambiar={setSustituto}
                placeholder="Elegir motor…"
                etiquetaBusqueda="Buscar motor"
                permitirVacio={false}
              />
            </div>
          ) : (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20" data-sin-sustitutos>
              No hay otro motor disponible.
            </p>
          )}
          {elegido && (
            <p className="mt-1 text-sm text-slate-700" data-origen-sustituto>
              {elegido.enEstacion ? `Viene de ${elegido.enEstacion}. Al reactivar, regresa allá.` : 'Es de repuesto. Al reactivar, queda sin estación.'}
            </p>
          )}
        </Campo>
      )}

      <Campo etiqueta={modo === 'inicio' ? 'Horómetro del motor que entra' : `Horómetro de ${codigo}`}>
        <input inputMode="decimal" value={horometro} onChange={(e) => setHorometro(e.target.value.replace(/[^\d.,]/g, ''))}
          aria-label="Horómetro" data-horometro-reemplazo className={claseNumero} />
      </Campo>
      <Campo etiqueta={modo === 'inicio' ? `Horómetro de ${codigo} (opcional)` : `Horómetro de ${sustitutoCodigo} (opcional)`}>
        <input inputMode="decimal" value={horometroOtro} onChange={(e) => setHorometroOtro(e.target.value.replace(/[^\d.,]/g, ''))}
          aria-label="Horómetro del otro motor" data-horometro-otro className={claseNumero} />
      </Campo>

      {modo === 'inicio' && (
        <Campo etiqueta="¿Qué le pasó? (opcional)">
          <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ej.: se dañó la bomba" data-motivo-reemplazo />
        </Campo>
      )}

      <Campo etiqueta="Fecha y hora" requerido>
        <input type="datetime-local" value={fechaHora} onChange={(e) => setFechaHora(e.target.value)} aria-label="Fecha y hora" data-fecha-hora
          className="min-h-11 w-60 rounded-lg border border-slate-200 bg-white px-3 py-2 text-base focus:border-brand-600 focus:outline-none" />
      </Campo>
    </MarcoRegistro>
  )
}
