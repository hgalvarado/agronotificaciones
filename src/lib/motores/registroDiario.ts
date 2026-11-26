/**
 * Registro diario del motor (hoja FTR_F-MA-103), cuentas puras: horas, galones gastados, rendimiento, continuidad del
 * horómetro y del visor, y el armado de las operaciones. Sin React ni red. Las mismas fórmulas que la base (sql/130):
 *   horas = horómetro final − inicial · gastado = visor inicial − visor final (como la hoja) · rendimiento = gastado ÷ horas.
 * El suministro de combustible (campo de la hoja) sube el TANQUE; nunca toca la bodega (sql/147).
 * Las fechas son de Honduras (UTC-6): se registran jornadas de ayer o anteriores, nunca se asume «hoy».
 */

import type { EstadoMotores, OperacionPendienteMotor } from './estado'

/** Día (AAAA-MM-DD) en Honduras (UTC-6) de un instante ISO. (Igual que en estado.ts: aquí no se importa para que las pruebas con Node carguen el archivo suelto.) */
function diaLocal(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t - 6 * 3600_000).toISOString().slice(0, 10) : iso.slice(0, 10)
}

export type DatosRegistro = { horoIni: number | null; horoFin: number | null; visorIni: number | null; visorFin: number | null; recibido: number }  // `recibido` = suministro de combustible del día

const r2 = (n: number) => Math.round(n * 100) / 100
const esNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const numero = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const hoyHonduras = () => diaLocal(new Date().toISOString())

export function calcularRegistro(
  d: DatosRegistro,
  opciones: { horoCambiado?: boolean } = {}
): { horas: number | null; gastado: number | null; rendimiento: number | null; errores: string[]; avisos: string[]; duranteDia: boolean } {
  const errores: string[] = []
  const avisos: string[] = []
  if (![d.horoIni, d.horoFin, d.visorIni, d.visorFin].every(esNum) || !esNum(d.recibido)) {
    return { horas: null, gastado: null, rendimiento: null, errores: ['Escribe un número válido.'], avisos, duranteDia: false }
  }
  const diff = r2((d.horoFin as number) - (d.horoIni as number))
  let horas = diff
  if (diff < 0) {
    if (opciones.horoCambiado) horas = 0
    else {
      errores.push('Horómetro final menor que el inicial.')
      horas = 0
    }
  }
  // sql/147: GASTADO = visor inicial − visor final (la hoja). Si el visor final es MAYOR, solo se acepta cuando el suministro lo explica
  // (entró diésel durante el día): gastado = inicial + suministro − final.
  let gastado: number | null = r2((d.visorIni as number) - (d.visorFin as number))
  let duranteDia = false
  if ((gastado as number) < 0) {
    if (d.recibido > 0 && (d.visorFin as number) - (d.visorIni as number) <= d.recibido + 0.5) {
      gastado = Math.max(r2((d.visorIni as number) + d.recibido - (d.visorFin as number)), 0)
      duranteDia = true
    } else {
      errores.push('Subió el visor: recibe combustible primero.')
      gastado = null
    }
  }
  const rendimiento = horas > 0 && gastado !== null ? r2(gastado / horas) : null
  if (horas === 0 && gastado !== null && gastado > 0) avisos.push('Gastó diésel sin horas de trabajo.')
  return { horas, gastado, rendimiento, errores, avisos, duranteDia }
}

export type Propuesta = { horoIni: number | null; visorIni: number | null; origen: 'cola' | 'registro' | 'motor' | null; fechaBase: string | null }

/**
 * La lectura FINAL del último registro con fecha ANTERIOR a `fecha` (no el último capturado): primero la cola pendiente
 * del mismo motor, después los registros bajados y por último lo guardado en el motor. Gana la fecha más reciente; a igual
 * fecha, la cola.
 */
export function proponerInicial(args: { equipoId: string; fecha: string; estado: EstadoMotores | null; pendientes: OperacionPendienteMotor[] }): Propuesta {
  let mejor: { fecha: string; horo: number; visor: number | null; origen: 'cola' | 'registro' | 'motor' } | null = null
  const probar = (fecha: string, horo: number, visor: number | null, origen: 'cola' | 'registro' | 'motor') => {
    if (!(fecha < args.fecha)) return
    if (!mejor || fecha > mejor.fecha) mejor = { fecha, horo, visor, origen }
  }
  for (const o of args.pendientes) {
    if (o.estado_local !== 'PENDIENTE' || o.tipo !== 'motor_registro_diario' || o.datos.equipo_id !== args.equipoId) continue
    probar(String(o.datos.fecha ?? ''), numero(o.datos.horo_fin), o.datos.visor_fin === undefined ? null : numero(o.datos.visor_fin), 'cola')
  }
  const e = args.estado
  if (e) {
    for (const r of e.registros) if (r.equipo_id === args.equipoId && !r.anulado_at) probar(r.fecha, r.horo_fin, r.visor_fin, 'registro')
    const m = e.motores.find((x) => x.equipo_id === args.equipoId)
    if (m?.fecha_ultimo && m.horo_ultimo !== null) probar(m.fecha_ultimo, m.horo_ultimo, m.visor_ultimo, 'motor')
  }
  const b = mejor as { fecha: string; horo: number; visor: number | null; origen: 'cola' | 'registro' | 'motor' } | null
  return b ? { horoIni: b.horo, visorIni: b.visor, origen: b.origen, fechaBase: b.fecha } : { horoIni: null, visorIni: null, origen: null, fechaBase: null }
}


export function avisosContinuidad(args: {
  horoIni: number | null
  visorIni: number | null
  horoCambiado: boolean
  visorCambiado: boolean
  propuesta: Propuesta
}): string[] {
  const out: string[] = []
  const p = args.propuesta
  if (p.horoIni !== null && !args.horoCambiado && esNum(args.horoIni) && Math.abs(args.horoIni - p.horoIni) > 0.005) {
    out.push(`Horómetro no continúa: antes terminó en ${p.horoIni}.`)
  }
  if (p.visorIni !== null && !args.visorCambiado && esNum(args.visorIni) && Math.abs(args.visorIni - p.visorIni) > 0.005) {
    out.push(`Visor no continúa: antes terminó en ${p.visorIni}.`)
  }
  return out
}

export function armarRegistroDiario(args: {
  equipoId: string
  fecha: string
  fechaHora: string
  horoIni: number
  horoFin: number
  visorIni: number
  visorFin: number
  rpm: number | null
  horoCambiado: boolean
  visorCambiado: boolean
  comentario: string
  estacionId?: string
  tanqueId?: string
  /** Suministro de combustible del día (columna de la hoja): sube el tanque solo por lo que falte de las recepciones (sql/147). */
  suministro?: number
  /** Lectura de caudal inicial y final (opcionales, de la hoja). */
  caudalIni?: number | null
  caudalFin?: number | null
  /** Firma del operador (nombre). */
  operador?: string
  hoy?: string
}): { datos: Record<string, unknown> } | { error: string } {
  if (![args.horoIni, args.horoFin, args.visorIni, args.visorFin].every(esNum)) return { error: 'Escribe un número válido.' }
  if (args.suministro !== undefined && (!esNum(args.suministro) || args.suministro < 0)) return { error: 'Suministro no válido.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.fecha)) return { error: 'Falta la fecha.' }
  if (args.fecha > (args.hoy ?? hoyHonduras())) return { error: 'La fecha no puede ser futura.' }
  if ((args.horoCambiado || args.visorCambiado) && !args.comentario.trim()) return { error: 'Explica el cambio en observaciones.' }
  if (args.rpm !== null && (!esNum(args.rpm) || args.rpm < 0 || args.rpm > 6000)) return { error: 'Revoluciones entre 0 y 6000.' }
  for (const q of [args.caudalIni, args.caudalFin]) if (q !== null && q !== undefined && (!esNum(q) || q < 0)) return { error: 'Caudal: escribe un número.' }
  if ((args.operador ?? '').trim().length > 80) return { error: 'Nombre del operador muy largo.' }
  const c = calcularRegistro(
    { horoIni: args.horoIni, horoFin: args.horoFin, visorIni: args.visorIni, visorFin: args.visorFin, recibido: args.suministro ?? 0 },
    { horoCambiado: args.horoCambiado }
  )
  if (c.errores.length) return { error: c.errores[0] }
  return {
    datos: {
      equipo_id: args.equipoId,
      estacion_id: args.estacionId,
      tanque_id: args.tanqueId,
      fecha: args.fecha,
      fecha_hora: args.fechaHora,
      horo_ini: args.horoIni,
      horo_fin: args.horoFin,
      visor_ini: args.visorIni,
      visor_fin: args.visorFin,
      rpm: args.rpm,
      horo_cambiado: args.horoCambiado,
      visor_cambiado: args.visorCambiado,
      comentario: args.comentario.trim() || null,
      suministro_gal: args.suministro && args.suministro > 0 ? args.suministro : undefined,
      caudal_ini: args.caudalIni ?? undefined,
      caudal_fin: args.caudalFin ?? undefined,
      operador: args.operador?.trim() || undefined,
      gastado_local: c.gastado ?? undefined,
    },
  }
}

/** Recibir diésel = entra al TANQUE de la estación (sql/147): no pasa por la bodega. */
export function armarRecepcionDiesel(args: {
  estacionId: string
  tanqueId: string | null
  galones: number
  fechaHora: string
  choferId: string | null
  vehiculoId: string | null
  comentario: string
}): { datos: Record<string, unknown> } | { error: string } {
  if (!args.tanqueId) return { error: 'Elige el tanque.' }
  if (!esNum(args.galones) || args.galones <= 0) return { error: 'Escribe los galones.' }
  return {
    datos: {
      estacion_id: args.estacionId,
      tanque_id: args.tanqueId,
      galones: args.galones,
      fecha_hora: args.fechaHora,
      chofer_id: args.choferId,
      vehiculo_id: args.vehiculoId,
      comentario: args.comentario.trim() || null,
    },
  }
}

export type TipoMovimientoMotor = 'INSTALADO' | 'TRASLADADO' | 'AL_TALLER' | 'DE_VUELTA' | 'RETIRADO'

/** Etiquetas claras de los motivos (mover o retirar). */
export const ETIQUETA_MOTIVO: Record<string, string> = {
  FIN_TEMPORADA: 'Fin de temporada',
  DANO_REEMPLAZO: 'Daño o reemplazo',
  CAMBIO_ESTACION: 'Traslado a otra estación',
  MANTENIMIENTO: 'Mantenimiento (al taller)',
  OTRO: 'Otro',
}

export function armarMovimientoMotor(args: {
  equipoId: string
  tipo: TipoMovimientoMotor
  fechaHora: string
  estacionDestino: string | null
  /** Un tanque LIBRE asignado a la estación de destino (sql/147). */
  tanqueId: string | null
  /** Solo quien tiene «Configurar» (o la práctica del modo de pruebas) puede crear un tanque. */
  tanqueNuevo: { nombre: string; capacidadGal: number | null; materialId?: string | null } | null
  motivo: string
  motivoCodigo: string
  horasBase: number | null
  /** Solo al recibir (sql/138). */
  horometro?: number | null
  observacion?: string
  estacionOrigen?: string | null
  /** Modo de pruebas: la estación de prueba aún no tiene tanque; la base crea uno de práctica (sql/147). */
  tanquePractica?: boolean
}): { datos: Record<string, unknown>; operacion: 'motor_asignar' | 'motor_retiro' } | { error: string } {
  const entra = args.tipo === 'INSTALADO' || args.tipo === 'DE_VUELTA' || args.tipo === 'TRASLADADO'
  // Recibir (INSTALADO, DE_VUELTA) no tiene motivo; mover o retirar piden uno (el código o lo escrito)
  const recibe = args.tipo === 'INSTALADO' || args.tipo === 'DE_VUELTA'
  const motivoTexto = args.motivo.trim() || (recibe ? '' : (ETIQUETA_MOTIVO[args.motivoCodigo] ?? ''))
  if (!recibe && !motivoTexto) return { error: 'Elige el motivo.' }
  if (!recibe && args.motivoCodigo === 'OTRO' && !args.motivo.trim()) return { error: 'Escribe cuál es el motivo.' }
  if (args.horometro != null && (!esNum(args.horometro) || args.horometro < 0)) return { error: 'Horómetro no válido.' }
  if (entra && !args.estacionDestino) return { error: 'Elige la estación de destino.' }
  if (entra && !args.tanqueId && !args.tanqueNuevo && !args.tanquePractica) return { error: 'Elige un tanque libre.' }
  if (args.tanqueNuevo && !args.tanqueNuevo.nombre.trim()) return { error: 'Escribe el nombre del tanque nuevo.' }
  if (args.horasBase !== null && (!esNum(args.horasBase) || args.horasBase < 0)) return { error: 'Horas de mantenimiento no válidas.' }
  const datos: Record<string, unknown> = {
    equipo_id: args.equipoId,
    estacion_id: args.estacionDestino ?? args.estacionOrigen ?? undefined,
    tipo: args.tipo === 'RETIRADO' ? undefined : args.tipo,
    fecha_hora: args.fechaHora,
    estacion_destino: entra ? args.estacionDestino : undefined,
    tanque_id: entra ? (args.tanqueId ?? undefined) : undefined,
    tanque_nuevo:
      entra && args.tanqueNuevo
        ? { nombre: args.tanqueNuevo.nombre.trim(), capacidad_gal: args.tanqueNuevo.capacidadGal, material_id: args.tanqueNuevo.materialId ?? undefined }
        : undefined,
    motivo: recibe ? undefined : motivoTexto,
    motivo_codigo: recibe ? undefined : args.motivoCodigo || undefined,
    horometro: args.horometro ?? undefined,
    observacion: args.observacion?.trim() || undefined,
    horas_base: args.horasBase ?? undefined,
  }
  return { datos, operacion: args.tipo === 'RETIRADO' ? 'motor_retiro' : 'motor_asignar' }
}
