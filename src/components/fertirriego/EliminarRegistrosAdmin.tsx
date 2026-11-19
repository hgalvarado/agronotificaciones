'use client'

/**
 * Administración › Eliminar registros de Fertirriego (migración 119). Lista TODOS los tipos (aplicaciones, recepciones,
 * conteos, devoluciones, relevos, traslados y horas de riego) de las estaciones donde la persona tiene «Eliminar por
 * completo», con filtros, casillas para varios y UN motivo. Debajo, la auditoría (solo lectura; no restaura).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, AreaTexto, Boton, Campo, Entrada, Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { mensajeDeError } from '@/lib/errores'
import { hoyIso } from '@/lib/fechas/zona'
import {
  MINIMO_MOTIVO_ELIMINAR,
  NOMBRE_TIPO_ELIMINABLE,
  TIPOS_ELIMINABLES,
  errorMotivoEliminar,
  TEXTO_COPIA_EN_AGL,
  type ResultadoEliminar,
  type TipoEliminable,
} from '@/lib/fertirriego/eliminar'

type Fila = {
  tipo: TipoEliminable
  documento_id: string
  estacion_id: string
  estacion: string
  fecha: string
  quien_id: string | null
  quien: string | null
  resumen: string
  anulado: boolean
  historica: boolean
}
type Auditoria = {
  id: string
  tipo: string
  estacion: string | null
  estacion2: string | null
  fecha_documento: string | null
  registrado_por_nombre: string | null
  resumen: string | null
  motivo: string
  eliminado_por_nombre: string | null
  eliminado_at: string
  copia_en_agl?: boolean
}

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'medium', timeStyle: 'short' }) : '—'
const clave = (f: { tipo: string; documento_id: string }) => `${f.tipo}:${f.documento_id}`

export function EliminarRegistrosAdmin({ estaciones, sinMigracion }: { estaciones: { id: string; nombre: string }[]; sinMigracion: boolean }) {
  const [estacion, setEstacion] = useState('')
  const [tipo, setTipo] = useState('')
  const [quien, setQuien] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [lista, setLista] = useState<Fila[] | null>(null)
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [auditoria, setAuditoria] = useState<Auditoria[] | null>(null)
  const [copia, setCopia] = useState<{ id: string; texto: string } | null>(null)

  const cargar = useCallback(async () => {
    const sb = createClient()
    const [l, a] = await Promise.all([
      sb.rpc('fn_fert_eliminar_listar', { p_estacion: estacion || null, p_tipo: tipo || null, p_desde: desde || null, p_hasta: hasta || null, p_limite: 300 }),
      sb.rpc('fn_fert_eliminaciones_listar', { p_limite: 100 }),
    ])
    if (l.error) return setError(mensajeDeError(l.error, 'No se pudo leer la lista.'))
    setLista((l.data as Fila[] | null) ?? [])
    setMarcadas(new Set())
    if (!a.error) setAuditoria((a.data as Auditoria[] | null) ?? [])
  }, [estacion, tipo, desde, hasta])

  useEffect(() => {
    if (sinMigracion) return
    void Promise.resolve().then(cargar)
  }, [sinMigracion, cargar])

  const personas = useMemo(() => [...new Set((lista ?? []).map((f) => f.quien).filter((x): x is string => !!x))].sort(), [lista])
  const visibles = (lista ?? []).filter((f) => !quien || f.quien === quien)

  function alternar(f: Fila) {
    setMarcadas((m) => {
      const n = new Set(m)
      if (!n.delete(clave(f))) n.add(clave(f))
      return n
    })
  }

  async function eliminar() {
    setError(null)
    setAviso(null)
    const e = errorMotivoEliminar(motivo)
    if (e) return setError(e)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return setError('Necesitas señal para eliminar.')
    const elegidas = (lista ?? []).filter((f) => marcadas.has(clave(f)))
    setTrabajando(true)
    const sb = createClient()
    let hechas = 0
    const avisos: string[] = []
    for (const f of elegidas) {
      const { data, error: err } = await sb.rpc('fn_fert_eliminar_documento', { p_tipo: f.tipo, p_documento: f.documento_id, p_motivo: motivo.trim() })
      if (err) {
        avisos.push(`${NOMBRE_TIPO_ELIMINABLE[f.tipo]} · ${f.resumen}: ${mensajeDeError(err, 'no se pudo eliminar')}`)
        continue
      }
      hechas++
      for (const n of (data as ResultadoEliminar).saldos_negativos ?? []) avisos.push(`Quedó saldo negativo de ${n.material} en ${n.estacion} (${n.saldo}).`)
    }
    setTrabajando(false)
    setConfirmar(false)
    if (avisos.length) setError(avisos.join('\n'))
    if (hechas) {
      setAviso(`${hechas} registro(s) eliminado(s).`)
      setMotivo('')
    }
    await cargar()
  }

  async function verCopia(id: string) {
    if (copia?.id === id) return setCopia(null)
    const { data, error: e } = await createClient().rpc('fn_fert_eliminacion_copia', { p_id: id })
    if (e) return setError(mensajeDeError(e, 'No se pudo leer la copia.'))
    // la base devuelve null cuando la copia ya se bajó a AGL (sql/121)
    setCopia({ id, texto: data == null ? TEXTO_COPIA_EN_AGL : JSON.stringify(data, null, 2) })
  }

  if (sinMigracion) return <Alerta>Falta correr la migración 119 (eliminar registros) en esta base.</Alerta>

  return (
    <div className="flex flex-col gap-4" data-eliminar-registros-admin>
      {error && (
        <div className="sticky top-0 z-10 whitespace-pre-line" role="alert" data-error-eliminar-admin>
          <Alerta>{error}</Alerta>
        </div>
      )}
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}

      <Tarjeta className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-bold text-slate-800">Buscar registros</h2>
        <Campo etiqueta="Estación">
          <SelectorBuscable valor={estacion} opciones={estaciones.map((e) => ({ id: e.id, titulo: e.nombre }))} onCambiar={setEstacion} placeholder="Todas las estaciones" etiquetaBusqueda="Buscar estación" />
        </Campo>
        <Campo etiqueta="Tipo">
          <SelectorBuscable
            valor={tipo}
            opciones={TIPOS_ELIMINABLES.map((t) => ({ id: t, titulo: NOMBRE_TIPO_ELIMINABLE[t] }))}
            onCambiar={setTipo}
            placeholder="Todos los tipos"
            etiquetaBusqueda="Buscar tipo"
          />
        </Campo>
        <div className="flex flex-wrap gap-3">
          <Campo etiqueta="Desde">
            <Entrada type="date" value={desde} max={hoyIso()} onChange={(e) => setDesde(e.target.value)} className="w-44" data-desde-eliminar />
          </Campo>
          <Campo etiqueta="Hasta">
            <Entrada type="date" value={hasta} max={hoyIso()} onChange={(e) => setHasta(e.target.value)} className="w-44" data-hasta-eliminar />
          </Campo>
        </div>
        <Campo etiqueta="Quién lo registró">
          <SelectorBuscable valor={quien} opciones={personas.map((p) => ({ id: p, titulo: p }))} onCambiar={setQuien} placeholder="Cualquiera" etiquetaBusqueda="Buscar persona" />
        </Campo>
      </Tarjeta>

      <Tarjeta className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-800">Registros ({visibles.length})</h2>
          <label className="flex min-h-11 items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={visibles.length > 0 && visibles.every((f) => marcadas.has(clave(f)))}
              onChange={(e) => setMarcadas(e.target.checked ? new Set(visibles.map(clave)) : new Set())}
              data-marcar-todos
            />
            Marcar todos
          </label>
        </div>
        {lista === null ? (
          <p className="text-sm text-slate-400">Cargando…</p>
        ) : visibles.length === 0 ? (
          <p className="text-sm text-slate-500">No hay registros con esos filtros.</p>
        ) : (
          <ul className="divide-y divide-slate-100" data-lista-eliminar>
            {visibles.map((f) => (
              <li key={clave(f)} className="flex items-start gap-3 py-2" data-registro-eliminar={f.tipo}>
                <input type="checkbox" className="mt-1 h-6 w-6 shrink-0" checked={marcadas.has(clave(f))} onChange={() => alternar(f)} aria-label={`Marcar ${f.resumen}`} data-marcar-registro />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-slate-800">
                    {NOMBRE_TIPO_ELIMINABLE[f.tipo]} · {f.estacion}
                  </p>
                  <p className="break-words text-xs text-slate-500">
                    {f.resumen} · {fecha(f.fecha)}
                    {f.quien ? ` · ${f.quien}` : ''}
                  </p>
                </div>
                {f.anulado && <Insignia tono="gris">Anulado</Insignia>}
                {f.historica && <Insignia tono="azul">Histórico</Insignia>}
              </li>
            ))}
          </ul>
        )}
        {marcadas.size > 0 && (
          <div className="flex flex-col gap-3 border-t border-slate-200 pt-3" data-panel-eliminar>
            <Campo etiqueta={`Motivo para los ${marcadas.size} marcado(s)`} requerido ayuda={`Mínimo ${MINIMO_MOTIVO_ELIMINAR} letras`} ayudaVisible>
              <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} data-motivo-eliminar-admin />
            </Campo>
            {confirmar ? (
              <>
                <Alerta tono="ambar">Se borrará por completo y no aparecerá en ningún informe. No se puede deshacer desde la app.</Alerta>
                <div className="flex flex-wrap gap-2">
                  <Boton variante="secundario" onClick={() => setConfirmar(false)} disabled={trabajando}>
                    Cancelar
                  </Boton>
                  <Boton variante="peligro" onClick={() => void eliminar()} disabled={trabajando} data-confirmar-eliminar-admin>
                    Eliminar por completo
                  </Boton>
                </div>
              </>
            ) : (
              <div>
                <Boton
                  variante="peligro"
                  onClick={() => {
                    const e = errorMotivoEliminar(motivo)
                    if (e) return setError(e)
                    setError(null)
                    setConfirmar(true)
                  }}
                  data-eliminar-marcados
                >
                  Eliminar por completo
                </Boton>
              </div>
            )}
          </div>
        )}
      </Tarjeta>

      <Tarjeta className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-bold text-slate-800">Auditoría de lo eliminado</h2>
        <p className="text-xs text-slate-500">Solo lectura. Aquí queda quién, cuándo y por qué; no entra a ningún informe ni se puede restaurar.</p>
        {auditoria === null ? (
          <p className="text-sm text-slate-400">Cargando…</p>
        ) : auditoria.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no se ha eliminado nada.</p>
        ) : (
          <ul className="divide-y divide-slate-100" data-lista-auditoria>
            {auditoria.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 py-2" data-auditoria={a.tipo}>
                <p className="break-words text-sm font-semibold text-slate-800">
                  {NOMBRE_TIPO_ELIMINABLE[a.tipo as TipoEliminable] ?? a.tipo} · {a.estacion ?? '—'}
                  {a.estacion2 ? ` → ${a.estacion2}` : ''}
                </p>
                <p className="break-words text-xs text-slate-500">
                  {a.resumen} · {fecha(a.eliminado_at)} · lo eliminó {a.eliminado_por_nombre ?? '—'}
                  {a.registrado_por_nombre ? ` (lo había registrado ${a.registrado_por_nombre})` : ''}
                </p>
                <p className="break-words text-xs text-slate-700">Motivo: {a.motivo}</p>
                {a.copia_en_agl ? (
                  <p className="break-words text-xs text-slate-500" data-copia-en-agl>{TEXTO_COPIA_EN_AGL}</p>
                ) : (
                  <div>
                    <Boton variante="secundario" tamano="sm" onClick={() => void verCopia(a.id)}>
                      {copia?.id === a.id ? 'Ocultar copia' : 'Ver copia'}
                    </Boton>
                  </div>
                )}
                {copia?.id === a.id && <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-[11px] ring-1 ring-inset ring-slate-200">{copia.texto}</pre>}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </div>
  )
}
