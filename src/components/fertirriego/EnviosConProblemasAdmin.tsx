'use client'

/**
 * Administración › Envíos con problemas (migración 136). Lista TODOS los registros que la base rechazó, de todas las
 * estaciones, para resolverlos desde la computadora sin ir donde está la persona: «Aceptar de todos modos» (se vuelve a
 * procesar como la persona que lo hizo), «Marcar resuelto» y «Descartar», con una nota que queda guardada.
 * Los que la persona marcó con «Pedir ayuda» salen primero.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Alerta, AreaTexto, Boton, Campo, Entrada, Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { mensajeDeError } from '@/lib/errores'
import { explicarEnvio } from '@/lib/fertirriego/errorEnvio'
import { NOMBRE_TIPO } from './VistaEnvios'

type Problema = {
  id: string
  tipo: string
  estacion_id: string | null
  estacion: string | null
  quien_id: string
  quien: string | null
  recibido_en: string
  mensaje: string | null
  datos: Record<string, unknown>
  revision_estado: 'AYUDA' | 'RESUELTO' | null
  revision_accion: string | null
  revision_nota: string | null
  revision_en: string | null
  revision_por: string | null
}

const ESTADOS = [
  { id: 'ABIERTOS', titulo: 'Sin resolver' },
  { id: 'AYUDA', titulo: 'Pidieron ayuda' },
  { id: 'RESUELTOS', titulo: 'Ya resueltos' },
  { id: 'TODOS', titulo: 'Todos' },
]
const NOMBRE_ACCION: Record<string, string> = {
  ACEPTADO_DE_TODOS_MODOS: 'Aceptado de todos modos',
  DESCARTADO_POR_USUARIO: 'Descartado por la persona',
  DESCARTADO: 'Descartado',
  RESUELTO: 'Resuelto',
}
const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'medium', timeStyle: 'short' }) : '—'

export function EnviosConProblemasAdmin({ estaciones, sinMigracion }: { estaciones: { id: string; nombre: string }[]; sinMigracion: boolean }) {
  const [estado, setEstado] = useState('ABIERTOS')
  const [estacion, setEstacion] = useState('')
  const [quien, setQuien] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [lista, setLista] = useState<Problema[] | null>(null)
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [abierto, setAbierto] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error: e } = await createClient().rpc('fn_fert_problemas', {
      p_estado: estado,
      p_estacion: estacion || null,
      p_desde: desde || null,
      p_hasta: hasta || null,
      p_quien: quien || null,
    })
    if (e) return setError(mensajeDeError(e, 'No se pudo leer la lista.'))
    const filas = ((data as Problema[] | null) ?? []).slice().sort((a, b) => Number(b.revision_estado === 'AYUDA') - Number(a.revision_estado === 'AYUDA'))
    setLista(filas)
  }, [estado, estacion, desde, hasta, quien])

  useEffect(() => {
    if (sinMigracion) return
    void Promise.resolve().then(cargar)
  }, [sinMigracion, cargar])

  const personas = [...new Map((lista ?? []).filter((f) => f.quien).map((f) => [f.quien_id, f.quien as string])).entries()]

  async function actuar(p: Problema, accion: 'aceptar' | 'RESUELTO' | 'DESCARTADO') {
    setError(null)
    setAviso(null)
    setTrabajando(p.id)
    const sb = createClient()
    const nota = notas[p.id]?.trim() || null
    if (accion === 'aceptar') {
      const { data, error: e } = await sb.rpc('fn_fert_problema_aceptar', { p_id: p.id, p_nota: nota })
      const r = data as { ok?: boolean; mensaje?: string } | null
      if (e) setError(mensajeDeError(e, 'No se pudo aceptar.'))
      else if (!r?.ok) setError(`No se pudo aceptar: ${r?.mensaje ?? 'la base lo volvió a rechazar'}. Puedes marcarlo como resuelto o descartarlo.`)
      else setAviso('Aceptado: el registro quedó aplicado y marcado «lo aceptó el administrador».')
    } else {
      const { error: e } = await sb.rpc('fn_fert_problema_resolver', { p_id: p.id, p_accion: accion, p_nota: nota })
      if (e) setError(mensajeDeError(e, 'No se pudo guardar.'))
      else setAviso(accion === 'RESUELTO' ? 'Marcado como resuelto.' : 'Descartado.')
    }
    setTrabajando(null)
    await cargar()
  }

  if (sinMigracion) return <Alerta>Falta correr la migración 136 (envíos con problemas) en esta base.</Alerta>

  return (
    <div className="flex flex-col gap-4" data-envios-problemas-admin>
      {error && <Alerta>{error}</Alerta>}
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}

      <Tarjeta className="flex flex-col gap-3 p-4">
        <Campo etiqueta="Mostrar">
          <SelectorBuscable valor={estado} opciones={ESTADOS} onCambiar={(v) => setEstado(v || 'ABIERTOS')} placeholder="Sin resolver" etiquetaBusqueda="Buscar estado" />
        </Campo>
        <Campo etiqueta="Estación">
          <SelectorBuscable
            valor={estacion}
            opciones={estaciones.map((e) => ({ id: e.id, titulo: e.nombre }))}
            onCambiar={setEstacion}
            placeholder="Todas las estaciones"
            etiquetaBusqueda="Buscar estación"
          />
        </Campo>
        <Campo etiqueta="Persona">
          <SelectorBuscable
            valor={quien}
            opciones={personas.map(([id, nombre]) => ({ id, titulo: nombre }))}
            onCambiar={setQuien}
            placeholder="Cualquiera"
            etiquetaBusqueda="Buscar persona"
          />
        </Campo>
        <div className="flex flex-wrap gap-3">
          <Campo etiqueta="Desde">
            <Entrada type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Campo>
          <Campo etiqueta="Hasta">
            <Entrada type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Campo>
        </div>
      </Tarjeta>

      <p className="text-sm font-bold text-slate-800">Envíos ({lista?.length ?? 0})</p>
      {lista && lista.length === 0 && <Alerta tono="azul">No hay envíos con problemas con estos filtros.</Alerta>}

      {(lista ?? []).map((p) => {
        const d = explicarEnvio({ mensaje: p.mensaje, tipo: p.tipo })
        const resuelto = p.revision_estado === 'RESUELTO'
        return (
          <Tarjeta key={p.id} className="flex flex-col gap-2 p-4">
            <div data-problema={p.tipo} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-slate-900">{NOMBRE_TIPO[p.tipo] ?? p.tipo}</p>
                {p.revision_estado === 'AYUDA' && <Insignia tono="ambar">pidió ayuda</Insignia>}
                {resuelto && <Insignia tono="verde">{NOMBRE_ACCION[p.revision_accion ?? ''] ?? 'Resuelto'}</Insignia>}
              </div>
              <p className="text-xs text-slate-600">
                {p.estacion ?? 'Sin estación'} · {p.quien ?? '—'} · {fecha(p.recibido_en)}
              </p>
              <p className="text-sm font-semibold text-red-800">{d.titulo}</p>
              <p className="text-xs text-slate-700">
                <b>Qué pasó:</b> {d.quePaso}
              </p>
              <p className="text-xs text-slate-700">
                <b>Por qué:</b> {d.porQue}
              </p>
              <p className="break-words text-xs text-slate-500">
                <b>Mensaje del sistema:</b> {p.mensaje}
              </p>
              {resuelto && (
                <p className="text-xs text-slate-600">
                  {p.revision_por ? `Por ${p.revision_por} · ` : ''}
                  {fecha(p.revision_en)}
                  {p.revision_nota ? ` · Nota: ${p.revision_nota}` : ''}
                </p>
              )}
              {!resuelto && p.revision_nota && <p className="text-xs text-slate-600">Nota de la persona: {p.revision_nota}</p>}
              <button type="button" className="min-h-11 self-start text-xs font-semibold text-slate-600 underline" onClick={() => setAbierto(abierto === p.id ? null : p.id)}>
                {abierto === p.id ? 'Ocultar lo que registró' : 'Ver lo que registró'}
              </button>
              {abierto === p.id && <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{JSON.stringify(p.datos, null, 2)}</pre>}
            </div>
            {!resuelto && (
              <>
                <Campo etiqueta="Nota (opcional)">
                  <AreaTexto rows={2} value={notas[p.id] ?? ''} onChange={(e) => setNotas((n) => ({ ...n, [p.id]: e.target.value }))} />
                </Campo>
                <div className="flex flex-wrap gap-2">
                  <Boton className="min-h-11" disabled={trabajando === p.id} onClick={() => void actuar(p, 'aceptar')} data-aceptar-de-todos-modos>
                    Aceptar de todos modos
                  </Boton>
                  <Boton variante="secundario" className="min-h-11" disabled={trabajando === p.id} onClick={() => void actuar(p, 'RESUELTO')} data-marcar-resuelto>
                    Marcar resuelto
                  </Boton>
                  <Boton variante="peligro" className="min-h-11" disabled={trabajando === p.id} onClick={() => void actuar(p, 'DESCARTADO')} data-descartar-problema>
                    Descartar
                  </Boton>
                </div>
              </>
            )}
          </Tarjeta>
        )
      })}

      <p className="text-xs text-slate-500">
        ¿Un registro ya aceptado quedó mal y hay que borrarlo del todo? Usa{' '}
        <Link href="/admin/fertirriego-eliminar" className="font-bold text-brand-700 underline">
          Eliminar por completo
        </Link>
        .
      </p>
    </div>
  )
}
