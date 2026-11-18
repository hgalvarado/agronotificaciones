/**
 * Registrador de errores y latido de salud (navegador). Nunca debe romper la app:
 *  - cada función pública es un try/catch absoluto y NO recursiva (un fallo del registrador solo se descarta);
 *  - todo se guarda primero en una cola local (cola.ts) y se envía a fn_errores_registrar (sql/118) con reintento y
 *    backoff; sin sesión o sin red, se queda y se manda al volver;
 *  - si la base todavía no tiene la migración 118, se pausa una hora (la cola conserva lo importante) y la app sigue igual.
 * Contrato y casos: docs/bitacora-errores.md.
 */

import { createClient } from '@/lib/supabase/client'
import { VERSION } from '@/lib/version'
import { ahoraIso } from '@/lib/fechas/zona'
import { confirmar, crearLimitador, encolar, esDefinitivo, esperaMs, tomarLote, type AlmacenSimple, type Severidad } from './cola'
import { acortarPila, esRuido, huellaLocal, sanear, sanearTexto } from './saneo'

export type ContextoError = {
  origen?: 'navegador' | 'sincronizacion' | 'guardado' | 'pantalla' | 'servidor' | 'otro'
  modulo?: string
  severidad?: Severidad
  codigo?: string
  detalle?: Record<string, unknown>
}

const PAUSA_SIN_MIGRACION_MS = 60 * 60_000

let usuarioActual: string | null = null
let enviando = false
let fallosSeguidos = 0
let proximoIntento = 0
let pausadoHasta = 0
let temporizador: ReturnType<typeof setTimeout> | null = null
let ultimoLatido = 0
const pasa = crearLimitador(20, 60_000)

/** Quién tiene la sesión (lo fija el componente raíz). Al entrar otra persona, se manda lo que quedó pendiente. */
export function fijarUsuario(id: string | null) {
  usuarioActual = id
}

function almacen(): AlmacenSimple | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function moduloDeRuta(ruta: string): string {
  const p = ruta.split('/').filter(Boolean)
  if (p[0] === 'admin' && p[1]) return `admin/${p[1]}`
  return p[0] ?? 'inicio'
}

/** Datos del dispositivo y del momento (sin nada personal). */
function contexto(): Record<string, unknown> {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  const w = typeof window !== 'undefined' ? window : null
  return {
    version: VERSION,
    navegador: nav?.userAgent?.slice(0, 200) ?? null,
    en_linea: nav ? nav.onLine : null,
    pantalla: w ? `${w.innerWidth}x${w.innerHeight}` : null,
    zona: (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone
      } catch {
        return null
      }
    })(),
    hora_telefono: ahoraIso(),
    instalada: w ? w.matchMedia?.('(display-mode: standalone)').matches === true : null,
  }
}

/** Código técnico de lo que sea que reventó. */
function codigoDe(e: unknown): string | undefined {
  if (e && typeof e === 'object') {
    const o = e as { code?: unknown; name?: unknown; status?: unknown }
    if (typeof o.code === 'string' || typeof o.code === 'number') return String(o.code)
    if (typeof o.status === 'number') return String(o.status)
    if (typeof o.name === 'string' && o.name !== 'Error') return o.name
  }
  return undefined
}

function mensajeCrudo(e: unknown): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown }
    const p = [o.message, o.details].filter((x) => typeof x === 'string' && x) as string[]
    if (p.length) return [...new Set(p)].join(' · ')
  }
  try {
    return JSON.stringify(e).slice(0, 500)
  } catch {
    return String(e)
  }
}

/**
 * Anota un error. Devuelve la huella (útil para «código de soporte»). NUNCA lanza.
 */
export function registrarError(e: unknown, ctx: ContextoError = {}): string | null {
  try {
    const a = almacen()
    if (!a) return null
    const mensaje = sanearTexto(mensajeCrudo(e), 1000).trim() || 'Error sin mensaje'
    if (esRuido(mensaje)) return null
    const ruta = typeof window !== 'undefined' ? window.location.pathname : null
    const modulo = ctx.modulo ?? (ruta ? moduloDeRuta(ruta) : null)
    const codigo = ctx.codigo ?? codigoDe(e) ?? null
    const origen = ctx.origen ?? 'navegador'
    const huella = huellaLocal(origen, modulo, ruta, codigo, mensaje)
    if (!pasa(huella)) return huella // bucle: el mismo error más de 20 veces por minuto se ignora
    const ahora = ahoraIso()
    const detalle = {
      ...contexto(),
      ...(e instanceof Error ? { nombre: e.name, pila: acortarPila(e.stack) } : {}),
      ...((sanear(ctx.detalle ?? {}) as Record<string, unknown>) ?? {}),
    }
    encolar(a, {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      huella,
      usuario: usuarioActual,
      origen,
      modulo,
      ruta,
      severidad: ctx.severidad ?? 'error',
      codigo,
      mensaje,
      detalle,
      cuando: ahora,
    })
    programarEnvio(2_000)
    return huella
  } catch {
    return null
  }
}

function programarEnvio(ms: number) {
  try {
    if (typeof window === 'undefined') return
    if (temporizador) clearTimeout(temporizador)
    temporizador = setTimeout(() => {
      temporizador = null
      void enviarPendientes()
    }, ms)
  } catch {
    /* nada */
  }
}

/** Manda lo que haya en la cola. Si falla, reintenta con espera creciente (5 s, 10 s… 5 min). NUNCA lanza. */
export async function enviarPendientes(forzar = false): Promise<{ enviados: number; pendientes: number }> {
  try {
    const a = almacen()
    if (!a || !usuarioActual || enviando) return { enviados: 0, pendientes: a ? tomarLote(a, usuarioActual ?? '', 1000).length : 0 }
    const ahora = Date.now()
    if (!forzar && (ahora < pausadoHasta || ahora < proximoIntento)) return { enviados: 0, pendientes: tomarLote(a, usuarioActual, 1000).length }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { enviados: 0, pendientes: tomarLote(a, usuarioActual, 1000).length }

    enviando = true
    let enviados = 0
    try {
      const supabase = createClient()
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) return { enviados: 0, pendientes: tomarLote(a, usuarioActual, 1000).length } // se manda al volver a entrar
      if (s.session.user.id !== usuarioActual) return { enviados: 0, pendientes: 0 }

      for (let vueltas = 0; vueltas < 6; vueltas++) {
        const lote = tomarLote(a, usuarioActual, 50)
        if (lote.length === 0) break
        const p_lote = lote.map((x) => ({
          tipo: 'error',
          origen: x.origen,
          modulo: x.modulo,
          ruta: x.ruta,
          severidad: x.severidad,
          codigo: x.codigo,
          mensaje: x.mensaje,
          detalle: x.detalle,
          repeticiones: x.repeticiones,
          cuando: x.ultima,
        }))
        const { error } = await supabase.rpc('fn_errores_registrar', { p_lote })
        if (error) {
          const falta = error.code === '42883' || error.code === 'PGRST202' || /could not find the function|schema cache/i.test(error.message ?? '')
          if (falta) {
            // La base aún no tiene la migración 118: no se insiste cada minuto; la cola conserva lo importante
            pausadoHasta = Date.now() + PAUSA_SIN_MIGRACION_MS
            return { enviados, pendientes: tomarLote(a, usuarioActual, 1000).length }
          }
          if (esDefinitivo(error.code)) {
            confirmar(a, lote.map((x) => x.id)) // un lote que nunca será aceptado no se reintenta eternamente
            continue
          }
          fallosSeguidos++
          proximoIntento = Date.now() + esperaMs(fallosSeguidos)
          programarEnvio(esperaMs(fallosSeguidos))
          return { enviados, pendientes: tomarLote(a, usuarioActual, 1000).length }
        }
        confirmar(a, lote.map((x) => x.id))
        enviados += lote.length
        fallosSeguidos = 0
        proximoIntento = 0
      }
    } catch {
      fallosSeguidos++
      proximoIntento = Date.now() + esperaMs(fallosSeguidos)
      programarEnvio(esperaMs(fallosSeguidos))
    } finally {
      enviando = false
    }
    return { enviados, pendientes: tomarLote(a, usuarioActual, 1000).length }
  } catch {
    enviando = false
    return { enviados: 0, pendientes: 0 }
  }
}

/* ------------------------------------------------------------------ latido de salud */

/** Lo que el teléfono sabe de la cola de Fertirriego (la lee del almacén local; sin abrirlo si nunca se usó). */
async function colaFertirriego(usuario: string): Promise<{ pendientes: number; viejoH: number | null; intentos: number; sync: string | null }> {
  const vacio = { pendientes: 0, viejoH: null as number | null, intentos: 0, sync: null as string | null }
  try {
    if (typeof indexedDB === 'undefined') return vacio
    const dbs = (indexedDB as unknown as { databases?: () => Promise<{ name?: string }[]> }).databases
    if (typeof dbs === 'function') {
      const lista = await dbs.call(indexedDB)
      if (!lista.some((d) => d.name === `agn-fertirriego-${usuario}`)) return vacio
    }
    const { AlmacenLocal } = await import('@/lib/fertirriego/almacenLocal')
    const alm = await AlmacenLocal.abrir(usuario)
    const [cola, est] = await Promise.all([alm.listarCola(), alm.leerEstado()])
    const pend = cola.filter((o) => o.estado_local === 'PENDIENTE')
    const viejo = pend.length ? Math.min(...pend.map((o) => Date.parse(o.creado_en))) : null
    return {
      pendientes: pend.length,
      viejoH: viejo ? Math.round(((Date.now() - viejo) / 3_600_000) * 10) / 10 : null,
      intentos: pend.reduce((m, o) => Math.max(m, o.intentos ?? 0), 0),
      sync: est.sincronizadoEn,
    }
  } catch {
    return vacio
  }
}

/**
 * Latido de salud: versión, dispositivo, pendientes, edad del más viejo, última sincronización buena, espacio, permiso
 * de ubicación y hora del teléfono (el servidor calcula el desfase). Como mucho uno cada 2 minutos salvo `forzar`.
 * NUNCA lanza.
 */
export async function enviarLatido(forzar = false): Promise<void> {
  try {
    if (!usuarioActual || typeof window === 'undefined') return
    const ahora = Date.now()
    if (!forzar && ahora - ultimoLatido < 120_000) return
    if (navigator.onLine === false) return
    ultimoLatido = ahora
    const usuario = usuarioActual
    const c = await colaFertirriego(usuario)
    const datos: Record<string, unknown> = { ...contexto(), intentos_max: c.intentos }
    try {
      const est = await navigator.storage?.estimate?.()
      if (est?.usage != null && est.quota != null) {
        datos.espacio_usado_mb = Math.round(est.usage / 1_048_576)
        datos.espacio_total_mb = Math.round(est.quota / 1_048_576)
      }
    } catch {
      /* no todos los navegadores lo dan */
    }
    try {
      const perm = await navigator.permissions?.query?.({ name: 'geolocation' as PermissionName })
      if (perm) datos.permiso_ubicacion = perm.state
    } catch {
      /* idem */
    }
    const supabase = createClient()
    const { data: s } = await supabase.auth.getSession()
    if (!s.session || s.session.user.id !== usuario) return
    if (ahora < pausadoHasta) return
    const { error } = await supabase.rpc('fn_errores_registrar', {
      p_lote: [
        {
          tipo: 'latido',
          version: VERSION,
          pendientes: c.pendientes,
          pendiente_mas_viejo_h: c.viejoH,
          ultima_sync_ok: c.sync,
          en_linea: navigator.onLine,
          hora_telefono: ahoraIso(),
          datos,
        },
      ],
    })
    if (error && (error.code === '42883' || error.code === 'PGRST202' || /could not find the function|schema cache/i.test(error.message ?? ''))) {
      pausadoHasta = Date.now() + PAUSA_SIN_MIGRACION_MS
    }
  } catch {
    /* un latido perdido no importa: viene otro */
  }
}

/* ------------------------------------------------------------------ captura global */

/** Engancha window.onerror y unhandledrejection. Devuelve la función que los desengancha. */
export function instalarCapturaGlobal(): () => void {
  if (typeof window === 'undefined') return () => {}
  const alError = (ev: ErrorEvent) => {
    try {
      registrarError(ev.error ?? ev.message, {
        origen: 'navegador',
        detalle: { archivo: sanearTexto(ev.filename ?? '', 200).replace(/\?.*$/, ''), linea: ev.lineno, columna: ev.colno },
      })
    } catch {
      /* nada */
    }
  }
  const alRechazo = (ev: PromiseRejectionEvent) => {
    try {
      registrarError(ev.reason ?? 'Promesa rechazada sin motivo', { origen: 'navegador', detalle: { tipo: 'unhandledrejection' } })
    } catch {
      /* nada */
    }
  }
  const alVolverRed = () => {
    fallosSeguidos = 0
    proximoIntento = 0
    void enviarPendientes(true)
    void enviarLatido(true)
  }
  window.addEventListener('error', alError)
  window.addEventListener('unhandledrejection', alRechazo)
  window.addEventListener('online', alVolverRed)
  return () => {
    window.removeEventListener('error', alError)
    window.removeEventListener('unhandledrejection', alRechazo)
    window.removeEventListener('online', alVolverRed)
  }
}

/** Anota la falla de una sincronización (se llama desde el sincronizador de Fertirriego). */
export function registrarFallaSync(e: unknown, extra: Record<string, unknown> = {}, severidad: Severidad = 'error') {
  registrarError(e, { origen: 'sincronizacion', modulo: 'fertirriego', severidad, detalle: extra })
}

/**
 * Ejecuta un guardado: si lanza, lo anota y vuelve a lanzar (el comportamiento visible no cambia). Para guardados que
 * lanzan en vez de devolver `{ error }` (los que devuelven error se anotan solos desde `mensajeDeError`).
 */
export async function conRegistro<T>(ctx: ContextoError & { operacion: string }, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    registrarError(e, { origen: 'guardado', ...ctx, detalle: { operacion: ctx.operacion, ...(ctx.detalle ?? {}) } })
    throw e
  }
}
