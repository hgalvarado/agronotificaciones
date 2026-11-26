'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Insignia, ListaEsqueleto, Tarjeta, type Tono } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { AvisoFlotante, useAvisoFlotante } from '@/components/ui/AvisoFlotante'
import { TIPOS_ALERTA, haceCuanto, nombreTipo } from '@/lib/alertas/destinos'

type Destinatario = { perfil: string | null; resultado: string; detalle: string | null; at: string }
type EnvioAlerta = { id: string; titulo: string; tipo: string; gravedad: string; creada_at: string; notificada_at: string | null; estado: string; destinatarios: Destinatario[] }
type Susc = { perfil_id: string; perfil: string; dispositivos: { id: string; agente: string | null; ultima_ok_at: string | null; creada_at: string }[] }
type Silencio = { id: string; tipo: string | null; estacion_id: string | null; estacion: string | null; hasta: string; nota: string | null }
type Control = { envios: EnvioAlerta[]; suscripciones: Susc[]; silencios: Silencio[]; preferencias_apagadas: { perfil: string; tipo: string }[] }

const TONO: Record<string, Tono> = { enviado: 'verde', fallo: 'rojo', sin_dispositivo: 'ambar', omitido_pref: 'gris', silenciada: 'gris' }
const TEXTO: Record<string, string> = { enviado: 'Entregado', fallo: 'Falló', sin_dispositivo: 'Sin teléfono', omitido_pref: 'Lo apagó', silenciada: 'Silenciada' }
const HORAS: { id: string; texto: string }[] = [
  { id: '1', texto: '1 hora' },
  { id: '8', texto: '8 horas' },
  { id: '24', texto: '1 día' },
  { id: '168', texto: '7 días' },
]

/** Control de alertas (alcance «Todas»): a quién llegó, quién no tiene teléfono, reenviar, silenciar. */
export function ControlAlertas() {
  const supabase = useMemo(() => createClient(), [])
  const [datos, setDatos] = useState<Control | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tipo, setTipo] = useState('')
  const [horas, setHoras] = useState('8')
  const [verDestino, setVerDestino] = useState<string | null>(null)
  const { aviso, mostrar } = useAvisoFlotante()

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('fn_alertas_control')
    if (e) return setError('No se pudo cargar el Control.')
    setError(null)
    setDatos(data as Control)
  }, [supabase])

  // bucle-ok: una sola carga al abrir; el resto es a demanda (acciones y «Actualizar»)
  useEffect(() => {
    const t = setTimeout(() => void cargar(), 0) // bucle-ok: una sola carga al abrir
    return () => clearTimeout(t)
  }, [cargar])

  async function accion(f: () => PromiseLike<{ error: unknown }>, ok: string) {
    const { error: e } = await f()
    if (e) return mostrar('No se pudo. Intenta de nuevo.', 'error')
    mostrar(ok)
    await cargar()
  }

  if (!datos && !error) return <ListaEsqueleto filas={4} />
  if (!datos) return <Alerta tono="ambar">{error}</Alerta>

  const sinTelefono = datos.suscripciones.filter((s) => s.dispositivos.length === 0)
  const conTelefono = datos.suscripciones.filter((s) => s.dispositivos.length > 0)

  return (
    <div className="flex flex-col gap-3" data-control-alertas>
      <div className="flex justify-end">
        <Boton variante="fantasma" tamano="sm" className="min-h-11" onClick={() => void cargar()}>
          Actualizar
        </Boton>
      </div>

      <Tarjeta className="p-3">
        <p className="text-sm font-bold text-slate-900">Sin teléfono activado · {sinTelefono.length}</p>
        <p className="text-xs text-slate-500">Tienen el permiso pero no reciben avisos. Pídeles que activen «Mi teléfono».</p>
        <p className="mt-2 text-sm text-slate-700" data-sin-telefono>{sinTelefono.length ? sinTelefono.map((s) => s.perfil).join(' · ') : 'Todos tienen teléfono.'}</p>
      </Tarjeta>

      <Tarjeta className="p-3">
        <p className="text-sm font-bold text-slate-900">Teléfonos activos · {conTelefono.length} personas</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm text-slate-700">
          {conTelefono.map((s) => (
            <li key={s.perfil_id}>
              <span className="font-semibold">{s.perfil}</span> · {s.dispositivos.length}{' '}
              <span className="text-xs text-slate-500">
                {s.dispositivos.map((d) => (d.agente ?? '').replace(/^Mozilla\/5\.0 \(([^)]*)\).*/, '$1').slice(0, 40) || 'teléfono').join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      </Tarjeta>

      <Tarjeta className="p-3">
        <p className="text-sm font-bold text-slate-900">Silenciar</p>
        <p className="text-xs text-slate-500">Pausa un tipo de alerta por un tiempo. La alerta se crea, pero no suena.</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <SelectorBuscable
            valor={tipo}
            opciones={TIPOS_ALERTA.map((t) => ({ id: t.id, titulo: t.nombre }))}
            onCambiar={setTipo}
            placeholder="Elegir tipo…"
            etiquetaBusqueda="Buscar tipo"
          />
          <SelectorBuscable valor={horas} opciones={HORAS.map((h) => ({ id: h.id, titulo: h.texto }))} onCambiar={setHoras} placeholder="Por cuánto…" etiquetaBusqueda="Buscar" />
        </div>
        <Boton className="mt-2 min-h-11" disabled={!tipo} onClick={() => void accion(() => supabase.rpc('fn_alerta_silenciar', { p_tipo: tipo, p_estacion: null, p_horas: Number(horas), p_nota: null }), 'Silenciado.')}>
          Silenciar
        </Boton>
        {datos.silencios.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5" data-silencios>
            {datos.silencios.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-sm text-slate-700">
                <span>
                  {s.tipo ? nombreTipo(s.tipo) : ''}
                  {s.estacion ? ` · ${s.estacion}` : ''} <span className="text-xs text-slate-500">hasta {new Date(s.hasta).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'short', timeStyle: 'short' })}</span>
                </span>
                <Boton variante="fantasma" tamano="sm" className="min-h-11" onClick={() => void accion(() => supabase.rpc('fn_alerta_quitar_silencio', { p_id: s.id }), 'Quitado.')}>
                  Quitar
                </Boton>
              </li>
            ))}
          </ul>
        )}
        {datos.preferencias_apagadas.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Apagaron tipos: {datos.preferencias_apagadas.map((p) => `${p.perfil} (${nombreTipo(p.tipo)})`).join(' · ')}
          </p>
        )}
      </Tarjeta>

      <p className="px-1 text-sm font-bold text-slate-900">Últimas alertas y a quién llegaron</p>
      <ul className="flex flex-col gap-2">
        {datos.envios.map((a) => {
          const por = a.destinatarios.reduce<Record<string, number>>((m, d) => ({ ...m, [d.resultado]: (m[d.resultado] ?? 0) + 1 }), {})
          return (
            <li key={a.id} data-envio-alerta={a.id} className="rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200">
              <p className="text-sm font-semibold text-slate-900">{a.titulo}</p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <span>{nombreTipo(a.tipo)}</span>
                <span>· {haceCuanto(a.creada_at)}</span>
                {a.estado !== 'abierta' && <Insignia tono="gris">{a.estado === 'atendida' ? 'Atendida' : 'Resuelta'}</Insignia>}
                {!a.notificada_at && a.estado === 'abierta' && <Insignia tono="ambar">Por avisar</Insignia>}
                {Object.entries(por).map(([r, n]) => (
                  <Insignia key={r} tono={TONO[r] ?? 'gris'}>
                    {TEXTO[r] ?? r} · {n}
                  </Insignia>
                ))}
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {a.destinatarios.length > 0 && (
                  <Boton variante="fantasma" tamano="sm" className="min-h-11" onClick={() => setVerDestino(verDestino === a.id ? null : a.id)}>
                    {verDestino === a.id ? 'Ocultar detalle' : 'Ver a quién'}
                  </Boton>
                )}
                {a.estado === 'abierta' && (
                  <Boton variante="secundario" tamano="sm" className="min-h-11" onClick={() => void accion(() => supabase.rpc('fn_alerta_reenviar', { p_id: a.id }), 'Se reenvía en breve.')}>
                    Reenviar
                  </Boton>
                )}
              </div>
              {verDestino === a.id && (
                <ul className="mt-1 flex flex-col gap-1 text-xs text-slate-600">
                  {a.destinatarios.map((d, i) => (
                    <li key={i}>
                      {d.perfil ?? 'Todos'} · {TEXTO[d.resultado] ?? d.resultado}
                      {d.detalle ? ` · ${d.detalle}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
        {datos.envios.length === 0 && <li className="px-1 text-sm text-slate-500">Todavía no hay alertas.</li>}
      </ul>
      <AvisoFlotante aviso={aviso} />
    </div>
  )
}
