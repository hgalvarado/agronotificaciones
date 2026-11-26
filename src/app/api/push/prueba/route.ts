import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@/lib/supabase/server'
import { armarPayload } from '@/lib/alertas/destinos'

/**
 * «Enviar aviso de prueba»: manda un aviso SOLO a los teléfonos de quien lo pide (sesión). Lee sus suscripciones con
 * su propia sesión (RLS: solo ve las suyas). No crea alertas ni toca a nadie más. Tope: 5 dispositivos.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const publica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privada = process.env.VAPID_PRIVATE_KEY
  const asunto = process.env.VAPID_SUBJECT
  if (!publica || !privada || !asunto) return NextResponse.json({ error: 'Faltan las llaves de avisos en el servidor.' }, { status: 503 })

  const supabase = await createClient()
  const { data: u } = await supabase.auth.getUser()
  if (!u.user) return NextResponse.json({ error: 'Sesión vencida.' }, { status: 401 })
  const { data: alc } = await supabase.rpc('fn_alertas_mi_alcance')
  if (!alc) return NextResponse.json({ error: 'Tu rol no tiene permiso de alertas.' }, { status: 403 })

  const { data: susc, error } = await supabase
    .from('push_suscripciones')
    .select('id, endpoint, p256dh, auth')
    .eq('perfil_id', u.user.id)
    .eq('activa', true)
    .limit(5)
  if (error) return NextResponse.json({ error: 'No se pudieron leer tus teléfonos.' }, { status: 500 })
  if (!susc?.length) return NextResponse.json({ error: 'Este teléfono no tiene los avisos activos.' }, { status: 409 })

  webpush.setVapidDetails(asunto, publica, privada)
  const payload = JSON.stringify(armarPayload({ titulo: 'Aviso de prueba', cuerpo: 'Si lo ves, los avisos funcionan en este teléfono.', url: '/alertas', clave: 'prueba' }))
  let enviados = 0
  for (const s of susc) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 300 })
      enviados++
    } catch {
      /* uno que falle no frena a los demás */
    }
  }
  return enviados > 0 ? NextResponse.json({ enviados }) : NextResponse.json({ error: 'No se pudo enviar. Activa los avisos de nuevo.' }, { status: 502 })
}
