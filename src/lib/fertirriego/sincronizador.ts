/**
 * Envía lo registrado en el teléfono y baja el estado nuevo (Etapa B).
 *
 * - Cada registro lleva su UUID: si la señal se cae a mitad del envío y se reenvía, la base responde «ya existía»
 *   y no duplica nada (sql/91).
 * - «inmediato» = se envía dentro de los 2 minutos de registrarlo (había señal). Así la base rechaza en el acto lo
 *   imposible (saldo negativo, estación ajena); lo que llega tarde se acepta y se marca para revisar.
 * - Los aceptados salen de la cola (ya están en lo que se bajó); los rechazados se quedan para que la persona los
 *   vea y decida.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ahoraIso } from '@/lib/fechas/zona'
import type { AlmacenLocal } from './almacenLocal'
import { registrarFallaSync } from '@/lib/errores/registrador'
import { importarLlave, type LlavePersona } from './codigo'
import type { EstadoCampo, Operacion } from './tipos'

const LOTE = 50
const INMEDIATO_MS = 120_000

export type ResultadoSincronizacion = {
  enviados: number
  rechazados: number
  estado: EstadoCampo | null
  sinRed: boolean
  error: string | null
}

type Respuesta = { id: string; estado: string; mensaje: string | null; observaciones: string[] | null }

let enCurso: Promise<ResultadoSincronizacion> | null = null

/** 115: si la base aún no tiene «anular diferencia de relevo», el mensaje técnico se cambia por uno que se entienda. */
function mensajeComprensible(o: { tipo: string; datos: Record<string, unknown> }, mensaje: string | null): string | null {
  if (o.tipo === 'anulacion' && o.datos.documento_tipo === 'relevo' && /No se puede anular ese tipo/i.test(mensaje ?? '')) {
    return 'El servidor todavía no está actualizado para anular la diferencia de un relevo. Avisa al administrador y vuelve a intentarlo más tarde.'
  }
  return mensaje
}

function esFallaDeRed(mensaje: string | undefined): boolean {
  return (typeof navigator !== 'undefined' && !navigator.onLine) || /fetch|network|Failed|NetworkError|Load failed/i.test(mensaje ?? '')
}

/** El sobre que va a la base (sin los campos que solo usa el teléfono). */
export function sobreDe(op: Operacion, ahora = new Date()) {
  return {
    id: op.id,
    tipo: op.tipo,
    creado_en: op.creado_en,
    enviado_en: ahoraIso(ahora),
    // Con la casilla «aplicar sin inventario» marcada la base no rechaza: registra y deja la observación SALDO_NEGATIVO
    inmediato: op.datos.acepta_negativo === true ? false : ahora.getTime() - Date.parse(op.creado_en) < INMEDIATO_MS,
    dispositivo: op.dispositivo,
    ubicacion: op.ubicacion,
    en_nombre_de: op.en_nombre_de,
    datos: op.datos,
  }
}

async function sincronizarUnaVez(almacen: AlmacenLocal, supabase: SupabaseClient): Promise<ResultadoSincronizacion> {
  const r: ResultadoSincronizacion = { enviados: 0, rechazados: 0, estado: null, sinRed: false, error: null }

  const { data: sesion } = await supabase.auth.getSession()
  if (!sesion.session) {
    registrarFallaSync('Sesión vencida: no se pudo sincronizar', { fase: 'sesion' }, 'aviso')
    return { ...r, error: 'Tu sesión venció. Vuelve a entrar: lo registrado sigue guardado en el teléfono.' }
  }

  // 1 · Enviar lo pendiente, en el orden en que se registró
  const pendientes = (await almacen.listarCola()).filter((o) => o.estado_local === 'PENDIENTE')
  for (let i = 0; i < pendientes.length; i += LOTE) {
    const lote = pendientes.slice(i, i + LOTE)
    const { data, error } = await supabase.rpc('fn_fert_sincronizar', { p_ops: lote.map((o) => sobreDe(o)) })
    if (error) {
      for (const o of lote) await almacen.guardarOperacion({ ...o, intentos: o.intentos + 1 })
      const detalle = { fase: 'enviar', lote: lote.length, tipos: [...new Set(lote.map((o) => o.tipo))], intentos_max: Math.max(...lote.map((o) => o.intentos + 1)), mas_viejo: lote[0]?.creado_en }
      if (esFallaDeRed(error.message)) {
        registrarFallaSync(`Sin conexión al enviar ${lote.length} registro(s)`, detalle, 'info')
        return { ...r, sinRed: true }
      }
      registrarFallaSync(error, detalle)
      return { ...r, error: error.message }
    }
    const porId = new Map(((data as Respuesta[]) ?? []).map((x) => [x.id, x]))
    for (const o of lote) {
      const x = porId.get(o.id)
      if (!x) continue
      const rechazado = x.estado === 'RECHAZADO' || (x.estado === 'YA_EXISTIA' && (x as { resultado?: string }).resultado === 'RECHAZADO')
      const observaciones = x.observaciones ?? []
      await almacen.guardarOperacion({
        ...o,
        intentos: o.intentos + 1,
        estado_local: rechazado ? 'RECHAZADO' : observaciones.length ? 'OBSERVADO' : 'ACEPTADO',
        mensaje: mensajeComprensible(o, x.mensaje),
        observaciones,
      })
      if (rechazado) r.rechazados++
      else r.enviados++
    }
  }

  // 2 · Bajar el estado nuevo (saldos, movimientos, catálogos)
  const { data: estado, error: e2 } = await supabase.rpc('fn_fert_estado_campo', {})
  if (e2) {
    if (esFallaDeRed(e2.message)) return { ...r, sinRed: true }
    registrarFallaSync(e2, { fase: 'bajar_estado' })
    return { ...r, error: e2.message }
  }
  await almacen.guardarEstado(estado as EstadoCampo, ahoraIso())
  r.estado = estado as EstadoCampo

  // 2b · Llaves del código de relevo (si su rol tiene «Relevo»). Se importan como no exportables.
  const { data: llaves, error: e3 } = await supabase.rpc('fn_fert_mis_llaves')
  if (!e3 && Array.isArray(llaves)) {
    const importadas: LlavePersona[] = []
    for (const l of llaves as { perfil_id: string; nombre: string; secreto: string }[]) {
      try {
        importadas.push({ perfil_id: l.perfil_id, nombre: l.nombre, llave: await importarLlave(l.secreto) })
      } catch {
        /* una llave dañada no impide el resto */
      }
    }
    await almacen.guardarLlaves(importadas)
  }

  // 3 · Lo aceptado ya está en el estado bajado: sale de la cola
  for (const o of await almacen.listarCola()) {
    if (o.estado_local === 'ACEPTADO' || o.estado_local === 'OBSERVADO') await almacen.borrarOperacion(o.id)
  }
  return r
}

let otraVuelta: Promise<ResultadoSincronizacion> | null = null

/**
 * Una sincronización a la vez. Si ya hay una en curso, lo registrado después de que empezó NO va en ella (ya leyó
 * la cola): se hace UNA vuelta más al terminar, para que no espere al reloj de cada minuto (que además se reinicia
 * cada vez que cambia la cola). Lo encontró la QA (2026-11-12): lo guardado justo al abrir tardaba más de 1 minuto.
 */
export function sincronizar(almacen: AlmacenLocal, supabase: SupabaseClient): Promise<ResultadoSincronizacion> {
  if (!enCurso) {
    enCurso = sincronizarUnaVez(almacen, supabase)
      .catch((e: unknown) => {
        const mensaje = e instanceof Error ? e.message : String(e)
        if (!esFallaDeRed(mensaje)) registrarFallaSync(e, { fase: 'inesperado' })
        return { enviados: 0, rechazados: 0, estado: null, sinRed: esFallaDeRed(mensaje), error: esFallaDeRed(mensaje) ? null : mensaje }
      })
      .finally(() => {
        enCurso = null
      })
    return enCurso
  }
  if (!otraVuelta) {
    otraVuelta = enCurso.then(() => {
      otraVuelta = null
      return sincronizar(almacen, supabase)
    })
  }
  return otraVuelta
}
