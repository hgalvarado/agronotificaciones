'use client'

/**
 * Permisos › un rol › «Administra usuarios con estos roles» (migración 97).
 *
 * Pedido del usuario (2026-11-12): el Jefe de zona solo debe administrar a los Estacioneros de su zona; los
 * Digitadores de campo también tienen zona pero dependen del administrador. Con lista: quien tenga este rol solo ve,
 * crea y edita a personas cuyos roles estén TODOS en la lista (y solo en sus zonas). Sin lista: como antes (los roles
 * marcados «Lo pueden asignar los jefes de zona»). La regla la aplica la base (fn_puedo_editar_persona).
 */

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Boton, Insignia } from '@/components/ui/Primitivos'
import { mensajeDeError } from '@/lib/errores'
import { ListaCasillasBuscable } from './ListaCasillasBuscable'

type RolBasico = { id: number; nombre: string; acceso_total?: boolean | null }

export function RolesQueAdministra({
  rol,
  roles,
  inicial,
  onGuardado,
}: {
  rol: RolBasico
  roles: RolBasico[]
  /** Los que administra hoy. null = falta la migración 97. */
  inicial: number[] | null
  onGuardado: (rolId: number, lista: number[]) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [marcados, setMarcados] = useState<string[]>((inicial ?? []).map(String))
  const [guardando, setGuardando] = useState(false)
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  if (inicial === null) return null // sin la 97 no se ofrece
  const candidatos = roles.filter((r) => r.id !== rol.id && !r.acceso_total)
  const nombre = new Map(roles.map((r) => [r.id, r.nombre]))
  const cambio = [...marcados].sort().join(',') !== [...inicial.map(String)].sort().join(',')

  async function guardar() {
    setGuardando(true)
    setEstado(null)
    const lista = marcados.map(Number)
    const { error } = await createClient().rpc('fn_guardar_roles_administra', { p_rol: rol.id, p_roles: lista })
    setGuardando(false)
    if (error) return setEstado({ tipo: 'error', texto: mensajeDeError(error, 'No se pudo guardar.') })
    onGuardado(rol.id, lista)
    setEstado({ tipo: 'ok', texto: lista.length ? 'Guardado.' : 'Guardado: sin lista, vuelve a la regla de «Lo pueden asignar los jefes de zona».' })
  }

  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200" data-administra-rol={rol.id}>
      <button
        type="button"
        aria-expanded={abierto}
        data-abrir-administra
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 text-left text-xs font-semibold text-slate-700"
      >
        <span>{abierto ? '▾' : '▸'} Usuarios que administra este rol</span>
        {inicial.length ? (
          inicial.map((id) => (
            <Insignia key={id} tono="azul">
              {nombre.get(id) ?? '?'}
            </Insignia>
          ))
        ) : (
          <Insignia tono="gris">Sin lista (regla general)</Insignia>
        )}
      </button>
      {abierto && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-slate-500">
            Si este rol tiene «Usuarios» con alcance de sus zonas (por ejemplo, Jefe de zona), marca los roles de las
            personas que puede ver, crear y editar en sus zonas. Las personas con otros roles no le aparecen. Sin nada
            marcado se usa la regla general: los roles con «Lo pueden asignar los jefes de zona».
          </p>
          <ListaCasillasBuscable
            nombre={`administra-${rol.id}`}
            opciones={candidatos.map((r) => ({ valor: String(r.id), etiqueta: r.nombre }))}
            marcados={marcados}
            onCambiar={setMarcados}
            vacio="No hay otros roles."
          />
          <div className="flex items-center gap-2">
            <Boton tamano="sm" onClick={() => void guardar()} disabled={guardando || !cambio} data-guardar-administra>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Boton>
            {estado && (
              <span className={`text-xs font-semibold ${estado.tipo === 'ok' ? 'text-brand-700' : 'text-red-600'}`} data-estado-administra>
                {estado.texto}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
