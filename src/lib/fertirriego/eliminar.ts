/**
 * Eliminar por completo un registro de Fertirriego (sql/119). Lógica pura: reglas del motivo, nombres de tipo y
 * cómo entender lo que responde la base. La base decide todo (permiso, turno archivado, saldo); aquí no se promete
 * lo que ella rechaza.
 */

import type { EstadoCampo } from './tipos'

/** Mínimo de letras del motivo (la misma regla que la base). */
export const MINIMO_MOTIVO_ELIMINAR = 15

export type TipoEliminable = 'aplicacion' | 'recepcion' | 'conteo' | 'devolucion' | 'relevo' | 'traslado' | 'bitacora'

export const NOMBRE_TIPO_ELIMINABLE: Record<TipoEliminable, string> = {
  aplicacion: 'Aplicación',
  recepcion: 'Recepción',
  conteo: 'Conteo',
  devolucion: 'Devolución',
  relevo: 'Relevo',
  traslado: 'Traslado',
  bitacora: 'Horas de riego',
}

export const TIPOS_ELIMINABLES = Object.keys(NOMBRE_TIPO_ELIMINABLE) as TipoEliminable[]

export function esTipoEliminable(t: string): t is TipoEliminable {
  return t in NOMBRE_TIPO_ELIMINABLE
}

/** null = el motivo sirve; si no, qué falta. */
export function errorMotivoEliminar(motivo: string): string | null {
  const n = motivo.trim().length
  if (n === 0) return 'Escribe por qué se elimina.'
  if (n < MINIMO_MOTIVO_ELIMINAR) return `Explica un poco más el motivo (mínimo ${MINIMO_MOTIVO_ELIMINAR} letras; llevas ${n}).`
  return null
}

export type ResultadoEliminar = {
  ok: boolean
  tipo: TipoEliminable
  eliminados: Record<string, number>
  saldos_negativos?: { estacion: string; material: string; saldo: number }[]
}

/** Texto para el aviso «Registro eliminado» (con la advertencia si algún saldo quedó en negativo). */
export function resumenEliminado(r: ResultadoEliminar | null | undefined): string {
  const neg = r?.saldos_negativos ?? []
  if (neg.length === 0) return 'Registro eliminado.'
  const lista = neg.map((n) => `${n.material} (${n.saldo})`).join(', ')
  return `Registro eliminado. Ojo: quedó saldo negativo en ${lista}.`
}

/** ¿El error es de falta de red (y no un rechazo de la base)? */
export function esFaltaDeSenal(e: unknown): boolean {
  const m = String((e as { message?: string } | null)?.message ?? e ?? '').toLowerCase()
  return m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network request failed') || m.includes('load failed')
}

/** Lo que se muestra cuando la copia completa de lo eliminado ya se bajó a AGL y se borró de Supabase (sql/121). */
export const TEXTO_COPIA_EN_AGL = 'La copia completa de este registro está en AGL (Fertirriego › Eliminados)'

/**
 * Estado del teléfono SIN un documento eliminado (y todo lo que de él cuelga). Se aplica en el acto, al confirmarse el
 * RPC, para que el registro desaparezca de la lista sin esperar la sincronización (en el campo puede tardar); la
 * sincronización que sigue trae después la verdad del servidor. Pura: no modifica el estado recibido.
 */
export function quitarDocumentoDelEstado(estado: EstadoCampo, documentoId: string): EstadoCampo {
  const docs = new Set<string>([documentoId])
  const quitados = new Set<string>(estado.movimientos.filter((m) => docs.has(m.documento_id)).map((m) => m.id))
  // Las anulaciones y devoluciones de lo quitado también se van (apuntan a sus movimientos)
  for (let i = 0; i < 3; i++) {
    for (const m of estado.movimientos) if (m.anula_id && quitados.has(m.anula_id)) quitados.add(m.id)
  }
  const fuera = estado.movimientos.filter((m) => quitados.has(m.id))
  const saldos = estado.saldos.map((s) => {
    const resta = fuera.filter((m) => m.estacion_id === s.estacion_id && m.material_id === s.material_id).reduce((t, m) => t + m.cantidad, 0)
    return resta ? { ...s, disponible: s.disponible - resta } : s
  })
  const sinId = <T extends { id: string }>(lista: T[] | undefined) => (lista ? lista.filter((x) => x.id !== documentoId) : lista)
  return {
    ...estado,
    saldos,
    movimientos: estado.movimientos.filter((m) => !quitados.has(m.id)),
    recepciones: sinId(estado.recepciones) ?? [],
    aplicaciones: sinId(estado.aplicaciones) ?? [],
    conteos: sinId(estado.conteos),
    relevos: sinId(estado.relevos),
    traslados: sinId(estado.traslados),
    envases_movimientos: estado.envases_movimientos?.filter((m) => m.documento_id !== documentoId),
  }
}
