/**
 * Lo que el teléfono sabe de Motores y combustible (respuesta de fn_mot_estado_campo, sql/130 y 147) y las cuentas puras
 * sobre eso. Ni React, ni IndexedDB, ni red. Motor = fila de `equipos` (catálogo existente), estación = `estaciones_riego`,
 * diésel = `materiales`: aquí solo viajan sus ids.
 *
 * sql/147: los tanques son FIJOS (catálogo de Torre de Control, asignados a una estación); el diésel se recibe al tanque y no
 * pasa por la bodega. La base quita las claves vacías: `normalizarEstado` las vuelve null.
 */

import type { Operacion } from '@/lib/fertirriego/tipos'

export type EstadoMotor = 'SIN_ASIGNAR' | 'EN_ESTACION' | 'TALLER' | 'RETIRADO'

export type TanqueMotor = { id: string; nombre: string; capacidad_gal: number | null; saldo_gal: number }

export type MotorEstacion = {
  equipo_id: string
  codigo: string
  nombre: string
  modelo: string | null
  estado: EstadoMotor
  estacion_id: string | null
  tanque: TanqueMotor | null
  horo_ultimo: number | null
  visor_ultimo: number | null
  fecha_ultimo: string | null
  intervalo_horas: number | null
  aviso_horas: number | null
  horas_desde_mant: number
  /** sql/147: parte de `horas_desde_mant` que es ESTIMADA (horómetro sin avance con consumo); solo cuenta para el mantenimiento. */
  horas_est_desde_mant?: number | null
  horas_para_mant: number | null
}

export type MotorOtraEstacion = {
  equipo_id: string
  codigo: string
  nombre: string
  modelo: string | null
  estado: EstadoMotor
  estacion_id: string
  estacion_nombre: string
}

export type TanqueEstacion = { id: string; nombre: string; estacion_id: string | null; capacidad_gal: number | null; saldo_gal: number }

export type RegistroMotor = {
  id: string
  equipo_id: string
  estacion_id: string
  tanque_id: string
  fecha: string
  horo_ini: number
  horo_fin: number
  horas: number
  visor_ini: number
  visor_fin: number
  recibido_gal: number
  gastado_gal: number
  rendimiento_gal_h: number | null
  rpm: number | null
  horo_cambiado: boolean
  visor_cambiado: boolean
  comentario: string | null
  /** sql/147: lo demás de la hoja FTR_F-MA-103. */
  caudal_ini: number | null
  caudal_fin: number | null
  operador: string | null
  /** visor inicial − saldo del libro (gal); null si no se comparó. */
  dif_visor_gal: number | null
  horas_estimadas: number | null
  rend_ref_gal_h: number | null
  registrado_por: string | null
  fecha_hora: string
  anulado_at: string | null
  motivo_anulacion: string | null
  observaciones: string[] | null
}

export type RecepcionMotor = {
  id: string
  /** sql/147: el tanque donde entró el diésel (las de la 144 vienen sin tanque: nivel estación). */
  tanque_id: string | null
  estacion_id: string
  galones: number
  chofer_id: string | null
  vehiculo_id: string | null
  fecha_hora: string
  comentario: string | null
  registrado_por: string | null
  anulado_at: string | null
  motivo_anulacion: string | null
}

export type MantenimientoMotor = {
  id: string
  equipo_id: string
  estacion_id: string | null
  fecha_hora: string
  horometro: number | null
  tipo: 'PREVENTIVO' | 'CORRECTIVO'
  nota: string | null
  horas_antes: number | null
}

export type AsignacionMotor = {
  id: string
  equipo_id: string
  tipo: 'INSTALADO' | 'TRASLADADO' | 'RETIRADO' | 'AL_TALLER' | 'DE_VUELTA'
  estacion_origen: string | null
  estacion_destino: string | null
  tanque_id: string | null
  fecha_hora: string
  motivo: string
  motivo_codigo: string | null
  destino_saldo: string | null
  destino_devolucion: string | null
  saldo_gal: number | null
  anulado_at: string | null
}

export type NivelSemaforo = 'verde' | 'amarillo' | 'rojo' | 'gris'

/** sql/147: una línea de «qué toca ahora» (ya ordenada por urgencia en la base). */
export type AyudaAhora = { nivel: NivelSemaforo; codigo: 'MANTENIMIENTO' | 'FALTA_REGISTRO' | 'TANQUE' | 'SIN_TANQUE'; texto: string }
export type AyudaMotor = { equipo_id: string; nivel: NivelSemaforo; ahora: AyudaAhora[] }

/** sql/147: señal de un día de registro (la base y el teléfono usan las mismas reglas). */
export type SenalRegistro = { registro_id: string; fecha: string; nivel: 'rojo' | 'amarillo' | 'info'; codigo: string; texto: string; equipo_id?: string }

/** sql/147: tanque fijo (catálogo de Torre de Control); se asigna a una estación. */
export type TanqueFijo = {
  id: string
  nombre: string
  zona_id: string | null
  estacion_id: string | null
  capacidad_gal: number | null
  motor_equipo_id: string | null
  saldo_gal: number
}

/** sql/147: tramo de custodia del motor (dónde estuvo y con qué horómetro). */
export type TramoMotor = {
  id: string
  equipo_id: string
  ubicacion: 'ESTACION' | 'TALLER' | 'RETIRADO'
  estacion_id: string | null
  tanque_id: string | null
  desde: string
  hasta: string | null
  horo_entrada: number | null
  horo_salida: number | null
}

export type EstadoMotores = {
  servidor_en: string
  permisos: {
    ver: boolean
    registrar: boolean
    anular: boolean
    configurar: boolean
    /** sql/138: un permiso por trabajo (configurar los incluye a todos). */
    motor_recibir?: boolean
    motor_mover?: boolean
    motor_retirar?: boolean
    motor_mantenimiento?: boolean
    /** sql/147: ve todos los motores con su ficha completa (nadie por defecto; el administrador sí). */
    auditar?: boolean
    /** sql/149: vista General de solo lectura (todos los motores, tiempo real). */
    ver_general?: boolean
  }
  /** sql/149: temporada activa (el historial baja desde su inicio). */
  temporada?: { id: string; nombre: string; desde: string; hasta: string } | null
  material_diesel_id: string | null
  motores: MotorEstacion[]
  /** Motores instalados en estaciones que la persona no ve: solo para elegirlos al recibir o mover (sql/138). */
  otras_estaciones?: MotorOtraEstacion[]
  tanques_sin_motor: TanqueEstacion[]
  registros: RegistroMotor[]
  recepciones: RecepcionMotor[]
  mantenimientos: MantenimientoMotor[]
  asignaciones: AsignacionMotor[]
  /** sql/147 (todo opcional: un teléfono con datos viejos no los trae). */
  ayuda?: AyudaMotor[]
  senales?: SenalRegistro[]
  tanques?: TanqueFijo[]
  tramos?: TramoMotor[]
  /** {id de persona → nombre} de quienes registraron. */
  personas?: Record<string, string>
}

/** Lo mínimo que se necesita de una operación pendiente (sirve también para las pruebas sin React). */
export type OperacionPendienteMotor = Pick<Operacion, 'id' | 'tipo' | 'estado_local' | 'datos'> & { creado_en?: string }

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** Día (AAAA-MM-DD) en Honduras (UTC-6) de un instante ISO. */
export function diaLocal(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t - 6 * 3600_000).toISOString().slice(0, 10) : iso.slice(0, 10)
}

/** El tanque de una recepción pendiente: el que trae, o el único de la estación (sql/147: un envío viejo solo trae la estación). */
function tanqueDeRecepcion(estado: EstadoMotores, d: Record<string, unknown>): string | null {
  if (d.tanque_id) return String(d.tanque_id)
  const l = (estado.tanques ?? []).filter((t) => t.estacion_id === d.estacion_id)
  return l.length === 1 ? l[0].id : null
}

/** Galones recibidos en un tanque en un día (Honduras): lo ya bajado más lo pendiente de enviar. */
export function recibidoEnDia(tanqueId: string, fecha: string, estado: EstadoMotores, pendientes: OperacionPendienteMotor[]): number {
  const bajado = estado.recepciones.filter((r) => r.tanque_id === tanqueId && !r.anulado_at && diaLocal(r.fecha_hora) === fecha).reduce((t, r) => t + r.galones, 0)
  const cola = pendientes
    .filter((o) => o.estado_local === 'PENDIENTE' && o.tipo === 'diesel_recibir' && tanqueDeRecepcion(estado, o.datos) === tanqueId && diaLocal(String(o.datos.fecha_hora ?? '')) === fecha)
    .reduce((t, o) => t + num(o.datos.galones), 0)
  return bajado + cola
}

/**
 * Saldo del tanque contando lo pendiente de enviar (sql/147): saldo bajado + diésel recibido pendiente (al tanque) + lo que un
 * registro declara como suministro y no está en recepciones (solo la diferencia, igual que la base) − lo gastado (visor inicial −
 * final). No reproduce el ajuste por visor de la base (esa es la verdad al sincronizar); es solo para que el nivel baje sin señal.
 */
export function saldoTanqueLocal(tanqueId: string, estado: EstadoMotores, pendientes: OperacionPendienteMotor[]): number {
  const base =
    estado.tanques?.find((t) => t.id === tanqueId)?.saldo_gal ??
    estado.motores.find((m) => m.tanque?.id === tanqueId)?.tanque?.saldo_gal ??
    estado.tanques_sin_motor.find((t) => t.id === tanqueId)?.saldo_gal ??
    0
  let saldo = base
  const activas = pendientes.filter((o) => o.estado_local === 'PENDIENTE')
  for (const op of activas) {
    if (op.tipo === 'diesel_recibir' && tanqueDeRecepcion(estado, op.datos) === tanqueId) saldo += num(op.datos.galones)
  }
  for (const op of activas) {
    if (op.tipo !== 'motor_registro_diario') continue
    const d = op.datos
    const delMotor = estado.motores.find((m) => m.equipo_id === d.equipo_id)
    const tanque = (d.tanque_id as string | undefined) ?? delMotor?.tanque?.id
    if (tanque !== tanqueId) continue
    const extra = Math.max(num(d.suministro_gal) - recibidoEnDia(tanqueId, String(d.fecha ?? ''), estado, pendientes), 0)
    saldo += extra - Math.max(d.gastado_local !== undefined ? num(d.gastado_local) : num(d.visor_ini) - num(d.visor_fin), 0)
  }
  return Math.round(saldo * 100) / 100
}

/** Los motores de una estación (instalados ahí), por código. */
export function motoresDeEstacion(estado: EstadoMotores, estacionId: string): MotorEstacion[] {
  return estado.motores.filter((m) => m.estado === 'EN_ESTACION' && m.estacion_id === estacionId).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
}

/** Motores fuera de una estación (taller, retirados, sin asignar): solo los ve quien tiene «configurar». */
export function motoresSinEstacion(estado: EstadoMotores): MotorEstacion[] {
  return estado.motores.filter((m) => m.estado !== 'EN_ESTACION').sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
}

/**
 * Motores que se pueden recibir en una estación: los que no están en ella (sin asignar, taller, retirados, o instalados
 * en otra estación). Los de otra estación llevan `enEstacion` para marcarlos «en estación X» y moverlos desde ahí.
 */
export type MotorElegible = { equipo_id: string; codigo: string; nombre: string; modelo: string | null; estado: EstadoMotor; enEstacion: string | null }

export function motoresParaRecibir(estado: EstadoMotores, estacionId: string, nombreEstacion: (id: string) => string | null): MotorElegible[] {
  const vistos = new Set<string>()
  const lista: MotorElegible[] = []
  for (const m of estado.motores) {
    if (m.estado === 'EN_ESTACION' && m.estacion_id === estacionId) continue
    vistos.add(m.equipo_id)
    lista.push({
      equipo_id: m.equipo_id,
      codigo: m.codigo,
      nombre: m.nombre,
      modelo: m.modelo,
      estado: m.estado,
      enEstacion: m.estado === 'EN_ESTACION' && m.estacion_id ? (nombreEstacion(m.estacion_id) ?? 'otra estación') : null,
    })
  }
  for (const o of estado.otras_estaciones ?? []) {
    if (vistos.has(o.equipo_id) || o.estacion_id === estacionId) continue
    lista.push({ equipo_id: o.equipo_id, codigo: o.codigo, nombre: o.nombre, modelo: o.modelo, estado: o.estado, enEstacion: o.estacion_nombre })
  }
  return lista.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
}

// ---------------------------------------------------------------- sql/147: normalizar lo que baja y tanques por estación

const conNulos = <T extends object>(o: T, claves: string[]): T => {
  const r = { ...o } as Record<string, unknown>
  for (const k of claves) if (r[k] === undefined) r[k] = null
  return r as T
}

/**
 * La base quita las claves vacías (`jsonb_strip_nulls`): aquí una clave ausente pasa a ser null y las listas nuevas a [].
 * Sirve igual con lo guardado por una versión anterior de la app.
 */
export function normalizarEstado(e: EstadoMotores): EstadoMotores {
  return {
    ...e,
    motores: (e.motores ?? []).map((m) =>
      conNulos(m, ['modelo', 'estacion_id', 'tanque', 'horo_ultimo', 'visor_ultimo', 'fecha_ultimo', 'intervalo_horas', 'aviso_horas', 'horas_para_mant', 'horas_est_desde_mant'])
    ),
    otras_estaciones: e.otras_estaciones ?? [],
    tanques_sin_motor: e.tanques_sin_motor ?? [],
    registros: (e.registros ?? []).map((r) =>
      conNulos(r, ['comentario', 'rpm', 'rendimiento_gal_h', 'caudal_ini', 'caudal_fin', 'operador', 'dif_visor_gal', 'horas_estimadas', 'rend_ref_gal_h', 'registrado_por', 'anulado_at', 'motivo_anulacion', 'observaciones'])
    ),
    recepciones: (e.recepciones ?? []).map((r) => conNulos(r, ['tanque_id', 'chofer_id', 'vehiculo_id', 'comentario', 'registrado_por', 'anulado_at', 'motivo_anulacion'])),
    mantenimientos: e.mantenimientos ?? [],
    asignaciones: (e.asignaciones ?? []).map((a) =>
      conNulos(a, ['estacion_origen', 'estacion_destino', 'tanque_id', 'motivo_codigo', 'destino_saldo', 'destino_devolucion', 'saldo_gal', 'anulado_at'])
    ),
    ayuda: e.ayuda ?? [],
    senales: e.senales ?? [],
    tanques: (e.tanques ?? []).map((t) => conNulos(t, ['zona_id', 'estacion_id', 'capacidad_gal', 'motor_equipo_id'])),
    tramos: (e.tramos ?? []).map((t) => conNulos(t, ['estacion_id', 'tanque_id', 'hasta', 'horo_entrada', 'horo_salida'])),
    personas: e.personas ?? {},
  }
}

/** Los tanques de una estación (catálogo fijo; con datos viejos, los de los motores y los sueltos). */
export function tanquesDeEstacion(estado: EstadoMotores, estacionId: string): TanqueFijo[] {
  const catalogo = estado.tanques ?? []
  if (catalogo.length > 0) return catalogo.filter((t) => t.estacion_id === estacionId)
  const vistos = new Set<string>()
  const lista: TanqueFijo[] = []
  for (const m of estado.motores) {
    if (m.estacion_id === estacionId && m.tanque && !vistos.has(m.tanque.id)) {
      vistos.add(m.tanque.id)
      lista.push({ id: m.tanque.id, nombre: m.tanque.nombre, zona_id: null, estacion_id: estacionId, capacidad_gal: m.tanque.capacidad_gal, motor_equipo_id: m.equipo_id, saldo_gal: m.tanque.saldo_gal })
    }
  }
  for (const t of estado.tanques_sin_motor) {
    if (t.estacion_id === estacionId && !vistos.has(t.id)) {
      lista.push({ id: t.id, nombre: t.nombre, zona_id: null, estacion_id: estacionId, capacidad_gal: t.capacidad_gal, motor_equipo_id: null, saldo_gal: t.saldo_gal })
    }
  }
  return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
}

/** Tanques de la estación libres (sin motor, o ya conectados a ESTE motor): los que se pueden elegir al recibir o mover un motor. */
export function tanquesLibres(estado: EstadoMotores, estacionId: string, equipoId: string): TanqueFijo[] {
  return tanquesDeEstacion(estado, estacionId).filter((t) => !t.motor_equipo_id || t.motor_equipo_id === equipoId)
}

/** Nombre de quien registró (los nombres bajan una sola vez en `personas`). */
export function nombreQuien(estado: EstadoMotores, id: string | null | undefined): string | null {
  return id ? (estado.personas?.[id] ?? null) : null
}
