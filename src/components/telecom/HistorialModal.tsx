'use client'

/**
 * Por cuántas manos ha pasado una línea o un equipo.
 *
 * No hay tabla de historial: el historial ES la tabla de asignaciones
 * leída al revés. Por eso esto no consulta un registro de auditoría sino
 * las mismas filas que ya sostienen el módulo, y por eso no puede
 * desincronizarse de lo que la pantalla enseña.
 *
 * Se abre desde la cuadrícula tocando el número o el IMEI: es el gesto
 * natural —«¿de quién era esto antes?»— y no merece un botón más en una
 * fila que ya tiene tres.
 */

import { useEffect, useState } from 'react'
import { Alerta, Esqueleto, Insignia } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { mensajeDeError } from '@/lib/errores'
import { leerHistorial } from '@/lib/telecom/repositorioCliente'
import type { TramoHistorial } from '@/lib/telecom/tipos'

export type Consulta = { tipo: 'LINEA' | 'EQUIPO'; llave: string; titulo: string }

export function HistorialModal({
  consulta,
  onCerrar,
}: {
  consulta: Consulta | null
  onCerrar: () => void
}) {
  if (!consulta) return null
  return <Contenido key={`${consulta.tipo}-${consulta.llave}`} consulta={consulta} onCerrar={onCerrar} />
}

function Contenido({ consulta, onCerrar }: { consulta: Consulta; onCerrar: () => void }) {
  const [tramos, setTramos] = useState<TramoHistorial[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      const { datos, error: e } = await leerHistorial(consulta.tipo, consulta.llave)
      if (!vivo) return
      if (e) {
        setError(
          mensajeDeError(
            e,
            'No se pudo leer el historial. Si dice que no existe «fn_telecom_historial», falta correr la migración 47.'
          )
        )
        setTramos([])
        return
      }
      setTramos(datos)
    }
    cargar()
    return () => {
      vivo = false
    }
  }, [consulta])

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`Historial de ${consulta.tipo === 'LINEA' ? 'la línea' : 'el equipo'} ${consulta.titulo}`}
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta>{error}</Alerta>}

        {tramos === null && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Esqueleto key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {tramos?.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">
            Todavía no se le ha entregado a nadie.
          </p>
        )}

        {/* Línea de tiempo: la raya vertical es lo que hace que se lea
            como una sucesión y no como una tabla de cuatro columnas. */}
        <ol className="relative flex flex-col gap-4 pl-5">
          {(tramos ?? []).map((t, i) => (
            <li key={t.id} className="relative">
              <span
                aria-hidden
                className={`absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full ${
                  t.estado === 'VIGENTE' ? 'bg-emerald-600' : 'bg-slate-300'
                }`}
              />
              {i < (tramos?.length ?? 0) - 1 && (
                <span
                  aria-hidden
                  className="absolute -left-[15px] top-5 h-[calc(100%+0.6rem)] w-px bg-slate-200"
                />
              )}

              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <p className="text-sm font-bold text-slate-900">
                  {t.empleado}
                  {t.codigo_empleado && (
                    <span className="ml-1.5 font-normal text-slate-400">{t.codigo_empleado}</span>
                  )}
                </p>
                {t.estado === 'VIGENTE' ? (
                  <Insignia tono="verde">Lo tiene ahora</Insignia>
                ) : (
                  <span className="text-xs text-slate-400">
                    {t.dias} {t.dias === 1 ? 'día' : 'días'}
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-500">
                {[t.puesto, t.departamento].filter(Boolean).join(' · ') || 'Sin puesto'}
              </p>
              <p className="text-xs text-slate-400">
                {t.fecha_entrega} → {t.fecha_devolucion_real ?? 'sigue asignado'}
                {t.estado === 'VIGENTE' && ` · ${t.dias} ${t.dias === 1 ? 'día' : 'días'}`}
              </p>
              {t.observaciones && (
                <p className="mt-0.5 text-xs italic text-slate-400">{t.observaciones}</p>
              )}
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  )
}
