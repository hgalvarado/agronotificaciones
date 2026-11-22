'use client'

/** Detalle de un registro de IC: hojas, IC real y plan, quién y cuándo; «Editar» (hojas y comentario) y «Eliminar» si la base lo permite. */

import { useState } from 'react'
import { Alerta, Boton, Campo, Entrada } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { createClient } from '@/lib/supabase/client'
import { nombreZona, quienRegistro, valorNumero, type Registro } from '@/lib/agrometricas/registrosPura'
import { diferenciaIC, textoIC, validarHojas } from '@/lib/agrometricas/registrosIC'

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const cuando = (iso: unknown) => {
  const d = iso ? new Date(String(iso)) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'short', timeStyle: 'short' }) : ''
}

export function DetalleIC({ registro, onCerrar, onGuardado, onPedirEliminar }: {
  registro: Registro
  onCerrar: () => void
  onGuardado: (nuevo: Record<string, unknown>) => void
  onPedirEliminar: (r: Registro) => void
}) {
  const [editando, setEditando] = useState(false)
  const [hojas, setHojas] = useState('')
  const [comentario, setComentario] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const quien = quienRegistro(registro)
  const v = validarHojas(hojas)

  const empezar = () => { setHojas(texto(registro.hojas)); setComentario(texto(registro.comentario)); setError(null); setEditando(true) }

  async function guardar() {
    if (!v.ok) { setError(v.error); return }
    const cambios: Record<string, unknown> = {}
    if (v.hojas !== valorNumero(registro, 'hojas')) cambios.hojas = v.hojas
    if (comentario.trim() !== texto(registro.comentario).trim()) cambios.comentario = comentario.trim() === '' ? null : comentario.trim()
    if (!Object.keys(cambios).length) { setEditando(false); return }
    setGuardando(true); setError(null)
    const { data, error: e } = await createClient().rpc('fn_agm_ic_editar', { p: { id: registro.id, ...cambios } })
    setGuardando(false)
    if (e) { setError(e.message || 'No se pudo guardar. Revisa la conexión e intenta de nuevo.'); return }
    const nuevo = (data as { registro?: Record<string, unknown> } | null)?.registro
    if (nuevo) onGuardado(nuevo)
    setEditando(false)
  }

  const fila = (etiqueta: string, valor: string) => (
    <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-slate-100 px-3">
      <span className="text-sm text-slate-600">{etiqueta}</span>
      <span className="text-sm font-semibold tabular-nums text-slate-900">{valor}</span>
    </div>
  )

  return (
    <Modal abierto onCerrar={guardando ? () => {} : onCerrar} ancho="ancho"
      titulo={`IC · ${registro.turno} · ${registro.fecha}${registro.ddt != null ? ` · DDT ${registro.ddt}` : ''}`}
      pie={
        <div className="flex flex-wrap justify-end gap-2">
          {registro.puede_eliminar && !editando && <Boton type="button" variante="peligro" onClick={() => onPedirEliminar(registro)} data-eliminar>Eliminar</Boton>}
          {registro.puede_editar && !editando && <Boton type="button" onClick={empezar} data-editar>Editar</Boton>}
          {editando && <Boton type="button" variante="secundario" onClick={() => setEditando(false)} disabled={guardando}>Cancelar</Boton>}
          {editando && <Boton type="button" onClick={guardar} disabled={guardando} data-guardar>{guardando ? 'Guardando…' : 'Guardar'}</Boton>}
          {!editando && <Boton type="button" variante="secundario" onClick={onCerrar}>Cerrar</Boton>}
        </div>
      }>
      <div className="flex flex-col gap-4" data-detalle-ic>
        {error && <Alerta tono="rojo">{error}</Alerta>}
        <p className="text-sm text-slate-500">{[registro.estacion, nombreZona(registro.zona), registro.temporada, registro.ciclo].filter(Boolean).join(' · ')}</p>
        {registro.lotes?.length > 0 && <p className="text-xs text-slate-500">Lotes: {registro.lotes.map((l) => `${l.lote}${l.nombre ? ` ${l.nombre}` : ''}`).join(', ')}</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {editando
            ? <Campo etiqueta="Hojas" error={hojas && !v.ok ? v.error : null}><Entrada inputMode="decimal" value={hojas} onChange={(e) => setHojas(e.target.value)} data-campo="hojas" /></Campo>
            : fila('Hojas', textoIC(valorNumero(registro, 'hojas'), 1))}
          {fila('IC real', textoIC(valorNumero(registro, 'ic_real')))}
          {fila('IC plan', textoIC(valorNumero(registro, 'ic_plan')))}
          {fila('Real − plan', textoIC(diferenciaIC(registro)))}
        </div>
        {editando && <p className="text-xs text-slate-500">El IC se recalcula con la misma fórmula que ya tenía este registro.</p>}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Comentario</h3>
          {editando ? <Entrada value={comentario} onChange={(e) => setComentario(e.target.value)} data-comentario /> : <p className="text-sm text-slate-800">{texto(registro.comentario) || '—'}</p>}
        </section>
        <p className="text-xs text-slate-500">
          {quien ? `Capturó ${quien}` : 'Autor desconocido'}{registro.creado_en ? ` · ${cuando(registro.creado_en)}` : ''}
          {registro.editado_en ? ` · Editado por ${texto(registro.editado_por_nombre) || '—'} el ${cuando(registro.editado_en)}` : ''}
          {registro.origen === 'APPSHEET' ? ' · Histórico de AppSheet' : ''}
        </p>
      </div>
    </Modal>
  )
}
