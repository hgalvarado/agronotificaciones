/**
 * Las cuentas y las reglas del módulo de desinfección, sin pantalla.
 *
 * Funciones puras: ni React, ni Supabase, ni `fetch`. Se prueban solas y
 * las pueden importar tanto el formulario como la cuadrícula.
 *
 * **Lo que se calcula aquí NO es lo que se guarda.** El costo del personal
 * lo pone el disparador `fn_desinfeccion_costo_personal` y los totales del
 * plan son columnas generadas. Lo de aquí es la VISTA PREVIA: el número
 * que la persona necesita ver mientras teclea, antes de guardar. Por eso
 * la fórmula está escrita con la misma forma que la de la base —misma
 * base de ocho horas, mismo factor— y por eso el número que queda en
 * pantalla después de guardar es el que devolvió la base, no éste.
 */

import { sumarDias } from '@/lib/fechas'
import { FASES, JORNADAS, type EntradaEjecucion, type EntradaLogistica, type EntradaPlan, type EstadoDesinfeccion, type JornadaTipo, type LecturaTensiometro, type LineaLote, type LineaPersonal } from './tipos'

/** La base sobre la que se calcula la hora extra. Es la de la migración 59. */
export const HORAS_JORNADA = 8

/**
 * Texto de un campo numérico a número.
 *
 * Vacío devuelve `null` y no `0`: «no escribió nada» y «escribió cero» no
 * son lo mismo, y confundirlos es lo que hace que un total diga 0 cuando
 * en realidad no hay con qué calcularlo.
 */
export function aNumero(texto: string | null | undefined): number | null {
  const t = (texto ?? '').trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Lo mismo, pero donde un vacío sí significa cero (horas, cantidades). */
export function aNumeroCero(texto: string | null | undefined): number {
  return aNumero(texto) ?? 0
}

export function factorDe(tipo: JornadaTipo): number {
  return JORNADAS.find((j) => j.valor === tipo)?.factor ?? 1.25
}

/**
 * El costo de una línea de personal.
 *
 *     costo = personas × ( tarifa_día × jornadas
 *                        + horas_extras × (tarifa_día / 8) × factor )
 *
 * Es la misma expresión de `fn_desinfeccion_costo_personal`. Sin tarifa
 * devuelve `null` —no cero—: una cuadrilla cuyo puesto todavía no tiene
 * tarifa vigente no cuesta cero, es que no se sabe cuánto cuesta.
 */
export function costoPersonal(
  linea: Pick<LineaPersonal, 'cantidadPersonas' | 'jornadas' | 'horasExtras' | 'jornadaTipo'>,
  tarifaDia: number | null | undefined
): number | null {
  if (tarifaDia === null || tarifaDia === undefined) return null
  const personas = aNumeroCero(linea.cantidadPersonas)
  const jornadas = aNumeroCero(linea.jornadas)
  const extras = aNumeroCero(linea.horasExtras)
  return (
    personas *
    (tarifaDia * jornadas + extras * (tarifaDia / HORAS_JORNADA) * factorDe(linea.jornadaTipo))
  )
}

/** Suma lo que se sepa. `null` sólo si NINGUNA línea tiene tarifa. */
export function costoCuadrilla(
  lineas: LineaPersonal[],
  tarifaDe: (puestoId: string) => number | null | undefined
): number | null {
  let hay = false
  let total = 0
  for (const l of lineas) {
    const c = costoPersonal(l, tarifaDe(l.puestoId))
    if (c === null) continue
    hay = true
    total += c
  }
  return hay ? total : null
}

/** El ácido del turno: litros × costo por litro. Es la columna generada. */
export function costoAcido(e: Pick<EntradaEjecucion, 'litrosAcido' | 'costoLitroAcido'>): number {
  return aNumeroCero(e.litrosAcido) * aNumeroCero(e.costoLitroAcido)
}

export function mzDeLotes(lineas: LineaLote[]): number {
  return lineas.reduce((a, l) => a + aNumeroCero(l.mzCubiertas), 0)
}

/**
 * Las horas de riego que SUGIERE el formulario: presurización +
 * inyección + lavado.
 *
 * Se sugiere y no se impone porque el total lo manda el reporte de campo,
 * y hay turnos en que el riego sigue después de lavar. Sobrescribir lo
 * que la persona escribió con una cuenta nuestra es cambiarle el dato sin
 * decírselo.
 */
export function horasSugeridas(e: EntradaEjecucion): number | null {
  const inicio = minutosDe(e.horaInicioIny)
  const fin = minutosDe(e.horaFinIny)
  const iny = inicio !== null && fin !== null && fin >= inicio ? (fin - inicio) / 60 : 0
  const total = aNumeroCero(e.horasPresurizacion) + iny + aNumeroCero(e.horasLavado)
  return total > 0 ? Math.round(total * 100) / 100 : null
}

/** HH:MM a minutos desde medianoche. `null` si no es una hora. */
export function minutosDe(hora: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((hora ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** La fecha de aplicación que la base va a generar: congelada + días. */
export function fechaAplicacionPrevista(e: EntradaPlan): string | null {
  if (!e.fechaSiembraCongelada) return null
  return sumarDias(e.fechaSiembraCongelada, Math.trunc(aNumeroCero(e.diasAplicacion)))
}

/** Los tres totales del plan, tal como los genera la base. */
export function totalesPlan(e: EntradaPlan): { litros: number; costo: number; costoMz: number } {
  const dosis = aNumeroCero(e.dosisMz)
  const area = aNumeroCero(e.areaPlanificadaMz)
  const costoLitro = aNumeroCero(e.costoLitro)
  const litros = dosis * area
  const costo = litros * costoLitro
  return { litros, costo, costoMz: area > 0 ? costo / area : 0 }
}

/* ------------------------------------------------------------------ */
/* La fase, y qué se puede tocar en cada una                           */
/* ------------------------------------------------------------------ */

export function nivelDeFase(estado: EstadoDesinfeccion): number {
  const i = FASES.findIndex((f) => f.valor === estado)
  return i < 0 ? 0 : i
}

/**
 * ¿Está cerrada la captura de este turno?
 *
 * **Esto es una convención de PANTALLA, no seguridad.** La base no
 * bloquea nada por fase: desinfección no cuelga de un ticket, así que no
 * tiene el tope de NOTIFICADO que sí tienen las labores. Lo que hace es
 * evitar el error de pasada —corregir una celda de un turno que ya se
 * cerró creyendo que se está capturando el de hoy—, y por eso el candado
 * se abre a propósito desde el formulario, con un interruptor visible, en
 * vez de esconder el turno.
 *
 * Si algún día esto tiene que ser una regla de verdad, va en RLS: aquí
 * sólo se esconde, nunca se concede.
 */
export function faseCerrada(estado: EstadoDesinfeccion): boolean {
  return nivelDeFase(estado) >= nivelDeFase('3_Aplicacion')
}

/**
 * Qué renglones hay que borrar al guardar: los que estaban y ya no están.
 *
 * Vive aquí, suelto y probado, porque es donde estuvo el fallo: la
 * primera versión comparaba contra los identificadores del FORMULARIO, y
 * un renglón recién creado todavía no tiene identificador. Resultado: se
 * insertaba y, dos líneas más abajo, se borraba por «sobrante». Lo que
 * hay que comparar es contra los identificadores que quedaron VIVOS
 * después de guardar, los nuevos incluidos.
 */
export function idsSobrantes(antes: { id: string }[], vivos: Iterable<string>): string[] {
  const quedan = new Set([...vivos].filter(Boolean))
  return antes.map((a) => a.id).filter((id) => !quedan.has(id))
}

/** Las lecturas que de verdad tienen algo escrito. */
export function lecturasParaGuardar(lecturas: LecturaTensiometro[]): LecturaTensiometro[] {
  return lecturas.filter((l) =>
    [l.punto, l.profundidad, l.lectura, l.hora, l.nota].some((v) => (v ?? '').trim() !== '')
  )
}

/* ------------------------------------------------------------------ */
/* Validación                                                          */
/* ------------------------------------------------------------------ */
/* Devuelven el problema en texto, o `null` si no hay ninguno. Dicen    */
/* QUÉ falta y no «revisa el formulario»: con diecisiete campos, ese    */
/* aviso obliga a buscarlo a ojo.                                       */

export function validarPlan(e: EntradaPlan): string | null {
  if (!e.temporadaId) return 'Elige la temporada.'
  if (!e.loteTemporadaId) return 'Elige el lote.'
  if (!e.fechaSiembraCongelada) return 'Falta la fecha de siembra.'
  const ciclo = aNumero(e.ciclo)
  if (ciclo === null || ciclo < 1) return 'El ciclo tiene que ser 1 o más.'
  for (const [campo, etiqueta] of [
    ['dosisMz', 'La dosis por manzana'],
    ['areaPlanificadaMz', 'El área planificada'],
    ['costoLitro', 'El costo por litro'],
  ] as const) {
    const v = aNumero(e[campo])
    if (v !== null && v < 0) return `${etiqueta} no puede ser negativa.`
  }
  return null
}

export function validarEjecucion(
  e: EntradaEjecucion,
  lotes: LineaLote[],
  personal: LineaPersonal[]
): string | null {
  if (!e.temporadaId) return 'Elige la temporada.'
  if (!e.turnoId) return 'Elige el turno de riego.'

  const ini = minutosDe(e.horaInicioPreriego)
  const fin = minutosDe(e.horaFinPreriego)
  if (ini !== null && fin !== null && fin < ini) {
    return 'El preriego no puede terminar antes de empezar.'
  }

  const iniIny = minutosDe(e.horaInicioIny)
  const finIny = minutosDe(e.horaFinIny)
  if (iniIny !== null && finIny !== null && finIny < iniIny) {
    return 'La inyección no puede terminar antes de empezar.'
  }

  // La fase manda sobre lo que tiene que estar lleno. Dejar guardar una
  // aplicación sin fecha es lo que después deja el costo sin tarifa y sin
  // forma de saber de qué día era.
  if (nivelDeFase(e.estado) >= nivelDeFase('3_Aplicacion') && !e.fechaAplicacion) {
    return 'Una ejecución en fase de Aplicación necesita su fecha de aplicación.'
  }

  const conLote = lotes.filter((l) => l.loteTemporadaId !== '')
  if (new Set(conLote.map((l) => l.loteTemporadaId)).size !== conLote.length) {
    return 'Hay un lote repetido en la lista de lotes regados.'
  }
  for (const l of conLote) {
    const mz = aNumero(l.mzCubiertas)
    if (mz === null || mz <= 0) return 'Cada lote regado necesita sus manzanas.'
  }
  if (lotes.some((l) => l.loteTemporadaId === '' && (l.mzCubiertas ?? '').trim() !== '')) {
    return 'Hay manzanas escritas en un renglón sin lote.'
  }

  for (const p of personal) {
    if (!p.puestoId) {
      if (
        aNumeroCero(p.jornadas) > 0 ||
        aNumeroCero(p.horasExtras) > 0 ||
        (p.operadorId ?? '') !== ''
      ) {
        return 'Hay un renglón de personal sin puesto de trabajo.'
      }
      continue
    }
    const personas = aNumero(p.cantidadPersonas)
    if (personas === null || personas < 1) return 'El personal se cuenta de uno en adelante.'
    if (aNumeroCero(p.jornadas) < 0 || aNumeroCero(p.horasExtras) < 0) {
      return 'Ni las jornadas ni las horas extras pueden ser negativas.'
    }
  }

  // Un costo de químico sin lotes regados no se puede repartir: la vista
  // de costos lo divide entre las manzanas de la ejecución, y sin ellas
  // ese gasto no llega a ningún lote.
  if (costoAcido(e) > 0 && conLote.length === 0) {
    return 'Hay costo de químico pero ningún lote regado: ese gasto no se podría repartir.'
  }

  return null
}

export function validarLogistica(e: EntradaLogistica): string | null {
  if (!e.temporadaId) return 'Elige la temporada.'
  if (!e.zonaId) return 'Elige la zona: la bolsa de acarreo se reparte por zona.'
  if (!e.fecha) return 'Falta la fecha.'
  if (!e.equipoId) return 'Elige el equipo.'
  const horas = aNumero(e.horasTrabajo)
  if (horas === null || horas < 0) return 'Las horas de trabajo no pueden ser negativas.'
  const costo = aNumero(e.costoHora)
  if (costo !== null && costo < 0) return 'El costo por hora no puede ser negativo.'
  return null
}
