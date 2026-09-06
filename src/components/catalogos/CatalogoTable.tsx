'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type CampoCatalogo = {
  key: string
  label: string
  tipo: 'text' | 'number' | 'checkbox'
  requerido?: boolean
}

type Fila = Record<string, string | number | boolean | null>

export function CatalogoTable({
  tabla,
  campos,
  filas,
  soloLectura = false,
}: {
  tabla: string
  campos: CampoCatalogo[]
  filas: Fila[]
  soloLectura?: boolean
}) {
  const supabase = createClient()
  const router = useRouter()
  const [nuevaFila, setNuevaFila] = useState<Fila>(
    Object.fromEntries(campos.map((c) => [c.key, c.tipo === 'checkbox' ? true : '']))
  )
  const [guardandoNueva, setGuardandoNueva] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function actualizarCampo(id: string, key: string, valor: string | number | boolean) {
    const { error } = await supabase.from(tabla).update({ [key]: valor }).eq('id', id)
    if (error) {
      alert(error.message)
      return
    }
    router.refresh()
  }

  async function crearFila(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setGuardandoNueva(true)
    const payload = Object.fromEntries(
      Object.entries(nuevaFila).filter(([, v]) => v !== '')
    )
    const { error } = await supabase.from(tabla).insert(payload)
    setGuardandoNueva(false)
    if (error) {
      setError(error.message)
      return
    }
    setNuevaFila(Object.fromEntries(campos.map((c) => [c.key, c.tipo === 'checkbox' ? true : ''])))
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase text-slate-400">
              {campos.map((c) => (
                <th key={c.key} className="px-3 py-2">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr key={String(fila.id)} className="border-b border-slate-50 last:border-0">
                {campos.map((c) => (
                  <td key={c.key} className="px-3 py-2">
                    {c.tipo === 'checkbox' ? (
                      <input
                        type="checkbox"
                        defaultChecked={Boolean(fila[c.key])}
                        disabled={soloLectura}
                        onChange={(e) => actualizarCampo(String(fila.id), c.key, e.target.checked)}
                        className="h-5 w-5 accent-emerald-700"
                      />
                    ) : (
                      <input
                        type={c.tipo}
                        defaultValue={fila[c.key] as string | number}
                        disabled={soloLectura}
                        onBlur={(e) =>
                          e.target.value !== String(fila[c.key] ?? '') &&
                          actualizarCampo(String(fila.id), c.key, c.tipo === 'number' ? Number(e.target.value) : e.target.value)
                        }
                        className="w-full min-w-[100px] rounded-md border border-transparent px-2 py-1 focus:border-slate-300 focus:bg-slate-50 disabled:bg-transparent"
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={campos.length} className="px-3 py-6 text-center text-slate-400">
                  Sin registros todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!soloLectura && (
        <form onSubmit={crearFila} className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-slate-300 p-3">
          {campos
            .filter((c) => c.key !== 'activo')
            .map((c) => (
              <label key={c.key} className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                {c.label}
                <input
                  type={c.tipo === 'checkbox' ? 'text' : c.tipo}
                  value={(nuevaFila[c.key] as string) ?? ''}
                  onChange={(e) => setNuevaFila((prev) => ({ ...prev, [c.key]: e.target.value }))}
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  required={c.requerido}
                />
              </label>
            ))}
          <button
            type="submit"
            disabled={guardandoNueva}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {guardandoNueva ? 'Agregando…' : '+ Agregar'}
          </button>
        </form>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}
