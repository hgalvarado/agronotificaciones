/**
 * ¿Se dibuja este botón?
 *
 * Es el reflejo exacto de `fn_verificar_permiso` en la base, para que la
 * pantalla esconda lo mismo que Postgres rechaza. Si la regla se
 * escribiera dos veces con matices distintos pasaría una de dos cosas, y
 * las dos son malas: o el usuario pulsa un botón y recibe un error de
 * permisos, o no ve un botón que sí le correspondía y da por imposible
 * algo que podía hacer.
 *
 * Funciones puras: ni React, ni Supabase, ni `fetch`. Se prueban sin
 * navegador y las pueden importar tanto las páginas del servidor como
 * los componentes `'use client'`.
 */

import type { Alcance, Condicion } from './abac'
import { SIN_MIGRACION } from './puede'

/** La regla efectiva del usuario para un cruce pantalla:acción. */
export type Regla = {
  alcance: Alcance
  condicion: Condicion
}

export const REGLA_ABIERTA: Regla = { alcance: 'global', condicion: 'sin_restriccion' }

/**
 * El mapa `"pantalla:accion" → regla` que devuelve `fn_mis_permisos()`.
 *
 * Una llave ausente quiere decir que la acción no está concedida. Es el
 * mismo conjunto que `puede()` consulta, con los otros dos ejes pegados.
 */
export type Reglas = Map<string, Regla>

/**
 * Las mismas reglas, en una forma que cruza del servidor al navegador.
 *
 * Un `Map` dentro de las props de un componente de cliente obliga a
 * confiar en cómo serializa cada versión del framework; una lista de
 * pares es JSON y punto. Se arma de vuelta con `armarReglas`.
 */
export type ReglasPlanas = [string, Regla][]

export function aplanarReglas(reglas: Reglas): ReglasPlanas {
  return [...reglas.entries()]
}

export function armarReglas(planas: ReglasPlanas | null | undefined): Reglas {
  return new Map(planas ?? [])
}

/**
 * Lo que hace falta saber de la fila para decidir.
 *
 * Van sueltos y no como un registro entero a propósito: la misma
 * pregunta la hacen pantallas con formas distintas —un ticket, un
 * horómetro, una labor, una línea de rotación— y obligarlas a un tipo
 * común sería inventar una forma que ninguna tiene.
 *
 * `undefined` quiere decir «esta fila no tiene ese atributo», y entonces
 * ese eje no recorta. Es la misma regla que aplica `fn_verificar_permiso`
 * cuando recibe un parámetro nulo, y es lo que permite preguntar sin
 * fila —`canExecuteAction(reglas, p, a, {})`— para decidir si la pantalla
 * enseña el botón «Nuevo».
 */
export type Fila = {
  /** Quién capturó el registro. */
  duenoId?: string | null
  /** La zona del registro, para el recorte zonal. */
  zonaId?: string | null
  /** El proceso del ticket del que cuelga. */
  proceso?: string | null
  /** El estado del ticket: `ABIERTO` es «activo». */
  estado?: string | null
}

/** El orden de los cuatro pasos. Es el mismo de `fn_nivel_proceso`. */
const PASOS = ['REGISTRADO', 'REVISANDO', 'PENDIENTE_APROBACION', 'NOTIFICADO']

export function nivelDeProceso(proceso: string | null | undefined): number {
  if (proceso == null) return 0
  const i = PASOS.indexOf(proceso)
  return i < 0 ? 0 : i
}

/**
 * Ya se liquidó en SAP.
 *
 * Es el único tope que NINGUNA casilla abre, ni siquiera la del
 * Administrador desde la matriz. Se corrige devolviendo el ticket a un
 * paso anterior, que es una decisión de quien revisa.
 */
export function estaNotificado(proceso: string | null | undefined): boolean {
  return proceso === 'NOTIFICADO'
}

/** Las acciones que no modifican nada: la condición no las toca. */
const LECTURA = new Set(['ver', 'exportar', 'descargar', 'read'])

export function esAccionDeLectura(accion: string): boolean {
  return LECTURA.has(accion)
}

/**
 * La regla efectiva para un cruce, o `null` si no está concedido.
 *
 * `SIN_MIGRACION` es el caso en que `fn_mis_permisos` todavía no existe:
 * se concede todo en vez de dejar a la empresa sin poder trabajar por una
 * migración pendiente. La base sigue rechazando lo que no corresponda.
 */
export function reglaDe(
  reglas: Reglas,
  pantalla: string,
  accion: string
): Regla | null {
  if (reglas.has(SIN_MIGRACION)) return REGLA_ABIERTA
  return reglas.get(`${pantalla}:${accion}`) ?? null
}

/**
 * ¿Puede esta persona hacer esta acción sobre esta fila?
 *
 * Los tres ejes, en el mismo orden que `fn_verificar_permiso`:
 *
 *   1 · ¿Está concedida la acción?
 *   2 · ALCANCE — ¿sobre esta fila? Global no recorta; propietario pide
 *       ser el autor; zonal acepta al autor o la zona asignada.
 *   3 · CONDICIÓN — ¿en este estado? `solo_abiertos_registrando` exige
 *       ticket abierto y todavía en el paso 0.
 *
 * Y por encima de todo, NOTIFICADO.
 */
export function canExecuteAction(
  reglas: Reglas,
  pantalla: string,
  accion: string,
  fila: Fila = {},
  contexto: { usuarioId?: string | null; zonas?: Set<string> } = {}
): boolean {
  const regla = reglaDe(reglas, pantalla, accion)
  if (regla === null) return false

  const lectura = esAccionDeLectura(accion)

  // El tope duro. Leer un ticket notificado sí se puede; tocarlo no.
  if (!lectura && estaNotificado(fila.proceso)) return false

  /* ------------------------------ Alcance --------------------------- */
  if (regla.alcance !== 'global' && fila.duenoId != null) {
    const esMio = contexto.usuarioId != null && fila.duenoId === contexto.usuarioId
    if (regla.alcance === 'propietario' && !esMio) return false
    if (regla.alcance === 'zonal' && !esMio) {
      // Sin zonas asignadas, el eje zonal no recorta: es lo que hace
      // `fn_ve_zona` en la base.
      const zonas = contexto.zonas
      if (zonas && zonas.size > 0) {
        if (fila.zonaId == null || !zonas.has(fila.zonaId)) return false
      }
    }
  }

  /* ----------------------------- Condición -------------------------- */
  if (!lectura && regla.condicion === 'solo_abiertos_registrando') {
    // `undefined` es «no sé el estado de la fila»: no recorta, porque la
    // pregunta sin fila es «¿podría llegar a hacerlo?».
    if (fila.estado != null && fila.estado !== 'ABIERTO') return false
    if (fila.proceso != null && nivelDeProceso(fila.proceso) > 0) return false
  }

  return true
}

/**
 * Las zonas que puede elegir al CREAR.
 *
 * Cuando el alcance de `crear` es zonal, el selector de Lote o de Zona
 * tiene que ofrecer únicamente lo que el usuario tiene asignado: dejarle
 * elegir una zona ajena es dejarle llenar un formulario entero para que
 * la base lo rechace al guardar.
 *
 * Devuelve `null` cuando NO hay que recortar —alcance global, o sin
 * zonas asignadas—, que es distinto de devolver un conjunto vacío.
 */
export function zonasParaCrear(
  reglas: Reglas,
  pantalla: string,
  zonasDelPerfil: string[] | Set<string> | null | undefined
): Set<string> | null {
  const regla = reglaDe(reglas, pantalla, 'crear')
  if (regla === null || regla.alcance !== 'zonal') return null

  const zonas = zonasDelPerfil instanceof Set ? zonasDelPerfil : new Set(zonasDelPerfil ?? [])
  return zonas.size > 0 ? zonas : null
}

/** Deja en la lista sólo lo que cae en las zonas permitidas. */
export function filtrarPorZona<T>(
  opciones: T[],
  zonaDe: (o: T) => string | null | undefined,
  permitidas: Set<string> | null
): T[] {
  if (permitidas === null) return opciones
  return opciones.filter((o) => {
    const z = zonaDe(o)
    return z != null && permitidas.has(z)
  })
}
