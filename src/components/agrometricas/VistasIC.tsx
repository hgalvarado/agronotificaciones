'use client'

/**
 * Registros de la temporada › Índice de crecimiento (IC): las tres vistas (Vista rápida, Tabla y Gráficas) con la misma
 * forma que las de parámetros. Solo presentan; guardar y eliminar lo hace la pantalla que las usa (la base decide el permiso).
 */

import { useMemo, useState } from 'react'
import { Boton, Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { DataGrid, type ColumnaGrid } from '@/components/ui/DataGrid'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { ayerIso, hoyIso } from '@/lib/fechas/zona'
import { agruparPorDia, nombreZona, quienRegistro, turnosDe, valorNumero, type Registro } from '@/lib/agrometricas/registrosPura'
import { diferenciaIC, estadoContraPlan, seriesHojas, seriesIC, sparksIC, textoIC } from '@/lib/agrometricas/registrosIC'
import { GraficaLinea, colorLeyenda } from './GraficaLinea'

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

export function GraficasIC({ registros }: { registros: Registro[] }) {
  const turnos = useMemo(() => turnosDe(registros), [registros])
  const [sel, setSel] = useState<string[]>([])
  const validos = sel.filter((t) => turnos.some((x) => x.turno === t))
  const elegidos = validos.length ? validos : turnos.slice(0, 1).map((t) => t.turno)
  if (!turnos.length) return <p className="text-sm text-slate-500">No hay registros para graficar con estos filtros.</p>

  return (
    <div className="flex flex-col gap-3" data-graficas-ic>
      <SelectorMultiple etiqueta="Turno de las gráficas" valores={validos} onCambiar={setSel}
        opciones={turnos.map((t) => ({ valor: t.turno, etiqueta: `${t.turno} (${t.n})` }))} />
      <p className="text-xs text-slate-500">Mostrando: {elegidos.join(', ')}. Línea punteada = IC del plan para cada DDT.</p>
      {elegidos.map((turno) => {
        const delTurno = registros.filter((r) => r.turno === turno)
        const ic = seriesIC(delTurno)
        const hojas = seriesHojas(delTurno)
        return (
          <section key={turno} className="flex flex-col gap-3" data-turno-grafica-ic={turno}>
            <h2 className="text-sm font-semibold text-slate-900">{turno}</h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Tarjeta className="p-3.5">
                <div data-grafica="ic">
                  <h3 className="mb-2 text-sm font-semibold text-slate-800">IC real contra plan</h3>
                  {ic.series.length ? (
                    <>
                      <GraficaLinea series={ic.series} etiqueta={`IC real contra plan por DDT, turno ${turno}`} />
                      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                        {ic.series.map((s) => (
                          <li key={s.campo} className="flex items-center gap-1.5 text-xs text-slate-600">
                            <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" className={colorLeyenda(s.campo)} /></svg>{s.etiqueta}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : <p className="text-sm text-slate-400">Sin lecturas.</p>}
                  {ic.sinDdt > 0 && <p className="mt-1 text-xs text-amber-700">{ic.sinDdt} registros sin DDT no se grafican.</p>}
                </div>
              </Tarjeta>
              <Tarjeta className="p-3.5">
                <div data-grafica="hojas">
                  <h3 className="mb-2 text-sm font-semibold text-slate-800">Hojas por DDT</h3>
                  {hojas.length ? <GraficaLinea series={hojas} etiqueta={`Hojas por DDT, turno ${turno}`} /> : <p className="text-sm text-slate-400">Sin lecturas.</p>}
                </div>
              </Tarjeta>
            </div>
          </section>
        )
      })}
    </div>
  )
}
