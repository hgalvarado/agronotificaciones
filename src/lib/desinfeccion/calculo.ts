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
import {
  EQUIPO_OTROS,
  FASES,
  FASE_FINAL,
  JORNADAS,
  LINEA_LOTE_VACIA,
  PUESTO_OTRO,
  lineaProductoVacia,
  type FasePersonal,
  type FaseProducto,
  type EntradaEjecucion,
  type EntradaLogistica,
  type EntradaPlan,
  type EstadoDesinfeccion,
  type JornadaTipo,
  type LecturaTensiometro,
  type LineaLote,
  type LineaPersonal,
  type LineaProducto,
} from './tipos'

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

/**
 * Dos decimales, que es lo que la base guarda desde la 74.
 *
 * `fn_desinfeccion_costo_personal` redondea a dos. Si aquí no se
 * redondeara, con 0.33 personas la pantalla diría 1,234.5567 y el
 * informe 1,234.56: el mismo turno con dos cifras distintas, que es
 * exactamente el fallo que el módulo puro existe para evitar.
 */
export function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function factorDe(tipo: JornadaTipo): number {
  return JORNADAS.find((j) => j.valor === tipo)?.factor ?? 1.25
}

/**
 * El costo de una línea de cuadrilla.
 *
 *     costo = personas × ( salario + horas_extras × (salario / 8) × factor )
 *
 * Es la misma expresión de `fn_desinfeccion_costo_personal` desde la 61.
 * **Ya no se multiplica por jornadas**: una línea es una cuadrilla de un
 * día, y los días son fases distintas.
 *
 * Sin salario devuelve `null` —no cero—: una cuadrilla cuyo salario
 * todavía no se sabe no cuesta cero, es que no se sabe cuánto cuesta.
 */
export function costoPersonal(
  linea: Pick<LineaPersonal, 'cantidadPersonas' | 'horasExtras' | 'jornadaTipo'>,
  salario: number | null | undefined,
): number | null {
  if (salario === null || salario === undefined) return null
  // **Personas con decimales desde la 74.** Un estacionero repartido
  // entre tres turnos pone 0.33 en cada uno. `aNumeroCero` ya normaliza
  // la coma, así que «0,33» y «0.33» son el mismo número: en el teclado
  // del teléfono la coma es lo que sale primero.
  const personas = aNumeroCero(linea.cantidadPersonas)
  const extras = aNumeroCero(linea.horasExtras)
  return redondear2(
    personas * (salario + extras * (salario / HORAS_JORNADA) * factorDe(linea.jornadaTipo)),
  )
}

/** El salario de una línea: el escrito, o el mínimo vigente. */
export function salarioDe(linea: LineaPersonal, minimo: number | null): number | null {
  const propio = aNumero(linea.salario)
  if (propio !== null) return propio
  return minimo
}

/**
 * Lo que cuesta la cuadrilla de UNA fase.
 *
 * Sin `fase` suma las dos. `null` sólo si no se sabe el salario de
 * ninguna línea.
 */
export function costoCuadrilla(
  lineas: LineaPersonal[],
  minimo: number | null,
  fase?: FasePersonal,
): number | null {
  const suyas = fase ? lineas.filter((l) => l.fase === fase) : lineas
  let hay = false
  let total = 0
  for (const l of suyas) {
    const c = costoPersonal(l, salarioDe(l, minimo))
    if (c === null) continue
    hay = true
    total += c
  }
  return hay ? redondear2(total) : null
}

/**
 * El puesto tal como se guarda: la lista, o lo escrito en «Otro».
 *
 * Una sola columna de texto y no un catálogo: lo que importa del puesto
 * es poder leerlo después, no cruzarlo con una tabla que en campo nadie
 * mantiene.
 */
export function puestoDe(linea: LineaPersonal): string {
  return linea.puesto === PUESTO_OTRO ? linea.puestoOtro.trim() : linea.puesto
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
export function costoQuimicos(lineas: LineaProducto[], fase?: FaseProducto): number {
  return productosDeFase(lineas, fase).reduce((a, l) => a + costoProducto(l), 0)
}

/**
 * Los químicos de UNA fase. Sin fase, todos.
 *
 * El lavado de cinta usa químico propio (migración 74) y vive en la
 * misma lista: separarlos en dos arreglos obligaría a duplicar el
 * guardado, la limpieza y el borrado de sobrantes. Lo que los distingue
 * es un campo, no una estructura.
 *
 * Una línea sin fase —las que vienen de antes de la 74— cuenta como
 * aplicación, que es lo que eran.
 */
export function productosDeFase(lineas: LineaProducto[], fase?: FaseProducto): LineaProducto[] {
  if (!fase) return lineas
  return lineas.filter((l) => (l.fase ?? '3_Aplicacion') === fase)
}

/* ------------------------------------------------------------------ */
/* Las partes por millón                                               */
/* ------------------------------------------------------------------ */

/**
 * El número que lleva delante un porcentaje escrito a mano.
 *
 * `concentracion` es TEXTO en el catálogo —«42%», «42 %», «1,3 %»—
 * porque así llega de la etiqueta del producto. Espejo exacto de
 * `fn_numero_de_texto` (migración 64).
 *
 * `null` si no hay un número reconocible. **No se asume 100:** un
 * producto sin concentración declarada no es producto puro, es un
 * producto del que no se sabe la concentración, y calcular con 100
 * daría unas ppm infladas que nadie sabría de dónde salieron.
 */
export function numeroDeTexto(texto: string | null | undefined): number | null {
  const m = /[0-9]+[.,]?[0-9]*/.exec((texto ?? '').trim())
  if (!m) return null
  const n = Number(m[0].replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * El agua que llevó producto, en metros cúbicos.
 *
 *     horas de inyección × caudal
 *
 * **El lavado NO cuenta, desde la 68.** Por el lavado pasa agua, sí,
 * pero agua limpia: se echa después para sacar de la tubería el químico
 * que quedó dentro. Sumarla al denominador diluye en el papel una
 * dilución que no ocurrió, y el ppm sale más bajo que el que de verdad
 * salió por el gotero.
 *
 * El error iba en la dirección mala: un ppm bajo no lo revisa nadie.
 */
export function aguaTotal(e: EntradaEjecucion): number {
  return horasInyeccion(e) * aNumeroCero(e.caudalAgua)
}

/**
 * Los litros de ingrediente activo de la DOSIS POR MANZANA.
 *
 * Desde la 65 parte de la dosis y no de los litros totales. No es el
 * mismo número con otro nombre: es el de antes dividido entre las
 * manzanas del turno.
 */
export function productoPuro(
  litros: string,
  concentracion: string | null | undefined,
  mz: number,
): number | null {
  const pct = numeroDeTexto(concentracion)
  if (pct === null) return null
  const dosis = dosisPorMz(litros, mz)
  if (dosis === null) return null
  return dosis * (pct / 100)
}

/**
 * Las partes por millón de un químico aplicado.
 *
 *     dosis_mz = litros / manzanas del turno
 *     agua     = horas de INYECCIÓN × caudal   (el lavado no, desde la 68)
 *     ppm      = dosis_mz × (I.A.%/100) × 1000 / agua
 *
 * El ×1000 es de litros a centímetros cúbicos, y no hay ningún
 * ×1.000.000: un metro cúbico de agua pesa un millón de gramos y un cc
 * de producto pesa aproximadamente uno, así que los cc por m³ ya vienen
 * en millonésimas.
 *
 * **Qué cambió en la 65.** La cuenta partía de los litros TOTALES y
 * ahora parte de la dosis por manzana, siguiendo la hoja de los
 * agrónomos. El resultado es el de antes dividido entre las manzanas del
 * turno: en uno de 10 mz, diez veces menor. La nota dimensional está en
 * la cabecera de la migración 65 y en §4 de la BITÁCORA — si el número
 * sale más bajo de lo esperado, ahí está dónde mirar.
 *
 * Espejo de `fn_ppm_desinfeccion`. Sin agua o sin manzanas devuelve
 * `null` y no cero: no es que la concentración sea cero, es que todavía
 * no se sabe entre cuánto se reparte.
 */
export function ppmDe(
  litros: string,
  concentracion: string | null | undefined,
  e: EntradaEjecucion,
  mz: number,
): number | null {
  const agua = aguaTotal(e)
  if (agua <= 0) return null
  const puro = productoPuro(litros, concentracion, mz)
  if (puro === null) return null
  return (puro * 1000) / agua
}

/**
 * Todo el desglose de una vez, para la tabla que lo explica.
 *
 * Se devuelven las PIEZAS y no sólo el resultado: un número que no se
 * puede auditar no se discute, se cree o no se cree. Y quien discute un
 * número de ppm en el campo quiere ver de dónde sale cada factor.
 */
export type DesglosePpm = {
  caudal: number
  horasInyeccion: number
  horasLavado: number
  aguaTotal: number
  dosisMz: number | null
  producto: string
  concentracion: number | null
  productoPuroLitros: number | null
  productoPuroCc: number | null
  ppm: number | null
}

export function desglosePpm(
  linea: LineaProducto,
  material:
    { descripcion: string | null; codigo: string; concentracion: string | null } | undefined,
  e: EntradaEjecucion,
  mz: number,
): DesglosePpm {
  const puro = productoPuro(linea.totalLitros, material?.concentracion, mz)
  return {
    caudal: aNumeroCero(e.caudalAgua),
    horasInyeccion: horasInyeccion(e),
    horasLavado: horasLavado(e),
    aguaTotal: aguaTotal(e),
    dosisMz: dosisPorMz(linea.totalLitros, mz),
    producto: material ? (material.descripcion ?? material.codigo) : '—',
    concentracion: numeroDeTexto(material?.concentracion),
    productoPuroLitros: puro,
    productoPuroCc: puro === null ? null : puro * 1000,
    ppm: ppmDe(linea.totalLitros, material?.concentracion, e, mz),
  }
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
 * Las horas entre dos horas del día, CRUZANDO LA MEDIANOCHE.
 *
 * Es el reflejo exacto de `fn_horas_entre` (migración 61). Hasta la 60
 * un fin anterior al inicio daba cero, y eso dejaba en cero justo los
 * turnos que más importan: la desinfección se hace de noche, y de 22:00
 * a 01:00 son tres horas.
 *
 * Una hora todavía sin capturar cuenta como cero en vez de anular la
 * suma entera. Y la misma hora de inicio y fin son cero horas, no
 * veinticuatro: un turno de cero horas existe —se anotó y no se trabajó—;
 * uno de veinticuatro, no.
 */
export function horasEntre(inicio: string, fin: string): number {
  const a = minutosDe(inicio)
  const b = minutosDe(fin)
  if (a === null || b === null) return 0
  if (b >= a) return (b - a) / 60
  return (b - a + 24 * 60) / 60
}

/**
 * Las horas de lavado.
 *
 * Desde la 62 sólo salen del reloj: el número escrito a mano que la 61
 * había dejado como red —`horas_lavado_manual`— ya no existe. Dos
 * entradas para una sola salida son una ambigüedad que un día cuesta
 * cara, y la red ya cumplió su turno.
 */
export function horasLavado(e: EntradaEjecucion): number {
  return horasEntre(e.horaInicioLavado, e.horaFinLavado)
}

/**
 * Las horas de presurización, también por reloj desde la 62.
 *
 * Era la última de las cuatro fases del riego que se escribía a mano, y
 * por eso la única que no podía cruzar la medianoche.
 */
export function horasPresurizacion(e: EntradaEjecucion): number {
  return horasEntre(e.inicioPresurizacion, e.finPresurizacion)
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
  return horasPresurizacion(e) + horasInyeccion(e) + horasLavado(e)
}

/**
 * DDT: los días transcurridos DESDE el trasplante. `fase − siembra`.
 *
 * **El signo es la mitad del dato.** Negativo quiere decir que la siembra
 * todavía está por delante, que es el caso normal al desinfectar: se
 * aplica el producto y se trasplanta dos meses después. Positivo quiere
 * decir que ya se sembró.
 *
 * Preriego el 2026-10-09 y siembra prevista el 2026-12-17 son **−69
 * días**, no 69: faltan 69 para el trasplante. Hasta la 62 esto se
 * restaba al revés y el número salía con el signo cambiado —el mismo
 * número, contando lo contrario—.
 */
export function ddt(fechaSiembra: string | null | undefined, fechaFase: string): number | null {
  if (!fechaSiembra || !fechaFase) return null
  // Las dos son fechas de CALENDARIO, no instantes: se restan en UTC para
  // que ningún reloj les quite un día.
  const s = Date.parse(`${fechaSiembra}T12:00:00Z`)
  const f = Date.parse(`${fechaFase}T12:00:00Z`)
  if (Number.isNaN(s) || Number.isNaN(f)) return null
  return Math.round((f - s) / 86400000)
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

/**
 * La fecha del preriego planificado (migración 75).
 *
 * Es `(siembra + días de aplicación) + días de preriego`, la MISMA
 * expresión de la columna generada. Se repite la suma entera y no se
 * parte de `fechaAplicacionPrevista` porque en la base no se puede:
 * Postgres no deja que una columna generada se apoye en otra generada.
 *
 * **Vacío devuelve `null`, no la fecha de aplicación.** «No se ha
 * planificado el preriego» y «se preriega el mismo día que se aplica»
 * son dos cosas distintas, y la segunda se escribe con un cero.
 */
export function fechaPreriegoPrevista(e: EntradaPlan): string | null {
  if (!e.fechaSiembraCongelada) return null
  if ((e.diasPreriego ?? '').trim() === '') return null
  const dias = aNumero(e.diasPreriego)
  if (dias === null) return null
  return sumarDias(
    e.fechaSiembraCongelada,
    Math.trunc(aNumeroCero(e.diasAplicacion)) + Math.trunc(dias)
  )
}

/**
 * La cosecha prevista: siembra + DDT de cosecha de la variedad.
 *
 * Se cuenta desde la SIEMBRA y no desde la aplicación: el DDT es «días
 * desde el trasplante», y el trasplante es la siembra.
 *
 * Sin DDT en la variedad devuelve `null` y la pantalla lo dice. Una
 * fecha inventada aquí acabaría en el calendario de la finca.
 */
export function fechaCosechaPrevista(
  e: EntradaPlan,
  ddtCosecha: number | null | undefined
): string | null {
  if (!e.fechaSiembraCongelada) return null
  if (ddtCosecha === null || ddtCosecha === undefined || !Number.isFinite(ddtCosecha)) return null
  return sumarDias(e.fechaSiembraCongelada, Math.trunc(ddtCosecha))
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

/**
 * El DDT de un turno completo, que riega VARIOS lotes.
 *
 * Los lotes de un turno no se siembran el mismo día, así que un solo
 * número sería mentira la mitad de las veces. Se devuelven los dos
 * extremos y la pantalla decide cómo decirlo: con un rango se ve de un
 * vistazo que el turno no es homogéneo, que es justo lo que hay que saber
 * antes de aplicar.
 *
 * `null` cuando no hay ninguna siembra capturada: no se inventa un número.
 */
export function rangoDdt(
  fechasSiembra: string[],
  fechaFase: string,
): { min: number; max: number } | null {
  if (!fechaFase) return null
  const dias = fechasSiembra.map((f) => ddt(f, fechaFase)).filter((d): d is number => d !== null)
  if (dias.length === 0) return null
  return { min: Math.min(...dias), max: Math.max(...dias) }
}

/**
 * Lo mismo, ya escrito para la pantalla.
 *
 * El signo va SIEMPRE escrito, también cuando es negativo, porque es la
 * mitad del dato: «−69 días» es «faltan 69 para trasplantar» y «69 días»
 * es «ya pasaron 69 desde que se trasplantó». Sin el signo son el mismo
 * texto para dos situaciones opuestas.
 */
export function textoDdt(fechasSiembra: string[], fechaFase: string): string {
  const r = rangoDdt(fechasSiembra, fechaFase)
  if (r === null) return '—'
  return r.min === r.max ? `${r.min} días` : `${r.min} a ${r.max} días`
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
  // **Hasta la FASE FINAL, que desde la 74 es el lavado de cinta.**
  // Dejarlo en '3_Aplicacion' cerraba el formulario justo antes de la
  // sección nueva: el turno llegaba a Aplicación, se bloqueaba, y el
  // lavado no se podía capturar nunca.
  return nivelDeFase(estado) >= nivelDeFase(FASE_FINAL)
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
export type SeccionEjecucion = 'lotes' | 'preriego' | 'lecturas' | 'aplicacion' | 'lavado'

export const SECCIONES: SeccionEjecucion[] = [
  'lotes',
  'preriego',
  'lecturas',
  'aplicacion',
  'lavado',
]

/** Cómo se llama cada sección cuando hay que nombrarla en un aviso. */
export const NOMBRE_SECCION: Record<SeccionEjecucion, string> = {
  lotes: '0 · Lotes y manzanas',
  preriego: '1 · Preriego',
  lecturas: '2 · Lecturas',
  aplicacion: '3 · Aplicación',
  lavado: '4 · Lavado de cinta',
}

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
  lecturas: LecturaTensiometro[],
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
    case 'lavado':
      // El dato mínimo es la FECHA. Un lavado puede cerrarse sin químico
      // —a veces se enjuaga sólo con agua— y sin cuadrilla propia si la
      // misma gente de la aplicación se queda a hacerlo.
      return e.fechaLavado !== ''
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
  lecturas: LecturaTensiometro[],
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
  permitidas: Set<string> | null,
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
    [l.punto, l.profundidad, l.lectura, l.hora, l.nota].some((v) => (v ?? '').trim() !== ''),
  )
}

/* ------------------------------------------------------------------ */
/* Las filas fantasma                                                   */
/* ------------------------------------------------------------------ */

/**
 * ¿Esta fila está tal como nació?
 *
 * El formulario abre cada sub-tabla con un renglón en blanco para que
 * haya dónde escribir. Si nadie lo toca, ese renglón **no es un dato**:
 * es el hueco. Compararlo campo a campo con su plantilla es la forma
 * exacta de distinguir «no la tocó» de «la tocó y la dejó a medias», y
 * esa diferencia es la que decide si se descarta en silencio o si hay que
 * avisar.
 *
 * El identificador no cuenta: una fila que ya existe en la base y que
 * nadie ha tocado sigue siendo una fila con datos.
 */
export function intacta<T extends Record<string, unknown>>(linea: T, plantilla: T): boolean {
  if ((linea.id ?? '') !== '') return false
  return Object.keys(plantilla).every(
    (k) => k === 'id' || String(linea[k] ?? '') === String(plantilla[k] ?? ''),
  )
}

/**
 * Fuera los renglones que nadie tocó, antes de validar y antes de
 * guardar.
 *
 * **Por qué existe esto.** El trabajo de campo es asíncrono: se asignan
 * los lotes un día, se riega otro y se aplica un tercero. Quien guarda
 * con sólo los lotes puestos no está dejando la cuadrilla «a medias»: es
 * que todavía no le toca. Antes, el renglón en blanco de personal traía
 * `jornadas: '1'` de fábrica, la validación lo leía como un dato escrito
 * y contestaba «Hay un renglón de personal sin puesto de trabajo» — un
 * error sobre algo que el usuario no había mirado siquiera, y que
 * bloqueaba el guardado incremental entero.
 *
 * Lo que NO hace esta limpieza es tapar un descuido: un renglón donde se
 * escribieron horas extras y se olvidó el puesto sí está tocado, y ése
 * sigue avisando.
 */
export function limpiarLotes(lineas: LineaLote[]): LineaLote[] {
  return lineas.filter((l) => !intacta(l, LINEA_LOTE_VACIA))
}

/**
 * La cuadrilla NO se limpia. Se devuelve entera.
 *
 * ── Por qué esto dejó de filtrar (migración 68) ─────────────────────
 *
 * Filtraba por «igual a la plantilla», y la plantilla de un renglón de
 * cuadrilla viene con **todo puesto**: una persona, puesto Jornal,
 * jornada Diurna, cero horas extras y el salario mínimo vigente. Eso no
 * es un hueco: **es la cuadrilla del preriego**, que casi siempre es
 * exactamente un jornal a mínimo en jornada normal.
 *
 * Es decir: el renglón que el usuario llenaba sin teclear nada —porque
 * los valores por omisión ya decían la verdad— era byte a byte idéntico
 * al renglón en blanco, y se borraba al guardar. Se perdía justo la
 * captura más común de la fase 1, y sin un solo aviso.
 *
 * Y la limpieza ya no protegía de nada: desde la 62 la cuadrilla arranca
 * en `[]` y un renglón sólo existe si alguien pulsó «Agregar personal».
 * **Pulsar el botón es la afirmación.** Un renglón de sobra se quita con
 * su propio botón, que es un gesto; borrarlo a sus espaldas no lo es.
 *
 * La función se conserva —con su firma— para que las dos llamadas sigan
 * leyéndose igual que las de lotes y productos, donde la limpieza SÍ
 * hace falta porque esos sí nacen con un renglón en blanco puesto.
 */
export function limpiarPersonal(lineas: LineaPersonal[], _salarioPorOmision = ''): LineaPersonal[] {
  return lineas
}

export function limpiarProductos(lineas: LineaProducto[]): LineaProducto[] {
  // La plantilla se compara CONTRA SU PROPIA FASE (migración 74). Con
  // `LINEA_PRODUCTO_VACIA` a secas, el renglón en blanco del lavado
  // nunca era «intacto» —su fase difiere— y se mandaba a guardar un
  // químico sin producto cada vez que alguien abría la sección 4.
  return lineas.filter((l) => !intacta(l, lineaProductoVacia(l.fase ?? '3_Aplicacion')))
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
  lotesCrudos: LineaLote[],
  personalCrudo: LineaPersonal[],
  productosCrudos: LineaProducto[] = [],
  salarioPorOmision = '',
): string | null {
  // Primero se tiran los renglones que nadie tocó. Validar el hueco en
  // blanco es lo que impedía guardar con sólo los lotes puestos.
  const lotes = limpiarLotes(lotesCrudos)
  const personal = limpiarPersonal(personalCrudo, salarioPorOmision)
  const productos = limpiarProductos(productosCrudos)

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

  // OJO: hasta la 60 una hora de fin anterior a la de inicio era un
  // error. Desde la 61 NO lo es: es un turno que cruza la medianoche, y
  // la desinfección se hace de noche. Quitar esta validación es parte
  // del arreglo, no un descuido.

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
    // «Otro» sin escribir qué es deja una línea que dentro de un año no
    // dice nada: es el único caso en que el puesto bloquea.
    if (p.puesto === PUESTO_OTRO && p.puestoOtro.trim() === '') {
      return 'Dice «Otro» en un puesto de la cuadrilla: escribe cuál.'
    }
    const personas = aNumero(p.cantidadPersonas)
    // **Mayor que cero, no mayor o igual que uno** (migración 74). Una
    // persona repartida entre tres turnos pone 0.33 en cada uno, y la
    // regla vieja lo rechazaba obligando a inflar el costo a 1.
    if (personas === null || personas <= 0) {
      return 'Las personas de la cuadrilla tienen que ser más de cero (ej. 0.33, 0.5 o 2).'
    }
    if (personas > 500) return 'Quinientas personas en un renglón son un dedo resbalado.'
    if (aNumeroCero(p.horasExtras) < 0) return 'Las horas extras no pueden ser negativas.'
    const salario = aNumero(p.salario)
    if (salario !== null && salario < 0) return 'El salario no puede ser negativo.'
  }

  /* ----------------------------- Químicos ---------------------------- */
  // El repetido se mira DENTRO de cada fase: el mismo ácido en la
  // inyección y en el lavado son dos renglones legítimos desde la 74, y
  // la llave única de la base también lleva la fase.
  const conProducto = productos.filter((q) => q.productoId !== '')
  const llaves = conProducto.map((q) => `${q.fase ?? '3_Aplicacion'}|${q.productoId}`)
  if (new Set(llaves).size !== llaves.length) {
    return 'Hay un producto repetido en la misma fase: suma los litros en una sola línea.'
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

/* ------------------------------------------------------------------ */
/* Validación detallada: qué campo, y qué hay que escribir en él       */
/* ------------------------------------------------------------------ */

/**
 * ── Por qué esto existe aparte de `validarEjecucion` ────────────────
 *
 * `validarEjecucion` devuelve UN texto: el primer problema que
 * encuentra. Sirve para no guardar basura, pero deja al usuario
 * buscando a ojo cuál de los cuarenta campos del formulario es el que
 * se queja —y con el acordeón plegado, ni siquiera sabe en qué sección
 * mirar—.
 *
 * Esto devuelve las dos cosas que la pantalla necesita para señalar en
 * vez de describir: el mapa `campo → qué corregir`, para pintar el
 * borde y poner el mensaje debajo, y el resumen por sección, para el
 * distintivo de la cabecera y para saber cuál abrir.
 *
 * ── La regla que NO se puede romper ─────────────────────────────────
 *
 * **El guardado incremental manda.** El trabajo de campo es asíncrono:
 * se asignan los lotes un día, se riega otro, se aplica un tercero y se
 * lava un cuarto. Una sección vacía no es un error, es que todavía no
 * le toca. Lo que sí es un error es una fila TOCADA y a medias —litros
 * escritos sin producto, un puesto «Otro» sin decir cuál—, porque ésa
 * sí se va a guardar y nadie va a volver a mirarla.
 *
 * Por eso cada comprobación de aquí se hace sobre lo que el usuario
 * escribió, no sobre lo que falta por escribir.
 */

/** `campo → qué hay que corregir`. La llave la usa el formulario para señalar. */
export type ErroresCampo = Record<string, string>

export type ResumenSeccion = {
  seccion: SeccionEjecucion
  /** Su posición en el flujo: sirve para abrir la PRIMERA con problema. */
  indice: number
  nombre: string
  mensajes: string[]
}

export type Diagnostico = {
  campos: ErroresCampo
  secciones: ResumenSeccion[]
  hay: boolean
  /** La primera sección con problema, para abrirla sola. */
  primera: SeccionEjecucion | null
}

/** Un ejemplo vale más que «valor inválido»: se dice qué se espera. */
const EJEMPLO_DECIMAL = 'ej. 0.33, 0.5 o 2'

/**
 * ¿Escribió algo que no es un número?
 *
 * Un vacío NO es un error aquí: puede ser un campo que todavía no toca.
 * Lo que es un error es haber escrito algo que no se puede sumar —una
 * letra, dos puntos, un guion suelto—, porque eso se guarda como nulo y
 * el total sale mal sin que nada avise.
 */
export function textoNoNumerico(texto: string | null | undefined): boolean {
  const t = (texto ?? '').trim()
  return t !== '' && aNumero(t) === null
}

/**
 * ¿Esta fila de cuadrilla la tocó alguien?
 *
 * Un renglón de cuadrilla nace con todo puesto —una persona, Jornal,
 * Diurna, el mínimo vigente—, así que no se puede comparar con una
 * plantilla en blanco. Lo que lo convierte en un dato es haber pulsado
 * «Agregar personal», que es la afirmación (migración 68). Se validan
 * todos.
 */
export function validarFormularioDetallado(
  e: EntradaEjecucion,
  lotes: LineaLote[],
  personal: LineaPersonal[],
  productos: LineaProducto[],
  lecturas: LecturaTensiometro[] = [],
): Diagnostico {
  const campos: ErroresCampo = {}
  const porSeccion = new Map<SeccionEjecucion, string[]>()

  const anotar = (seccion: SeccionEjecucion, campo: string | null, mensaje: string) => {
    if (campo) campos[campo] = mensaje
    const antes = porSeccion.get(seccion) ?? []
    if (!antes.includes(mensaje)) antes.push(mensaje)
    porSeccion.set(seccion, antes)
  }

  /** Numérico suelto: si hay texto, tiene que ser número; y no negativo. */
  const numero = (
    seccion: SeccionEjecucion,
    campo: string,
    valor: string | null | undefined,
    etiqueta: string,
    { positivo = false }: { positivo?: boolean } = {},
  ) => {
    if (textoNoNumerico(valor)) {
      anotar(seccion, campo, `${etiqueta} tiene que ser un número (${EJEMPLO_DECIMAL}).`)
      return
    }
    const n = aNumero(valor)
    if (n === null) {
      if (positivo) anotar(seccion, campo, `${etiqueta} hace falta (${EJEMPLO_DECIMAL}).`)
      return
    }
    if (positivo && n <= 0) {
      anotar(seccion, campo, `${etiqueta} tiene que ser mayor que 0 (${EJEMPLO_DECIMAL}).`)
      return
    }
    if (!positivo && n < 0) anotar(seccion, campo, `${etiqueta} no puede ser negativa.`)
  }

  /* --------------------- 0 · Lotes y manzanas ---------------------- */
  lotes.forEach((l, i) => {
    const tocada = !intacta(l, LINEA_LOTE_VACIA)
    if (!tocada) return
    if (l.loteTemporadaId === '') {
      anotar('lotes', `lote.${i}.loteTemporadaId`, 'Escribiste manzanas sin elegir el lote.')
    }
    if ((l.mzCubiertas ?? '').trim() === '' && l.loteTemporadaId !== '') {
      anotar('lotes', `lote.${i}.mzCubiertas`, 'Elegiste el lote pero faltan sus manzanas.')
    } else {
      numero('lotes', `lote.${i}.mzCubiertas`, l.mzCubiertas, 'Las manzanas', { positivo: true })
    }
  })

  const conLote = lotes.filter((l) => l.loteTemporadaId !== '')
  const vistos = new Set<string>()
  conLote.forEach((l) => {
    const i = lotes.indexOf(l)
    if (vistos.has(l.loteTemporadaId)) {
      anotar('lotes', `lote.${i}.loteTemporadaId`, 'Este lote ya está más arriba: va una sola vez.')
    }
    vistos.add(l.loteTemporadaId)
  })

  /* --------------------------- Cuadrilla --------------------------- */
  const seccionDeFase = (f: FasePersonal): SeccionEjecucion =>
    f === '1_Preriego' ? 'preriego' : f === '4_Lavado' ? 'lavado' : 'aplicacion'

  personal.forEach((p, i) => {
    const s = seccionDeFase(p.fase)
    if (p.puesto === PUESTO_OTRO && p.puestoOtro.trim() === '') {
      anotar(s, `personal.${i}.puestoOtro`, 'Dice «Otro»: escribe qué puesto es.')
    }
    numero(s, `personal.${i}.cantidadPersonas`, p.cantidadPersonas, 'Las personas', {
      positivo: true,
    })
    const personas = aNumero(p.cantidadPersonas)
    if (personas !== null && personas > 500) {
      anotar(s, `personal.${i}.cantidadPersonas`, 'Quinientas personas son un dedo resbalado.')
    }
    numero(s, `personal.${i}.horasExtras`, p.horasExtras, 'Las horas extras')
    numero(s, `personal.${i}.salario`, p.salario, 'El salario')
  })

  /* --------------------------- Químicos ---------------------------- */
  const llaves = new Map<string, number>()
  productos.forEach((q, i) => {
    const fase: FaseProducto = q.fase ?? '3_Aplicacion'
    const s: SeccionEjecucion = fase === '4_Lavado' ? 'lavado' : 'aplicacion'
    if (intacta(q, lineaProductoVacia(fase))) return

    if (q.productoId === '') {
      anotar(s, `producto.${i}.productoId`, 'Escribiste litros sin elegir el químico.')
    }
    if (q.productoId !== '' && (q.totalLitros ?? '').trim() === '') {
      anotar(s, `producto.${i}.totalLitros`, 'Elegiste el químico pero faltan sus litros.')
    } else {
      numero(s, `producto.${i}.totalLitros`, q.totalLitros, 'Los litros', { positivo: true })
    }
    numero(s, `producto.${i}.costoLitro`, q.costoLitro, 'El costo por litro')
    // Los envases NO se piden en el lavado: ahí no se controla logística
    // de envase, se enjuaga con lo que haya abierto.
    if (fase !== '4_Lavado') {
      numero(s, `producto.${i}.cantidadEnvases`, q.cantidadEnvases, 'Los envases')
    }

    if (q.productoId !== '') {
      const llave = `${fase}|${q.productoId}`
      if (llaves.has(llave)) {
        anotar(
          s,
          `producto.${i}.productoId`,
          'Este químico ya está en esta misma fase: suma los litros en una línea.',
        )
      }
      llaves.set(llave, i)
    }
  })

  /* ------------------------- 2 · Lecturas -------------------------- */
  lecturas.forEach((l, i) => {
    numero('lecturas', `lectura.${i}.lectura`, l.lectura, 'La lectura')
  })

  /* ----------------- 3 · Aplicación: los medidores ----------------- */
  for (const [campo, etiqueta] of [
    ['caudalAgua', 'El caudal'],
    ['ceAntes', 'La CE antes'],
    ['ceDurante', 'La CE durante'],
    ['ceDespues', 'La CE después'],
    ['calibracionEntrada', 'La calibración de entrada'],
    ['calibracionSalida', 'La calibración de salida'],
    ['calibracionCampo', 'La calibración de campo'],
  ] as const) {
    numero('aplicacion', `ejecucion.${campo}`, e[campo], etiqueta)
  }

  // La fase manda: una aplicación sin fecha deja el costo sin tarifa y
  // sin forma de saber de qué día era.
  if (nivelDeFase(e.estado) >= nivelDeFase('3_Aplicacion') && !e.fechaAplicacion) {
    anotar('aplicacion', 'ejecucion.fechaAplicacion', 'Falta la fecha de aplicación.')
  }

  // **«Otros» sin decir cuál no es un dato** (migración 75). Dentro de un
  // año no contesta con qué se aplicó, que es justo el hueco que el
  // campo venía a llenar. La base lo rechaza; aquí se avisa antes de
  // gastar el viaje.
  if (e.equipoAplicacion === EQUIPO_OTROS && e.equipoAplicacionOtro.trim() === '') {
    anotar(
      'aplicacion',
      'ejecucion.equipoAplicacionOtro',
      'Elegiste «Otros» como equipo: escribe cuál fue.'
    )
  }

  /* --------------------- 4 · Lavado de cinta ----------------------- */
  // Si hay algo capturado del lavado —químico o cuadrilla— tiene que
  // saberse de qué día es: la tarifa del jornal sale de esa fecha.
  const hayLavado =
    productosDeFase(productos, '4_Lavado').some(
      (q) => !intacta(q, lineaProductoVacia('4_Lavado')),
    ) || personal.some((p) => p.fase === '4_Lavado')
  if (hayLavado && !e.fechaLavado) {
    anotar('lavado', 'ejecucion.fechaLavado', 'Hay lavado capturado: falta su fecha.')
  }

  const secciones: ResumenSeccion[] = SECCIONES.filter(
    (s) => (porSeccion.get(s) ?? []).length > 0,
  ).map((s) => ({
    seccion: s,
    indice: SECCIONES.indexOf(s),
    nombre: NOMBRE_SECCION[s],
    mensajes: porSeccion.get(s) ?? [],
  }))

  return {
    campos,
    secciones,
    hay: secciones.length > 0,
    primera: secciones[0]?.seccion ?? null,
  }
}
