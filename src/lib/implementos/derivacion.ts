/**
 * De qué tipo es cada fierro.
 *
 * Hay dos catálogos y la gente sólo conoce uno: el operador dice
 * «salió el ROMSR-01», no «salió un Romplow». Por eso la captura pide el
 * CÓDIGO FÍSICO y el tipo —que es de donde sale la tarifa SAP— se deduce
 * de él.
 *
 * Funciones puras: entran catálogos, sale un id o un nombre. La misma
 * deducción la hace la base con un disparador, para que valga también
 * para la importación masiva del histórico; esto es sólo para poder
 * enseñarlo en pantalla sin ir y volver al servidor.
 */

export type ImplementoFisicoOpcion = {
  id: string
  codigo: string
  descripcion: string
  /** Tipo SAP al que pertenece. Nulo mientras nadie lo empareje. */
  implemento_id?: string | null
}

export type ImplementoTipo = { id: string; nombre: string; codigo?: string | null }

/** El tipo SAP que corresponde a un código físico, o null si no lo tiene. */
export function tipoDelFisico(
  fisicos: ImplementoFisicoOpcion[],
  fisicoId: string | null | undefined
): string | null {
  if (!fisicoId) return null
  return fisicos.find((f) => f.id === fisicoId)?.implemento_id ?? null
}

/** Cómo se llama ese tipo, para enseñarlo sin que se pueda editar. */
export function nombreDelTipo(
  tipos: ImplementoTipo[],
  tipoId: string | null | undefined
): string | null {
  if (!tipoId) return null
  return tipos.find((t) => t.id === tipoId)?.nombre ?? null
}

/**
 * Lo que se escribe en el campo «Implemento utilizado» de la pantalla.
 *
 * Los tres casos se dicen distinto a propósito: «sin implemento» es una
 * decisión, y «este código todavía no tiene tipo» es un pendiente del
 * catálogo que alguien tiene que resolver. Confundirlos deja labores sin
 * costo de implemento sin que nadie se entere.
 */
export function textoImplementoDeducido(
  tipos: ImplementoTipo[],
  fisicos: ImplementoFisicoOpcion[],
  fisicoId: string | null | undefined
): { texto: string; pendiente: boolean } {
  if (!fisicoId) return { texto: 'Sin implemento / no aplica', pendiente: false }

  const tipo = tipoDelFisico(fisicos, fisicoId)
  if (!tipo) {
    return {
      texto: 'Este código todavía no tiene tipo en el catálogo',
      pendiente: true,
    }
  }

  return { texto: nombreDelTipo(tipos, tipo) ?? 'Tipo desconocido', pendiente: !nombreDelTipo(tipos, tipo) }
}

/**
 * Los códigos físicos que aplican a una labor.
 *
 * Se filtra por labor a propósito: una lista de 94 fierros hace que el
 * digitador elija el equivocado, y de eso se trata la vinculación. Si la
 * labor no tiene ninguno vinculado se devuelven todos, que es mejor que
 * dejar la captura sin poder elegir nada.
 */
export function fisicosDeLabor(
  fisicos: ImplementoFisicoOpcion[],
  vinculos: { labor_id: string; implemento_fisico_id: string }[],
  laborId: string | null | undefined
): ImplementoFisicoOpcion[] {
  if (!laborId) return []
  const ids = new Set(
    vinculos.filter((v) => v.labor_id === laborId).map((v) => v.implemento_fisico_id)
  )
  if (ids.size === 0) return fisicos
  return fisicos.filter((f) => ids.has(f.id))
}
