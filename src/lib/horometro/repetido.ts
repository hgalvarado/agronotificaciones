/**
 * ¿La lectura que se está capturando repite o se monta sobre otra del mismo equipo ese día?
 *
 * Reglas (pedido del usuario 2026-11-11):
 *   - REPETIDA: mismo inicial y mismo final. Un horómetro no marca lo mismo dos veces en un día, salvo que esté
 *     malo. Casi siempre es el mismo equipo registrado otra vez en vez de agregarle labores al primero.
 *   - TRASLAPE: los rangos se pisan sin ser iguales (p. ej. 100-108 y 104-110). Se avisa, no se frena.
 * Función pura: sin React ni base, para poder probarla sola.
 */

export type LecturaDelDia = {
  id: string
  ticketId: string
  turno: string
  inicial: number
  final: number
  operador: string | null
  labores: number
  /** El ticket es de quien está capturando (puede ir a agregarle labores). */
  esMio: boolean
  /** Quién lo capturó (sólo llega con la migración 88). */
  capturo: string | null
}

/** Marca que queda en el comentario cuando se guarda reportando el horómetro malo. */
export const MARCA_HOROMETRO_MALO = '[Horómetro malo]'

export function revisarRepetido(
  lecturas: LecturaDelDia[],
  inicialTexto: string,
  finalTexto: string
): { repetida: LecturaDelDia | null; traslapes: LecturaDelDia[] } {
  const ini = Number(inicialTexto.replace(',', '.'))
  const fin = Number(finalTexto.replace(',', '.'))
  if (inicialTexto.trim() === '' || finalTexto.trim() === '' || Number.isNaN(ini) || Number.isNaN(fin)) {
    return { repetida: null, traslapes: [] }
  }
  const igual = (a: number, b: number) => Math.abs(a - b) < 0.005
  const repetida = lecturas.find((l) => igual(l.inicial, ini) && igual(l.final, fin)) ?? null
  const traslapes = lecturas.filter(
    (l) => l !== repetida && Math.max(l.inicial, ini) < Math.min(l.final, fin)
  )
  return { repetida, traslapes }
}
