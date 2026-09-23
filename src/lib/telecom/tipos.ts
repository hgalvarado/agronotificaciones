/**
 * Contratos del módulo de telecomunicaciones.
 *
 * Sólo nombres de formas y las etiquetas de sus estados. No sabe de React
 * ni de Supabase: los comparten el repositorio, las tres cuadrículas y el
 * acta en PDF.
 */

export const ESTADOS_LINEA = [
  { valor: 'DISPONIBLE', etiqueta: 'Disponible', tono: 'verde' },
  { valor: 'ASIGNADA', etiqueta: 'Asignada', tono: 'azul' },
  { valor: 'SUSPENDIDA', etiqueta: 'Suspendida', tono: 'ambar' },
] as const

export type EstadoLinea = (typeof ESTADOS_LINEA)[number]['valor']

export const ESTADOS_EQUIPO = [
  { valor: 'EN_BODEGA', etiqueta: 'En bodega', tono: 'verde' },
  { valor: 'ASIGNADO', etiqueta: 'Asignado', tono: 'azul' },
  { valor: 'DANADO', etiqueta: 'Dañado', tono: 'rojo' },
] as const

export type EstadoEquipo = (typeof ESTADOS_EQUIPO)[number]['valor']

export const ESTADOS_ASIGNACION = [
  { valor: 'VIGENTE', etiqueta: 'Vigente', tono: 'verde' },
  // Entregada pero en duda: el equipo no aparece, el colaborador se fue
  // sin devolverlo. Sigue teniendo la línea y el equipo fuera —por eso no
  // es «finalizada»— pero no es una entrega sana.
  { valor: 'REVISAR', etiqueta: 'Revisar', tono: 'ambar' },
  { valor: 'FINALIZADA', etiqueta: 'Finalizada', tono: 'gris' },
] as const

export type EstadoAsignacion = (typeof ESTADOS_ASIGNACION)[number]['valor']

/** Cómo se lee un estado. Una sola tabla para las tres cuadrículas. */
export function etiquetaEstado(valor: string | null | undefined): string {
  const todos = [...ESTADOS_LINEA, ...ESTADOS_EQUIPO, ...ESTADOS_ASIGNACION]
  return todos.find((e) => e.valor === valor)?.etiqueta ?? (valor ?? '—')
}

export type PlanTelecom = {
  id: string
  nombre: string
  proveedor: string | null
  costo_mensual: number | null
  es_retencion: boolean
  activo: boolean
}

/**
 * Cómo se lee un centro de costo en toda la aplicación: «1020 - Agrícola».
 *
 * El código solo no dice nada en un reporte que lee gerencia. La base ya
 * arma la etiqueta en la vista; esto es el respaldo para lo que todavía
 * no pasa por ella —un formulario a medio llenar, un catálogo suelto— y
 * el único sitio donde vive el formato.
 */
export function etiquetaCentro(
  codigo: string | null | undefined,
  nombre?: string | null
): string {
  const c = (codigo ?? '').trim()
  if (!c) return ''
  const n = (nombre ?? '').trim()
  return n ? `${c} - ${n}` : c
}

/** Un centro de costo del catálogo. */
export type CentroCosto = {
  id: string
  codigo: string
  nombre: string | null
  activo: boolean
}

export type Persona = {
  id: string
  codigo: string | null
  nombre: string
  es_operador: boolean
  es_administrativo: boolean
  activo: boolean
}

export type FilaLinea = {
  numero: string
  proveedor: string | null
  plan_id: string | null
  plan_nombre: string | null
  plan_costo: number | null
  plan_es_retencion: boolean | null
  estado: EstadoLinea
  observaciones: string | null
  activo: boolean
  asignacion_id: string | null
  empleado_id: string | null
  asignada_a: string | null
  codigo_empleado: string | null
  fecha_entrega: string | null
  fecha_devolucion_programada: string | null
  /** Llegan con la migración 49: cuántas solicitudes lleva pedidas. */
  solicitudes?: number | null
  ultima_solicitud?: string | null
}

export type FilaEquipo = {
  imei: string
  marca_modelo: string
  ram: string | null
  almacenamiento: string | null
  fecha_compra: string | null
  fecha_renovacion: string | null
  estado: EstadoEquipo
  observaciones: string | null
  activo: boolean
  dias_para_renovacion: number | null
  asignacion_id: string | null
  empleado_id: string | null
  asignado_a: string | null
  codigo_empleado: string | null
  fecha_entrega: string | null
}

export type FilaAsignacion = {
  id: string
  empleado_id: string
  empleado: string
  codigo_empleado: string | null
  linea_numero: string | null
  linea_proveedor: string | null
  plan_nombre: string | null
  plan_es_retencion: boolean | null
  equipo_imei: string | null
  marca_modelo: string | null
  ram: string | null
  almacenamiento: string | null
  fecha_entrega: string
  fecha_devolucion_programada: string | null
  fecha_devolucion_real: string | null
  centro_costo: string | null
  /** Llegan con la migración 49. Sin ella se cae al código a secas. */
  centro_costo_nombre?: string | null
  centro_costo_etiqueta?: string | null
  departamento: string | null
  puesto: string | null
  correo_asignado: string | null
  accesorios_entregados: string[] | null
  observaciones: string | null
  estado: EstadoAsignacion
  capturo: string | null
  dias_para_devolucion: number | null
}

/** Una fila de la línea de tiempo de una línea o de un equipo. */
export type TramoHistorial = {
  id: string
  empleado: string
  codigo_empleado: string | null
  departamento: string | null
  puesto: string | null
  fecha_entrega: string
  fecha_devolucion_real: string | null
  dias: number
  estado: EstadoAsignacion
  observaciones: string | null
}

export type TipoAlerta = 'DEVOLUCION' | 'RENOVACION'

export type Alerta = {
  tipo: TipoAlerta
  llave: string
  quien: string | null
  que: string
  detalle: string | null
  fecha: string
  dias: number
}

/**
 * Qué tan urgente es una alerta.
 *
 * Roja: ya se pasó la fecha o es hoy. Ámbar: está dentro de la semana.
 * El resto es un aviso y no una alarma; pintarlo todo de rojo enseña a
 * ignorar el rojo.
 */
export function urgencia(dias: number): 'roja' | 'ambar' | 'gris' {
  if (dias <= 0) return 'roja'
  if (dias <= 7) return 'ambar'
  return 'gris'
}

/** Cómo se lee un plazo: «vencido hace 3 días», «faltan 5 días», «hoy». */
export function textoPlazo(dias: number): string {
  if (dias === 0) return 'Hoy'
  if (dias < 0) {
    const d = Math.abs(dias)
    return `Vencido hace ${d} ${d === 1 ? 'día' : 'días'}`
  }
  return `Faltan ${dias} ${dias === 1 ? 'día' : 'días'}`
}

/**
 * Los accesorios vienen de un `jsonb` y pueden llegar de tres formas: la
 * lista de textos que guarda la pantalla, una lista de objetos de una
 * carga vieja, o nulo. Se normaliza aquí para que las cuadrículas, el
 * acta y el formulario no tengan cada uno su propia interpretación.
 */
export function accesorios(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return []
  return bruto
    .map((x) => {
      if (typeof x === 'string') return x.trim()
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>
        return String(o.nombre ?? o.descripcion ?? o.detalle ?? '').trim()
      }
      return ''
    })
    .filter(Boolean)
}

/** Los accesorios que se ofrecen por omisión; se pueden escribir otros. */
export const ACCESORIOS_COMUNES = [
  'Cargador',
  'Cable USB',
  'Audífonos',
  'Forro protector',
  'Vidrio templado',
  'Caja original',
  'Chip / SIM',
  'Memoria SD',
]


/* ------------------------------------------------------------------ */
/* Bitácora de solicitudes al proveedor                                */
/* ------------------------------------------------------------------ */

export const ACCIONES_SOLICITUD = [
  { valor: 'CAMBIO_PLAN', etiqueta: 'Cambio de plan' },
  { valor: 'SUSPENSION', etiqueta: 'Suspensión' },
  { valor: 'REACTIVACION', etiqueta: 'Reactivación' },
  { valor: 'PORTABILIDAD', etiqueta: 'Portabilidad' },
  { valor: 'CANCELACION', etiqueta: 'Cancelación' },
  { valor: 'REPOSICION_SIM', etiqueta: 'Reposición de SIM' },
  { valor: 'RECLAMO', etiqueta: 'Reclamo' },
  { valor: 'OTRA', etiqueta: 'Otra' },
] as const

export type AccionSolicitud = (typeof ACCIONES_SOLICITUD)[number]['valor']

export function etiquetaAccion(valor: string | null | undefined): string {
  return ACCIONES_SOLICITUD.find((a) => a.valor === valor)?.etiqueta ?? (valor ?? '—')
}

/** Una solicitud registrada en la bitácora de una línea. */
export type Solicitud = {
  id: string
  fecha: string
  accion: AccionSolicitud
  detalle: string | null
  comentarios: string | null
  responsable: string | null
}

/* ------------------------------------------------------------------ */
/* Resúmenes                                                           */
/* ------------------------------------------------------------------ */

export type Grupo = { clave: string; cuantos: number }

/**
 * Cuántas filas hay en cada valor de un campo, de mayor a menor.
 *
 * Es la cuenta que se hacía a mano para saber cuántos teléfonos carga
 * cada departamento. Puro: recibe filas y devuelve grupos, así que la
 * pantalla sólo lo dibuja.
 */
export function agrupar<T>(filas: T[], de: (f: T) => string | null | undefined): Grupo[] {
  const mapa = new Map<string, number>()
  for (const f of filas) {
    const clave = (de(f) ?? '').trim() || 'Sin asignar'
    mapa.set(clave, (mapa.get(clave) ?? 0) + 1)
  }
  return [...mapa.entries()]
    .map(([clave, cuantos]) => ({ clave, cuantos }))
    .sort((a, b) => b.cuantos - a.cuantos || a.clave.localeCompare(b.clave, 'es'))
}

/** Una entrega sigue teniendo el equipo fuera mientras no se finalice. */
export function estaAbierta(f: { estado: EstadoAsignacion }): boolean {
  return f.estado !== 'FINALIZADA'
}

/**
 * El orden en que se leen las líneas: primero por estado y luego por
 * número. Las asignadas arriba —es lo que se consulta— y las suspendidas
 * al final, que es donde estorban menos.
 */
const ORDEN_LINEA: Record<string, number> = { ASIGNADA: 0, DISPONIBLE: 1, SUSPENDIDA: 2 }

export function compararLineas(a: FilaLinea, b: FilaLinea): number {
  const porEstado = (ORDEN_LINEA[a.estado] ?? 9) - (ORDEN_LINEA[b.estado] ?? 9)
  if (porEstado !== 0) return porEstado
  return a.numero.localeCompare(b.numero, 'es', { numeric: true })
}
