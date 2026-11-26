'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Tarjeta } from '@/components/ui/Primitivos'
import { AvisoFlotante, useAvisoFlotante } from '@/components/ui/AvisoFlotante'
import { TIPOS_ALERTA } from '@/lib/alertas/destinos'
import { activarPush, desactivarPush, estadoPushActual, type EstadoPush } from '@/lib/alertas/push'

const TEXTO_ESTADO: Record<EstadoPush, string> = {
  cargando: 'Revisando…',
  no_soportado: 'Este navegador no permite avisos.',
  instalar_ios: 'Instala la app primero: Compartir › «Agregar a pantalla de inicio». Ábrela desde ahí y vuelve aquí. (iPhone con iOS 16.4 o más.)',
  bloqueado: 'Bloqueaste los avisos. Actívalos en los ajustes del navegador para este sitio.',
  inactivo: 'Avisos apagados en este teléfono.',
  activo: 'Avisos activos en este teléfono.',
}

/** «Avisos en este teléfono»: activar/desactivar, aviso de prueba y qué tipos recibo. */
export function MiTelefono() {
  const supabase = useMemo(() => createClient(), [])
  const [estado, setEstado] = useState<EstadoPush>('cargando')
  const [ocupado, setOcupado] = useState(false)
  const [apagados, setApagados] = useState<Set<string>>(new Set())
  const { aviso, mostrar } = useAvisoFlotante()

  const revisar = useCallback(async () => setEstado(await estadoPushActual()), [])

  // bucle-ok: una lectura al abrir; después solo tras las acciones del usuario
  useEffect(() => {
    const t = setTimeout(() => { // bucle-ok: una sola vez al abrir
      void revisar()
      void supabase
        .from('push_preferencias')
        .select('tipo, activo')
        .then(({ data }) => setApagados(new Set((data ?? []).filter((p) => !p.activo).map((p) => p.tipo as string))))
    }, 0)
    return () => clearTimeout(t)
  }, [revisar, supabase])

  async function activar() {
    setOcupado(true)
    try {
      await activarPush()
      mostrar('Avisos activados.')
    } catch (e) {
      mostrar((e as Error).message, 'error')
    }
    setOcupado(false)
    await revisar()
  }

  async function desactivar() {
    setOcupado(true)
    try {
      await desactivarPush()
      mostrar('Avisos apagados en este teléfono.')
    } catch {
      mostrar('No se pudo apagar. Intenta de nuevo.', 'error')
    }
    setOcupado(false)
    await revisar()
  }

  async function prueba() {
    setOcupado(true)
    const r = await fetch('/api/push/prueba', { method: 'POST' }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    setOcupado(false)
    if (r?.ok) mostrar('Aviso enviado. Debe llegar en segundos.')
    else mostrar(j.error ?? 'No se pudo enviar el aviso.', 'error')
  }

  async function cambiarTipo(tipo: string, recibir: boolean) {
    const antes = apagados
    const n = new Set(apagados)
    if (recibir) n.delete(tipo)
    else n.add(tipo)
    setApagados(n)
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('push_preferencias').upsert({ perfil_id: u.user?.id, tipo, activo: recibir }, { onConflict: 'perfil_id,tipo' })
    if (error) {
      setApagados(antes)
      mostrar('No se pudo guardar.', 'error')
    }
  }

  return (
    <div className="flex flex-col gap-3" data-mi-telefono>
      <Tarjeta className="p-4">
        <p className="text-base font-bold text-slate-900">Avisos en este teléfono</p>
        <p className="mt-1 text-sm text-slate-600" data-estado-push={estado}>
          {TEXTO_ESTADO[estado]}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(estado === 'inactivo' || estado === 'bloqueado') && (
            <Boton className="min-h-11" disabled={ocupado || estado === 'bloqueado'} onClick={() => void activar()} data-activar-avisos>
              Activar avisos
            </Boton>
          )}
          {estado === 'activo' && (
            <>
              <Boton variante="secundario" className="min-h-11" disabled={ocupado} onClick={() => void prueba()} data-aviso-prueba>
                Enviar aviso de prueba
              </Boton>
              <Boton variante="fantasma" className="min-h-11" disabled={ocupado} onClick={() => void desactivar()}>
                Desactivar en este teléfono
              </Boton>
            </>
          )}
        </div>
        {estado === 'instalar_ios' && <Alerta tono="ambar">En iPhone los avisos solo funcionan con la app instalada.</Alerta>}
      </Tarjeta>

      <Tarjeta className="p-4">
        <p className="text-sm font-bold text-slate-900">Qué avisos quiero</p>
        <ul className="mt-2 flex flex-col">
          {TIPOS_ALERTA.map((t) => (
            <li key={t.id}>
              <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-slate-700">
                {t.nombre}
                <input type="checkbox" role="switch" /* ui-ok: interruptor de preferencia, no selección de fila */ className="h-5 w-5" checked={!apagados.has(t.id)} onChange={(e) => void cambiarTipo(t.id, e.target.checked)} />
              </label>
            </li>
          ))}
        </ul>
      </Tarjeta>
      <AvisoFlotante aviso={aviso} />
    </div>
  )
}
