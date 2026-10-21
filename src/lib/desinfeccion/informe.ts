/**
 * El informe ejecutivo de un lote: tipos y cuentas puras.
 *
 * Nada de React ni de Supabase. Lo que vive aquí lo usan **dos**
 * consumidores —la pantalla y el PDF— y ésa es la razón de que exista:
 * un informe que dice en el papel algo distinto de lo que dice en la
 * pantalla es peor que no tener informe, porque quien lo lleva a una
 * reunión no sabe cuál de los dos defender.
 */

/** Un químico aplicado, tal como lo arma la vista en su `jsonb`. */
export type ProductoInforme = {
  /** En qué fase se usó (migración 74). El lavado no lleva ppm. */
  fase?: string | null
  codigo: string | null
  nombre: string | null
  concentracion: string | null
  objetivos: string[] | null
  litros: number | null
  dosis_mz: number | null
  ppm: number | null
  costo: number | null

  /* ---- Lo que la 76 añadió: el reparto, a la vista ---------------- */
  /**
   * Los litros del TURNO entero y los que le tocan a ESTE lote.
   *
   * Las dos cifras juntas son lo que permite auditar el prorrateo. Hasta
   * la 75 sólo se guardaba una y el informe la presentaba como si fuera
   * la del lote: un turno de 2.000 L sobre dos lotes de 10 mz decía 200
   * L/mz en cada uno cuando la dosis real era 100.
   */
  litros_turno?: number | null
  litros_lote?: number | null
  costo_lote?: number | null
  costo_litro?: number | null
  ppm_calculada?: number | null
  cantidad_envases?: number | null
  tipo_envase?: string | null
  objetivos_control?: string[] | null
}

/** Una línea de cuadrilla, ya prorrateada al lote. */
export type CuadrillaDetalle = {
  fase: string | null
  puesto_texto: string | null
  operador_nombre: string | null
  cantidad_personas: number | null
  salario_base_manual: number | null
  horas_extras: number | null
  jornada_tipo: string | null
  costo_turno: number | null
  costo_lote: number | null
}

/** Un acarreo, con lo que de él absorbió este lote. */
export type LogisticaDetalle = {
  id: string | null
  fecha: string | null
  tipo_cargo: string | null
  equipo_nombre: string | null
  implemento_nombre: string | null
  operador_nombre: string | null
  horas_trabajo: number | null
  costo_total: number | null
  costo_lote: number | null
}

/** Una lectura de tensiómetro, tal como la captura la pantalla. */
export type LecturaTensiometro = {
  punto?: string | number | null
  profundidad?: string | number | null
  lectura?: string | number | null
  hora?: string | null
  nota?: string | null
}

/** Un turno del lote, con los números con los que se repartió. */
export type EjecucionDetalle = {
  turno_nombre: string | null
  turno_codigo: string | null
  mz_cubiertas: number | null
  mz_total_turno: number | null
  factor_lote: number | null
  fecha_preriego: string | null
  hora_inicio_preriego: string | null
  hora_fin_preriego: string | null
  horas_preriego: number | null
  obs_preriego: string | null
  fecha_lecturas: string | null
  /**
   * **Es un arreglo de objetos, no un texto.**
   *
   * Se capturan varios tensiómetros por turno, cada uno con su punto,
   * su profundidad, su lectura, su hora y su nota. Pintarlo directo en
   * el JSX reventaba la pantalla con el error 31 de React —«Objects are
   * not valid as a React child»—, que en producción sale minificado y
   * sin decir qué objeto era.
   *
   * Se acepta también el texto suelto: así se escribía antes de que la
   * captura pasara a estructurado, y eso sigue guardado.
   */
  lecturas_tensiometro: LecturaTensiometro[] | string | null
  fecha_aplicacion: string | null
  estacion_nombre: string | null
  equipo_aplicacion_mostrado: string | null
  caudal_agua: number | null
  inicio_presurizacion: string | null
  fin_presurizacion: string | null
  horas_presurizacion: number | null
  hora_inicio_iny: string | null
  hora_fin_iny: string | null
  horas_inyeccion: number | null
  hora_inicio_lavado: string | null
  hora_fin_lavado: string | null
  horas_lavado: number | null
  total_horas_riego: number | null
  agua_total_m3: number | null
  ce_antes: number | null
  ce_durante: number | null
  ce_despues: number | null
  calibracion_entrada: number | null
  calibracion_salida: number | null
  calibracion_campo: number | null
  fecha_lavado: string | null
}

/** Una línea del plan, tal como se presupuestó. */
export type PlanDetalle = {
  producto_id: string | null
  producto_nombre: string | null
  producto_codigo: string | null
  dosis_mz: number | null
  area_planificada_mz: number | null
  total_litros: number | null
  costo_litro: number | null
  total_costo: number | null
  dias_preriego: number | null
  fecha_preriego: string | null
  dias_aplicacion: number | null
  fecha_aplicacion: string | null
}

/**
 * Una fila de `v_desinfeccion_informe_ejecutivo`: un lote en un ciclo,
 * con su flujo entero.
 */
export type FilaInforme = {
  lote_temporada_id: string
  ciclo: number
  lote_nomenclatura: string
  lote_nombre: string | null
  zona_id: string | null
  zona_nombre: string | null
  temporada_id: string
  temporada_nombre: string | null

  /* Tiempos */
  fecha_siembra_plan: string | null
  fecha_aplicacion_plan: string | null
  /** El preriego PLANIFICADO, y la cosecha prevista (migración 75). */
  fecha_preriego_plan: string | null
  fecha_cosecha_plan: string | null
  fecha_preriego: string | null
  /** El día de las lecturas de tensiómetro (etapa propia desde la 76). */
  fecha_lecturas: string | null
  fecha_aplicacion: string | null
  /** El día en que se lavó la cinta (migración 74). */
  fecha_lavado: string | null
  fecha_siembra: string | null
  /** `real` = ya se sembró. `plan` = todavía es lo previsto. */
  origen_siembra: 'real' | 'plan' | null
  variedad: string | null
  /** Con qué se aplicó (migración 75). */
  equipo_aplicacion: string | null
  ddt_preriego: number | null
  ddt_aplicacion: number | null
  ddt_lavado: number | null
  ddt_plan: number | null

  /* Agronomía */
  mz_regadas: number | null
  mz_planificadas: number | null
  dosis_mz_plan: number | null
  dosis_mz_real: number | null
  caudal_agua: number | null
  horas_riego: number | null
  ppm_principal: number | null
  objetivos_control: string[] | null
  /** La vista lo agrega por ejecución, así que llega anidado. */
  productos: ProductoInforme[][] | null
  estado: string | null

  /* Finanzas */
  costo_quimico: number | null
  /**
   * El químico, separado por fase (migración 76).
   *
   * El plan presupuesta SÓLO la aplicación. Medir contra él el costo
   * total —químico + cuadrilla + acarreo— dejaba la desviación siempre
   * en rojo y la hacía inútil.
   */
  costo_quimico_aplicacion: number | null
  costo_quimico_lavado: number | null
  costo_personal: number | null
  costo_personal_preriego: number | null
  costo_personal_aplicacion: number | null
  costo_personal_lavado: number | null
  costo_logistica: number | null
  costo_plan: number | null
  costo_total: number | null
  costo_mz: number | null
  delta_costo: number | null
  delta_costo_pct: number | null
  delta_dosis: number | null
  delta_dosis_pct: number | null
  fase_mas_cara: string | null

  /* El expediente (migración 76): de dónde salió cada número */
  cuadrilla_detalle: CuadrillaDetalle[] | null
  logistica_detalle: LogisticaDetalle[] | null
  ejecuciones_detalle: EjecucionDetalle[] | null
  planes_detalle: PlanDetalle[] | null
}

const n = (v: number | null | undefined): number => Number(v ?? 0)

/**
 * Los químicos de la fila, en una sola lista.
 *
 * La vista los agrupa por ejecución —un lote puede regarse en dos
 * turnos—, así que llegan anidados. Aquí se aplanan y se juntan los que
 * son el mismo producto: en el informe interesa cuánto se aplicó EN
 * TOTAL de cada químico, no en cuántas pasadas.
 */
export function productosDe(fila: FilaInforme): ProductoInforme[] {
  const planos = (fila.productos ?? []).flat().filter(Boolean)
  const porCodigo = new Map<string, ProductoInforme>()

  for (const p of planos) {
    const llave = p.codigo ?? p.nombre ?? '—'
    const antes = porCodigo.get(llave)
    if (!antes) {
      porCodigo.set(llave, { ...p, objetivos: [...(p.objetivos ?? [])] })
      continue
    }
    porCodigo.set(llave, {
      ...antes,
      litros: n(antes.litros) + n(p.litros),
      costo: n(antes.costo) + n(p.costo),
      dosis_mz: n(antes.dosis_mz) + n(p.dosis_mz),
      // Las ppm NO se suman: se queda la del que más litros llevó, que
      // es la que se discute. Una media de ppm no significa nada.
      ppm: n(antes.litros) >= n(p.litros) ? antes.ppm : p.ppm,
      objetivos: [...new Set([...(antes.objetivos ?? []), ...(p.objetivos ?? [])])].sort(),
    })
  }

  return [...porCodigo.values()].sort((a, b) => n(b.litros) - n(a.litros))
}

/* ------------------------------------------------------------------ */
/* Las desviaciones                                                     */
/* ------------------------------------------------------------------ */

/**
 * Cómo se lee una desviación.
 *
 * `null` cuando no hay plan contra el que comparar: eso **no es cero**.
 * Un cero diría «clavado», y lo que pasa es que no había plan.
 */
export type Tono = 'bien' | 'alerta' | 'malo' | 'neutro'

/**
 * El tono de una desviación de COSTO o de DOSIS.
 *
 * ── Por qué una banda y no un signo ─────────────────────────────────
 *
 * Pintar de rojo cualquier número por encima del plan haría que todo
 * saliera rojo: un turno nunca clava la dosis al decimal. Un informe
 * donde todo está en rojo no señala nada.
 *
 * La banda del ±5 % es «esto es ruido de campo». Fuera de ella, por
 * arriba, es gasto de más; por abajo, ahorro —o un lote al que le faltó
 * producto, que también hay que mirar, y por eso se marca en ámbar y no
 * en verde cuando se queda muy corto—.
 */
export function tonoDelta(pct: number | null | undefined): Tono {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'neutro'
  if (Math.abs(pct) <= 5) return 'bien'
  if (pct > 20) return 'malo'
  if (pct > 5) return 'alerta'
  // Muy por debajo del plan no es una buena noticia automática: puede
  // ser ahorro y puede ser que al lote le faltara producto.
  if (pct < -20) return 'alerta'
  return 'bien'
}

/**
 * El número con su signo delante, que es la mitad del dato.
 *
 * Se formatea con el MISMO separador de miles que el resto del sistema.
 * Escribía `+8000.00` mientras la pantalla decía `+8,000.00`, así que el
 * papel y el tablero discrepaban en la forma del mismo número: quien
 * lleva el informe a una reunión no tiene por qué explicar por qué.
 */
export function conSigno(v: number | null | undefined, decimales = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const s = new Intl.NumberFormat('es-HN', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(v)
  return v > 0 ? `+${s}` : s
}

/* ------------------------------------------------------------------ */
/* El cronograma por ETAPAS (migración 76)                              */
/* ------------------------------------------------------------------ */

/**
 * Una etapa del ciclo, con su fecha prevista y la que ocurrió.
 *
 * ── Por qué etapas y no hitos sueltos ───────────────────────────────
 *
 * La línea de tiempo anterior ponía todos los hitos sobre UNA recta y
 * alternaba las etiquetas arriba y abajo para que no se pisaran. Con
 * cuatro hitos colaba; con seis, y con un preriego y unas lecturas que
 * caen a dos días uno del otro, los textos se montan y el gráfico deja
 * de leerse justo en la parte que más se mira.
 *
 * Una etapa por FILA lo resuelve por construcción: dos etiquetas no
 * pueden chocar si viven en bandas distintas. Y de paso cabe lo que
 * antes no cabía —el plan Y lo real de la misma etapa, en la misma
 * banda—, que es la comparación que se viene a hacer.
 */
export type Etapa = {
  clave: 'preriego' | 'lecturas' | 'aplicacion' | 'lavado' | 'siembra' | 'cosecha'
  etiqueta: string
  plan: string | null
  real: string | null
  /** Días de `real` contra `plan`. Positivo = se hizo después. */
  desfase: number | null
  /**
   * Los DDT, contra la siembra. Negativo = todavía faltaba para
   * trasplantar, que es lo normal en una desinfección.
   *
   * Se calculan AQUÍ y no en la vista a propósito: son una resta de dos
   * fechas que la fila ya trae, y pedírselos a la base obligaría a
   * añadir seis columnas más para no decir nada nuevo.
   */
  ddtPlan: number | null
  ddtReal: number | null
}

const SEIS: {
  clave: Etapa['clave']
  etiqueta: string
  plan: (f: FilaInforme) => string | null
  real: (f: FilaInforme) => string | null
}[] = [
  {
    clave: 'preriego',
    etiqueta: 'Pre-riego',
    plan: (f) => f.fecha_preriego_plan,
    real: (f) => f.fecha_preriego,
  },
  {
    // Las lecturas no se planifican por separado: se hacen entre el
    // preriego y la inyección. Se enseña lo que ocurrió y se deja el
    // plan vacío en vez de inventarle uno.
    clave: 'lecturas',
    etiqueta: 'Lecturas',
    plan: () => null,
    real: (f) => f.fecha_lecturas,
  },
  {
    clave: 'aplicacion',
    etiqueta: 'Inyección / Aplicación',
    plan: (f) => f.fecha_aplicacion_plan,
    real: (f) => f.fecha_aplicacion,
  },
  {
    clave: 'lavado',
    etiqueta: 'Lavado de cinta',
    plan: () => null,
    real: (f) => f.fecha_lavado,
  },
  {
    clave: 'siembra',
    etiqueta: 'Siembra',
    plan: (f) => f.fecha_siembra_plan,
    real: (f) => (f.origen_siembra === 'real' ? f.fecha_siembra : null),
  },
  {
    clave: 'cosecha',
    etiqueta: 'Cosecha prevista',
    plan: (f) => f.fecha_cosecha_plan,
    real: () => null,
  },
]

/** Días entre dos fechas ISO. `null` si falta alguna. */
export function diasEntre(desde: string | null, hasta: string | null): number | null {
  if (!desde || !hasta) return null
  const a = Date.parse(`${hasta}T12:00:00Z`)
  const b = Date.parse(`${desde}T12:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((a - b) / 86_400_000)
}

/**
 * Las seis etapas del ciclo, siempre las seis y siempre en este orden.
 *
 * A diferencia de `hitosDe`, una etapa sin ninguna fecha **no se cae**:
 * se dibuja vacía. En un cronograma por filas el hueco informa —«esto
 * no se ha hecho»— mientras que en una recta sólo estorbaba.
 */
export function etapasDe(fila: FilaInforme): Etapa[] {
  // El DDT se cuenta contra la siembra REAL si la hay, y contra la
  // prevista si todavía no se sembró. Contra un hueco no se cuenta nada.
  const siembra = fila.fecha_siembra ?? fila.fecha_siembra_plan ?? null

  return SEIS.map((e) => {
    const plan = e.plan(fila)
    const real = e.real(fila)
    return {
      clave: e.clave,
      etiqueta: e.etiqueta,
      plan,
      real,
      desfase: diasEntre(plan, real),
      ddtPlan: diasEntre(siembra, plan),
      ddtReal: diasEntre(siembra, real),
    }
  })
}

/* ------------------------------------------------------------------ */
/* El expediente: tres detalles y el dossier por fase                   */
/* ------------------------------------------------------------------ */

const lista = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : [])

export const cuadrillaDe = (f: FilaInforme): CuadrillaDetalle[] => lista(f.cuadrilla_detalle)
export const logisticaDe = (f: FilaInforme): LogisticaDetalle[] => lista(f.logistica_detalle)
export const ejecucionesDe = (f: FilaInforme): EjecucionDetalle[] => lista(f.ejecuciones_detalle)
export const planesDe = (f: FilaInforme): PlanDetalle[] => lista(f.planes_detalle)

/** Las cuatro fases, con el nombre con el que se enseñan. */
export const FASES: { clave: string; etiqueta: string }[] = [
  { clave: '1_Preriego', etiqueta: '1 · Pre-riego' },
  { clave: '2_Lecturas', etiqueta: '2 · Lecturas' },
  { clave: '3_Aplicacion', etiqueta: '3 · Inyección / Aplicación' },
  { clave: '4_Lavado', etiqueta: '4 · Lavado de cinta' },
]

/** El nombre legible de una fase, sin su prefijo numérico. */
export function nombreFase(clave: string | null | undefined): string {
  if (!clave) return '—'
  return FASES.find((f) => f.clave === clave)?.etiqueta ?? clave.replace(/^\d_/, '')
}

/**
 * El dossier de una fase: sus químicos y su cuadrilla, ya prorrateados.
 *
 * Es el bloque que cierra el informe. La pregunta que contesta no es
 * «cuánto costó el lote» —eso está arriba— sino «qué se hizo en cada
 * fase y con qué», que es lo que se discute cuando un número no cuadra.
 */
export type DatoFase = { etiqueta: string; valor: string }

export type DossierFase = {
  clave: string
  etiqueta: string
  productos: ProductoInforme[]
  cuadrilla: CuadrillaDetalle[]
  /** Lo operativo de la fase, ya formado: reloj, agua, CE, calibración. */
  datos: DatoFase[]
  costoQuimico: number
  costoCuadrilla: number
  /** `true` si la fase no tiene absolutamente nada: no se hizo. */
  vacia: boolean
}

/* Formadores pequeños. Un hueco es un guion y NO un cero: un cero dice
   «se midió y dio cero», que es otra afirmación. */
const t = (v: string | null | undefined): string | null => (v ? String(v).slice(0, 5) : null)
const q = (v: number | null | undefined, su = ''): string | null =>
  v === null || v === undefined ? null : `${v}${su}`

/**
 * Las lecturas de tensiómetro, convertidas a texto.
 *
 * Cada lectura se escribe entera —punto, profundidad, valor, hora y
 * nota— y lo que falte se cae del renglón en vez de dejar un «undefined»
 * escrito. Devolver `null` cuando no hay ninguna es lo que hace que la
 * fase 2 no aparezca como hecha cuando nadie midió nada.
 */
export function lecturasTexto(
  v: LecturaTensiometro[] | string | null | undefined,
): string | null {
  if (v === null || v === undefined) return null
  // Lo escrito a mano antes de que la captura fuera estructurada.
  if (typeof v === 'string') return v.trim() || null
  if (!Array.isArray(v)) return null

  const lineas = v
    .map((l) => {
      if (!l || typeof l !== 'object') return null
      const punto = l.punto === null || l.punto === undefined ? '' : ` ${l.punto}`
      const prof =
        l.profundidad === null || l.profundidad === undefined ? '' : ` (${l.profundidad})`
      const valor =
        l.lectura === null || l.lectura === undefined ? null : `${l.lectura} cb`
      const hora = l.hora ? `a las ${String(l.hora).slice(0, 5)}` : null
      const nota = l.nota ? String(l.nota).trim() || null : null

      const cabeza = `Tensiómetro${punto}${prof}`
      const cuerpo = [valor, hora].filter(Boolean).join(' ')
      return [cuerpo ? `${cabeza}: ${cuerpo}` : cabeza, nota].filter(Boolean).join(' - ')
    })
    .filter((x): x is string => Boolean(x))

  return lineas.length === 0 ? null : lineas.join(' · ')
}

/** Un rango de reloj, o sólo las horas si falta alguna de las dos puntas. */
const rango = (
  desde: string | null | undefined,
  hasta: string | null | undefined,
  horas: number | null | undefined,
): string | null => {
  const a = t(desde)
  const b = t(hasta)
  // Guion simple y no raya larga: el motor de PDF escribe en Latin-1 y
  // un «–» sale como «?» en el papel. Lo mismo se lee igual de bien.
  if (a && b) return horas === null || horas === undefined ? `${a} - ${b}` : `${a} - ${b} (${horas} h)`
  return q(horas, ' h')
}

/*
 * **`undefined` también es un hueco.**
 *
 * La vista devuelve `null` para lo no capturado, pero un `jsonb` al que
 * le falta la clave llega como `undefined`, y comparar sólo contra
 * `null` dejaba pasar renglones como «Fecha:» sin valor y marcaba como
 * hecha una fase que no se había tocado.
 */
const unir = (pares: [string, string | null | undefined][]): DatoFase[] =>
  pares
    // **`typeof === 'string'` y no «distinto de nulo».** Un `jsonb` que
    // resulta ser un arreglo de objetos pasaba el filtro y acababa en el
    // JSX, donde React lo rechaza con el error 31 —minificado y sin
    // decir qué objeto era—. Aquí no entra nada que no sea texto.
    .filter((par): par is [string, string] => typeof par[1] === 'string' && par[1] !== '')
    .map(([etiqueta, valor]) => ({ etiqueta, valor }))

/** Tres medidas que se leen juntas, o ninguna si no se midió ninguna. */
const trio = (
  a: number | null | undefined,
  b: number | null | undefined,
  c: number | null | undefined,
): string | null =>
  a === null || a === undefined
    ? b === null || b === undefined
      ? c === null || c === undefined
        ? null
        : `— / — / ${c}`
      : `— / ${b} / ${c ?? '—'}`
    : `${a} / ${b ?? '—'} / ${c ?? '—'}`

/**
 * Lo operativo de una fase, sacado de los turnos que regaron el lote.
 *
 * Un lote puede regarse en DOS turnos, así que cada dato se presenta con
 * el código del turno delante cuando hay más de uno. Promediarlos sería
 * inventar un turno que no existió.
 */
function datosDeFase(clave: string, turnos: EjecucionDetalle[]): DatoFase[] {
  const varios = turnos.length > 1
  const marca = (e: EjecucionDetalle, etiqueta: string) =>
    varios ? `${e.turno_codigo ?? '—'} · ${etiqueta}` : etiqueta

  return turnos.flatMap((e) => {
    if (clave === '1_Preriego')
      return unir([
        [marca(e, 'Fecha'), e.fecha_preriego],
        [marca(e, 'Reloj'), rango(e.hora_inicio_preriego, e.hora_fin_preriego, e.horas_preriego)],
        [marca(e, 'Observaciones'), e.obs_preriego],
      ])

    if (clave === '2_Lecturas')
      return unir([
        [marca(e, 'Fecha'), e.fecha_lecturas],
        [marca(e, 'Tensiómetros'), lecturasTexto(e.lecturas_tensiometro)],
      ])

    if (clave === '3_Aplicacion')
      return unir([
        [marca(e, 'Fecha'), e.fecha_aplicacion],
        [marca(e, 'Estación de riego'), e.estacion_nombre],
        [marca(e, 'Equipo de aplicación'), e.equipo_aplicacion_mostrado],
        [marca(e, 'Caudal'), q(e.caudal_agua, ' m³/h')],
        [marca(e, 'Agua con producto'), q(e.agua_total_m3, ' m³')],
        [marca(e, 'Presurización'),
          rango(e.inicio_presurizacion, e.fin_presurizacion, e.horas_presurizacion)],
        [marca(e, 'Inyección'), rango(e.hora_inicio_iny, e.hora_fin_iny, e.horas_inyeccion)],
        [marca(e, 'Total horas de riego'), q(e.total_horas_riego, ' h')],
        [marca(e, 'CE antes / durante / después'),
          trio(e.ce_antes, e.ce_durante, e.ce_despues)],
        [marca(e, 'Calibración entrada / salida / campo'),
          trio(e.calibracion_entrada, e.calibracion_salida, e.calibracion_campo)],
      ])

    if (clave === '4_Lavado')
      return unir([
        [marca(e, 'Fecha'), e.fecha_lavado],
        [marca(e, 'Reloj'), rango(e.hora_inicio_lavado, e.hora_fin_lavado, e.horas_lavado)],
      ])

    return []
  })
}

export function dossierDe(fila: FilaInforme): DossierFase[] {
  const todos = (fila.productos ?? []).flat().filter(Boolean)
  const peones = cuadrillaDe(fila)
  const turnos = ejecucionesDe(fila)

  return FASES.map(({ clave, etiqueta }) => {
    const productos = todos.filter((p) => p.fase === clave)
    const cuadrilla = peones.filter((c) => c.fase === clave)
    const datos = datosDeFase(clave, turnos)
    const costoQuimico = productos.reduce((a, p) => a + n(p.costo_lote ?? p.costo), 0)
    const costoCuadrilla = cuadrilla.reduce((a, c) => a + n(c.costo_lote), 0)
    return {
      clave,
      etiqueta,
      productos,
      cuadrilla,
      datos,
      costoQuimico,
      costoCuadrilla,
      // **Una fase está vacía sólo si no hay NADA**, ni siquiera una
      // fecha. Las lecturas no llevan químico ni cuadrilla, y marcarlas
      // vacías por eso escondería el único dato que tienen.
      vacia: productos.length === 0 && cuadrilla.length === 0 && datos.length === 0,
    }
  })
}

/**
 * El plan contra lo real, producto a producto, para la fase 3.
 *
 * Es la única fase que el plan presupuesta. Se cruzan por código, y lo
 * que aparece sólo en un lado aparece igual: un químico planificado que
 * no se aplicó —o uno aplicado que nadie planificó— es justo lo que se
 * viene a buscar, y emparejar sólo lo que coincide lo escondería.
 */
export type ParPlanReal = {
  codigo: string
  nombre: string | null
  dosisPlan: number | null
  dosisReal: number | null
  litrosPlan: number | null
  litrosReal: number | null
  costoPlan: number | null
  costoReal: number | null
}

export function planContraReal(fila: FilaInforme): ParPlanReal[] {
  const reales = (fila.productos ?? [])
    .flat()
    .filter((p) => Boolean(p) && p.fase === '3_Aplicacion')
  const planes = planesDe(fila)

  const porCodigo = new Map<string, ParPlanReal>()
  const vacio = (codigo: string, nombre: string | null): ParPlanReal => ({
    codigo,
    nombre,
    dosisPlan: null,
    dosisReal: null,
    litrosPlan: null,
    litrosReal: null,
    costoPlan: null,
    costoReal: null,
  })

  for (const l of planes) {
    const codigo = l.producto_codigo ?? l.producto_nombre ?? '—'
    const fila_ = porCodigo.get(codigo) ?? vacio(codigo, l.producto_nombre)
    fila_.dosisPlan = n(fila_.dosisPlan) + n(l.dosis_mz)
    fila_.litrosPlan = n(fila_.litrosPlan) + n(l.total_litros)
    fila_.costoPlan = n(fila_.costoPlan) + n(l.total_costo)
    porCodigo.set(codigo, fila_)
  }

  for (const r of reales) {
    const codigo = r.codigo ?? r.nombre ?? '—'
    const fila_ = porCodigo.get(codigo) ?? vacio(codigo, r.nombre)
    fila_.nombre = fila_.nombre ?? r.nombre
    fila_.dosisReal = n(fila_.dosisReal) + n(r.dosis_mz)
    fila_.litrosReal = n(fila_.litrosReal) + n(r.litros_lote ?? r.litros)
    fila_.costoReal = n(fila_.costoReal) + n(r.costo_lote ?? r.costo)
    porCodigo.set(codigo, fila_)
  }

  return [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))
}

/**
 * Cuántos días de retraso llevó la aplicación contra su plan.
 *
 * Positivo = se aplicó después de lo previsto. `null` si falta alguna de
 * las dos fechas: comparar contra un hueco da un número inventado.
 */
export function retrasoDias(fila: FilaInforme): number | null {
  if (!fila.fecha_aplicacion || !fila.fecha_aplicacion_plan) return null
  const a = Date.parse(`${fila.fecha_aplicacion}T12:00:00Z`)
  const b = Date.parse(`${fila.fecha_aplicacion_plan}T12:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((a - b) / 86_400_000)
}

/* ------------------------------------------------------------------ */
/* Lo que la 76 retiró                                                  */
/* ------------------------------------------------------------------ */

/*
 * `hitosDe`, `piezasDe`, `porcentajeDe` y `fasesCuadrilla` vivían aquí.
 *
 * Los dos primeros alimentaban la recta del cronograma y la barra
 * apilada del costo, y las dos figuras se retiraron en la 76: la recta
 * porque con seis etapas sus etiquetas se pisaban, y la barra porque
 * decía «98 % químico» sin contestar de dónde salía cada lempira.
 *
 * Lo que las sustituye —`etapasDe` y el expediente de arriba— sale de
 * los mismos datos y lo consumen los mismos dos clientes, la pantalla y
 * el PDF. Dejarlas aquí «por si acaso» habría dejado dos maneras de
 * calcular el reparto de un costo, que es justo como se llega a un papel
 * que no coincide con el tablero.
 */
