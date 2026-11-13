'use client'

/**
 * AgroMétricas › Parámetros de riego (teléfono primero, sin señal).
 * Se elige la jornada (hoy / ayer / otra) y el turno (de AGL); el DDT se calcula. Secciones plegables con lo diario
 * arriba (tensiómetros). Fuera de rango = aviso con «¿quisiste decir…?», nunca bloquea. Guardar pone el registro en
 * la cola del teléfono y lo envía cuando hay señal (lib/agrometricas/cola.ts). El clima va una vez por zona y día.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alerta, AreaTexto, Boton, Campo, Entrada, Insignia, Tarjeta, TarjetaEncabezado, bordeError } from '@/components/ui/Primitivos'
import { Acordeon } from '@/components/ui/Acordeon'
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

  const cerrar = (clave: string) => setAbiertas((a) => ({ ...a, [clave]: !a[clave] }))
  const llenos = (seccion: string) => CAMPOS.filter((c) => c.seccion === seccion && leerNumero(valores[c.clave]) != null).length
  const fueraEn = (seccion: string) => CAMPOS.filter((c) => c.seccion === seccion && revisar(leerNumero(valores[c.clave]), rangos.get(c.clave), c).fuera).length

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Parámetros de riego</h1>
          <p className="text-sm text-slate-500">
            {datos?.bajado ? `Turnos al ${new Date(datos.bajado).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'short', timeStyle: 'short' })}` : 'Cargando turnos…'}
          </p>
        </div>
        <span data-estado-cola><Insignia tono={cola ? 'ambar' : 'verde'} punto>{cola ? `${cola} por enviar` : 'Todo enviado'}</Insignia></span>
      </div>

      {aviso && <Alerta tono="azul">{aviso}</Alerta>}
      {rechazados.map((r) => (
        <Alerta key={r.id} tono="rojo">
          No se guardó {r.resumen}: {r.mensaje}{' '}
          <button className="font-semibold underline" onClick={() => { Cola.descartarRechazado(usuarioId, r.id); refrescarCola() }}>Quitar aviso</button>
        </Alerta>
      ))}
      {!puedeRegistrar && <Alerta tono="ambar">Puedes ver, pero no registrar parámetros. Pídelo a tu jefe de zona.</Alerta>}

      <Tarjeta>
        <TarjetaEncabezado titulo="Jornada y turno" />
        <div className="flex flex-col gap-3 p-4">
          <Campo etiqueta="Jornada" requerido>
            <div className="grid grid-cols-3 gap-2">
              <Boton type="button" tamano="lg" variante={fecha === hoyIso() ? 'primario' : 'secundario'} onClick={() => setFecha(hoyIso())}>Hoy</Boton>
              <Boton type="button" tamano="lg" variante={fecha === ayerIso() ? 'primario' : 'secundario'} onClick={() => setFecha(ayerIso())}>Ayer</Boton>
              <Entrada type="date" value={fecha} max={hoyIso()} onChange={(e) => e.target.value && setFecha(e.target.value)}
                className="h-13 text-base" aria-label="Otra fecha" />
            </div>
          </Campo>
          <Campo etiqueta="Turno" requerido>
            <SelectorBuscable valor={turnoId} opciones={opciones} onCambiar={setTurnoId} placeholder="Elige el turno…"
              etiquetaBusqueda="Buscar turno o estación…" permitirVacio={false} />
          </Campo>
          {turno && (
            <div className="flex flex-wrap items-center gap-2" data-ddt>
              <Insignia tono="verde">DDT {dias ?? '—'}</Insignia>
              <Insignia tono="gris">{turno.estacion ?? 'Sin estación'}</Insignia>
              <Insignia tono="gris">{turno.zona ?? 'Sin zona'}</Insignia>
              <span className="text-xs text-slate-500">{[turno.ciclo, turno.temporada].filter(Boolean).join(' · ')}</span>
            </div>
          )}
        </div>
      </Tarjeta>

      {SECCIONES.map((s) => (
        <Acordeon key={s.clave} titulo={s.titulo} abierto={Boolean(abiertas[s.clave])} onAlternar={() => cerrar(s.clave)}
          resumen={llenos(s.clave) ? <Insignia tono="azul">{llenos(s.clave)} con dato</Insignia> : undefined}
          aviso={fueraEn(s.clave) ? `${fueraEn(s.clave)} fuera de rango` : null}>
          <div className="grid grid-cols-2 gap-3 px-3.5 pb-4">
            {CAMPOS.filter((c) => c.seccion === s.clave).map((c) => {
              const r = revisar(leerNumero(valores[c.clave]), rangos.get(c.clave), c)
              return (
                <Campo key={c.clave} etiqueta={c.unidad ? `${c.etiqueta} (${c.unidad})` : c.etiqueta} error={r.fuera ? r.mensaje : null}>
                  <Entrada inputMode="decimal" enterKeyHint="next" autoComplete="off" data-campo={c.clave}
                    className={`h-12 text-base tabular-nums ${bordeError(r.fuera)}`} value={valores[c.clave] ?? ''}
                    onChange={(e) => poner(c.clave, e.target.value)} />
                  {r.sugerencia != null && (
                    <button type="button" className="mt-1 text-sm font-semibold text-emerald-700 underline" onClick={() => poner(c.clave, String(r.sugerencia))}>
                      Usar {r.sugerencia}
                    </button>
                  )}
                </Campo>
              )
            })}
          </div>
        </Acordeon>
      ))}

      <Tarjeta>
        <div className="p-4">
          <Campo etiqueta="Comentario">
            <AreaTexto rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} />
          </Campo>
        </div>
      </Tarjeta>
      {error && <Alerta tono="rojo">{error}</Alerta>}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-2xl">
          <Boton type="button" tamano="lg" className="w-full" disabled={!puedeRegistrar} onClick={guardar} data-guardar>Guardar</Boton>
        </div>
      </div>
    </>
  )
}
