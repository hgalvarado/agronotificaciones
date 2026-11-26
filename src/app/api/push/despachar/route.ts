import { NextResponse, type NextRequest } from 'next/server'
import webpush from 'web-push'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { armarPayload } from '@/lib/alertas/destinos'

/**
 * Envía los avisos push de las alertas pendientes. Lo llama pg_net (al nacer una alerta), AGL o un cron.
 * Protegida por secreto en la cabecera `x-despacho-secreto` (PUSH_DESPACHO_SECRETO). Sin sesión.
 * Tope por llamada: 20 alertas y 200 envíos; un solo reintento por envío con espera corta. Nada de bucles.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ALERTAS = 20
const MAX_ENVIOS = 200
const REINTENTO_MS = 800

function secretoValido(recibido: string | null): boolean {
  const esperado = process.env.PUSH_DESPACHO_SECRETO
  if (!esperado || !recibido) return false
  const a = Buffer.from(recibido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Envio = { perfil_id: string; suscripcion_id: string; endpoint: string; p256dh: string; auth: string }
type Item = { alerta: { id: string; clave: string; titulo: string; cuerpo: string; url: string }; envios: Envio[] }

export async function POST(req: NextRequest) {
  if (!secretoValido(req.headers.get('x-despacho-secreto'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const publica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privada = process.env.VAPID_PRIVATE_KEY
  const asunto = process.env.VAPID_SUBJECT
  if (!publica || !privada || !asunto) {
    return NextResponse.json({ error: 'Faltan las llaves VAPID en el servidor' }, { status: 503 })
  }
  webpush.setVapidDetails(asunto, publica, privada)

  let alertaId: string | null = null
  const cuerpo = await req.json().catch(() => null)
  if (cuerpo && typeof cuerpo.alerta_id === 'string') alertaId = cuerpo.alerta_id

  const db = createAdminClient()
  const { data: plan, error } = await db.rpc('fn_alertas_plan_despacho', { p_limite: MAX_ALERTAS, p_alerta: alertaId })
  if (error) return NextResponse.json({ error: 'No se pudo armar el despacho' }, { status: 500 })

  const items = (plan ?? []) as Item[]
  let enviados = 0
  let fallos = 0
  let restantes = MAX_ENVIOS

  let agotado = false
  for (const item of items) {
    const payload = JSON.stringify(armarPayload(item.alerta))
    for (const e of item.envios) {
      if (restantes <= 0) {
        agotado = true
        break
      }
      restantes--
      let detalle: string | null = null
      let ok = false
      for (let intento = 0; intento < 2 && !ok; intento++) {
        try {
          await webpush.sendNotification({ endpoint: e.endpoint, keys: { p256dh: e.p256dh, auth: e.auth } }, payload, { TTL: 3600, urgency: 'high' })
          ok = true
        } catch (err) {
          const codigo = (err as { statusCode?: number }).statusCode
          detalle = `${codigo ?? 'error'} ${(err as Error).message ?? ''}`.slice(0, 200)
          if (codigo && codigo < 500 && codigo !== 429) break // 404/410 y demás: no tiene caso reintentar
          if (intento === 0) await espera(REINTENTO_MS)
        }
      }
      await db.rpc('fn_alerta_registrar_envio', {
        p_alerta: item.alerta.id,
        p_perfil: e.perfil_id,
        p_susc: e.suscripcion_id,
        p_resultado: ok ? 'enviado' : 'fallo',
        p_detalle: ok ? null : detalle,
      })
      if (ok) enviados++
      else fallos++
    }
    // Tope de envíos agotado: esta alerta y las siguientes NO se cierran; se retoman en la próxima llamada
    // (la regla de 24 h evita repetir el aviso a quien ya lo recibió).
    if (agotado) break
    await db.rpc('fn_alerta_cerrar_despacho', { p_alerta: item.alerta.id })
  }
  return NextResponse.json({ alertas: items.length, enviados, fallos })
}
