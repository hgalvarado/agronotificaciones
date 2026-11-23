/**
 * Registro diario del motor (hoja FTR_F-MA-103), cuentas puras: horas, galones gastados, rendimiento, continuidad del
 * horómetro y del visor, y el armado de las operaciones. Sin React ni red. Las mismas fórmulas que la base (sql/130):
 *   horas = horómetro final − inicial · gastado = visor inicial − visor final + recibido ese día · rendimiento = gastado ÷ horas.
 * Las fechas son de Honduras (UTC-6): se registran jornadas de ayer o anteriores, nunca se asume «hoy».
 */

import type { EstadoMotores, OperacionPendienteMotor, RecepcionMotor } from './estado'

/** Día (AAAA-MM-DD) en Honduras (UTC-6) de un instante ISO. (Igual que en estado.ts: aquí no se importa para que las pruebas con Node carguen el archivo suelto.) */
function diaLocal(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t - 6 * 3600_000).toISOString().slice(0, 10) : iso.slice(0, 10)
}

export type DatosRegistro = { horoIni: number | null; horoFin: number | null; visorIni: number | null; visorFin: number | null; recibido: number }

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
): { horas: number | null; gastado: number | null; rendimiento: number | null; errores: string[]; avisos: string[] } {
  const errores: string[] = []
  const avisos: string[] = []
  if (![d.horoIni, d.horoFin, d.visorIni, d.visorFin].every(esNum) || !esNum(d.recibido)) {
    return { horas: null, gastado: null, rendimiento: null, errores: ['Escribe un número válido.'], avisos }
  }
  const diff = r2((d.horoFin as number) - (d.horoIni as number))
  let horas = diff
  if (diff < 0) {
    if (opciones.horoCambiado) horas = 0
    else {
      errores.push('El horómetro final es menor que el inicial.')
      horas = 0
    }
  }
  const gastado = r2((d.visorIni as number) - (d.visorFin as number) + d.recibido)
  if (gastado < 0) errores.push('El visor final es mayor que el inicial y no hay diésel recibido ese día: registra la recepción o corrige la lectura.')
  const rendimiento = horas > 0 && gastado >= 0 ? r2(gastado / horas) : null
  if (horas === 0 && gastado > 0) avisos.push('Gastó diésel sin horas de trabajo.')
  return { horas, gastado, rendimiento, errores, avisos }
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

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

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
    out.push(`El horómetro inicial no continúa donde terminó el último registro (${p.horoIni}${p.fechaBase ? `, del ${fmt(p.fechaBase)}` : ''}).`)
  }
  if (p.visorIni !== null && !args.visorCambiado && esNum(args.visorIni) && Math.abs(args.visorIni - p.visorIni) > 0.005) {
    out.push(`El visor inicial no coincide con el final anterior (${p.visorIni}).`)
  }
  return out
}

/** Lo recibido en el tanque ese día (hora de Honduras): lo que ya está en la base más lo que está en cola, sin anuladas. */
export function recibidoDelDia(args: { tanqueId: string; fecha: string; recepciones: RecepcionMotor[]; pendientes: OperacionPendienteMotor[] }): number {
  let t = 0
  for (const r of args.recepciones) if (r.tanque_id === args.tanqueId && !r.anulado_at && diaLocal(r.fecha_hora) === args.fecha) t += r.galones
  for (const o of args.pendientes) {
    if (o.estado_local !== 'PENDIENTE' || o.tipo !== 'diesel_recibir' || o.datos.tanque_id !== args.tanqueId) continue
    if (diaLocal(String(o.datos.fecha_hora ?? o.creado_en ?? '')) === args.fecha) t += numero(o.datos.galones)
  }
  return r2(t)
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
  /** Lo recibido ese día en el tanque, para guardar el consumo estimado en el teléfono (la base lo vuelve a calcular). */
  recibido?: number
  hoy?: string
}): { datos: Record<string, unknown> } | { error: string } {
  if (![args.horoIni, args.horoFin, args.visorIni, args.visorFin].every(esNum)) return { error: 'Escribe un número válido.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.fecha)) return { error: 'Indica la fecha del registro.' }
  if (args.fecha > (args.hoy ?? hoyHonduras())) return { error: 'La fecha no puede ser posterior a hoy.' }
  if ((args.horoCambiado || args.visorCambiado) && !args.comentario.trim()) return { error: 'Explica el cambio del horómetro o del visor en las observaciones.' }
  if (args.rpm !== null && (!esNum(args.rpm) || args.rpm < 0 || args.rpm > 6000)) return { error: 'Las revoluciones deben estar entre 0 y 6000.' }
  const c = calcularRegistro(
    { horoIni: args.horoIni, horoFin: args.horoFin, visorIni: args.visorIni, visorFin: args.visorFin, recibido: args.recibido ?? 0 },
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
      gastado_local: c.gastado,
    },
  }
}

export function armarRecepcionDiesel(args: {
  tanqueId: string
  galones: number
  fechaHora: string
  choferId: string | null
  vehiculoId: string | null
  comentario: string
  estacionId?: string
  capacidadGal?: number | null
  saldoActual?: number
}): { datos: Record<string, unknown>; aviso?: string } | { error: string } {
  if (!esNum(args.galones) || args.galones <= 0) return { error: 'Indica los galones recibidos.' }
  const aviso =
    args.capacidadGal && args.saldoActual !== undefined && args.saldoActual + args.galones > args.capacidadGal + 0.0001
      ? `Con esto el tanque pasa de su capacidad (${args.capacidadGal} gal).`
      : undefined
  return {
    datos: {
      tanque_id: args.tanqueId,
      estacion_id: args.estacionId,
      galones: args.galones,
      fecha_hora: args.fechaHora,
      chofer_id: args.choferId,
      vehiculo_id: args.vehiculoId,
      comentario: args.comentario.trim() || null,
    },
    aviso,
  }
}

export type DestinoSaldo = 'CON_EL_MOTOR' | 'DEVUELTO' | 'QUEDA_EN_TANQUE'
export type TipoMovimientoMotor = 'INSTALADO' | 'TRASLADADO' | 'AL_TALLER' | 'DE_VUELTA' | 'RETIRADO'

/** Qué se sugiere hacer con el diésel según el motivo: fin de temporada → con el motor; daño y reemplazo → queda en el tanque (fijo). */
export function destinoSugerido(motivoCodigo: string): { destino: DestinoSaldo | null; fijo: boolean } {
  if (motivoCodigo === 'DANO_REEMPLAZO') return { destino: 'QUEDA_EN_TANQUE', fijo: true }
  if (motivoCodigo === 'FIN_TEMPORADA') return { destino: 'CON_EL_MOTOR', fijo: false }
  return { destino: null, fijo: false }
}

export function armarMovimientoMotor(args: {
  equipoId: string
  tipo: TipoMovimientoMotor
  fechaHora: string
  estacionDestino: string | null
  tanqueId: string | null
  tanqueNuevo: { nombre: string; capacidadGal: number | null; materialId?: string | null } | null
  motivo: string
  motivoCodigo: string
  destinoSaldo: DestinoSaldo | null
  destinoDevolucion: 'SUMINISTROS' | 'BODEGA' | 'TALLER' | null
  horasBase: number | null
  saldoActual: number
  /** El motor trae su propio tanque (viajó con él): no hace falta elegir otro. */
  traeTanque?: boolean
  estacionOrigen?: string | null
}): { datos: Record<string, unknown>; operacion: 'motor_asignar' | 'motor_retiro' } | { error: string } {
  if (!args.motivo.trim()) return { error: 'Escribe el motivo.' }
  const sale = args.tipo === 'TRASLADADO' || args.tipo === 'RETIRADO' || args.tipo === 'AL_TALLER'
  const entra = args.tipo === 'INSTALADO' || args.tipo === 'DE_VUELTA' || args.tipo === 'TRASLADADO'
  let destino = args.destinoSaldo
  if (args.motivoCodigo === 'DANO_REEMPLAZO' && sale) destino = 'QUEDA_EN_TANQUE'
  if (sale && args.saldoActual > 0.0001 && !destino) return { error: `El tanque tiene ${r2(args.saldoActual)} gal de diésel: indica qué pasa con ese diésel.` }
  if (sale && destino === 'DEVUELTO' && !args.destinoDevolucion) return { error: 'Indica a dónde se devuelve el diésel (suministros, bodega o taller).' }
  if (entra && !args.estacionDestino) return { error: 'Elige la estación de destino.' }
  if (entra && args.tipo !== 'TRASLADADO' && !args.tanqueId && !args.tanqueNuevo && !args.traeTanque) return { error: 'Indica el tanque del motor: elige uno de la estación o crea uno nuevo.' }
  if (args.tanqueNuevo && !args.tanqueNuevo.nombre.trim()) return { error: 'Escribe el nombre del tanque nuevo.' }
  if (args.horasBase !== null && (!esNum(args.horasBase) || args.horasBase < 0)) return { error: 'Las horas desde el último mantenimiento no son válidas.' }
  const datos: Record<string, unknown> = {
    equipo_id: args.equipoId,
    estacion_id: args.estacionDestino ?? args.estacionOrigen ?? undefined,
    tipo: args.tipo === 'RETIRADO' ? undefined : args.tipo,
    fecha_hora: args.fechaHora,
    estacion_destino: entra ? args.estacionDestino : undefined,
    tanque_id: args.tanqueId ?? undefined,
    tanque_nuevo: args.tanqueNuevo
      ? { nombre: args.tanqueNuevo.nombre.trim(), capacidad_gal: args.tanqueNuevo.capacidadGal, material_id: args.tanqueNuevo.materialId ?? undefined }
      : undefined,
    motivo: args.motivo.trim(),
    motivo_codigo: args.motivoCodigo || undefined,
    destino_saldo: sale ? destino ?? undefined : undefined,
    destino_devolucion: sale && destino === 'DEVUELTO' ? args.destinoDevolucion : undefined,
    horas_base: args.horasBase ?? undefined,
  }
  return { datos, operacion: args.tipo === 'RETIRADO' ? 'motor_retiro' : 'motor_asignar' }
}
