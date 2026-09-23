'use client'

/**
 * La bitácora de solicitudes al proveedor: registrarlas y verlas.
 *
 * Lo que se le PIDE a Tigo o a Claro —bajar a Plan $1, suspender,
 * portar— se pedía por teléfono y luego nadie sabía cuándo ni quién. Sin
 * ese rastro, un cambio de plan pedido en marzo que el proveedor no
 * aplicó no se puede reclamar en junio.
 *
 * Quién la registra NO es un campo del formulario: lo pone la base desde
 * la sesión. Dejar escribirlo vaciaría de sentido la bitácora justo el
 * día que hay que usarla.
 */

import { useEffect, useState } from 'react'
import { Alerta, AreaTexto, Boton, Campo, Entrada, Esqueleto } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { hoyIso } from '@/lib/fechas'
import { mensajeDeError } from '@/lib/errores'
import { leerBitacora, registrarSolicitud } from '@/lib/telecom/repositorioCliente'
import { ACCIONES_SOLICITUD, etiquetaAccion, type Solicitud } from '@/lib/telecom/tipos'

/* ================================================================== */
/* Registrar                                                           */
/* ================================================================== */

export function RegistrarSolicitudModal({
  numero,
  onCerrar,
  onGuardado,
}: {
  numero: string | null
  onCerrar: () => void
  onGuardado: () => void
}) {
  if (!numero) return null
  return <Formulario key={numero} numero={numero} onCerrar={onCerrar} onGuardado={onGuardado} />
}

function Formulario({
  numero,
  onCerrar,
  onGuardado,
}: {
  numero: string
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [accion, setAccion] = useState('')
  const [fecha, setFecha] = useState(hoyIso())
  const [detalle, setDetalle] = useState('')
  const [comentarios, setComentarios] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    if (!accion) return setError('Elige qué se le pidió al proveedor.')
    setError(null)
    setGuardando(true)
    const { error: e } = await registrarSolicitud({ numero, accion, detalle, comentarios, fecha })
    setGuardando(false)
    if (e) {
      return setError(
        mensajeDeError(
          e,
          'No se pudo registrar. Si dice que no existe «fn_telecom_registrar_solicitud», falta correr la migración 49.'
        )
      )
    }
    onGuardado()
    onCerrar()
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`Registrar solicitud · ${numero}`}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Registrar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta>{error}</Alerta>}

        <p className="text-sm text-slate-500">
          Queda con la fecha, con tu nombre y con lo que escribas. Es el rastro con el que se le
          reclama al proveedor si no lo aplica.
        </p>

        <Campo etiqueta="Qué se pidió" requerido>
          <SelectorBuscable
            valor={accion}
            opciones={ACCIONES_SOLICITUD.map((a) => ({ id: a.valor, titulo: a.etiqueta }))}
            onCambiar={setAccion}
            placeholder="Elige la acción…"
            etiquetaBusqueda="Buscar acción…"
            permitirVacio={false}
          />
        </Campo>

        <Campo
          etiqueta="Fecha de la solicitud"
          requerido
          ayuda="El día en que se pidió, no el de hoy si se registra después."
        >
          <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Campo>

        <Campo etiqueta="Detalle">
          <Entrada
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            placeholder="Bajar a Plan $1"
          />
        </Campo>

        <Campo etiqueta="Comentarios">
          <AreaTexto
            rows={3}
            value={comentarios}
            onChange={(e) => setComentarios(e.target.value)}
            placeholder="Con quién se habló, número de caso…"
          />
        </Campo>
      </div>
    </Modal>
  )
}

/* ================================================================== */
/* Ver el historial                                                    */
/* ================================================================== */

export function BitacoraModal({
  numero,
  onCerrar,
}: {
  numero: string | null
  onCerrar: () => void
}) {
  if (!numero) return null
  return <Linea key={numero} numero={numero} onCerrar={onCerrar} />
}

function Linea({ numero, onCerrar }: { numero: string; onCerrar: () => void }) {
  const [filas, setFilas] = useState<Solicitud[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      const { datos, error: e } = await leerBitacora(numero)
      if (!vivo) return
      if (e) {
        setError(
          mensajeDeError(
            e,
            'No se pudo leer la bitácora. Si dice que no existe «fn_telecom_bitacora», falta correr la migración 49.'
          )
        )
        setFilas([])
        return
      }
      setFilas(datos)
    }
    cargar()
    return () => {
      vivo = false
    }
  }, [numero])

  return (
    <Modal abierto onCerrar={onCerrar} titulo={`Solicitudes de la línea ${numero}`}>
      <div className="flex flex-col gap-3">
        {error && <Alerta>{error}</Alerta>}

        {filas === null && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Esqueleto key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {filas?.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">
            Todavía no se le ha pedido nada al proveedor sobre esta línea.
          </p>
        )}

        {/* La misma línea de tiempo del historial de asignaciones: la raya
            vertical es lo que hace que se lea como una sucesión. */}
        <ol className="relative flex flex-col gap-4 pl-5">
          {(filas ?? []).map((s, i) => (
            <li key={s.id} className="relative">
              <span
                aria-hidden
                className="absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full bg-brand-600"
              />
              {i < (filas?.length ?? 0) - 1 && (
                <span
                  aria-hidden
                  className="absolute -left-[15px] top-5 h-[calc(100%+0.6rem)] w-px bg-slate-200"
                />
              )}

              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <p className="text-sm font-bold text-slate-900">{etiquetaAccion(s.accion)}</p>
                <span className="text-xs text-slate-400">{s.fecha}</span>
              </div>

              {s.detalle && <p className="text-sm text-slate-600">{s.detalle}</p>}
              {s.comentarios && (
                <p className="mt-0.5 text-xs italic text-slate-400">{s.comentarios}</p>
              )}
              <p className="text-xs text-slate-400">
                Solicitó: {s.responsable ?? 'sin registrar'}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  )
}
