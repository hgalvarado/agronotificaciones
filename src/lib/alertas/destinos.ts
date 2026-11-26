/**
 * Catálogo ÚNICO de alertas: tipos (texto, color) y a dónde lleva cada una (enlace profundo).
 * Puro: sin React ni Supabase. La base (sql/154 `_alerta_armar_url`) arma la misma URL al publicar; aquí se rearma
 * desde `destino` para la pantalla, y se leen los parámetros al abrir cada módulo (`leerDestino`).
 */

export type TipoAlerta = 'cuadre_combustible' | 'mantenimiento_vencido' | 'saldo_negativo' | 'capacidad_llena' | 'otro'
export type Gravedad = 'alta' | 'media' | 'baja'

export const TIPOS_ALERTA: { id: TipoAlerta; nombre: string }[] = [
  { id: 'cuadre_combustible', nombre: 'Cuadre de combustible' },
  { id: 'mantenimiento_vencido', nombre: 'Mantenimiento' },
  { id: 'saldo_negativo', nombre: 'Saldo negativo' },
  { id: 'capacidad_llena', nombre: 'Capacidad llena' },
  { id: 'otro', nombre: 'Otros' },
]

export const GRAVEDADES: { id: Gravedad; nombre: string; tono: 'rojo' | 'ambar' | 'gris' }[] = [
  { id: 'alta', nombre: 'Alta', tono: 'rojo' },
  { id: 'media', nombre: 'Media', tono: 'ambar' },
  { id: 'baja', nombre: 'Baja', tono: 'gris' },
]

export function nombreTipo(t: string): string {
  return TIPOS_ALERTA.find((x) => x.id === t)?.nombre ?? 'Otros'
}

export type DestinoAlerta = {
  pantalla?: string
  pestana?: string
  estacion_id?: string
  tanque_id?: string
  motor_id?: string
  registro_id?: string
  documento_id?: string
  fecha?: string
}

/** Pantallas a las que una alerta puede llevar y su ruta. */
const RUTAS: Record<string, string> = {
  motores: '/motores',
  fertirriego: '/fertirriego',
  inyeccion: '/inyeccion',
  agrometricas: '/agrometricas',
  campo: '/campo',
}

/** Parámetros de la URL (en este orden) y de qué campo del destino salen. */
const PARAMETROS: [string, (d: DestinoAlerta) => string | undefined][] = [
  ['pestana', (d) => d.pestana],
  ['estacion', (d) => d.estacion_id],
  ['tanque', (d) => d.tanque_id],
  ['motor', (d) => d.motor_id],
  ['registro', (d) => d.registro_id ?? d.documento_id],
  ['fecha', (d) => d.fecha],
]

/** Solo rutas internas: nunca `//otro-sitio` ni `https://…`. */
export function rutaInternaSegura(ruta: string | null | undefined, porDefecto = '/campo'): string {
  const r = (ruta ?? '').trim()
  return r.startsWith('/') && !r.startsWith('//') && !r.includes('\\') ? r : porDefecto
}

/** URL final de una alerta: desde `destino` si lo hay; si no, la `url` guardada; si no, /campo. */
export function urlDeAlerta(a: { destino?: DestinoAlerta | null; url?: string | null }): string {
  const d = a.destino
  const ruta = d?.pantalla ? RUTAS[d.pantalla.toLowerCase()] : undefined
  if (!d || !ruta) return rutaInternaSegura(a.url)
  const q = PARAMETROS.flatMap(([k, f]) => {
    const v = f(d)?.trim()
    return v ? [`${k}=${encodeURIComponent(v)}`] : []
  })
  return q.length ? `${ruta}?${q.join('&')}` : ruta
}

export type DestinoLeido = {
  pestana?: string
  estacion?: string
  tanque?: string
  motor?: string
  registro?: string
  fecha?: string
}

/** Lee los parámetros del enlace profundo al abrir un módulo (todos opcionales, texto limpio). */
export function leerDestino(busqueda: string | URLSearchParams): DestinoLeido {
  const q = typeof busqueda === 'string' ? new URLSearchParams(busqueda) : busqueda
  const g = (k: string) => {
    const v = q.get(k)?.trim()
    return v ? v.slice(0, 80) : undefined
  }
  return { pestana: g('pestana'), estacion: g('estacion'), tanque: g('tanque'), motor: g('motor'), registro: g('registro'), fecha: g('fecha') }
}

export function hayDestino(d: DestinoLeido): boolean {
  return Boolean(d.pestana || d.estacion || d.tanque || d.motor || d.registro || d.fecha)
}

/** Hace cuánto, en palabras cortas (para la lista). `ahora` se inyecta para poder probarlo. */
export function haceCuanto(iso: string, ahora: number = Date.now()): string {
  const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000))
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

/** Datos mínimos del aviso push (el servidor y las pruebas lo comparten). */
export function armarPayload(a: { titulo: string; cuerpo: string; url: string; clave: string }) {
  return {
    titulo: a.titulo.slice(0, 60),
    cuerpo: a.cuerpo.slice(0, 140),
    url: rutaInternaSegura(a.url),
    tag: a.clave,
  }
}
