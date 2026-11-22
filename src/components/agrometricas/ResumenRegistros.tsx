'use client'

/**
 * AgroMétricas › Registros de la temporada › «Resumen» (el de AGL, para el teléfono y el escritorio): tarjetas, mapa de calor
 * turnos × días, líneas contra el DDT y turnos al mismo DDT, de CE, pH, tensiómetros, cloro, horas de riego y % de fertilización.
 * Sin «Normal histórico» (aún no hay rangos). EN LÍNEA: pide los registros del rango a fn_agm_mis_registros (la base decide qué ve
 * cada persona) y calcula aquí; no hay función de agregado (≤ 10 000 filas por consulta).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alerta, Boton, Campo, Entrada, ListaEsqueleto, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorMultiple, type OpcionSelector } from '@/components/ui/SelectorMultiple'
import { useMemoria } from '@/lib/memoria/useMemoria'
import { createClient } from '@/lib/supabase/client'
import { hoyIso } from '@/lib/fechas/zona'
import { nombreZona, unirPagina, type Registro } from '@/lib/agrometricas/registrosPura'
import {
  FILTROS_RESUMEN_VACIOS, MAX_PAGINAS_RESUMEN, PARAMETROS_RESUMEN, armarResumen, campoDe, etiquetaCiclo, filtrarResumen,
  parametroDe, paramsResumen, rangoEfectivo, type FiltrosResumen,
} from '@/lib/agrometricas/resumenPura'
import { BarrasDdt, LineasDdt, MapaCalor } from './GraficasResumen'

interface LoteVisible { lote: string; nombre: string | null; turnos: string[] }
interface TurnoCatalogo { turno: string; zona_id: string | null; zona: string | null }

const MSG_SIN_CONEXION = 'Esta pantalla necesita conexión. Lo que guardaste en este teléfono sin enviar sigue en Parámetros de riego › Mis registros.'
const mensaje = (e: unknown) => (e instanceof Error && e.message && !/failed to fetch|network/i.test(e.message) ? e.message : MSG_SIN_CONEXION)
const cabecera = 'text-xs font-semibold uppercase tracking-wide text-slate-500'

function Seccion({ titulo, nota, children, dato }: { titulo: string; nota?: string; children: ReactNode; dato: string }) {
  return (
    <Tarjeta className="p-3.5">
      <section data-resumen-seccion={dato} className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
        {nota && <p className="text-xs text-slate-500">{nota}</p>}
        {children}
      </section>
    </Tarjeta>
  )
}

export function ResumenRegistros() {
  const [filtros, setFiltros, lista] = useMemoria<FiltrosResumen>('agrometricas:registros:resumen', FILTROS_RESUMEN_VACIOS)
  const [registros, setRegistros] = useState<Registro[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lotes, setLotes] = useState<LoteVisible[]>([])
  const [catalogo, setCatalogo] = useState<TurnoCatalogo[]>([])
  const lectura = useRef(0)
  const hoy = hoyIso()

  const cargar = useCallback(async (f: FiltrosResumen) => {
    const mia = ++lectura.current
    setCargando(true); setError(null)
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error(MSG_SIN_CONEXION)
      const supabase = createClient()
      let acumulado: Registro[] = []
      for (let pag = 0; pag < MAX_PAGINAS_RESUMEN; pag++) {
        const { data, error: e } = await supabase.rpc('fn_agm_mis_registros', { p: paramsResumen(f, pag, hoyIso()) })
        if (mia !== lectura.current) return
        if (e) throw new Error(e.message)
        const r = data as { total: number; registros: Registro[] }
        acumulado = unirPagina(acumulado, r.registros)
        if (acumulado.length >= r.total || !r.registros.length) break
      }
      setRegistros(acumulado)
    } catch (e) {
      if (mia === lectura.current) setError(mensaje(e))
    } finally {
      if (mia === lectura.current) setCargando(false)
    }
  }, [])

  // Parámetro y medida no cambian la consulta: solo rango, zona única y lotes (lo demás se recorta aquí)
  const clave = JSON.stringify(paramsResumen(filtros, 0, hoy))
  useEffect(() => {
    if (!lista) return
    const t = setTimeout(() => { cargar(filtros) }, 0)
    const alVolver = () => { cargar(filtros) }
    window.addEventListener('online', alVolver)
    return () => { clearTimeout(t); window.removeEventListener('online', alVolver) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la consulta depende solo de `clave`
  }, [lista, clave, cargar])

  useEffect(() => {
    const supabase = createClient()
    supabase.rpc('fn_agm_lotes_visibles').then(({ data }) => { if (Array.isArray(data)) setLotes(data as LoteVisible[]) }, () => {})
    supabase.rpc('fn_agm_mis_turnos').then(({ data }) => { setCatalogo(((data as { turnos?: TurnoCatalogo[] } | null)?.turnos) ?? []) }, () => {})
  }, [])

  const rango = rangoEfectivo(filtros, hoy)
  const parametro = parametroDe(filtros.parametro)
  const campo = campoDe(filtros.parametro, filtros.medida)
  const medida = parametro.medidas.find((m) => m.campo === campo) ?? parametro.medidas[0]

  const filtrados = useMemo(() => filtrarResumen(registros, filtros), [registros, filtros])
  const resumen = useMemo(
    () => armarResumen(filtrados, { hoy, desde: rango.desde, hasta: rango.hasta, parametro: filtros.parametro, medida: filtros.medida, turnos: filtros.turno }),
    [filtrados, hoy, rango.desde, rango.hasta, filtros.parametro, filtros.medida, filtros.turno])

  const turnosDeLotes = useMemo(
    () => [...new Set(lotes.filter((l) => filtros.lotes.includes(l.lote)).flatMap((l) => l.turnos))].sort(), [lotes, filtros.lotes])

  const opciones = useMemo(() => {
    const mapa = (pares: [string, string][]): OpcionSelector[] =>
      [...new Map(pares).entries()].map(([valor, etiqueta]) => ({ valor, etiqueta })).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta))
    const zonas: [string, string][] = [], ciclos: [string, string][] = [], turnos: [string, string][] = []
    for (const t of catalogo) if (t.zona_id) zonas.push([t.zona_id, nombreZona(t.zona) || t.zona_id])
    for (const r of registros) {
      if (r.zona_id) zonas.push([r.zona_id, nombreZona(r.zona) || r.zona_id])
      if (r.ciclo) ciclos.push([etiquetaCiclo(r.ciclo), etiquetaCiclo(r.ciclo)])
      turnos.push([r.turno, r.turno])
    }
    for (const v of filtros.ciclo) ciclos.push([v, v])
    for (const v of filtros.turno) turnos.push([v, v])
    for (const t of turnosDeLotes) turnos.push([t, t])   // al elegir un lote aparecen TODOS sus turnos
    return {
      lotes: lotes.map((l) => ({ valor: l.lote, etiqueta: `${l.lote}${l.nombre ? ` ${l.nombre}` : ''}` })),
      zonas: mapa(zonas), ciclos: mapa(ciclos), turnos: mapa(turnos),
    }
  }, [catalogo, registros, lotes, turnosDeLotes, filtros.ciclo, filtros.turno])

  const cambiar = (c: Partial<FiltrosResumen>) => setFiltros((p) => ({ ...p, ...c }))
  const t = resumen.tarjetas
  const etiquetaMedida = parametro.medidas.length > 1 ? `${parametro.etiqueta} · ${medida.etiqueta}` : parametro.etiqueta
  const hayFiltros = Boolean(filtros.lotes.length || filtros.ciclo.length || filtros.zona.length || filtros.turno.length || filtros.desde || filtros.hasta)

  return (
    <div className="flex flex-col gap-3" data-resumen>
      <Tarjeta className="p-3.5">
        <div data-resumen-filtros className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SelectorMultiple etiqueta="Lote" opciones={opciones.lotes} valores={filtros.lotes} onCambiar={(v) => cambiar({ lotes: v })} />
            <SelectorMultiple etiqueta="Ciclo" opciones={opciones.ciclos} valores={filtros.ciclo} onCambiar={(v) => cambiar({ ciclo: v })} />
            <SelectorMultiple etiqueta="Zona" opciones={opciones.zonas} valores={filtros.zona} onCambiar={(v) => cambiar({ zona: v })} />
            <SelectorMultiple etiqueta="Turno" opciones={opciones.turnos} valores={filtros.turno} onCambiar={(v) => cambiar({ turno: v })} />
          </div>
          {filtros.lotes.length > 0 && turnosDeLotes.length > 0 && (
            <p className="text-xs text-slate-500" data-turnos-del-lote>Lote {filtros.lotes.join(', ')}: {turnosDeLotes.length} turno(s) — {turnosDeLotes.join(', ')}.</p>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Campo etiqueta="Desde"><Entrada type="date" value={rango.desde} max={rango.hasta} onChange={(e) => cambiar({ desde: e.target.value })} data-rs-desde /></Campo>
            <Campo etiqueta="Hasta"><Entrada type="date" value={rango.hasta} min={rango.desde} onChange={(e) => cambiar({ hasta: e.target.value })} data-rs-hasta /></Campo>
            <div className="col-span-2 flex flex-wrap items-end gap-2">
              <Boton type="button" variante="secundario" onClick={() => cambiar({ desde: '', hasta: '' })} data-rs-14>Últimos 14 días</Boton>
              {hayFiltros && (
                <button type="button" data-rs-limpiar className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-brand-700 underline"
                  onClick={() => cambiar({ lotes: [], ciclo: [], zona: [], turno: [], desde: '', hasta: '' })}>Quitar filtros</button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className={cabecera}>Parámetro</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Parámetro" data-rs-parametros>
              {PARAMETROS_RESUMEN.map((p) => (
                <button key={p.clave} type="button" aria-pressed={filtros.parametro === p.clave} data-rs-parametro={p.clave}
                  onClick={() => cambiar({ parametro: p.clave, medida: '' })}
                  className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${filtros.parametro === p.clave ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
                  {p.etiqueta}
                </button>
              ))}
            </div>
            {parametro.medidas.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Medida" data-rs-medidas>
                {parametro.medidas.map((m) => (
                  <button key={m.campo} type="button" aria-pressed={campo === m.campo} data-rs-medida={m.campo} onClick={() => cambiar({ medida: m.campo })}
                    className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${campo === m.campo ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
                    {m.etiqueta}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Tarjeta>

      {error && (
        <div className="flex flex-col gap-2" data-error>
          <Alerta tono="rojo">{error}</Alerta>
          <Boton type="button" variante="secundario" className="self-start" onClick={() => cargar(filtros)}>Reintentar</Boton>
        </div>
      )}
      {!error && cargando && !registros.length && <ListaEsqueleto filas={4} />}

      {!error && (registros.length > 0 || !cargando) && (
        <div className={`flex flex-col gap-3 ${cargando ? 'opacity-60 transition-opacity' : ''}`}>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-resumen-tarjetas>
            {[
              { k: 'activos', titulo: 'Turnos activos', valor: t.turnos_activos, detalle: 'con registro en los últimos 14 días', alerta: false },
              { k: 'hoy', titulo: 'Con registro hoy', valor: t.con_registro_hoy, detalle: `de ${t.turnos_activos} turnos activos`, alerta: false },
              { k: 'faltan', titulo: 'Sin registro hoy', valor: t.sin_registro_hoy.length, detalle: t.sin_registro_hoy.length ? 'turnos que faltan' : 'no falta ninguno', alerta: t.sin_registro_hoy.length > 0 },
              { k: 'semana', titulo: 'Registros de la semana', valor: t.registros_semana, detalle: 'últimos 7 días', alerta: false },
            ].map((x) => (
              <div key={x.k} data-rs-tarjeta={x.k}>
                <Tarjeta className={`h-full border-l-4 p-3 ${x.alerta ? 'border-l-orange-500' : 'border-l-emerald-500'}`}>
                  <p className="text-xs font-semibold text-slate-600">{x.titulo}</p>
                  <p className="text-3xl font-bold tabular-nums text-slate-900">{x.valor}</p>
                  <p className="text-xs text-slate-500">{x.detalle}</p>
                </Tarjeta>
              </div>
            ))}
          </div>

          {t.sin_registro_hoy.length > 0 && (
            <Seccion dato="faltan" titulo={`Turnos sin registro hoy (${t.sin_registro_hoy.length})`}>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700" data-rs-faltan>
                {t.sin_registro_hoy.map((f) => <li key={f.turno}>{f.turno}{f.ultimo ? ` (último ${f.ultimo.slice(8, 10)}/${f.ultimo.slice(5, 7)})` : ''}</li>)}
              </ul>
            </Seccion>
          )}

          <Seccion dato="mapa" titulo={`${etiquetaMedida}: turnos por día`}
            nota={`Últimos ${resumen.mapa.dias.length} días del rango. Toca una celda para ver el valor y el DDT.${resumen.mapa.recortadas ? ` Se muestran ${resumen.mapa.filas.length} turnos (+${resumen.mapa.recortadas}: elige turnos).` : ''}`}>
            <MapaCalor dias={resumen.mapa.dias} filas={resumen.mapa.filas} unidad={parametro.unidad} decimales={parametro.decimales} />
          </Seccion>
          <Seccion dato="lineas" titulo={`${etiquetaMedida} contra el DDT`} nota="Cada línea es un turno (promedio por día de DDT dentro del rango).">
            <LineasDdt series={resumen.lineas} unidad={parametro.unidad} decimales={parametro.decimales} />
          </Seccion>
          <Seccion dato="comparacion" titulo={`${etiquetaMedida}: turnos al mismo DDT${resumen.comparacion.ddt !== null ? ` (${resumen.comparacion.ddt})` : ''}`}
            nota="De mayor a menor; cada turno con su valor más cercano a ese DDT (±1 día).">
            <BarrasDdt barras={resumen.comparacion.barras} unidad={parametro.unidad} decimales={parametro.decimales} />
          </Seccion>
        </div>
      )}
    </div>
  )
}
