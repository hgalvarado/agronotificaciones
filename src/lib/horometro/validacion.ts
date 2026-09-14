/**
 * Validación del horómetro. Funciones puras: entra lo que se escribió en
 * los campos —texto, siempre texto— y sale un valor con forma conocida o
 * un error en castellano.
 *
 * Vive aparte de la pantalla para que la misma regla valga en el
 * formulario de alta, en el de edición y en la edición en línea de la
 * cuadrícula. Una regla escrita tres veces acaba siendo tres reglas
 * distintas.
 */

export const HORAS_HOMBRE_MAXIMAS = 24

export type EntradaHorometro = {
  equipoId: string
  horometroInicial: string
  horometroFinal: string
  horasHombre: string
}

export type HorometroValido = {
  equipoId: string
  horometroInicial: number
  horometroFinal: number
  horasHombre: number
}

export type Resultado =
  | { ok: true; valor: HorometroValido }
  | { ok: false; campo: keyof EntradaHorometro; error: string }

/** Número escrito a mano: admite coma decimal y espacios. */
export function aNumero(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.')
  if (limpio === '') return null
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

/**
 * Las horas hombre, por separado.
 *
 * Se exporta suelta porque la cuadrícula edita esa celda sin pasar por el
 * resto del formulario, y tiene que rechazar exactamente lo mismo.
 *
 * «Vacío» es su propio caso y no «cero»: son dos errores distintos y
 * decirlos igual deja al usuario adivinando cuál cometió.
 */
export function validarHorasHombre(texto: string): { ok: true; valor: number } | { ok: false; error: string } {
  if (texto.trim() === '') {
    return { ok: false, error: 'Las horas hombre son obligatorias.' }
  }
  const n = aNumero(texto)
  if (n === null) return { ok: false, error: 'Las horas hombre no son un número válido.' }
  if (n <= 0) return { ok: false, error: 'Las horas hombre tienen que ser mayores que cero.' }
  if (n > HORAS_HOMBRE_MAXIMAS) {
    return {
      ok: false,
      error: `Una jornada no pasa de ${HORAS_HOMBRE_MAXIMAS} horas. Revisa si sobra un dígito.`,
    }
  }
  return { ok: true, valor: n }
}

/** El horómetro completo, en el orden en que el usuario llena los campos. */
export function validarHorometro(entrada: EntradaHorometro): Resultado {
  if (!entrada.equipoId) {
    return { ok: false, campo: 'equipoId', error: 'Selecciona un equipo.' }
  }

  const inicial = aNumero(entrada.horometroInicial)
  if (inicial === null) {
    return { ok: false, campo: 'horometroInicial', error: 'Escribe la lectura inicial del horómetro.' }
  }
  if (inicial < 0) {
    return { ok: false, campo: 'horometroInicial', error: 'La lectura inicial no puede ser negativa.' }
  }

  const final = aNumero(entrada.horometroFinal)
  if (final === null) {
    return { ok: false, campo: 'horometroFinal', error: 'Escribe la lectura final del horómetro.' }
  }
  if (final < inicial) {
    return {
      ok: false,
      campo: 'horometroFinal',
      error: 'El horómetro final no puede ser menor al inicial.',
    }
  }

  const horas = validarHorasHombre(entrada.horasHombre)
  if (!horas.ok) return { ok: false, campo: 'horasHombre', error: horas.error }

  return {
    ok: true,
    valor: {
      equipoId: entrada.equipoId,
      horometroInicial: inicial,
      horometroFinal: final,
      horasHombre: horas.valor,
    },
  }
}
