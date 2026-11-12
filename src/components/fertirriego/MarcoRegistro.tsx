'use client'

/**
 * El marco común de todo registro del campo: título, quién registra (custodia / «registrar por otro»), la
 * ubicación obligatoria y el botón Guardar. Cada formulario solo arma sus datos (`construir`).
 *
 * Reglas (las mismas de la base, para que la pantalla no prometa lo que la base rechaza):
 *   - Registra quien tiene la estación a cargo.
 *   - Quien tiene «Registrar por otro» (jefe, parametrista) registra a nombre de un estacionero de la estación.
 *   - Sin una de las dos, no se registra (se explica por qué).
 */

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { MENSAJE_UBICACION_DENEGADA, obtenerUbicacion, permisoDenegado } from '@/lib/fertirriego/ubicacion'
import type { Estacion, Operacion, Persona, Ubicacion } from '@/lib/fertirriego/tipos'

const NOMBRE_PERMISO: Record<string, string> = {
  aplicar: 'Aplicar',
  anular: 'Anular',
  relevo: 'Relevo',
  trasladar: 'Trasladar',
  autorizar_traslado: 'Autorizar traslado',
}

export type ContextoRegistro = { ubicacion: Ubicacion | null; enNombreDe: string | null; ejecutor: string }

export function puedeRegistrar(estacion: Estacion, yo: Persona): { si: boolean; porOtro: boolean; motivo: string | null } {
  if (estacion.custodio_id === yo.id && estacion.custodia_estado !== 'EN_ENTREGA') return { si: true, porOtro: false, motivo: null }
  if (estacion.permisos.en_nombre_de) return { si: true, porOtro: true, motivo: null }
  if (!estacion.custodio_id) {
    return { si: false, porOtro: false, motivo: 'La estación todavía no está a cargo de nadie. Pide a tu jefe que te la asigne.' }
  }
  return {
    si: false,
    porOtro: false,
    motivo: `La estación está a cargo de ${estacion.custodio ?? 'otra persona'}. Recíbela en el relevo o pide a tu jefe que te la asigne.`,
  }
}

export function MarcoRegistro({
  titulo,
  estacion,
  yo,
  onCerrar,
  onGuardado,
  registrar,
  construir,
  children,
  textoGuardar = 'Guardar',
  sinCustodia = false,
  permiso = 'aplicar',
}: {
  /**
   * Sin exigir la custodia, solo el permiso: la bitácora de horas (no toca la bodega) y anular con «Anular».
   * Es la misma regla que aplica la base para esos registros.
   */
  sinCustodia?: boolean
  permiso?: 'aplicar' | 'anular' | 'relevo' | 'trasladar' | 'autorizar_traslado'
  titulo: string
  estacion: Estacion
  yo: Persona
  onCerrar: () => void
  onGuardado: (mensaje: string) => void
  registrar: (...ops: Operacion[]) => Promise<void>
  /** Arma los registros, o devuelve el error a mostrar. Puede pedir confirmación con `confirmar`. */
  construir: (ctx: ContextoRegistro) => Operacion[] | string | Promise<Operacion[] | string>
  children: React.ReactNode
  textoGuardar?: string
}) {
  const regla = sinCustodia
    ? estacion.permisos[permiso]
      ? { si: true, porOtro: false, motivo: null }
      : { si: false, porOtro: false, motivo: `Tu rol no tiene «${NOMBRE_PERMISO[permiso]}» en esta estación.` }
    : puedeRegistrar(estacion, yo)
  const [porQuien, setPorQuien] = useState<string>(regla.porOtro ? (estacion.custodio_id ?? '') : yo.id)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    setError(null)
    if (!regla.si) return setError(regla.motivo)
    if (regla.porOtro && !porQuien) return setError('Elige a nombre de quién registras.')
    setGuardando(true)
    try {
      if (await permisoDenegado()) return setError(MENSAJE_UBICACION_DENEGADA)
      const u = await obtenerUbicacion()
      if (u.tipo === 'denegado') return setError(MENSAJE_UBICACION_DENEGADA)
      // Sin la estación a cargo, el registro va SIEMPRE «por otro» (aunque elija su propio nombre): así la base
      // aplica la regla de «Registrar por otro» y no la de custodia
      const enNombreDe = regla.porOtro ? porQuien : null
      const r = await construir({ ubicacion: u.tipo === 'ok' ? u.ubicacion : null, enNombreDe, ejecutor: enNombreDe ?? yo.id })
      if (typeof r === 'string') return setError(r)
      if (r.length === 0) return
      await registrar(...r)
      onGuardado(
        u.tipo === 'ok'
          ? 'Guardado en el teléfono. Se envía solo cuando haya señal.'
          : 'Guardado en el teléfono (el GPS no respondió: quedará marcado «sin ubicación»).'
      )
      onCerrar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`${titulo} · ${estacion.nombre}`}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={() => void guardar()} disabled={guardando || !regla.si} data-guardar-registro>
            {guardando ? 'Guardando…' : textoGuardar}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {!regla.si && <Alerta tono="ambar">{regla.motivo}</Alerta>}
        {regla.si && regla.porOtro && (
          <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
            <p className="mb-1.5 text-xs font-semibold text-amber-800">
              Registras por otra persona (queda anotado que lo hiciste tú)
            </p>
            <SelectorBuscable
              valor={porQuien}
              opciones={[{ id: yo.id, titulo: `${yo.nombre} (yo)` }, ...estacion.personas.filter((p) => p.id !== yo.id).map((p) => ({ id: p.id, titulo: p.nombre }))]}
              onCambiar={setPorQuien}
              placeholder="¿A nombre de quién?"
              etiquetaBusqueda="Buscar persona"
            />
          </div>
        )}
        {children}
        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}
