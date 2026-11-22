'use client'

/**
 * Detalle de un registro: todos los valores, foto (si la ruta se puede ver), quién y cuándo, «Editar» (mismas
 * validaciones y avisos de rango que la captura; fn_agm_editar_parametro) y «Eliminar» (solo si la base lo permite).
 */

import { useEffect, useState } from 'react'
import { Alerta, Boton, Campo, Entrada, Insignia } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { createClient } from '@/lib/supabase/client'
import { CAMPOS, SECCIONES, revisar, type Rango } from '@/lib/agrometricas/parametros'
import { cambiosDeEdicion, validarEdicion, valorNumero, type Registro } from '@/lib/agrometricas/registrosPura'

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const cuando = (iso: unknown) => {
  const d = iso ? new Date(String(iso)) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'short', timeStyle: 'short' }) : ''
}
// Los tres datos de clima son por zona, no de este registro: no se editan ni se muestran aquí
const CAMPOS_REGISTRO = CAMPOS.filter((c) => c.seccion !== 'clima')

export function DetalleRegistro({ registro, rangos, onCerrar, onGuardado, onPedirEliminar }: {
  registro: Registro
  rangos: Map<string, Rango>
  onCerrar: () => void
  onGuardado: (nuevo: Record<string, unknown>) => void
  onPedirEliminar: (r: Registro) => void
}) {
  const [editando, setEditando] = useState(false)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [comentario, setComentario] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const ruta = texto(registro.foto_calicata)

  // La foto vive en un bucket privado: se pide un enlace temporal; si no se puede (sin permiso/señal), simplemente no se muestra
  useEffect(() => {
    if (!ruta) return
    let vigente = true
    createClient().storage.from('agrometricas').createSignedUrl(ruta, 300).then(
      ({ data }) => { if (vigente) setFotoUrl(data?.signedUrl ?? null) },
      () => { if (vigente) setFotoUrl(null) })
    return () => { vigente = false }
  }, [ruta])

  const empezarEdicion = () => {
    setValores(Object.fromEntries(CAMPOS_REGISTRO.map((c) => [c.clave, texto(registro[c.clave])])))
    setComentario(texto(registro.comentario)); setError(null); setEditando(true)
  }
  const v = validarEdicion(valores)

  async function guardar() {
    if (!v.ok) { setError('Revisa los campos marcados.'); return }
    const cambios: Record<string, unknown> = cambiosDeEdicion(registro, v.numeros)
    if (comentario.trim() !== texto(registro.comentario).trim()) cambios.comentario = comentario.trim() === '' ? null : comentario.trim()
    if (!Object.keys(cambios).length) { setEditando(false); return }
    setGuardando(true); setError(null)
    const { data, error: e } = await createClient().rpc('fn_agm_editar_parametro', { p: { id: registro.id, ...cambios } })
    setGuardando(false)
    if (e) { setError(e.message || 'No se pudo guardar. Revisa la conexión e intenta de nuevo.'); return }
    const nuevo = (data as { registro?: Record<string, unknown> } | null)?.registro
    if (nuevo) onGuardado(nuevo)
    setEditando(false)
  }

  const fuera = registro.fuera_rango ?? []
  const quien = texto(registro.creado_por_nombre) || texto(registro.creado_por_email)

  return (
    <Modal abierto onCerrar={guardando ? () => {} : onCerrar} ancho="ancho"
      titulo={`${registro.turno} · ${registro.fecha}${registro.ddt != null ? ` · DDT ${registro.ddt}` : ''}`}
      pie={
        <div className="flex flex-wrap justify-end gap-2">
          {registro.puede_eliminar && !editando && <Boton type="button" variante="peligro" onClick={() => onPedirEliminar(registro)} data-eliminar>Eliminar</Boton>}
          {registro.puede_editar && !editando && <Boton type="button" onClick={empezarEdicion} data-editar>Editar</Boton>}
          {editando && <Boton type="button" variante="secundario" onClick={() => setEditando(false)} disabled={guardando}>Cancelar</Boton>}
          {editando && <Boton type="button" onClick={guardar} disabled={guardando} data-guardar>{guardando ? 'Guardando…' : 'Guardar'}</Boton>}
          {!editando && <Boton type="button" variante="secundario" onClick={onCerrar}>Cerrar</Boton>}
        </div>
      }>
      <div className="flex flex-col gap-4" data-detalle>
        {error && <Alerta tono="rojo">{error}</Alerta>}
        <p className="text-sm text-slate-500">
          {[registro.estacion, registro.zona, registro.temporada, registro.ciclo].filter(Boolean).join(' · ')}
        </p>
        {registro.lotes?.length > 0 && (
          <p className="text-xs text-slate-500">Lotes: {registro.lotes.map((l) => `${l.lote}${l.nombre ? ` ${l.nombre}` : ''}`).join(', ')}</p>
        )}
        {fuera.length > 0 && <Insignia tono="rojo">Fuera de rango: {fuera.join(', ')}</Insignia>}

        {SECCIONES.filter((s) => s.clave !== 'clima').map((s) => (
          <section key={s.clave} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{s.titulo}</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CAMPOS_REGISTRO.filter((c) => c.seccion === s.clave).map((c) => {
                const rev = editando ? revisar(v.numeros[c.clave] ?? null, rangos.get(c.clave), c) : null
                return editando ? (
                  <Campo key={c.clave} etiqueta={`${c.etiqueta}${c.unidad ? ` (${c.unidad})` : ''}`} error={v.errores[c.clave] ?? null}>
                    <Entrada inputMode="decimal" value={valores[c.clave] ?? ''} onChange={(e) => setValores((x) => ({ ...x, [c.clave]: e.target.value }))} data-campo={c.clave} />
                    {rev?.mensaje && <span className="text-xs text-amber-700">{rev.mensaje}</span>}
                  </Campo>
                ) : (
                  <div key={c.clave} className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-slate-100 px-3">
                    <span className="text-sm text-slate-600">{c.etiqueta}</span>
                    <span className={`text-sm font-semibold tabular-nums ${fuera.includes(c.clave) ? 'text-red-700' : 'text-slate-900'}`}>
                      {valorNumero(registro, c.clave) === null ? '—' : `${valorNumero(registro, c.clave)}${c.unidad ? ` ${c.unidad}` : ''}`}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        ))}

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Comentario</h3>
          {editando
            ? <Entrada value={comentario} onChange={(e) => setComentario(e.target.value)} data-comentario />
            : <p className="text-sm text-slate-800">{texto(registro.comentario) || '—'}</p>}
        </section>

        {fotoUrl && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Foto de la calicata</h3>
            {/* eslint-disable-next-line @next/next/no-img-element -- enlace temporal firmado de Storage */}
            <img src={fotoUrl} alt="Foto de la calicata" className="max-h-80 w-full rounded-xl object-contain" data-foto />
          </section>
        )}

        <p className="text-xs text-slate-500">
          {quien ? `Capturó ${quien}` : 'Autor desconocido'}{registro.creado_en ? ` · ${cuando(registro.creado_en)}` : ''}
          {registro.editado_en ? ` · Editado por ${texto(registro.editado_por_nombre) || '—'} el ${cuando(registro.editado_en)}` : ''}
          {registro.origen === 'APPSHEET' ? ' · Histórico de AppSheet' : ''}
        </p>
      </div>
    </Modal>
  )
}
