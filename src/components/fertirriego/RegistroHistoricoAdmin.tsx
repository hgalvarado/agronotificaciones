'use client'

/**
 * Administración › Registro histórico de Fertirriego (migración 116). Pedido del usuario (2026-11-18): hay estaciones
 * que ya operaban antes de poner el sistema en marcha. El administrador da a UNA persona, en UNA o varias estaciones y
 * hasta una fecha límite, el permiso de registrar lo que ya se aplicó SIN mover el inventario. Se revoca antes si hace
 * falta; vencido o revocado, la persona vuelve al proceso normal.
 */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Campo, Entrada, Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { ListaCasillasBuscable } from '@/components/admin/ListaCasillasBuscable'
import { mensajeDeError } from '@/lib/errores'
import { hoyIso, sumarDias } from '@/lib/fechas/zona'

type Permiso = {
  id: string
  persona_id: string
  persona: string
  estacion_id: string
  estacion: string
  hasta: string
  dias_restantes: number
  otorgado_por: string | null
  otorgado_at: string
  revocado_at: string | null
  nota: string | null
  estado: 'VIGENTE' | 'VENCIDO' | 'REVOCADO'
}

const TONO = { VIGENTE: 'verde', VENCIDO: 'gris', REVOCADO: 'rojo' } as const
const TEXTO = { VIGENTE: 'Vigente', VENCIDO: 'Vencido', REVOCADO: 'Revocado' } as const
const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'medium', timeStyle: 'short' }) : '—'

export function RegistroHistoricoAdmin({
  estaciones,
  personas,
  sinMigracion,
}: {
  estaciones: { id: string; nombre: string }[]
  personas: { id: string; nombre: string }[]
  sinMigracion: boolean
}) {
  const [lista, setLista] = useState<Permiso[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [persona, setPersona] = useState('')
  const [elegidas, setElegidas] = useState<string[]>([])
  const [hasta, setHasta] = useState(() => sumarDias(hoyIso(), 7))
  const [nota, setNota] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [soloVigentes, setSoloVigentes] = useState(true)

  const cargar = useCallback(async () => {
    const { data, error: e } = await createClient().rpc('fn_fert_historico_listar', { p_solo_vigentes: false })
    if (e) return setError(mensajeDeError(e, 'No se pudo leer la lista.'))
    setLista((data as Permiso[] | null) ?? [])
  }, [])

  useEffect(() => {
    if (sinMigracion) return
    // La carga inicial se hace en una microtarea (no dentro del propio efecto)
    void Promise.resolve().then(cargar)
  }, [sinMigracion, cargar])

  async function otorgar() {
    setError(null)
    setAviso(null)
    if (!persona) return setError('Elige la persona.')
    if (elegidas.length === 0) return setError('Elige al menos una estación.')
    if (!hasta || hasta < hoyIso()) return setError('La fecha límite no puede ser anterior a hoy.')
    setTrabajando(true)
    const { data, error: e } = await createClient().rpc('fn_fert_historico_otorgar', {
      p_persona: persona,
      p_estaciones: elegidas,
      p_hasta: hasta,
      p_nota: nota.trim() || null,
    })
    setTrabajando(false)
    if (e) return setError(mensajeDeError(e, 'No se pudo otorgar.'))
    setAviso(`Permiso guardado en ${data as number} estación(es) hasta el ${hasta}. La persona debe tocar «Actualizar» en Fertirriego (con señal).`)
    setElegidas([])
    setNota('')
    await cargar()
  }

  async function revocar(p: Permiso) {
    setError(null)
    setAviso(null)
    setTrabajando(true)
    const { error: e } = await createClient().rpc('fn_fert_historico_revocar', { p_id: p.id })
    setTrabajando(false)
    if (e) return setError(mensajeDeError(e, 'No se pudo revocar.'))
    setAviso(`Permiso revocado: ${p.persona} · ${p.estacion}.`)
    await cargar()
  }

  if (sinMigracion) return <Alerta>Falta correr la migración 116 (registro histórico) en esta base.</Alerta>

  const visibles = (lista ?? []).filter((p) => !soloVigentes || p.estado === 'VIGENTE')

  return (
    <div className="flex flex-col gap-4" data-registro-historico-admin>
      {/* Alertas arriba y visibles */}
      {error && (
        <div className="sticky top-0 z-10" role="alert" data-error-historico>
          <Alerta>{error}</Alerta>
        </div>
      )}
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}

      <Tarjeta className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-bold text-slate-800">Dar permiso de registro histórico</h2>
        <p className="text-xs text-slate-500">
          La persona podrá registrar aplicaciones de días pasados en las estaciones que elijas, hasta la fecha límite. Esos
          registros NO mueven el inventario. Pasada la fecha (o si lo revocas) vuelve al proceso normal.
        </p>
        <Campo etiqueta="Persona" requerido>
          <div data-sel-persona>
            <SelectorBuscable
              valor={persona}
              opciones={personas.map((p) => ({ id: p.id, titulo: p.nombre }))}
              onCambiar={setPersona}
              placeholder="¿Quién registrará?"
              etiquetaBusqueda="Buscar persona"
            />
          </div>
        </Campo>
        <Campo etiqueta="Estaciones" requerido>
          <ListaCasillasBuscable
            nombre="estaciones-historico"
            opciones={estaciones.map((e) => ({ valor: e.id, etiqueta: e.nombre }))}
            marcados={elegidas}
            onCambiar={setElegidas}
            vacio="No hay estaciones."
          />
        </Campo>
        <Campo etiqueta="Fecha límite (inclusive)" requerido>
          <Entrada type="date" value={hasta} min={hoyIso()} max={sumarDias(hoyIso(), 90)} onChange={(e) => setHasta(e.target.value)} className="w-44" data-hasta-historico />
        </Campo>
        <Campo etiqueta="Nota (opcional)">
          <Entrada value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. Papalon-1: aplicaciones de antes de noviembre" data-nota-historico />
        </Campo>
        <div>
          <Boton onClick={() => void otorgar()} disabled={trabajando} data-otorgar-historico>
            Guardar permiso
          </Boton>
        </div>
      </Tarjeta>

      <Tarjeta className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-800">Permisos</h2>
          <label className="flex min-h-11 items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" className="h-5 w-5" checked={soloVigentes} onChange={(e) => setSoloVigentes(e.target.checked)} data-solo-vigentes />
            Solo vigentes
          </label>
        </div>
        {lista === null ? (
          <p className="text-sm text-slate-400">Cargando…</p>
        ) : visibles.length === 0 ? (
          <p className="text-sm text-slate-500">No hay permisos {soloVigentes ? 'vigentes' : ''}.</p>
        ) : (
          <ul className="divide-y divide-slate-100" data-lista-historico>
            {visibles.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2" data-permiso-historico={p.estado} data-persona={p.persona}>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-slate-800">
                    {p.persona} · {p.estacion}
                  </p>
                  <p className="text-xs text-slate-500">
                    {p.estado === 'VIGENTE'
                      ? `Hasta el ${p.hasta} (${p.dias_restantes <= 0 ? 'vence hoy' : `${p.dias_restantes} día(s)`})`
                      : p.estado === 'REVOCADO'
                        ? `Revocado ${fecha(p.revocado_at)}`
                        : `Venció el ${p.hasta}`}
                    {p.otorgado_por ? ` · lo dio ${p.otorgado_por}` : ''}
                    {p.nota ? ` · ${p.nota}` : ''}
                  </p>
                </div>
                <Insignia tono={TONO[p.estado]}>{TEXTO[p.estado]}</Insignia>
                {p.estado === 'VIGENTE' && (
                  <Boton variante="secundario" tamano="sm" onClick={() => void revocar(p)} disabled={trabajando} data-revocar-historico>
                    Revocar
                  </Boton>
                )}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </div>
  )
}
