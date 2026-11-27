/**
 * Semáforos, «qué toca ahora» y señales por día de registro (sql/147 §5), calculados en el teléfono con lo que ya bajó de
 * fn_mot_estado_campo + lo pendiente de enviar. Las MISMAS reglas y textos de la base (`_mot_semaforo`, `_mot_estado_motor`,
 * `_mot_senales`) para que sin señal el estacionero vea lo mismo. Puro: ni React, ni IndexedDB, ni red, ni importaciones de valores
 * (así las pruebas con Node cargan el archivo suelto).
 */

import type { AyudaAhora, MotorEstacion, NivelSemaforo, OperacionPendienteMotor, RecepcionMotor, RegistroMotor } from './estado'

export type NivelAviso = 'rojo' | 'amarillo' | 'info'
export type Aviso = { nivel: NivelAviso; codigo: string; texto: string }

const TOLERANCIA_GAL = 3
export const ORDEN_NIVEL: Record<string, number> = { rojo: 0, amarillo: 1, info: 2, gris: 3, verde: 4 }

const r2 = (n: number) => Math.round(n * 100) / 100
/** Número sin ceros de más («5», «5.4»). */
const t = (n: number, d = 1) => String(Math.round(n * 10 ** d) / 10 ** d)
const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const diaLocal = (iso: string): string => {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? new Date(ms - 6 * 3600_000).toISOString().slice(0, 10) : iso.slice(0, 10)
}

/** Días de calendario entre dos fechas AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}
const sumarDias = (iso: string, d: number): string => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)

/** El peor nivel de una lista (rojo > amarillo > info/gris > verde); lista vacía = verde. */
export function peorNivel(niveles: string[]): string {
  return niveles.reduce((p, n) => (ORDEN_NIVEL[n] < ORDEN_NIVEL[p] ? n : p), 'verde')
}

// ---------------------------------------------------------------- semáforos del motor (§5.1)

export type Semaforo = { nivel: NivelSemaforo; texto: string }

export function semaforoMantenimiento(m: { intervalo_horas: number | null; aviso_horas: number | null }, horasDesdeMant: number, horasEstimadas = 0): Semaforo & { faltan: number | null } {
  const intervalo = m.intervalo_horas
  if (intervalo === null || intervalo === undefined || intervalo <= 0) {
    return { nivel: 'gris', faltan: null, texto: 'Sin intervalo: cárgalo en AGL.' }
  }
  const aviso = m.aviso_horas ?? Math.round(intervalo * 0.1)
  const faltan = r2(intervalo - horasDesdeMant)
  const nivel: NivelSemaforo = faltan <= 0 ? 'rojo' : faltan <= aviso ? 'amarillo' : 'verde'
  let texto =
    nivel === 'rojo'
      ? `Vencido hace ${t(-faltan)} h`
      : `Faltan ${t(faltan)} h`
  if (horasEstimadas > 0) texto += ` · ${t(horasEstimadas)} h estimadas`
  return { nivel, faltan, texto }
}

export function semaforoRegistro(fechaUltima: string | null, hoy: string): Semaforo & { dias: number | null } {
  if (!fechaUltima) return { nivel: 'amarillo', dias: null, texto: 'Sin registros: registra el primer día.' }
  const dias = Math.max(diasEntre(fechaUltima, hoy) - 1, 0)
  // Un día sin registro NO es una alerta: si el motor no trabajó, no se registra (la continuidad del horómetro y del visor lo confirma)
  if (dias === 0) return { nivel: 'verde', dias, texto: 'Registro al día.' }
  return { nivel: 'gris', dias, texto: `Último registro hace ${dias + 1} día${dias === 0 ? '' : 's'}.` }
}

export function semaforoTanque(saldo: number | null, capacidad: number | null): Semaforo & { pct: number | null } {
  if (saldo === null) return { nivel: 'rojo', pct: null, texto: 'Sin tanque conectado.' }
  const pct = capacidad && capacidad > 0 ? Math.max(0, Math.min(100, Math.round((saldo * 100) / capacidad))) : null
  if (saldo <= 0) return { nivel: 'rojo', pct, texto: 'Tanque vacío: recibe combustible.' }
  if (capacidad && saldo <= capacidad * 0.15) return { nivel: 'amarillo', pct, texto: `Tanque bajo: ${t(saldo)} gal.` }
  return { nivel: 'verde', pct, texto: `Tanque con ${t(saldo)} gal.` }
}

/** Último día registrado del motor, contando lo pendiente de enviar. */
export function fechaUltimaLocal(motor: { equipo_id: string; fecha_ultimo: string | null }, pendientes: OperacionPendienteMotor[]): string | null {
  let f = motor.fecha_ultimo
  for (const o of pendientes) {
    if (o.estado_local !== 'PENDIENTE' || o.tipo !== 'motor_registro_diario' || o.datos.equipo_id !== motor.equipo_id) continue
    const d = String(o.datos.fecha ?? '')
    if (d && (!f || d > f)) f = d
  }
  return f
}

export type AyudaLocal = {
  nivel: NivelSemaforo
  mantenimiento: ReturnType<typeof semaforoMantenimiento>
  registro: ReturnType<typeof semaforoRegistro> | null
  tanque: ReturnType<typeof semaforoTanque> | null
  /** De lo más urgente a lo menos. */
  ahora: AyudaAhora[]
}

/** Todo lo que se ve de un motor de un vistazo (igual que `_mot_estado_motor`). Solo el motor instalado en una estación tiene registro y tanque. */
export function ayudaLocal(args: {
  motor: Pick<MotorEstacion, 'estado' | 'intervalo_horas' | 'aviso_horas' | 'tanque'>
  saldoTanque: number | null
  horasDesdeMant: number
  horasEstimadas: number
  fechaUltima: string | null
  hoy: string
}): AyudaLocal {
  const { motor } = args
  const mantenimiento = semaforoMantenimiento(motor, args.horasDesdeMant, args.horasEstimadas)
  const ahora: AyudaAhora[] = []
  if (mantenimiento.nivel === 'rojo' || mantenimiento.nivel === 'amarillo') ahora.push({ nivel: mantenimiento.nivel, codigo: 'MANTENIMIENTO', texto: mantenimiento.texto })
  let registro: AyudaLocal['registro'] = null
  let tanque: AyudaLocal['tanque'] = null
  if (motor.estado === 'EN_ESTACION') {
    registro = semaforoRegistro(args.fechaUltima, args.hoy)
    if (!motor.tanque) {
      tanque = semaforoTanque(null, null)
      ahora.push({ nivel: 'rojo', codigo: 'SIN_TANQUE', texto: tanque.texto })
    } else {
      tanque = semaforoTanque(args.saldoTanque ?? motor.tanque.saldo_gal, motor.tanque.capacidad_gal)
      if (tanque.nivel !== 'verde') ahora.push({ nivel: tanque.nivel, codigo: 'TANQUE', texto: tanque.texto })
    }
  }
  const ordenadas = ahora.map((x, i) => ({ x, i })).sort((a, b) => ORDEN_NIVEL[a.x.nivel] - ORDEN_NIVEL[b.x.nivel] || a.i - b.i).map((e) => e.x)
  const nivel: NivelSemaforo = ordenadas.some((x) => x.nivel === 'rojo') ? 'rojo' : ordenadas.some((x) => x.nivel === 'amarillo') ? 'amarillo' : 'verde'
  return { nivel, mantenimiento, registro, tanque, ahora: ordenadas }
}

export type ItemAhora = AyudaAhora & { equipo_id: string; motor: string }

/** «Qué toca ahora» de toda la estación, ordenado por urgencia (y por motor a igual urgencia). */
export function queTocaAhora(items: { motor: { equipo_id: string; codigo: string }; ayuda: AyudaLocal }[]): ItemAhora[] {
  const lista: ItemAhora[] = []
  for (const it of items) for (const a of it.ayuda.ahora) lista.push({ ...a, equipo_id: it.motor.equipo_id, motor: it.motor.codigo })
  return lista
    .map((x, i) => ({ x, i }))
    .sort((a, b) => ORDEN_NIVEL[a.x.nivel] - ORDEN_NIVEL[b.x.nivel] || a.x.motor.localeCompare(b.x.motor, 'es', { numeric: true }) || a.i - b.i)
    .map((e) => e.x)
}

// ---------------------------------------------------------------- referencia de rendimiento y horas estimadas (§3)

const mediana = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Mediana de gal/h de los últimos 30 días del propio motor con horas y consumo; mínimo 5 días (igual que `_mot_rend_referencia`). */
export function rendimientoReferencia(registros: Pick<RegistroMotor, 'equipo_id' | 'fecha' | 'horas' | 'gastado_gal' | 'rendimiento_gal_h' | 'anulado_at'>[], equipoId: string, fecha: string): number | null {
  const desde = sumarDias(fecha, -30)
  const vals = registros
    .filter((r) => r.equipo_id === equipoId && !r.anulado_at && r.fecha < fecha && r.fecha >= desde && r.horas > 0 && r.gastado_gal > 0 && r.rendimiento_gal_h !== null)
    .map((r) => r.rendimiento_gal_h as number)
  return vals.length >= 5 ? mediana(vals) : null
}

/** Horas que se estimarían solo para el mantenimiento: horómetro sin avance (horas 0) con consumo ÷ rendimiento de referencia. */
export function horasEstimadas(horas: number, gastado: number, referencia: number | null): number | null {
  if (!(horas === 0 && gastado > 0) || !referencia || referencia <= 0) return null
  return r2(gastado / referencia)
}

/**
 * Horas desde el último mantenimiento contando lo pendiente de enviar, con las ESTIMADAS aparte (nunca suman al horómetro):
 * las horas de los registros en cola suman; un mantenimiento en cola reinicia el contador.
 */
export function horasMantDetalle(
  motor: { equipo_id: string; horas_desde_mant: number; horas_est_desde_mant?: number | null },
  registros: RegistroMotor[],
  pendientes: OperacionPendienteMotor[]
): { horas: number; estimadas: number } {
  const propios = pendientes.filter((o) => o.estado_local === 'PENDIENTE' && o.datos.equipo_id === motor.equipo_id)
  const mant = propios
    .filter((o) => o.tipo === 'motor_mantenimiento')
    .map((o) => String(o.datos.fecha_hora ?? '').slice(0, 10))
    .sort()
    .pop()
  let horas = mant ? 0 : motor.horas_desde_mant
  let est = mant ? 0 : (motor.horas_est_desde_mant ?? 0)
  for (const o of propios) {
    if (o.tipo !== 'motor_registro_diario') continue
    const fecha = String(o.datos.fecha ?? '')
    if (mant && fecha <= mant) continue
    const h = Math.max(num(o.datos.horo_fin) - num(o.datos.horo_ini), 0)
    const gastado = o.datos.gastado_local !== undefined ? num(o.datos.gastado_local) : Math.max(num(o.datos.visor_ini) - num(o.datos.visor_fin), 0)
    const e = horasEstimadas(h, gastado, rendimientoReferencia(registros, motor.equipo_id, fecha)) ?? 0
    horas += h + e
    est += e
  }
  return { horas: r2(horas), estimadas: r2(est) }
}

// ---------------------------------------------------------------- señales por día de registro (§5.2)

type RegSenal = Pick<
  RegistroMotor,
  'id' | 'equipo_id' | 'fecha' | 'estacion_id' | 'tanque_id' | 'horo_ini' | 'horo_fin' | 'horas' | 'visor_ini' | 'visor_fin' | 'gastado_gal' | 'recibido_gal' | 'rendimiento_gal_h' | 'rpm' | 'horo_cambiado' | 'visor_cambiado' | 'dif_visor_gal' | 'horas_estimadas' | 'rend_ref_gal_h' | 'anulado_at'
> & { fecha_hora?: string }

/** Las señales de un día, con el registro anterior del mismo motor (`prev`) y los 10 anteriores con rendimiento (`hist`). */
export function senalesDeRegistro(
  r: RegSenal,
  prev: RegSenal | null,
  hist: RegSenal[],
  recepciones: Pick<RecepcionMotor, 'tanque_id' | 'galones' | 'fecha_hora' | 'anulado_at'>[],
  /** sql/155: diésel devuelto a bodega (resta entre el día anterior, incluido, y este día, excluido: igual que la base). */
  devoluciones: Pick<RecepcionMotor, 'tanque_id' | 'galones' | 'fecha_hora' | 'anulado_at'>[] = [],
  /**
   * Registro anterior del MISMO TANQUE (de cualquier motor): el visor sigue al tanque, no al motor (reemplazo temporal: otro motor
   * gastó de ese tanque entre medio). Sin pasarlo (undefined) se usa `prev`, como antes.
   */
  prevTanque?: RegSenal | null,
  codigoMotor?: (equipoId: string) => string | null
): Aviso[] {
  const out: Aviso[] = []
  const add = (nivel: NivelAviso, codigo: string, texto: string) => out.push({ nivel, codigo, texto })
  if (prev && !r.horo_cambiado) {
    if (r.horo_ini < prev.horo_fin - 0.005) add('rojo', 'HORO_RETROCEDE', `Horómetro retrocede: inicia ${t(r.horo_ini, 2)}, antes ${t(prev.horo_fin, 2)}.`)
    else if (r.horo_ini > prev.horo_fin + 0.005) add('amarillo', 'HORO_SALTA', `Horómetro salta ${t(r.horo_ini - prev.horo_fin, 2)} h.`)
  }
  const pt = prevTanque === undefined ? (prev && prev.tanque_id === r.tanque_id ? prev : null) : prevTanque
  if (pt && pt.equipo_id !== r.equipo_id && pt.gastado_gal > 0) {
    add('info', 'TANQUE_OTRO_MOTOR', `Antes, este tanque alimentó a ${codigoMotor?.(pt.equipo_id) ?? 'otro motor'}: ${t(pt.gastado_gal)} gal el ${pt.fecha.slice(8, 10)}/${pt.fecha.slice(5, 7)}.`)
  }
  if (pt && pt.fecha === r.fecha && !r.visor_cambiado) {
    // el mismo día otro registro del tanque terminó antes: el visor inicial sigue donde ese terminó
    const d = r.visor_ini - pt.visor_fin
    if (d < -TOLERANCIA_GAL) add('rojo', 'VISOR_FALTA', `Visor inicial: faltan ${t(-d)} gal.`)
    else if (d > TOLERANCIA_GAL + Math.max(0, r.recibido_gal)) add('amarillo', 'VISOR_SOBRA', `Visor inicial: sobran ${t(d)} gal. ¿Falta recibir combustible?`)
  } else if (pt && !r.visor_cambiado) {
    const prev = pt
    // suministros entre el día anterior y este día (este incluido): lo recibido en el tanque o lo declarado en el registro
    const enRango = recepciones.filter((x) => !x.anulado_at && x.tanque_id === r.tanque_id && diaLocal(x.fecha_hora) > prev.fecha && diaLocal(x.fecha_hora) < r.fecha).reduce((s, x) => s + x.galones, 0)
    const delDia = recepciones.filter((x) => !x.anulado_at && x.tanque_id === r.tanque_id && diaLocal(x.fecha_hora) === r.fecha).reduce((s, x) => s + x.galones, 0)
    const devuelto = devoluciones.filter((x) => !x.anulado_at && x.tanque_id === r.tanque_id && diaLocal(x.fecha_hora) >= prev.fecha && diaLocal(x.fecha_hora) < r.fecha).reduce((s, x) => s + x.galones, 0)
    const esperado = prev.visor_fin + enRango + Math.max(delDia, r.recibido_gal) - devuelto
    const d = r.visor_ini - esperado
    if (d < -TOLERANCIA_GAL) add('rojo', 'VISOR_FALTA', `Visor inicial: faltan ${t(-d)} gal.`)
    else if (d > TOLERANCIA_GAL) add('amarillo', 'VISOR_SOBRA', `Visor inicial: sobran ${t(d)} gal. ¿Falta recibir combustible?`)
  }
  // El visor contra el tanque se compara EN VIVO con el registro anterior y las recepciones (VISOR_FALTA / VISOR_SOBRA). Lo guardado al registrar
  // (dif_visor_gal) queda viejo en cuanto se corrige un registro o una recepción, así que ya no se usa para avisar.
  const rend = hist.filter((h) => h.horas > 0 && h.rendimiento_gal_h !== null).slice(0, 10).map((h) => h.rendimiento_gal_h as number)
  if (r.horas > 0 && r.rendimiento_gal_h !== null && rend.length >= 5) {
    const med = mediana(rend)
    if (med > 0 && (r.rendimiento_gal_h > med * 1.35 || r.rendimiento_gal_h < med * 0.65)) {
      const grave = r.rendimiento_gal_h > med * 1.75 || r.rendimiento_gal_h < med * 0.4
      add(grave ? 'rojo' : 'amarillo', 'RENDIMIENTO', `Rinde ${t(r.rendimiento_gal_h, 2)} gal/h; lo normal ${t(med, 2)}.`)
    }
  }
  if (r.horas === 0 && r.gastado_gal > 0) {
    add(
      'amarillo',
      'HORO_SIN_AVANCE_CON_CONSUMO',
      `Horómetro sin avance, gastó ${t(r.gastado_gal)} gal.` + (r.horas_estimadas !== null ? ` Se estiman ${t(r.horas_estimadas)} h.` : ' Sin referencia para estimar.')
    )
  }
  if (r.horas >= 1 && r.gastado_gal === 0) add('amarillo', 'HORAS_SIN_CONSUMO', `Trabajó ${t(r.horas)} h sin gastar.`)
  if (r.horas > 24) add('rojo', 'HORAS_IMPOSIBLES', `Más de 24 h en un día.`)
  if (r.rpm === null) add('info', 'SIN_RPM', 'Faltan las revoluciones.')
  return out
}

/** Señales de TODOS los registros bajados (por registro), con las mismas reglas de la base. Sin red. */
export function senalesPorRegistro(
  registros: RegSenal[],
  recepciones: Pick<RecepcionMotor, 'tanque_id' | 'galones' | 'fecha_hora' | 'anulado_at'>[],
  devoluciones: Pick<RecepcionMotor, 'tanque_id' | 'galones' | 'fecha_hora' | 'anulado_at'>[] = [],
  codigoMotor?: (equipoId: string) => string | null
): Map<string, Aviso[]> {
  const mapa = new Map<string, Aviso[]>()
  const vigentes = registros.filter((r) => !r.anulado_at)
  const orden = (a: RegSenal, b: RegSenal) => a.fecha.localeCompare(b.fecha) || (a.fecha_hora ?? '').localeCompare(b.fecha_hora ?? '') || b.visor_ini - a.visor_ini || a.id.localeCompare(b.id)
  // el visor sigue al TANQUE: el anterior del tanque puede ser de otro motor (reemplazo temporal)
  const anteriorTanque = new Map<string, RegSenal | null>()
  const porTanque = new Map<string, RegSenal[]>()
  for (const r of vigentes) porTanque.set(r.tanque_id, [...(porTanque.get(r.tanque_id) ?? []), r])
  for (const lista of porTanque.values()) [...lista].sort(orden).forEach((r, i, asc) => anteriorTanque.set(r.id, i > 0 ? asc[i - 1] : null))
  const porMotor = new Map<string, RegSenal[]>()
  for (const r of vigentes) porMotor.set(r.equipo_id, [...(porMotor.get(r.equipo_id) ?? []), r])
  for (const lista of porMotor.values()) {
    const asc = [...lista].sort(orden)
    asc.forEach((r, i) => {
      const hist = asc.slice(0, i).reverse()
      mapa.set(r.id, senalesDeRegistro(r, i > 0 ? asc[i - 1] : null, hist, recepciones, devoluciones, anteriorTanque.get(r.id) ?? null, codigoMotor))
    })
  }
  return mapa
}

/** Observaciones de captura que sí interesan en la fila (el resto son detalle técnico). */
export const OBS_MOTOR: Record<string, { nivel: NivelAviso; texto: string }> = {
  REGISTRO_HISTORICO: { nivel: 'info', texto: 'Registro histórico' },
  SUMINISTRO_DURANTE_DIA: { nivel: 'info', texto: 'Entró combustible ese día' },
  MOTOR_NO_ASIGNADO_EN_FECHA: { nivel: 'amarillo', texto: 'Motor sin asignar esa fecha' },
  MOTOR_EN_TALLER_EN_FECHA: { nivel: 'amarillo', texto: 'Motor en taller esa fecha' },
  MOTOR_RETIRADO_EN_FECHA: { nivel: 'amarillo', texto: 'Motor retirado esa fecha' },
  MANTENIMIENTO_PROXIMO: { nivel: 'amarillo', texto: 'Mantenimiento próximo' },
  MANTENIMIENTO_VENCIDO: { nivel: 'rojo', texto: 'Mantenimiento vencido' },
}

// ---------------------------------------------------------------- alertas del formulario (antes de guardar)

export type EntradaAlertas = {
  fecha: string
  horoIni: number | null
  horoFin: number | null
  visorIni: number | null
  visorFin: number | null
  suministro: number
  horoCambiado: boolean
  visorCambiado: boolean
  /** Lectura final del último registro anterior a la fecha (continuidad). */
  previo: { horoIni: number | null; visorIni: number | null; fechaBase: string | null }
  /** Saldo del tanque según el libro (con lo pendiente) y lo ya recibido ese día en él; null = no se sabe. */
  saldoTanque: number | null
  recibidoHoyTanque: number
  /** Registros ya bajados del motor (para el rendimiento normal y la referencia). */
  registros: RegSenal[]
  equipoId: string
  /** Es histórico: no mueve el libro, no se compara el saldo. */
  historico?: boolean
}

/** Lo que se le dice a quien escribe, en vivo: continuidad, visor contra el libro, rendimiento y horas estimadas. */
export function alertasRegistro(e: EntradaAlertas): Aviso[] {
  const out: Aviso[] = []
  const { horoIni, horoFin, visorIni, visorFin } = e
  const p = e.previo
  if (horoIni !== null && p.horoIni !== null && !e.horoCambiado) {
    if (horoIni < p.horoIni - 0.005) out.push({ nivel: 'rojo', codigo: 'HORO_RETROCEDE', texto: `Horómetro retrocede: antes terminó en ${t(p.horoIni, 2)}.` })
    else if (horoIni > p.horoIni + 0.005) out.push({ nivel: 'amarillo', codigo: 'HORO_SALTA', texto: `Horómetro salta ${t(horoIni - p.horoIni, 2)} h.` })
  }
  // Hueco del visor: debe iniciar donde terminó el último registro más lo recibido ese día (un histórico no suma lo recibido).
  // Solo informa: no bloquea el guardado.
  const visorEsperado = p.visorIni !== null ? p.visorIni + (e.historico ? 0 : e.suministro) : null
  if (visorIni !== null && visorEsperado !== null && !e.visorCambiado && Math.abs(visorIni - visorEsperado) > 0.005) {
    out.push({ nivel: 'amarillo', codigo: 'VISOR_NO_CONTINUA', texto: `Visor no continúa: debía iniciar en ${t(visorEsperado)}.` })
  }
  if (!e.historico && visorIni !== null && e.saldoTanque !== null && p.visorIni !== null && !e.visorCambiado) {
    const extra = Math.max(e.suministro - e.recibidoHoyTanque, 0)
    const esperado = e.saldoTanque + extra
    const d = r2(visorIni - esperado)
    if (d < -TOLERANCIA_GAL) out.push({ nivel: 'rojo', codigo: 'SALDO_FALTA', texto: `Faltan ${t(-d)} gal contra el tanque.` })
    else if (d > TOLERANCIA_GAL) out.push({ nivel: 'amarillo', codigo: 'SALDO_SOBRA', texto: `Sobran ${t(d)} gal contra el tanque.` })
  }
  if (horoIni !== null && horoFin !== null && visorIni !== null && visorFin !== null) {
    const horas = horoFin >= horoIni ? r2(horoFin - horoIni) : 0
    let gastado = r2(visorIni - visorFin)
    if (gastado < 0 && e.suministro > 0 && visorFin - visorIni <= e.suministro + 0.5) gastado = r2(visorIni + e.suministro - visorFin)
    if (gastado >= 0) {
      if (horas > 24) out.push({ nivel: 'rojo', codigo: 'HORAS_IMPOSIBLES', texto: `Más de 24 h en un día.` })
      const hist = e.registros.filter((r) => r.equipo_id === e.equipoId && !r.anulado_at && r.fecha < e.fecha).sort((a, b) => b.fecha.localeCompare(a.fecha))
      const rend = hist.filter((h) => h.horas > 0 && h.rendimiento_gal_h !== null).slice(0, 10).map((h) => h.rendimiento_gal_h as number)
      if (horas > 0 && rend.length >= 5) {
        const med = mediana(rend)
        const re = gastado / horas
        if (med > 0 && (re > med * 1.35 || re < med * 0.65)) {
          const grave = re > med * 1.75 || re < med * 0.4
          out.push({ nivel: grave ? 'rojo' : 'amarillo', codigo: 'RENDIMIENTO', texto: `Rinde ${t(re, 2)} gal/h; lo normal ${t(med, 2)}. Revisa las lecturas.` })
        }
      }
      if (horas >= 1 && gastado === 0) out.push({ nivel: 'amarillo', codigo: 'HORAS_SIN_CONSUMO', texto: `Trabajó ${t(horas)} h sin gastar.` })
      if (horas === 0 && gastado > 0) {
        const ref = rendimientoReferencia(e.registros, e.equipoId, e.fecha)
        const est = horasEstimadas(horas, gastado, ref)
        out.push({
          nivel: 'amarillo',
          codigo: 'HORO_SIN_AVANCE_CON_CONSUMO',
          texto:
            est !== null
              ? `Horómetro sin avance: se estiman ${t(est)} h.`
              : `Horómetro sin avance, gastó ${t(gastado)} gal.`,
        })
      }
    }
  }
  return out.sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel])
}
