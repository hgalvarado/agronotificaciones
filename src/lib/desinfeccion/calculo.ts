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
import { FASES, JORNADAS, LINEA_LOTE_VACIA, LINEA_PRODUCTO_VACIA, PUESTO_OTRO, lineaPersonalVacia, type FasePersonal, type EntradaEjecucion, type EntradaLogistica, type EntradaPlan, type EstadoDesinfeccion, type JornadaTipo, type LecturaTensiometro, type LineaLote, type LineaPersonal, type LineaProducto } from './tipos'

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
  salario: number | null | undefined
): number | null {
  if (salario === null || salario === undefined) return null
  const personas = aNumeroCero(linea.cantidadPersonas)
  const extras = aNumeroCero(linea.horasExtras)
  return personas * (salario + extras * (salario / HORAS_JORNADA) * factorDe(linea.jornadaTipo))
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
  fase?: FasePersonal
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
  return hay ? total : null
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
export function costoQuimicos(lineas: LineaProducto[]): number {
  return lineas.reduce((a, l) => a + costoProducto(l), 0)
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
 * El agua que pasó por la estación, en metros cúbicos.
 *
 *     (horas de inyección + horas de lavado) × caudal
 *
 * El lavado cuenta porque por ahí también pasa agua: dejarlo fuera
 * subiría las ppm de un turno que se lavó mucho, que es justo al revés
 * de lo que pasó en el suelo.
 */
export function aguaTotal(e: EntradaEjecucion): number {
  return (horasInyeccion(e) + horasLavado(e)) * aNumeroCero(e.caudalAgua)
}

/** Los litros de ingrediente activo que llevaba lo aplicado. */
export function productoPuro(litros: string, concentracion: string | null | undefined): number | null {
  const pct = numeroDeTexto(concentracion)
  if (pct === null) return null
  return aNumeroCero(litros) * (pct / 100)
}

/**
 * Las partes por millón de un químico aplicado.
 *
 *     ppm = producto puro (cc) / agua total (m³)
 *
 * **Por qué los mililitros por metro cúbico SON partes por millón.** Un
 * metro cúbico de agua pesa un millón de gramos y un mililitro de
 * producto pesa aproximadamente un gramo: la división ya viene en
 * millonésimas. Por eso está el ×1000 —de litros a cc— y por eso NO hay
 * ningún ×1.000.000 por ningún lado.
 *
 * Espejo de `fn_ppm_desinfeccion` (migración 64). Sin agua devuelve
 * `null` y no cero: no es que la concentración sea cero, es que todavía
 * no se sabe entre cuánta agua se reparte.
 */
export function ppmDe(
  litros: string,
  concentracion: string | null | undefined,
  e: EntradaEjecucion
): number | null {
  const agua = aguaTotal(e)
  if (agua <= 0) return null
  const puro = productoPuro(litros, concentracion)
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
  material: { descripcion: string | null; codigo: string; concentracion: string | null } | undefined,
  e: EntradaEjecucion,
  mz: number
): DesglosePpm {
  const puro = productoPuro(linea.totalLitros, material?.concentracion)
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
    ppm: ppmDe(linea.totalLitros, material?.concentracion, e),
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
  fechaFase: string
): { min: number; max: number } | null {
  if (!fechaFase) return null
  const dias = fechasSiembra
    .map((f) => ddt(f, fechaFase))
    .filter((d): d is number => d !== null)
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
    (k) => k === 'id' || String(linea[k] ?? '') === String(plantilla[k] ?? '')
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
 * `salarioPorOmision` es el que el formulario ESCRIBE en el input al
 * agregar un renglón (migración 62). Hay que pasárselo a la plantilla o
 * un renglón agregado por descuido, con el salario ya puesto y nada
 * más, dejaría de parecer intacto y se guardaría.
 */
export function limpiarPersonal(lineas: LineaPersonal[], salarioPorOmision = ''): LineaPersonal[] {
  // La plantilla se arma con la fase de la propia línea: el renglón en
  // blanco del preriego y el de la aplicación son huecos distintos, y
  // compararlos contra una sola plantilla dejaría pasar uno de los dos.
  return lineas.filter((l) => !intacta(l, lineaPersonalVacia(l.fase, salarioPorOmision)))
}

export function limpiarProductos(lineas: LineaProducto[]): LineaProducto[] {
  return lineas.filter((l) => !intacta(l, LINEA_PRODUCTO_VACIA))
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
  salarioPorOmision = ''
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
    if (personas === null || personas < 1) return 'El personal se cuenta de uno en adelante.'
    if (aNumeroCero(p.horasExtras) < 0) return 'Las horas extras no pueden ser negativas.'
    const salario = aNumero(p.salario)
    if (salario !== null && salario < 0) return 'El salario no puede ser negativo.'
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
