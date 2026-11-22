'use client'

/**
 * AgroMétricas › Parámetros de riego (teléfono primero, sin señal).
 *
 * - Jornada (Hoy / Ayer / otra fecha) y turno (de AGL; solo los de sus zonas). El DDT se calcula.
 * - Lo YA registrado ese turno y día se carga en los campos: se ve y se edita, nunca se borra por error (la base no
 *   borra con un campo vacío; el valor guardado queda como texto gris del campo).
 * - Calicata: fija por ciclo. Se mide UNA vez con el GPS (varias lecturas, se queda la más precisa) y se guarda su
 *   precisión. Medir otra vez solo la mejora si es más precisa.
 * - Foto del día de la calicata (cámara trasera), comprimida y en la cola sin señal.
 * - Fuera de rango = aviso con «Usar 7.97», nunca bloquea. Clima una vez por zona y día.
 * - Al guardar: aviso flotante abajo (se ve aunque se esté al final del formulario).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alerta, AreaTexto, Boton, BotonLink, Campo, Entrada, Insignia, Tarjeta, TarjetaEncabezado, bordeError } from '@/components/ui/Primitivos'
import { Acordeon } from '@/components/ui/Acordeon'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { AvisoFlotante, useAvisoFlotante } from '@/components/ui/AvisoFlotante'
import { createClient } from '@/lib/supabase/client'
import { ayerIso, hoyIso } from '@/lib/fechas/zona'
import { CAMPOS, SECCIONES, ddt, leerNumero, revisar, type Rango } from '@/lib/agrometricas/parametros'
import { calidad, comprimirFoto, medirCalicata, type Medicion } from '@/lib/agrometricas/gps'
import * as Cola from '@/lib/agrometricas/cola'
import { RUTAS_SIN_SENAL } from '@/lib/agrometricas/colaPura'
import { resumirRegistro, unirItems, type EntradaHistorial } from '@/lib/agrometricas/historialPura'
import { MisRegistros } from './MisRegistros'
import { RegistroServiceWorker } from '@/components/fertirriego/RegistroServiceWorker'

type Turno = { id: string; turno: string; temporada: string; ciclo: string | null; fecha_siembra: string | null;
  estacion: string | null; zona_id: string | null; zona: string | null }
type Datos = { turnos: Turno[]; rangos: Rango[]; bajado: string }
type Calicata = { latitud: number; longitud: number; precision_m: number; lecturas: number; medido_en?: string }

const uuid = () => crypto.randomUUID()
/** Lo más grande que cabe en las columnas de agm_parametros / agm_clima (numeric(10,3)). */
const LIMITE = 10_000_000
const texto = (v: unknown) => (v == null ? '' : String(v))

export function FormParametros({ usuarioId, puedeRegistrar }: { usuarioId: string; puedeRegistrar: boolean }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [fecha, setFecha] = useState(hoyIso())
  const [turnoId, setTurnoId] = useState('')
  const [valores, setValores] = useState<Record<string, string>>({})
  const [guardados, setGuardados] = useState<Record<string, string>>({})   // lo que ya está en la base ese día
  const [comentario, setComentario] = useState('')
  const [comentarioGuardado, setComentarioGuardado] = useState('')
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>(() => Object.fromEntries(SECCIONES.map((s) => [s.clave, s.abierta])))
  const [cola, setCola] = useState(0)
  const [ultimo, setUltimo] = useState<string | null>(null)
  const [persistente, setPersistente] = useState<boolean | null>(null)
  const [rechazados, setRechazados] = useState<Cola.Rechazado[]>([])
  const [pendientes, setPendientes] = useState<Cola.Pendiente[]>([])
  const [historial, setHistorial] = useState<EntradaHistorial[]>([])
  const [calicata, setCalicata] = useState<Calicata | null>(null)
  const [midiendo, setMidiendo] = useState<Medicion | 'iniciando' | null>(null)
  const [foto, setFoto] = useState<string | null>(null)
  const [fotoGuardada, setFotoGuardada] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { aviso, mostrar } = useAvisoFlotante()

  // Solo cuenta la lectura MÁS RECIENTE: una lectura vieja que termina tarde no pisa el número actual
  const lecturaCola = useRef(0)
  const refrescarCola = useCallback(async () => {
    const mia = ++lecturaCola.current
    try {
      const [p, r, u, h] = await Promise.all([Cola.pendientes(usuarioId), Cola.rechazados(usuarioId), Cola.ultimoEnvio(usuarioId), Cola.historial(usuarioId)])
      if (mia !== lecturaCola.current) return
      setCola(p.length); setPendientes(p); setRechazados(r); setUltimo(u); setHistorial(h)
    } catch { /* sin almacén local: se muestra lo último conocido */ }
  }, [usuarioId])

  const enviar = useCallback(async () => {
    const n = await Cola.enviar(usuarioId)
    await refrescarCola()
    if (n) mostrar(`${n === 1 ? 'Registro enviado' : `${n} registros enviados`} a la base.`)
  }, [usuarioId, refrescarCola, mostrar])

  // Turnos y rangos: primero lo guardado en el teléfono; después, con señal, lo nuevo de la base
  useEffect(() => {
    Cola.pedirPersistente().then(setPersistente, () => setPersistente(null))   // silencioso: si lo niega, solo se avisa
    Cola.datosGuardados<Datos>(usuarioId).then((d) => setDatos((x) => x ?? d), () => {})
    const primeraLectura = setTimeout(() => { refrescarCola() }, 0)   // fuera del cuerpo del efecto (regla set-state-in-effect)
    createClient().rpc('fn_agm_mis_turnos').then(({ data, error: e }) => {
      if (e || !data) return
      const nuevos = { ...(data as Omit<Datos, 'bajado'>), bajado: new Date().toISOString() }
      Cola.guardarDatos(usuarioId, nuevos)
      setDatos(nuevos)
    }, () => {})
    const primerEnvio = setTimeout(() => { enviar() }, 0)
    const alVolver = () => { enviar() }
    window.addEventListener('online', alVolver)
    return () => { clearTimeout(primerEnvio); clearTimeout(primeraLectura); window.removeEventListener('online', alVolver) }
  }, [usuarioId, refrescarCola, enviar])

  const turno = datos?.turnos.find((t) => t.id === turnoId) ?? null

  // Lo ya registrado ese turno y día (y el clima de su zona, y la calicata del ciclo): se carga para ver y editar
  useEffect(() => {
    if (!turno) return
    let vigente = true
    const supabase = createClient()
    Promise.all([
      supabase.from('agm_parametros').select('*').eq('turno_ciclo_id', turno.id).eq('fecha', fecha).maybeSingle(),
      turno.zona_id ? supabase.from('agm_clima').select('eto,dpv,viento').eq('zona_id', turno.zona_id).eq('fecha', fecha).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('agm_calicatas').select('*').eq('turno_ciclo_id', turno.id).maybeSingle(),
    ]).then(([p, c, k]) => {
      if (!vigente) return
      const fila = { ...(p.data ?? {}), ...(c.data ?? {}) } as Record<string, unknown>
      const previos = Object.fromEntries(CAMPOS.map((x) => [x.clave, texto(fila[x.clave])]).filter(([, v]) => v !== ''))
      setGuardados(previos)
      setValores(previos)
      setComentario(texto(fila.comentario))
      setComentarioGuardado(texto(fila.comentario))
      setFotoGuardada(Boolean(fila.foto_calicata))
      setCalicata((k.data as Calicata | null) ?? null)
    }, () => {})   // sin señal: se trabaja con lo que hay; la base completa sin borrar
    return () => { vigente = false }
  }, [turno, fecha])

  const elegirTurno = (id: string) => {
    setTurnoId(id); setValores({}); setGuardados({}); setComentario(''); setComentarioGuardado(''); setFoto(null); setFotoGuardada(false); setCalicata(null)
  }
  const cambiarFecha = (f: string) => { setFecha(f); setValores({}); setGuardados({}); setComentario(''); setComentarioGuardado(''); setFoto(null); setFotoGuardada(false) }

  const rangos = useMemo(() => new Map((datos?.rangos ?? []).map((r) => [r.parametro, r])), [datos])
  const opciones = useMemo(() => (datos?.turnos ?? []).map((t) => ({
    id: t.id, titulo: t.turno, subtitulo: [t.estacion, t.ciclo, t.temporada].filter(Boolean).join(' · '), grupo: t.zona ?? 'Sin zona',
  })), [datos])
  const dias = turno ? ddt(fecha, turno.fecha_siembra) : null
  const misRegistros = useMemo(() => unirItems(pendientes, rechazados, historial, new Date().toISOString()), [pendientes, rechazados, historial])
  /** Resumen corto del registro (se guarda con él en la cola y luego en el historial local). */
  const vistaDe = (tipo: 'parametros' | 'clima' | 'calicata', d: Record<string, unknown>, t: Turno) =>
    resumirRegistro(tipo, d, { turno: tipo === 'clima' ? `Clima ${t.zona ?? ''}`.trim() : t.turno, lugar: (tipo === 'clima' ? t.zona : t.estacion ?? t.zona) ?? '', ddt: dias, fecha }, CAMPOS)
  const poner = (clave: string, v: string) => setValores((x) => ({ ...x, [clave]: v }))
  const alternar = (clave: string) => setAbiertas((a) => ({ ...a, [clave]: !a[clave] }))
  const llenos = (seccion: string) => CAMPOS.filter((c) => c.seccion === seccion && leerNumero(valores[c.clave] || guardados[c.clave]) != null).length
  const fueraEn = (seccion: string) => CAMPOS.filter((c) => c.seccion === seccion && revisar(leerNumero(valores[c.clave]), rangos.get(c.clave), c).fuera).length

  async function medir() {
    if (!turno) return
    setMidiendo('iniciando')
    try {
      const m = await medirCalicata({ alAvanzar: (x) => setMidiendo(x) })
      if (calicata && m.precision_m >= calicata.precision_m) {
        mostrar(`La ubicación guardada (±${calicata.precision_m} m) es igual o más precisa. Se queda.`, 'info')
        return
      }
      const datosCal = { turno_ciclo_id: turno.id, ...m }
      const guardada = await Cola.encolar(usuarioId, { id: uuid(), tipo: 'calicata', resumen: `Calicata ${turno.turno}`, datos: datosCal, vista: vistaDe('calicata', datosCal, turno) })
      if (!guardada) { mostrar('El teléfono no pudo guardar la ubicación. Libera espacio e intenta otra vez.', 'error'); return }
      setCalicata(m)
      mostrar(`${calicata ? 'Calicata mejorada' : 'Calicata ubicada'}: ±${m.precision_m} m (${calidad(m.precision_m).texto.toLowerCase()}).`)
      refrescarCola()
      enviar()
    } catch (e) {
      mostrar(e instanceof Error ? e.message : 'No se pudo medir.', 'error')
    } finally {
      setMidiendo(null)
    }
  }

  async function tomarFoto(archivo: File | undefined) {
    if (!archivo) return
    try { setFoto(await comprimirFoto(archivo)) } catch { mostrar('No se pudo leer la foto. Intenta otra vez.', 'error') }
  }

  async function guardar() {
    setError(null)
    if (!turno) { setError('Elige el turno.'); return }
    const cambiados = (deClima: boolean) => Object.fromEntries(CAMPOS
      .filter((c) => (c.seccion === 'clima') === deClima)
      .map((c) => [c.clave, leerNumero(valores[c.clave])] as const)
      .filter(([k, v]) => v != null && String(v) !== guardados[k]))
    const numeros = cambiados(false)
    const clima = cambiados(true)
    // Un dedo de más (123456789012) no cabe en la base: se avisa aquí, en español, antes de guardarlo en el teléfono
    const enorme = CAMPOS.find((c) => Math.abs(Number({ ...numeros, ...clima }[c.clave] ?? 0)) >= LIMITE)
    if (enorme) {
      setError(`${enorme.etiqueta}: ${valores[enorme.clave]} es demasiado grande. Revisa la lectura.`)
      return
    }
    // El comentario solo viaja si cambió (el ya guardado se carga en el campo: no es un cambio)
    const nota = comentario.trim() === comentarioGuardado.trim() ? '' : comentario.trim()
    if (!Object.keys(numeros).length && !Object.keys(clima).length && !foto && !nota) {
      mostrar('No hay cambios para guardar.', 'info')
      return
    }
    let cupo = true
    if (Object.keys(numeros).length || foto || nota) {
      const id = uuid()
      const datosP = { id, turno_ciclo_id: turno.id, fecha, ...numeros, comentario: nota || null }
      cupo = await Cola.encolar(usuarioId, { id, tipo: 'parametros', resumen: `${turno.turno} · ${fecha}`,
        datos: datosP, vista: vistaDe('parametros', datosP, turno) }, foto)
    }
    if (cupo && Object.keys(clima).length && turno.zona_id) {
      const id = uuid()
      const datosC = { id, zona_id: turno.zona_id, fecha, ...clima }
      cupo = await Cola.encolar(usuarioId, { id, tipo: 'clima', resumen: `Clima ${turno.zona ?? ''} · ${fecha}`,
        datos: datosC, vista: vistaDe('clima', datosC, turno) })
    }
    if (!cupo) {
      mostrar('El teléfono no tiene espacio para guardar (¿muchas fotos sin enviar?). Busca señal para enviar.', 'error')
      return
    }
    // Lo guardado queda en pantalla para seguir editando: no se limpia nada
    setGuardados((g) => ({ ...g, ...Object.fromEntries(Object.entries({ ...numeros, ...clima }).map(([k, v]) => [k, String(v)])) }))
    if (nota) setComentarioGuardado(nota)
    if (foto) { setFoto(null); setFotoGuardada(true) }
    mostrar(navigator.onLine ? `Registrado: ${turno.turno} · ${fecha}` : 'Registrado en el teléfono. Se enviará al volver la señal.')
    refrescarCola()
    enviar()
  }

  async function exportarPendientes() {
    try {
      const json = await Cola.exportarPendientes(usuarioId)
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `agrometricas_pendientes_${hoyIso()}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      mostrar('No se pudo exportar. Intenta otra vez.', 'error')
    }
  }

  const enMedicion = midiendo && midiendo !== 'iniciando' ? midiendo : null

  return (
    <>
      <RegistroServiceWorker rutas={RUTAS_SIN_SENAL} />
      <BotonLink href="/agrometricas" variante="secundario" tamano="md" className="self-start">← AgroMétricas</BotonLink>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-900">Parámetros de riego</h1>
          <p className="text-sm text-slate-500">
            {datos?.bajado ? `Turnos al ${new Date(datos.bajado).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'short', timeStyle: 'short' })}` : 'Cargando turnos…'}
          </p>
        </div>
        <span data-estado-cola className="shrink-0"><Insignia tono={cola ? 'ambar' : 'verde'} punto>{cola ? `${cola} ${cola === 1 ? 'pendiente' : 'pendientes'} de enviar` : 'Todo enviado'}</Insignia></span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2" data-envio>
        <p className="text-sm text-slate-500">
          {ultimo ? `Último envío: ${new Date(ultimo).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'short', timeStyle: 'short' })}` : 'Aún no se ha enviado nada desde este teléfono.'}
        </p>
        {cola > 0 && <Boton type="button" tamano="md" variante="secundario" onClick={exportarPendientes} data-exportar-pendientes>Exportar pendientes</Boton>}
      </div>
      {persistente === false && <Alerta tono="ambar">El teléfono no garantiza conservar lo guardado si se queda sin espacio. Envía los registros apenas tengas señal.</Alerta>}

      {rechazados.map((r) => (
        <Alerta key={r.id} tono="rojo">
          No se guardó {r.resumen}: {r.mensaje}{' '}
          <button className="font-semibold underline" onClick={async () => { await Cola.descartarRechazado(usuarioId, r.id); refrescarCola() }}>Quitar aviso</button>
        </Alerta>
      ))}
      {!puedeRegistrar && <Alerta tono="ambar">Puedes ver, pero no registrar parámetros. Pídelo a tu jefe de zona.</Alerta>}

      <Tarjeta>
        <TarjetaEncabezado titulo="Jornada y turno" />
        <div className="flex flex-col gap-3 p-4">
          <Campo etiqueta="Jornada" requerido>
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Boton type="button" tamano="lg" variante={fecha === hoyIso() ? 'primario' : 'secundario'} onClick={() => cambiarFecha(hoyIso())}>Hoy</Boton>
                <Boton type="button" tamano="lg" variante={fecha === ayerIso() ? 'primario' : 'secundario'} onClick={() => cambiarFecha(ayerIso())}>Ayer</Boton>
              </div>
              <Entrada type="date" value={fecha} max={hoyIso()} onChange={(e) => e.target.value && cambiarFecha(e.target.value)}
                className="h-12 w-full text-base" aria-label="Otra fecha" />
            </div>
          </Campo>
          <Campo etiqueta="Turno" requerido>
            <SelectorBuscable valor={turnoId} opciones={opciones} onCambiar={elegirTurno} placeholder="Elige el turno…"
              etiquetaBusqueda="Buscar turno o estación…" permitirVacio={false} />
          </Campo>
          {turno && (
            <div className="flex flex-wrap items-center gap-2" data-ddt>
              <Insignia tono="verde">DDT {dias ?? '—'}</Insignia>
              <Insignia tono="gris">{turno.estacion ?? 'Sin estación'}</Insignia>
              <Insignia tono="gris">{turno.zona ?? 'Sin zona'}</Insignia>
              {Object.keys(guardados).length > 0 && <Insignia tono="azul">Ya registrado: se puede editar</Insignia>}
            </div>
          )}
        </div>
      </Tarjeta>

      {turno && (
        <Tarjeta>
          <TarjetaEncabezado titulo="Calicata del ciclo"
            accion={calicata ? <Insignia tono={calidad(calicata.precision_m).tono} punto>±{calicata.precision_m} m</Insignia> : undefined} />
          <div className="flex flex-col gap-3 p-4" data-calicata>
            <p className="text-sm text-slate-600">
              {calicata
                ? `Ubicada (${calidad(calicata.precision_m).texto.toLowerCase()}): ${Number(calicata.latitud).toFixed(6)}, ${Number(calicata.longitud).toFixed(6)}. Es fija todo el ciclo; medir otra vez solo la mejora si sale más precisa.`
                : 'Párate junto a la calicata, a cielo abierto, y mide. Se ubica una sola vez por ciclo.'}
            </p>
            {midiendo && (
              <p className="text-sm font-semibold text-slate-700" role="status">
                {enMedicion ? `Midiendo… mejor precisión ±${enMedicion.precision_m} m (${enMedicion.lecturas} lecturas)` : 'Buscando señal del GPS…'}
              </p>
            )}
            <Boton type="button" tamano="lg" variante={calicata ? 'secundario' : 'primario'} disabled={!puedeRegistrar || Boolean(midiendo)} onClick={medir}>
              {midiendo ? 'Midiendo…' : calicata ? 'Medir otra vez (mejorar precisión)' : 'Ubicar calicata con GPS'}
            </Boton>
            <label className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 text-center text-base font-semibold ${foto ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-700'}`}>
              <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={!puedeRegistrar} data-foto
                onChange={(e) => { tomarFoto(e.target.files?.[0]); e.target.value = '' }} />
              {foto ? 'Foto lista · tocar para cambiarla' : fotoGuardada ? 'Foto del día guardada · tomar otra' : 'Tomar foto de la calicata'}
            </label>
            {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (data URL), no una imagen del sitio */}
            {foto && <img src={foto} alt="Foto de la calicata" className="max-h-48 w-full rounded-xl object-cover" />}
          </div>
        </Tarjeta>
      )}

      {SECCIONES.map((s) => (
        <Acordeon key={s.clave} titulo={s.titulo} abierto={Boolean(abiertas[s.clave])} onAlternar={() => alternar(s.clave)}
          resumen={llenos(s.clave) ? <Insignia tono="azul">{llenos(s.clave)} con dato</Insignia> : undefined}
          aviso={fueraEn(s.clave) ? `${fueraEn(s.clave)} fuera de rango` : null}>
          <div className="grid grid-cols-2 gap-3 px-3.5 pb-4">
            {CAMPOS.filter((c) => c.seccion === s.clave).map((c) => {
              const r = revisar(leerNumero(valores[c.clave]), rangos.get(c.clave), c)
              return (
                <Campo key={c.clave} etiqueta={c.unidad ? `${c.etiqueta} (${c.unidad})` : c.etiqueta} error={r.fuera ? r.mensaje : null}>
                  <Entrada inputMode="decimal" enterKeyHint="next" autoComplete="off" data-campo={c.clave}
                    placeholder={guardados[c.clave] ? `Guardado: ${guardados[c.clave]}` : undefined}
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

      <MisRegistros items={misRegistros} />
      <div className="h-20" aria-hidden />   {/* que la barra fija de Guardar no tape «Mis registros» */}

      <AvisoFlotante aviso={aviso} />
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-2xl">
          <Boton type="button" tamano="lg" className="w-full" disabled={!puedeRegistrar} onClick={guardar} data-guardar>Guardar</Boton>
        </div>
      </div>
    </>
  )
}
