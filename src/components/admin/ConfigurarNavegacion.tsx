'use client'

/**
 * Qué accesos directos ve cada rol en la barra inferior del teléfono.
 *
 * Es sólo pantalla: la regla de cuántos caben vive en
 * `lib/navegacion/barra` y el guardado en `fn_guardar_navegacion`, que
 * reemplaza la barra de un rol de una vez. Hacerlo con borrar+insertar
 * desde aquí dejaría al rol sin barra a medio camino, y hay gente
 * usándola en ese momento.
 */

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Selector, Tarjeta } from '@/components/ui/Primitivos'
import { IconChevronDown } from '@/components/ui/Icons'
import { mensajeDeError } from '@/lib/errores'
import { CUPO_BARRA, cabenEnBarra } from '@/lib/navegacion/barra'

export type PantallaOpcion = { codigo: string; nombre: string }
export type RolOpcion = { id: number; codigo: string; nombre: string }

export function ConfigurarNavegacion({
  roles,
  pantallas,
  inicial,
}: {
  roles: RolOpcion[]
  pantallas: PantallaOpcion[]
  /** Lo que hay guardado hoy, por rol. */
  inicial: Record<number, string[]>
}) {
  const [rolId, setRolId] = useState<number>(roles[0]?.id ?? 0)
  const [porRol, setPorRol] = useState<Record<number, string[]>>(inicial)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const elegidas = useMemo(() => porRol[rolId] ?? [], [porRol, rolId])
  const disponibles = useMemo(
    () => pantallas.filter((p) => !elegidas.includes(p.codigo)),
    [pantallas, elegidas]
  )

  const cupo = cabenEnBarra(elegidas.length)
  const nombreDe = (codigo: string) =>
    pantallas.find((p) => p.codigo === codigo)?.nombre ?? codigo

  function cambiar(nuevas: string[]) {
    setPorRol({ ...porRol, [rolId]: nuevas })
    setAviso(null)
  }

  function mover(i: number, delta: number) {
    const j = i + delta
    if (j < 0 || j >= elegidas.length) return
    const copia = [...elegidas]
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
    cambiar(copia)
  }

  async function guardar() {
    setGuardando(true)
    setError(null)
    const { error: e } = await createClient().rpc('fn_guardar_navegacion', {
      p_rol_id: rolId,
      p_pantallas: elegidas,
    })
    setGuardando(false)

    if (e) {
      return setError(
        mensajeDeError(
          e,
          'No se pudo guardar. Si dice que no existe «fn_guardar_navegacion», falta correr la migración 39.'
        )
      )
    }
    setAviso(
      elegidas.length === 0
        ? 'Barra restablecida: este rol vuelve al orden por omisión.'
        : 'Barra guardada. Quien tenga este rol la verá al recargar.'
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alerta>{error}</Alerta>}
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}

      <Tarjeta className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Rol
          </label>
          <Selector value={String(rolId)} onChange={(e) => setRolId(Number(e.target.value))}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
              </option>
            ))}
          </Selector>
        </div>

        <p className="text-xs text-slate-400">
          Abajo caben <strong>{CUPO_BARRA}</strong> botones contando el de «Más». Lo que sobre —y
          todo lo que no marques aquí— sigue saliendo dentro de «Más»:{' '}
          <strong>nada desaparece</strong>. Sin nada marcado, el rol usa el orden por omisión.
        </p>

        {/* ------------------------- Elegidas ------------------------- */}
        <div>
          <h3 className="mb-1.5 text-sm font-semibold text-slate-900">En la barra, en orden</h3>

          {elegidas.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-sm text-slate-400">
              Sin configurar. Este rol ve el orden por omisión.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-xl ring-1 ring-inset ring-slate-200">
              {elegidas.map((codigo, i) => {
                // Por encima del cupo se ve igual, pero avisado: marcar
                // ocho no es un error, sólo que las últimas no salen abajo.
                const enBarra = i < cupo
                return (
                  <li
                    key={codigo}
                    className={`flex items-center gap-2 px-3 py-2.5 ${
                      i > 0 ? 'border-t border-slate-100' : ''
                    } ${enBarra ? 'bg-white' : 'bg-slate-50'}`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                        enBarra ? 'bg-brand-700 text-white' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {nombreDe(codigo)}
                      </span>
                      {!enBarra && (
                        <span className="block text-[11px] text-slate-400">
                          No cabe abajo: sale en «Más».
                        </span>
                      )}
                    </span>

                    <button
                      type="button"
                      aria-label={`Subir ${nombreDe(codigo)}`}
                      onClick={() => mover(i, -1)}
                      disabled={i === 0}
                      className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
                    >
                      <IconChevronDown className="h-4 w-4 rotate-180" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Bajar ${nombreDe(codigo)}`}
                      onClick={() => mover(i, 1)}
                      disabled={i === elegidas.length - 1}
                      className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
                    >
                      <IconChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => cambiar(elegidas.filter((c) => c !== codigo))}
                      className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-400 transition-colors hover:text-red-600"
                    >
                      Quitar
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* ------------------------ Disponibles ----------------------- */}
        {disponibles.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-slate-900">Agregar a la barra</h3>
            <div className="flex flex-wrap gap-1.5">
              {disponibles.map((p) => (
                <button
                  key={p.codigo}
                  type="button"
                  onClick={() => cambiar([...elegidas, p.codigo])}
                  className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 transition-colors hover:text-brand-700 hover:ring-brand-400"
                >
                  + {p.nombre}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          {elegidas.length > 0 && (
            <Boton variante="secundario" onClick={() => cambiar([])} disabled={guardando}>
              Limpiar
            </Boton>
          )}
          <Boton onClick={() => void guardar()} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      </Tarjeta>
    </div>
  )
}
