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
import { FASES, JORNADAS, type EntradaEjecucion, type EntradaLogistica, type EntradaPlan, type EstadoDesinfeccion, type JornadaTipo, type LecturaTensiometro, type LineaLote, type LineaPersonal, type LineaProducto } from './tipos'

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

/** Lo que cuesta un químico: litros × costo por litro. */
export function costoProducto(l: Pick<LineaProducto, 'totalLitros' | 'costoLitro'>): number {
  return aNumeroCero(l.totalLitros) * aNumeroCero(l.costoLitro)
}

/**
 * Lo que cuesta el químico de la aplicación: TODOS sus productos.
 *
 * Desde la 60 una aplicación lleva varios —el desinfectante y el ácido, y
 * mañana otro—, así que esto es una suma y no una multiplicación.
 */
export function costoQuimicos(lineas: LineaProducto[]): number {
  return lineas.reduce((a, l) => a + costoProducto(l), 0)
}

/**
 * La dosis por manzana de un producto.
 *
 * Se DEDUCE del total aplicado y de las manzanas del turno; no se
 * captura. Capturadas las dos, un día no cuadran y no hay forma de saber
 * cuál es la buena. Sin manzanas devuelve `null` —no cero—: no es que la
 * dosis sea cero, es que todavía no se sabe entre cuántas se reparte.
 */
export function dosisPorMz(totalLitros: string, mz: number): number | null {
  if (mz <= 0) return null
  return aNumeroCero(totalLitros) / mz
}

export function mzDeLotes(lineas: LineaLote[]): number {
  return lineas.reduce((a, l) => a + aNumeroCero(l.mzCubiertas), 0)
}

/**
 * Las horas entre dos horas del mismo día, sin negativos.
 *
 * Es el reflejo exacto de lo que hace la base con
 * `greatest(fin - inicio, interval '0')`: un fin anterior al inicio no
 * resta horas —un turno de duración negativa no existe— y una hora
 * todavía sin capturar cuenta como cero en vez de anular la suma entera.
 */
export function horasEntre(inicio: string, fin: string): number {
  const a = minutosDe(inicio)
  const b = minutosDe(fin)
  if (a === null || b === null || b <= a) return 0
  return (b - a) / 60
}

/** La duración del preriego. La base la guarda generada. */
export function horasPreriego(e: EntradaEjecucion): number {
  return horasEntre(e.horaInicioPreriego, e.horaFinPreriego)
}

/** La duración de la inyección. También generada en la base. */
export function horasInyeccion(e: EntradaEjecucion): number {
  return horasEntre(e.horaInicioIny, e.horaFinIny)
}

/**
 * El total de horas de riego: presurización + inyección + lavado.
 *
 * Desde la 60 es una COLUMNA GENERADA y el campo está bloqueado en la
 * pantalla. Esto es su reflejo, para enseñar el número mientras se
 * teclea; el que queda guardado es el de la base.
 */
export function totalHorasRiego(e: EntradaEjecucion): number {
  return aNumeroCero(e.horasPresurizacion) + horasInyeccion(e) + aNumeroCero(e.horasLavado)
}

/**
 * Los días que faltan para el trasplante: siembra − lectura.
 *
 * Positivo quiere decir que la siembra todavía está por delante, que es
 * el caso normal al desinfectar. Negativo quiere decir que ya se sembró.
 */
export function ddt(fechaSiembra: string | null | undefined, fechaLectura: string): number | null {
  if (!fechaSiembra || !fechaLectura) return null
  // Las dos son fechas de CALENDARIO, no instantes: se restan en UTC para
  // que ningún reloj les quite un día.
  const s = Date.parse(`${fechaSiembra}T12:00:00Z`)
  const l = Date.parse(`${fechaLectura}T12:00:00Z`)
  if (Number.isNaN(s) || Number.isNaN(l)) return null
  return Math.round((s - l) / 86400000)
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

/* ------------------------------------------------------------------ */
/* El embudo: qué está lleno y por dónde se sigue                      */
/* ------------------------------------------------------------------ */

/**
 * Las secciones del formulario, en el orden en que se capturan.
 *
 * `lotes` va primero y no es una fase del enum: es el PASO 0. Sin saber
 * qué lotes tocó el turno y cuántas manzanas son, ni el químico ni la
 * cuadrilla se pueden repartir entre nadie — el costo se quedaría en el
 * aire. Por eso bloquea a las demás.
 */
export type SeccionEjecucion = 'lotes' | 'preriego' | 'lecturas' | 'aplicacion'

export const SECCIONES: SeccionEjecucion[] = ['lotes', 'preriego', 'lecturas', 'aplicacion']

/**
 * ¿Esta sección ya tiene lo suyo?
 *
 * Lo que cuenta es el dato MÍNIMO que hace útil a la sección, no que esté
 * entera: un preriego con su fecha y sus horas está capturado aunque no
 * lleve observaciones. Pedir el formulario completo haría que una sección
 * no se diera nunca por hecha y el embudo no avanzara nunca.
 */
export function seccionLlena(
  seccion: SeccionEjecucion,
  e: EntradaEjecucion,
  lotes: LineaLote[],
  lecturas: LecturaTensiometro[]
): boolean {
  switch (seccion) {
    case 'lotes':
      return mzDeLotes(lotes) > 0 && lotes.some((l) => l.loteTemporadaId !== '')
    case 'preriego':
      return e.fechaPreriego !== '' && horasPreriego(e) > 0
    case 'lecturas':
      return e.fechaLecturas !== '' && lecturas.some((l) => l.lectura.trim() !== '')
    case 'aplicacion':
      return e.fechaAplicacion !== '' && totalHorasRiego(e) > 0
  }
}

/**
 * Por dónde se sigue: la PRIMERA sección que todavía está vacía.
 *
 * Es lo que decide qué se abre al entrar. Quien vuelve al día siguiente
 * no viene a mirar lo que ya capturó, viene a seguir donde lo dejó;
 * abrirle siempre la primera sección le obliga a plegar y desplegar hasta
 * encontrar el hueco. Con todo lleno devuelve `null` y no se abre nada.
 */
export function siguienteSeccion(
  e: EntradaEjecucion,
  lotes: LineaLote[],
  lecturas: LecturaTensiometro[]
): SeccionEjecucion | null {
  return SECCIONES.find((s) => !seccionLlena(s, e, lotes, lecturas)) ?? null
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

/**
 * Recorta una lista de catálogo a las zonas permitidas, dejando pasar lo
 * que TODAVÍA no tiene zona.
 *
 * `filtrarPorZona` de ABAC tira lo que no tiene zona, y para los lotes
 * eso está bien: un lote sin zona es un dato incompleto. Para las
 * estaciones de riego no: la zona se la puso la migración 60 y nace nula,
 * así que el día que se instala ninguna tiene zona. Esconderlas todas
 * dejaría el módulo sin poder capturar hasta que alguien entre a
 * Catálogos a asignarlas una por una.
 *
 * `permitidas` en `null` quiere decir «no hay que recortar».
 */
export function recortarDejandoSinZona<T>(
  opciones: T[],
  zonaDe: (o: T) => string | null | undefined,
  permitidas: Set<string> | null
): T[] {
  if (permitidas === null) return opciones
  return opciones.filter((o) => {
    const z = zonaDe(o)
    return z == null || permitidas.has(z)
  })
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
  personal: LineaPersonal[],
  productos: LineaProducto[] = []
): string | null {
  if (!e.temporadaId) return 'Elige la temporada.'
  if (!e.turnoId) return 'Elige el turno de riego.'
  const ciclo = aNumero(e.ciclo)
  if (ciclo === null || ciclo < 1) return 'El ciclo tiene que ser 1 o más.'

  // El paso 0 no es una formalidad: sin lotes y sin manzanas, ni el
  // químico ni la cuadrilla se pueden repartir entre nadie y el costo del
  // turno se queda en el aire.
  if (mzDeLotes(lotes) <= 0) {
    return 'Empieza por los lotes: sin manzanas no hay entre qué repartir el costo.'
  }

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

  /* ----------------------------- Químicos ---------------------------- */
  const conProducto = productos.filter((q) => q.productoId !== '')
  if (new Set(conProducto.map((q) => q.productoId)).size !== conProducto.length) {
    return 'Hay un producto repetido: suma los litros en una sola línea.'
  }
  for (const q of conProducto) {
    if (aNumeroCero(q.totalLitros) < 0 || aNumeroCero(q.costoLitro) < 0) {
      return 'Ni los litros ni el costo por litro pueden ser negativos.'
    }
  }
  if (productos.some((q) => q.productoId === '' && aNumeroCero(q.totalLitros) > 0)) {
    return 'Hay litros escritos en un renglón sin producto.'
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
