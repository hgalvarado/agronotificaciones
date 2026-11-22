'use client'

/**
 * Registros de la temporada › Índice de crecimiento (IC): las tres vistas (Vista rápida, Tabla y Gráficas) con la misma
 * forma que las de parámetros. Solo presentan; guardar y eliminar lo hace la pantalla que las usa (la base decide el permiso).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Boton, Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { DataGrid, type ColumnaGrid } from '@/components/ui/DataGrid'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { ayerIso, hoyIso } from '@/lib/fechas/zona'
import { agruparPorDia, nombreZona, quienRegistro, turnosDe, valorNumero, type Registro } from '@/lib/agrometricas/registrosPura'
import { VENTANA_IC, diferenciaIC, estadoContraPlan, resumenPorTurno, resumenTurnoIC, sparksIC, textoIC, type PlanPunto } from '@/lib/agrometricas/registrosIC'
import { normalizarVersiones } from '@/lib/agrometricas/indicePura'
import { createClient } from '@/lib/supabase/client'
import { GraficaLinea } from './GraficaLinea'
import { BarrasHojas, GraficaICPlan } from './GraficaIC'

const Estado = ({ r }: { r: Registro }) => {
  const e = estadoContraPlan(r)
  return e === 'sobre' ? <Insignia tono="verde">Sobre el plan</Insignia> : e === 'bajo' ? <Insignia tono="ambar">Bajo el plan</Insignia> : null
}

export function TarjetasIC({ registros, onAbrir }: { registros: Registro[]; onAbrir: (r: Registro) => void }) {
  const grupos = useMemo(() => agruparPorDia(registros, hoyIso(), ayerIso()), [registros])
  const sparks = useMemo(() => sparksIC(registros), [registros])
  return (
    <div className="flex flex-col gap-4" data-tarjetas-ic>
      {grupos.map((g) => (
        <section key={g.dia} data-dia={g.dia} className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.etiqueta} · {g.registros.length}</h2>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {g.registros.map((r) => {
              const puntos = sparks.get(r.turno) ?? []
              return (
                <button key={r.id} type="button" onClick={() => onAbrir(r)} data-registro-ic={r.id}
                  className="block rounded-2xl text-left transition active:scale-[.99] focus-visible:outline-2 focus-visible:outline-emerald-600">
                  <Tarjeta className="h-full p-3.5 hover:border-emerald-300">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-sm font-semibold text-slate-900">{r.turno}{r.ddt != null ? ` · DDT ${r.ddt}` : ''}</p>
                      <span className="flex shrink-0 items-center gap-1.5"><Estado r={r} />{r.puede_editar && <Insignia tono="gris">Editable</Insignia>}</span>
                    </div>
                    <p className="mb-2 text-xs text-slate-500">{[r.estacion, nombreZona(r.zona), quienRegistro(r)].filter(Boolean).join(' · ')}</p>
                    <ul className="flex flex-col divide-y divide-slate-100">
                      <li className="flex min-h-11 items-center justify-between gap-2 py-1">
                        <span className="text-sm text-slate-600">Hojas</span>
                        <span className="text-sm font-semibold tabular-nums text-slate-900">{textoIC(valorNumero(r, 'hojas'), 1)}</span>
                      </li>
                      <li className="flex min-h-11 items-center justify-between gap-2 py-1">
                        <span className="text-sm text-slate-600">IC real</span>
                        <span className="flex items-center gap-2">
                          {puntos.length > 1 && (
                            <GraficaLinea compacta etiqueta={`IC real por DDT, turno ${r.turno}`}
                              series={[{ campo: 'ic_real', etiqueta: 'IC real', puntos: puntos.map((p) => ({ x: p.x, y: p.y, fecha: '', fuera: false })) }]} />
                          )}
                          <span className="min-w-14 text-right text-sm font-semibold tabular-nums text-slate-900">{textoIC(valorNumero(r, 'ic_real'))}</span>
                        </span>
                      </li>
                      <li className="flex min-h-11 items-center justify-between gap-2 py-1">
                        <span className="text-sm text-slate-600">IC plan</span>
                        <span className="text-sm font-semibold tabular-nums text-slate-900">{textoIC(valorNumero(r, 'ic_plan'))}</span>
                      </li>
                    </ul>
                  </Tarjeta>
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export function TablaIC({ registros, cargando, onEditarCelda, onAbrir, onEliminarVarios }: {
  registros: Registro[]
  cargando: boolean
  onEditarCelda: (fila: Registro, campo: string, valor: unknown) => Promise<void>
  onAbrir: (r: Registro) => void
  onEliminarVarios: (ids: string[], limpiar: () => void) => void
}) {
  const columnas = useMemo<ColumnaGrid<Registro>[]>(() => [
    { campo: 'fecha', label: 'Fecha', tipo: 'fecha', valor: (r) => r.fecha },
    { campo: 'turno', label: 'Turno', tipo: 'seleccion', valor: (r) => r.turno },
    { campo: 'ddt', label: 'DDT', tipo: 'numero', numero: true, valor: (r) => r.ddt },
    { campo: 'zona', label: 'Zona', tipo: 'seleccion', valor: (r) => nombreZona(r.zona) },
    { campo: 'estacion', label: 'Estación', tipo: 'seleccion', valor: (r) => r.estacion ?? '' },
    { campo: 'lotes', label: 'Lotes', tipo: 'texto', valor: (r) => (r.lotes ?? []).map((l) => l.lote).join(', ') },
    { campo: 'hojas', label: 'Hojas', tipo: 'numero', numero: true, valor: (r) => valorNumero(r, 'hojas'), editable: (r: Registro) => r.puede_editar, editor: 'numero' },
    { campo: 'ic_real', label: 'IC real', tipo: 'numero', numero: true, valor: (r) => valorNumero(r, 'ic_real'), render: (r: Registro) => <span>{textoIC(valorNumero(r, 'ic_real'))}</span> },
    { campo: 'ic_plan', label: 'IC plan', tipo: 'numero', numero: true, valor: (r) => valorNumero(r, 'ic_plan'), render: (r: Registro) => <span>{textoIC(valorNumero(r, 'ic_plan'))}</span> },
    { campo: 'diferencia', label: 'Real − plan', tipo: 'numero', numero: true, valor: (r) => diferenciaIC(r),
      render: (r: Registro) => { const d = diferenciaIC(r); return <span className={d !== null && d < 0 ? 'font-semibold text-amber-700' : ''}>{textoIC(d)}</span> } },
    { campo: 'comentario', label: 'Comentario', tipo: 'texto', valor: (r) => r.comentario ?? '' },
    { campo: 'capturo', label: 'Registró', tipo: 'seleccion', valor: (r) => quienRegistro(r) },
  ], [])

  return (
    <div data-tabla-ic>
      <DataGrid<Registro>
        filas={registros}
        columnas={columnas}
        titulo="Índice de crecimiento"
        nombreArchivo="agrometricas-indice-crecimiento"
        ordenInicial={{ campo: 'fecha', direccion: 'desc' }}
        minAncho="1100px"
        cargando={cargando}
        memoria="agrometricas-registros-ic"
        puedeEditarCelda
        onEditarCelda={onEditarCelda}
        resumen={(v) => <span className="text-sm text-slate-500">{v.length} registros</span>}
        accionFila={(r) => <Boton type="button" tamano="sm" variante="secundario" onClick={() => onAbrir(r)}>Ver</Boton>}
        accionesSeleccion={(ids, limpiar) => {
          const eliminables = registros.filter((r) => ids.includes(r.id) && r.puede_eliminar).map((r) => r.id)
          return eliminables.length
            ? <Boton type="button" tamano="sm" variante="peligro" onClick={() => onEliminarVarios(eliminables, limpiar)} data-eliminar-varios>Eliminar ({eliminables.length})</Boton>
            : null
        }}
        vacio={{ titulo: 'Sin registros', descripcion: 'Ajusta los filtros.' }}
      />
    </div>
  )
}

/** Plan del IC de la versión de fórmula vigente: una sola lectura al abrir las gráficas (sin temporizadores ni reintentos). */
function usePlanIC(): PlanPunto[] {
  const [plan, setPlan] = useState<PlanPunto[]>([])
  const pedido = useRef(false)
  useEffect(() => {
    if (pedido.current) return
    pedido.current = true
    createClient().rpc('fn_agm_ic_config').then(({ data }) => {
      const versiones = normalizarVersiones(data)
      const hoy = hoyIso()
      const vigente = [...versiones].reverse().find((v) => v.vigente_desde <= hoy) ?? versiones[0]
      if (vigente) setPlan(vigente.plan)
    }, () => {})   // sin plan de la fórmula: las gráficas usan el plan que trae cada registro
  }, [])
  return plan
}

const FLECHA: Record<string, string> = { sube: '↑ Sube', baja: '↓ Baja', igual: '→ Igual' }

function Dato({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 px-3 py-2">
      <p className="text-xs text-slate-500">{etiqueta}</p>
      <p className={`text-base font-semibold tabular-nums ${tono ?? 'text-slate-900'}`}>{valor}</p>
    </div>
  )
}

export function GraficasIC({ registros }: { registros: Registro[] }) {
  const turnos = useMemo(() => turnosDe(registros), [registros])
  const plan = usePlanIC()
  const [sel, setSel] = useState<string[]>([])
  const validos = sel.filter((t) => turnos.some((x) => x.turno === t))
  const elegidos = validos.length ? validos : turnos.slice(0, 1).map((t) => t.turno)
  const comparativo = useMemo(() => resumenPorTurno(registros, elegidos, plan), [registros, elegidos, plan])
  if (!turnos.length) return <p className="text-sm text-slate-500">No hay registros para graficar con estos filtros.</p>

  return (
    <div className="flex flex-col gap-3" data-graficas-ic>
      <SelectorMultiple etiqueta="Turno de las gráficas" valores={validos} onCambiar={setSel}
        opciones={turnos.map((t) => ({ valor: t.turno, etiqueta: `${t.turno} (${t.n})` }))} />
      <p className="text-xs text-slate-500">
        Cómo leerlas: la línea punteada es el IC que se esperaba (plan); la verde es el IC medido. El tallo de cada punto muestra cuánto se aleja del plan:
        verde = por encima, ámbar = por debajo. El IC se mide preferiblemente del DDT {VENTANA_IC.min} al {VENTANA_IC.max}.
      </p>

      {elegidos.length > 1 && (
        <Tarjeta className="p-3.5">
          <div data-resumen-turnos>
            <h3 className="mb-1 text-sm font-semibold text-slate-800">Resumen por turno · del más atrasado al más adelantado</h3>
            <p className="mb-2 text-xs text-slate-500">La barra es el IC real como % del plan en la última lectura; la marca vertical es el 100 %.</p>
            <ul className="flex flex-col gap-1.5">
              {comparativo.map((r) => {
                const ancho = r.pct === null ? 0 : Math.min(100, (r.pct / 150) * 100)
                return (
                  <li key={r.turno} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm" data-fila-turno={r.turno}>
                    <span className="truncate font-medium text-slate-800">{r.turno}</span>
                    <span className="relative h-4 rounded-full bg-slate-100">
                      <span className={`absolute inset-y-0 left-0 rounded-full ${r.pct !== null && r.pct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${ancho}%` }} />
                      <span className="absolute inset-y-0 w-px bg-slate-500" style={{ left: `${(100 / 150) * 100}%` }} />
                    </span>
                    <span className="min-w-28 text-right tabular-nums text-slate-700">
                      {r.pct === null ? 'Sin plan' : `${r.pct} %`}{r.ddt !== null ? ` · DDT ${r.ddt}` : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </Tarjeta>
      )}

      {elegidos.map((turno) => {
        const delTurno = registros.filter((r) => r.turno === turno)
        const r = resumenTurnoIC(delTurno, plan)
        const sobre = r.pct !== null && r.pct >= 100
        return (
          <section key={turno} className="flex flex-col gap-3" data-turno-grafica-ic={turno}>
            <h2 className="text-sm font-semibold text-slate-900">{turno}</h2>
            <Tarjeta className="p-3.5">
              <div data-resumen-ic>
                <p className={`mb-3 text-sm font-medium ${r.pct === null ? 'text-slate-700' : sobre ? 'text-emerald-700' : 'text-amber-700'}`}>{r.frase}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Dato etiqueta="Último IC real" valor={textoIC(r.real)} />
                  <Dato etiqueta={r.ddt !== null ? `IC plan (DDT ${r.ddt})` : 'IC plan'} valor={textoIC(r.plan)} />
                  <Dato etiqueta="% del plan" valor={r.pct === null ? '—' : `${r.pct} %`} tono={r.pct === null ? undefined : sobre ? 'text-emerald-700' : 'text-amber-700'} />
                  <Dato etiqueta="Tendencia" valor={r.tendencia ? FLECHA[r.tendencia] : '—'} />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {r.n} registro{r.n === 1 ? '' : 's'}{r.fecha ? ` · última lectura ${r.fecha}` : ''}
                  {r.fueraVentana > 0 ? ` · ${r.fueraVentana} fuera de la ventana DDT ${VENTANA_IC.min}–${VENTANA_IC.max}` : ''}
                </p>
              </div>
            </Tarjeta>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Tarjeta className="p-3.5">
                <div data-grafica="ic">
                  <h3 className="mb-2 text-sm font-semibold text-slate-800">IC real contra el plan</h3>
                  <GraficaICPlan registros={delTurno} plan={plan} etiqueta={`IC real contra plan por DDT, turno ${turno}`} />
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    <li className="flex items-center gap-1.5"><svg width="22" height="8" aria-hidden><line x1="0" x2="22" y1="4" y2="4" className="stroke-emerald-600" strokeWidth="2.6" /></svg>IC real</li>
                    <li className="flex items-center gap-1.5"><svg width="22" height="8" aria-hidden><line x1="0" x2="22" y1="4" y2="4" className="stroke-slate-500" strokeWidth="1.8" strokeDasharray="5 3" /></svg>IC plan</li>
                    <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600" />Sobre el plan</li>
                    <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />Bajo el plan</li>
                  </ul>
                </div>
              </Tarjeta>
              <Tarjeta className="p-3.5">
                <div data-grafica="hojas">
                  <h3 className="mb-2 text-sm font-semibold text-slate-800">Hojas por DDT</h3>
                  <BarrasHojas registros={delTurno} etiqueta={`Hojas por DDT, turno ${turno}`} />
                </div>
              </Tarjeta>
            </div>
          </section>
        )
      })}
    </div>
  )
}
