/**
 * El vocabulario del permiso con atributos.
 *
 * Desde la 53 un permiso ya no es «está o no está la fila»: son tres
 * cosas a la vez —si se permite, sobre QUÉ filas, y BAJO QUÉ estado del
 * registro—. Los tres nombres viven aquí y no repartidos por la matriz,
 * la navegación y cada pantalla, porque son los mismos nombres que usan
 * los dos tipos `alcance_permiso` y `condicion_permiso` de Postgres: una
 * cadena de más en el navegador es un permiso que la base rechaza.
 *
 * Puro: ni React ni Supabase. Se prueba sin navegador.
 */

export type Alcance = 'global' | 'zonal' | 'propietario'
export type Condicion = 'sin_restriccion' | 'solo_abiertos_registrando'

export type ConfigPermiso = {
  permitido: boolean
  alcance: Alcance
  condicion: Condicion
}

/** Lo que vale una celda que nunca se ha tocado. */
export const PERMISO_APAGADO: ConfigPermiso = {
  permitido: false,
  alcance: 'global',
  condicion: 'sin_restriccion',
}

export const ALCANCES: { valor: Alcance; nombre: string; letra: string; detalle: string }[] = [
  {
    valor: 'global',
    nombre: 'Global',
    letra: 'G',
    detalle: 'Toda la empresa, sin recorte de zona ni de autor.',
  },
  {
    valor: 'zonal',
    nombre: 'Zonal',
    letra: 'Z',
    detalle:
      'Lo de las zonas que tenga asignadas, más lo que capturó él. Sin zonas asignadas equivale a global.',
  },
  {
    valor: 'propietario',
    nombre: 'Propietario',
    letra: 'P',
    detalle: 'Únicamente los registros que capturó él.',
  },
]

export const CONDICIONES: { valor: Condicion; nombre: string; detalle: string }[] = [
  {
    valor: 'sin_restriccion',
    nombre: 'Sin restricción',
    detalle: 'Puede hacerlo en cualquier momento del proceso.',
  },
  {
    valor: 'solo_abiertos_registrando',
    nombre: 'Sólo mientras se registra',
    detalle:
      'Sólo con el ticket abierto y todavía en «0. Registrado». En cuanto alguien lo manda a revisión, se le cierra.',
  },
]

/** Lee un alcance que vino de la base sin confiar en que sea válido. */
export function leerAlcance(valor: string | null | undefined): Alcance {
  return ALCANCES.some((a) => a.valor === valor) ? (valor as Alcance) : 'global'
}

export function leerCondicion(valor: string | null | undefined): Condicion {
  return CONDICIONES.some((c) => c.valor === valor) ? (valor as Condicion) : 'sin_restriccion'
}

/** La letra del distintivo de la celda. Vacía cuando no concede nada. */
export function letraDeAlcance(config: ConfigPermiso): string {
  if (!config.permitido) return ''
  return ALCANCES.find((a) => a.valor === config.alcance)?.letra ?? 'G'
}

/**
 * Cómo se lee una celda en una línea.
 *
 * `escribe` dice si la acción modifica datos. La condición sólo recorta
 * la escritura —`fn_verificar_permiso` la salta en las acciones de
 * lectura—, así que nombrarla en «Ver» sería prometer un candado que la
 * base no aplica.
 */
export function resumenPermiso(config: ConfigPermiso, escribe: boolean): string {
  if (!config.permitido) return 'No'
  const alcance = ALCANCES.find((a) => a.valor === config.alcance)?.nombre ?? 'Global'
  if (!escribe || config.condicion === 'sin_restriccion') return alcance
  return `${alcance} · sólo mientras se registra`
}
