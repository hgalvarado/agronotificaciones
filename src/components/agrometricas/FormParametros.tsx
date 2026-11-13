'use client'

/**
 * AgroMétricas › Parámetros de riego (teléfono primero, sin señal).
 * Se elige la jornada (hoy / ayer / otra) y el turno (de AGL); el DDT se calcula. Secciones plegables con lo diario
 * arriba (tensiómetros). Fuera de rango = aviso con «¿quisiste decir…?», nunca bloquea. Guardar pone el registro en
 * la cola del teléfono y lo envía cuando hay señal (lib/agrometricas/cola.ts). El clima va una vez por zona y día.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Boton, Campo, Entrada, AreaTexto, Alerta } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { createClient } from '@/lib/supabase/client'
import { ayerIso, hoyIso } from '@/lib/fechas/zona'
import { CAMPOS, SECCIONES, ddt, leerNumero, revisar, type Rango } from '@/lib/agrometricas/parametros'
import * as Cola from '@/lib/agrometricas/cola'

type Turno = { id: string; turno: string; temporada: string; ciclo: string | null; fecha_siembra: string | null;
  estacion: string | null; zona_id: string | null; zona: string | null }
type Datos = { turnos: Turno[]; rangos: Rango[]; bajado: string }

const uuid = () => crypto.randomUUID()

export function FormParametros({ usuarioId, puedeRegistrar }: { usuarioId: string; puedeRegistrar: boolean }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [fecha, setFecha] = useState(hoyIso())
  const [turnoId, setTurnoId] = useState('')
  const [valores, setValores] = useState<Record<string, string>>({})
  const [comentario, setComentario] = useState('')
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>(() => Object.fromEntries(SECCIONES.map((s) => [s.clave, s.abierta])))
  const [cola, setCola] = useState(0)
  const [rechazados, setRechazados] = useState<Cola.Rechazado[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refrescarCola = useCallback(() => {
    setCola(Cola.pendientes(usuarioId).length)
    setRechazados(Cola.rechazados(usuarioId))
  }, [usuarioId])

  const enviar = useCallback(async () => {
    const n = await Cola.enviar(usuarioId)
    refrescarCola()
    if (n) setAviso(`${n} registro(s) enviado(s).`)
  }, [usuarioId, refrescarCola])

  // Datos: primero lo guardado en el teléfono; después, si hay señal, lo nuevo de la base
  useEffect(() => {
    // Lo guardado en el teléfono se lee después del primer pintado (localStorage no existe en el servidor)
    Promise.resolve().then(() => {
      setDatos((d) => d ?? Cola.datosGuardados<Datos>(usuarioId))
      refrescarCola()
    })
    createClient().rpc('fn_agm_mis_turnos').then(({ data, error: e }) => {
      if (e || !data) return
      const nuevos = { ...(data as Omit<Datos, 'bajado'>), bajado: new Date().toISOString() }
      Cola.guardarDatos(usuarioId, nuevos)
      setDatos(nuevos)
    }, () => {})
    const primerEnvio = setTimeout(() => { enviar() }, 0)
    const alVolver = () => { enviar() }
    window.addEventListener('online', alVolver)
    return () => { clearTimeout(primerEnvio); window.removeEventListener('online', alVolver) }
  }, [usuarioId, refrescarCola, enviar])

  const turno = datos?.turnos.find((t) => t.id === turnoId) ?? null
  const rangos = useMemo(() => new Map((datos?.rangos ?? []).map((r) => [r.parametro, r])), [datos])
  const opciones = useMemo(() => (datos?.turnos ?? []).map((t) => ({
    id: t.id, titulo: t.turno, subtitulo: [t.estacion, t.ciclo, t.temporada].filter(Boolean).join(' · '), grupo: t.zona ?? 'Sin zona',
  })), [datos])
  const dias = turno ? ddt(fecha, turno.fecha_siembra) : null

  const poner = (clave: string, v: string) => setValores((x) => ({ ...x, [clave]: v }))

  function guardar() {
    setError(null)
    if (!turno) { setError('Elige el turno.'); return }
    const numeros = Object.fromEntries(CAMPOS.filter((c) => c.seccion !== 'clima')
      .map((c) => [c.clave, leerNumero(valores[c.clave])]).filter(([, v]) => v != null))
    const clima = Object.fromEntries(CAMPOS.filter((c) => c.seccion === 'clima')
      .map((c) => [c.clave, leerNumero(valores[c.clave])]).filter(([, v]) => v != null))
    if (!Object.keys(numeros).length && !Object.keys(clima).length && !comentario.trim()) {
      setError('No hay ningún dato para guardar.'); return
    }
    if (Object.keys(numeros).length || comentario.trim()) {
      Cola.encolar(usuarioId, { id: uuid(), tipo: 'parametros', resumen: `${turno.turno} · ${fecha}`,
        datos: { id: uuid(), turno_ciclo_id: turno.id, fecha, ...numeros, comentario: comentario.trim() || null } })
    }
    if (Object.keys(clima).length && turno.zona_id) {
      Cola.encolar(usuarioId, { id: uuid(), tipo: 'clima', resumen: `Clima ${turno.zona ?? ''} · ${fecha}`,
        datos: { id: uuid(), zona_id: turno.zona_id, fecha, ...clima } })
    }
    setValores({})
    setComentario('')
    setAviso(navigator.onLine ? 'Guardado. Enviando…' : 'Guardado en el teléfono. Se enviará al volver la señal.')
    refrescarCola()
    enviar()
  }

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Parámetros de riego</h1>
        <p className="text-sm opacity-75" data-estado-cola>
          {cola ? `${cola} por enviar` : 'Todo enviado'}
          {datos?.bajado ? ` · turnos al ${new Date(datos.bajado).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'short', timeStyle: 'short' })}` : ''}
        </p>
      </header>

      {aviso && <Alerta tono="azul">{aviso}</Alerta>}
      {rechazados.map((r) => (
        <Alerta key={r.id} tono="rojo">
          No se guardó {r.resumen}: {r.mensaje}{' '}
          <button className="underline" onClick={() => { Cola.descartarRechazado(usuarioId, r.id); refrescarCola() }}>Quitar aviso</button>
        </Alerta>
      ))}
      {!puedeRegistrar && <Alerta tono="ambar">Puedes ver, pero no registrar parámetros (pídelo a tu jefe de zona).</Alerta>}
      {datos === null && <p className="text-sm opacity-75">Cargando turnos… (la primera vez necesita señal)</p>}

      <div className="flex flex-col gap-3 rounded-2xl border border-gray-400/30 p-3">
        <Campo etiqueta="Jornada" requerido>
          <div className="flex flex-wrap gap-2">
            <Boton type="button" tamano="lg" variante={fecha === hoyIso() ? 'primario' : 'secundario'} onClick={() => setFecha(hoyIso())}>Hoy</Boton>
            <Boton type="button" tamano="lg" variante={fecha === ayerIso() ? 'primario' : 'secundario'} onClick={() => setFecha(ayerIso())}>Ayer</Boton>
            <Entrada type="date" value={fecha} max={hoyIso()} onChange={(e) => e.target.value && setFecha(e.target.value)}
              className="h-13 min-w-40 flex-1 text-base" aria-label="Otra fecha" />
          </div>
        </Campo>
        <Campo etiqueta="Turno" requerido>
          <SelectorBuscable valor={turnoId} opciones={opciones} onCambiar={setTurnoId} placeholder="Elige el turno…"
            etiquetaBusqueda="Buscar turno o estación…" permitirVacio={false} />
        </Campo>
        {turno && (
          <p className="text-sm" data-ddt>
            <strong>DDT {dias ?? '—'}</strong> · {turno.estacion ?? 'Sin estación'} · {turno.zona ?? ''} · {turno.temporada}
          </p>
        )}
      </div>

      {SECCIONES.map((s) => (
        <section key={s.clave} className="rounded-2xl border border-gray-400/30">
          <button type="button" className="flex min-h-13 w-full items-center justify-between px-4 text-left text-base font-semibold"
            aria-expanded={abiertas[s.clave]} onClick={() => setAbiertas((a) => ({ ...a, [s.clave]: !a[s.clave] }))}>
            {s.titulo}<span aria-hidden>{abiertas[s.clave] ? '▾' : '▸'}</span>
          </button>
          {abiertas[s.clave] && (
            <div className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2">
              {CAMPOS.filter((c) => c.seccion === s.clave).map((c) => {
                const r = revisar(leerNumero(valores[c.clave]), rangos.get(c.clave), c)
                return (
                  <Campo key={c.clave} etiqueta={c.unidad ? `${c.etiqueta} (${c.unidad})` : c.etiqueta}>
                    <Entrada inputMode="decimal" enterKeyHint="next" autoComplete="off" data-campo={c.clave}
                      className="h-13 text-lg" value={valores[c.clave] ?? ''} onChange={(e) => poner(c.clave, e.target.value)} />
                    {r.fuera && (
                      <p className="mt-1 text-sm text-amber-700 dark:text-amber-400" role="status">
                        {r.mensaje}{' '}
                        {r.sugerencia != null && (
                          <button type="button" className="font-semibold underline" onClick={() => poner(c.clave, String(r.sugerencia))}>
                            Usar {r.sugerencia}
                          </button>
                        )}
                      </p>
                    )}
                  </Campo>
                )
              })}
              {s.clave === 'suelo' && (
                <p className="text-sm opacity-75 sm:col-span-2">La foto de la calicata se agrega en la siguiente versión.</p>
              )}
            </div>
          )}
        </section>
      ))}

      <Campo etiqueta="Comentario">
        <AreaTexto rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} />
      </Campo>
      {error && <Alerta tono="rojo">{error}</Alerta>}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-400/30 bg-[var(--c-superficie,white)] p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-2xl">
          <Boton type="button" tamano="lg" className="w-full" disabled={!puedeRegistrar} onClick={guardar} data-guardar>Guardar</Boton>
        </div>
      </div>
    </>
  )
}
