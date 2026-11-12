'use client'

/**
 * Guardado rápido (piloto 1, punto 2): el formulario se cierra al tocar Guardar y el registro termina de guardarse
 * en segundo plano (ubicación + almacén del teléfono). Si eso falla, el borrador vuelve y la pantalla muestra un
 * aviso fijo con «Reintentar» y «Avisar». Se comunican por eventos de la ventana para no cruzar props por todos
 * los formularios.
 */

/** Se dispara (sincrónico) al tocar Guardar, con el formulario todavía abierto: la pantalla anota cuál era. */
export const EVENTO_GUARDADO_INICIADO = 'fert:guardado-iniciado'
/** El guardado en segundo plano falló. */
export const EVENTO_GUARDADO_FALLIDO = 'fert:guardado-fallido'

export type GuardadoIniciado = { id: string }
export type GuardadoFallido = { id: string; formulario: string; estacion: string; error: string; hora: string }

export function avisarIniciado(detalle: GuardadoIniciado) {
  window.dispatchEvent(new CustomEvent<GuardadoIniciado>(EVENTO_GUARDADO_INICIADO, { detail: detalle }))
}

export function avisarFallido(detalle: GuardadoFallido) {
  window.dispatchEvent(new CustomEvent<GuardadoFallido>(EVENTO_GUARDADO_FALLIDO, { detail: detalle }))
}

export function textoFallo(f: GuardadoFallido): string {
  return [
    'Fertirriego: no se pudo guardar un registro en el teléfono.',
    `Formulario: ${f.formulario}`,
    `Estación: ${f.estacion}`,
    `Hora: ${f.hora}`,
    `Error: ${f.error}`,
  ].join('\n')
}

/** «Avisar»: compartir el error (WhatsApp u otra app); sin «compartir» en el navegador, abre WhatsApp. */
export async function compartirFallo(f: GuardadoFallido): Promise<void> {
  const text = textoFallo(f)
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: 'Fertirriego: error al guardar', text })
      return
    }
  } catch (e) {
    // La persona cerró el menú de compartir: no hay nada más que hacer
    if (e instanceof Error && e.name === 'AbortError') return
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
}
