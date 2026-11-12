'use client'

/**
 * «Qué puede hacer» una persona: sus permisos efectivos (la unión de sus roles), por módulo, con el alcance
 * y el rol que se lo da. Responde «¿por qué Juan no ve X?» sin abrir la matriz. Lee lo GUARDADO en la base
 * (fn_permisos_de_perfil, migración 92), no lo que se está editando en el formulario.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Esqueleto } from '@/components/ui/Primitivos'
import { mensajeDeError } from '@/lib/errores'
import { leerAlcance, type Alcance } from '@/lib/permisos/abac'
import { nombreAlcance } from '@/lib/permisos/niveles'

export type PantallaFicha = {
  codigo: string
  nombre: string
  modulo?: string | null
  etiquetas_alcance?: Partial<Record<Alcance, string>> | null
}

type Fila = { recurso: string; accion: string; alcance: string; condicion: string; roles: string[] | null }

export function FichaPermisosPersona({
  perfilId,
  pantallas,
  acciones,
}: {
  perfilId: string
  pantallas: PantallaFicha[]
  acciones: { codigo: string; nombre: string }[]
}) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    createClient()
      .rpc('fn_permisos_de_perfil', { p_perfil: perfilId })
      .then(({ data, error: e }) => {
        if (!vivo) return
        if (e) setError(mensajeDeError(e, 'No se pudo leer. Si dice que no existe, falta correr la migración 92.'))
        else setFilas((data as Fila[]) ?? [])
      })
    return () => {
      vivo = false
    }
  }, [perfilId])

  if (error) return <Alerta tono="ambar">{error}</Alerta>
  if (filas === null) return <Esqueleto className="h-24 w-full" />

  const nombreAccion = new Map(acciones.map((a) => [a.codigo, a.nombre]))
  const porPantalla = new Map<string, Fila[]>()
  for (const f of filas) porPantalla.set(f.recurso, [...(porPantalla.get(f.recurso) ?? []), f])

  const modulos = new Map<string, { p: PantallaFicha; filas: Fila[] }[]>()
  for (const p of pantallas) {
    const suyas = porPantalla.get(p.codigo)
    if (!suyas?.some((f) => f.accion === 'ver') && !suyas?.length) continue
    const m = p.modulo || 'Otros'
    modulos.set(m, [...(modulos.get(m) ?? []), { p, filas: suyas ?? [] }])
  }

  if (modulos.size === 0) {
    return <p className="text-sm text-slate-400" data-ficha-permisos>No tiene acceso a ninguna pantalla.</p>
  }

  return (
    <div className="flex flex-col gap-3" data-ficha-permisos>
      {[...modulos.entries()].map(([modulo, lista]) => (
        <div key={modulo}>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{modulo}</p>
          <div className="divide-y divide-slate-100 rounded-xl ring-1 ring-inset ring-slate-200">
            {lista.map(({ p, filas: fs }) => {
              const alcance = leerAlcance(fs.find((f) => f.accion === 'ver')?.alcance ?? fs[0]?.alcance)
              const roles = [...new Set(fs.flatMap((f) => f.roles ?? []))]
              const enRegistro = fs.some((f) => f.condicion === 'solo_abiertos_registrando')
              return (
                <div key={p.codigo} className="px-3 py-2" data-ficha-pantalla={p.codigo}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">{p.nombre}</p>
                    <span className="text-xs font-semibold text-brand-700">
                      {nombreAlcance(alcance, p.etiquetas_alcance)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {fs.map((f) => nombreAccion.get(f.accion) ?? f.accion).join(' · ')}
                    {enRegistro && ' · algunas solo mientras se registra'}
                  </p>
                  {roles.length > 0 && <p className="text-[11px] text-slate-400">Por: {roles.join(', ')}</p>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
