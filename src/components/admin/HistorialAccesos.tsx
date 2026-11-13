'use client'

/**
 * Historial de accesos (migración 93): quién cambió qué permiso, rol, zona o estación, y cuándo.
 * Sirve para un rol (Permisos) o para una persona (Usuarios). Lee fn_historial_accesos.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Esqueleto } from '@/components/ui/Primitivos'
import { mensajeDeError } from '@/lib/errores'
import { formatearFechaHora } from '@/lib/estados'

type Evento = {
  at: string
  por: string
  tabla: string
  accion: string
  rol: string | null
  persona: string | null
  recurso: string | null
  antes: Record<string, unknown> | null
  despues: Record<string, unknown> | null
}

const ALCANCE: Record<string, string> = { global: 'todo', zonal: 'sus zonas', propietario: 'solo lo suyo' }

/** Una línea legible por evento. */
function describir(e: Evento): string {
  const d = e.despues ?? {}
  const a = e.antes ?? {}
  switch (e.tabla) {
    case 'permisos': {
      if (e.accion === 'DELETE') return `Quitó ${e.recurso} a ${e.rol ?? 'un rol'}`
      const permitido = d.permitido !== false
      const alcance = ALCANCE[String(d.alcance)] ?? String(d.alcance ?? '')
      const cond = d.condicion === 'solo_abiertos_registrando' ? ' · solo en registro' : ''
      return `${permitido ? 'Concedió' : 'Apagó'} ${e.recurso} a ${e.rol ?? 'un rol'}${permitido ? ` (${alcance}${cond})` : ''}`
    }
    case 'roles':
      if (e.accion === 'INSERT') return `Creó el rol ${d.nombre ?? ''}`
      if (e.accion === 'DELETE') return `Eliminó el rol ${a.nombre ?? ''}`
      if (a.delegable !== d.delegable) return `${d.delegable ? 'Marcó' : 'Desmarcó'} ${d.nombre} como delegable`
      return `Cambió el rol ${d.nombre ?? ''}`
    case 'perfiles_roles':
      return `${e.accion === 'DELETE' ? 'Quitó' : 'Dio'} el rol ${e.rol ?? ''} a ${e.persona ?? 'una persona'}`
    case 'perfiles_zonas':
      return `${e.accion === 'DELETE' ? 'Quitó' : 'Asignó'} la zona ${e.recurso ?? ''} a ${e.persona ?? 'una persona'}`
    case 'perfiles_estaciones':
      return `${e.accion === 'DELETE' ? 'Quitó' : 'Asignó'} la estación ${e.recurso ?? ''} a ${e.persona ?? 'una persona'}`
    case 'perfiles': {
      if (e.accion === 'INSERT') return `Dio de alta a ${e.persona ?? 'una persona'}`
      const cambios: string[] = []
      if (a.todas_las_zonas !== d.todas_las_zonas) cambios.push(d.todas_las_zonas ? 'encendió «Todas las zonas»' : 'apagó «Todas las zonas»')
      if (a.activo !== d.activo) cambios.push(d.activo ? 'activó la cuenta' : 'desactivó la cuenta')
      if (a.rol_id !== d.rol_id) cambios.push(`cambió el rol principal a ${e.rol ?? ''}`)
      return `${e.persona ?? 'Persona'}: ${cambios.join(', ') || 'cambio de accesos'}`
    }
    case 'menu_rol':
      return e.accion === 'DELETE'
        ? `Devolvió ${e.rol ?? 'un rol'} al menú de siempre`
        : `${e.accion === 'INSERT' ? 'Diseñó' : 'Cambió'} el menú de ${e.rol ?? 'un rol'}`
    default:
      return `${e.accion} en ${e.tabla}`
  }
}

export function HistorialAccesos({ rolId, perfilId }: { rolId?: number; perfilId?: string }) {
  const [eventos, setEventos] = useState<Evento[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    createClient()
      .rpc('fn_historial_accesos', { p_rol: rolId ?? null, p_perfil: perfilId ?? null, p_limite: 100 })
      .then(({ data, error: e }) => {
        if (!vivo) return
        if (e) setError(mensajeDeError(e, 'No se pudo leer el historial. Si dice que no existe, falta la migración 93.'))
        else setEventos((data as Evento[]) ?? [])
      })
    return () => {
      vivo = false
    }
  }, [rolId, perfilId])

  if (error) return <Alerta tono="ambar">{error}</Alerta>
  if (eventos === null) return <Esqueleto className="h-16 w-full" />
  if (eventos.length === 0) return <p className="text-sm text-slate-400" data-historial>Sin cambios registrados todavía.</p>

  return (
    <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-inset ring-slate-200" data-historial>
      {eventos.map((e, i) => (
        <li key={i} className="px-3 py-2">
          <p className="text-sm text-slate-700">{describir(e)}</p>
          <p className="text-[11px] text-slate-400">
            {formatearFechaHora(e.at)} · {e.por}
          </p>
        </li>
      ))}
    </ul>
  )
}
