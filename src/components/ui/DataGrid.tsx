'use client'

/**
 * La cuadrícula estándar del sistema.
 *
 * Todas las tablas de análisis —siembra diaria, horómetros, labores, plan
 * de emplasticado— son esta misma. Cada pantalla pone sus columnas y sus
 * acciones; el orden, los filtros, la selección múltiple y el Excel están
 * aquí y se comportan igual en las cuatro.
 *
 * El componente NO sabe de negocio: no lee, no escribe, no valida. Filtrar
 * y ordenar están en `lib/grid/filtros` (puro y probado), y guardar o
 * eliminar lo hace quien la usa, a través de los huecos que deja.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Boton, EstadoVacio } from './Primitivos'
import { FiltroColumna } from './FiltroColumna'
import { IconCheck, IconInbox, IconSearch } from './Icons'
import { construirXlsx, descargar, type CeldaHoja } from '@/lib/hojas'
import {
  buscar,
  contarFiltros,
  estaActivo,
  filtroVacio,
  opcionesDe,
  ordenar,
  resumenFiltro,
  textoDe,
  filtrar as filtrarFilas,
} from '@/lib/grid/filtros'
import type { ColumnaGrid, Filtro, Filtros, Orden } from '@/lib/grid/tipos'

export type { ColumnaGrid } from '@/lib/grid/tipos'

export function DataGrid<T extends { id: string }>({
  filas,
  columnas,
  titulo,
  nombreArchivo,
  ordenInicial,
  seleccionable = true,
  minAncho = '1000px',
  resumen,
  acciones,
  accionesSeleccion,
  accionFila,
  resaltar,
  vacio,
  puedeExportar = true,
  filtrosExternos,
  onEditarCelda,
  puedeEditarCelda = false,
}: {
  filas: T[]
  columnas: ColumnaGrid<T>[]
  /** Nombre del conjunto; se usa en el Excel y en los textos. */
  titulo: string
  nombreArchivo?: string
  ordenInicial?: Orden
  seleccionable?: boolean
  minAncho?: string
  /** Línea de totales, a la izquierda de la barra de herramientas. */
  resumen?: (visibles: T[]) => ReactNode
  /** Botones propios de la pantalla (Importar, Nuevo…). */
  acciones?: ReactNode
  /** Acciones en masa. Reciben lo marcado que está a la vista. */
  accionesSeleccion?: (ids: string[], limpiar: () => void) => ReactNode
  /** Botones de una fila (Editar, Eliminar). */
  accionFila?: (fila: T) => ReactNode
  /** Clase extra para filas que hay que destacar (un desfase, un error). */
  resaltar?: (fila: T) => string | null
  vacio?: { titulo: string; descripcion?: string }
  puedeExportar?: boolean
  /**
   * Panel de filtros GLOBALES, encima de la tabla. Acotan la consulta o
   * la pantalla entera; los del encabezado sólo recortan lo que ya está
   * cargado. Son dos cosas distintas y por eso se ven distintas.
   */
  filtrosExternos?: ReactNode
  /** Guarda una celda editada. Sin esto, la tabla es de sólo lectura. */
  onEditarCelda?: (fila: T, campo: string, valor: unknown) => Promise<void> | void
  puedeEditarCelda?: boolean
}) {
  const [orden, setOrden] = useState<Orden | null>(ordenInicial ?? null)
  const [filtros, setFiltros] = useState<Filtros>({})
  const [busqueda, setBusqueda] = useState('')
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())

  const filtrables = useMemo(() => columnas.filter((c) => c.tipo !== 'ninguno'), [columnas])

  const visibles = useMemo(
    () => ordenar(buscar(filtrarFilas(filas, columnas, filtros), filtrables, busqueda), columnas, orden),
    [filas, columnas, filtrables, filtros, busqueda, orden]
  )

  const activos = contarFiltros(filtros)

  // Las listas de casillas se calculan una vez para todas las columnas:
  // cada una mira las filas que pasan los filtros de LAS DEMÁS, como el
  // autofiltro de Excel, y hacerlo dentro del panel recorrería la tabla
  // entera cada vez que se abre uno.
  const opciones = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const c of columnas) {
      out[c.campo] = c.tipo === 'seleccion' ? opcionesDe(filas, columnas, filtros, c.campo) : []
    }
    return out
  }, [filas, columnas, filtros])

  // La selección NO se poda al filtrar: se deja intacta y todas las
  // acciones trabajan sobre la intersección con lo que está en pantalla.
  // Así nadie elimina algo que el filtro le está tapando, y quitar el
  // filtro devuelve la selección tal como estaba.
  const marcadasVisibles = useMemo(
    () => visibles.filter((f) => marcadas.has(f.id)).map((f) => f.id),
    [visibles, marcadas]
  )
  const todasMarcadas = visibles.length > 0 && marcadasVisibles.length === visibles.length

  function cambiarFiltro(campo: string, f: Filtro) {
    setFiltros((prev) => {
      const copia = { ...prev }
      if (estaActivo(f)) copia[campo] = f
      else delete copia[campo]
      return copia
    })
  }

  function alternarOrden(campo: string) {
    setOrden((o) =>
      o?.campo === campo
        ? { campo, direccion: o.direccion === 'asc' ? 'desc' : 'asc' }
        : { campo, direccion: 'asc' }
    )
  }

  function alternarMarca(id: string) {
    setMarcadas((prev) => {
      const copia = new Set(prev)
      if (copia.has(id)) copia.delete(id)
      else copia.add(id)
      return copia
    })
  }

  const limpiarSeleccion = () => setMarcadas(new Set())

  function exportar() {
    const cols = columnas.filter((c) => !c.sinExportar)
    const hoja: CeldaHoja[][] = [
      cols.map((c) => c.label),
      ...visibles.map((f) =>
        cols.map((c) => {
          if (c.numero) {
            const v = c.valor(f)
            return v === null || v === undefined || v === '' ? '' : Number(v)
          }
          return textoDe(f, c)
        })
      ),
    ]
    descargar(construirXlsx(titulo.slice(0, 30), hoja), `${nombreArchivo ?? 'datos'}.xlsx`)
  }

  const hayColumnaAcciones = Boolean(accionFila)

  return (
    <div className="flex flex-col gap-3">
      {filtrosExternos}

      {/* ------------------- Barra de herramientas ------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        {resumen && <div className="min-w-[180px] flex-1 text-sm text-slate-500">{resumen(visibles)}</div>}

        <div className="relative min-w-[180px] max-w-xs flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en toda la tabla…"
            inputMode="search"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>

        {(activos > 0 || busqueda) && (
          <Boton
            variante="secundario"
            tamano="sm"
            onClick={() => {
              setFiltros({})
              setBusqueda('')
            }}
          >
            Limpiar {activos > 0 ? `${activos} ${activos === 1 ? 'filtro' : 'filtros'}` : 'búsqueda'}
          </Boton>
        )}

        {acciones}

        {puedeExportar && (
          <Boton variante="secundario" tamano="sm" onClick={exportar} disabled={visibles.length === 0}>
            Exportar
          </Boton>
        )}
      </div>

      {/* -------------------- Barra de selección --------------------- */}
      {seleccionable && marcadasVisibles.length > 0 && (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 shadow-[var(--shadow-card)] lg:top-2">
          <span className="text-sm font-bold text-brand-800">
            {marcadasVisibles.length} {marcadasVisibles.length === 1 ? 'seleccionada' : 'seleccionadas'}
          </span>
          <button
            type="button"
            onClick={limpiarSeleccion}
            className="text-xs font-semibold text-brand-700 underline"
          >
            Limpiar selección
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            {accionesSeleccion?.(marcadasVisibles, limpiarSeleccion)}
          </div>
        </div>
      )}

      {/* ---------------------------- Tabla -------------------------- */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
        {filas.length === 0 ? (
          <EstadoVacio
            icono={<IconInbox />}
            titulo={vacio?.titulo ?? 'Sin registros'}
            descripcion={vacio?.descripcion}
          />
        ) : (
          <>
            <div className="scroll-suave max-h-[70svh] overflow-auto">
              <table className="w-full text-sm" style={{ minWidth: minAncho }}>
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr className="border-b border-slate-200 text-left">
                    {seleccionable && (
                      <th className="w-9 px-2 py-2.5">
                        <button
                          type="button"
                          aria-label={todasMarcadas ? 'Limpiar selección' : 'Seleccionar todas'}
                          onClick={() =>
                            setMarcadas(todasMarcadas ? new Set() : new Set(visibles.map((f) => f.id)))
                          }
                          className={`flex h-4 w-4 items-center justify-center rounded border transition-all ${
                            todasMarcadas
                              ? 'border-brand-700 bg-brand-700 text-white'
                              : 'border-slate-300 bg-white hover:border-brand-400'
                          }`}
                        >
                          {todasMarcadas && <IconCheck className="h-3 w-3" />}
                        </button>
                      </th>
                    )}

                    {columnas.map((c) => {
                      const filtro = filtros[c.campo] ?? filtroVacio(c.tipo)
                      const texto = resumenFiltro(filtro)
                      return (
                        <th
                          key={c.campo}
                          className="px-3 py-2 align-top"
                          style={c.ancho ? { width: c.ancho } : undefined}
                        >
                          <span
                            className={`flex items-center gap-1 ${c.numero ? 'justify-end' : ''}`}
                          >
                            {c.tipo === 'ninguno' ? (
                              <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                {c.label}
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => alternarOrden(c.campo)}
                                  title={`Ordenar por ${c.label}`}
                                  className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-bold uppercase tracking-wide ${
                                    orden?.campo === c.campo
                                      ? 'text-brand-700'
                                      : 'text-slate-500 hover:text-slate-800'
                                  }`}
                                >
                                  {c.label}
                                  <span className="text-[9px]">
                                    {orden?.campo === c.campo
                                      ? orden.direccion === 'asc'
                                        ? '▲'
                                        : '▼'
                                      : '⇅'}
                                  </span>
                                </button>
                                <FiltroColumna
                                  tipo={c.tipo}
                                  etiqueta={c.label}
                                  filtro={filtro}
                                  opciones={opciones[c.campo] ?? []}
                                  onCambiar={(f) => cambiarFiltro(c.campo, f)}
                                />
                              </>
                            )}
                          </span>

                          {texto && (
                            <button
                              type="button"
                              onClick={() => cambiarFiltro(c.campo, filtroVacio(c.tipo))}
                              title="Limpiar este filtro"
                              className={`mt-1 flex max-w-full items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-brand-800 hover:bg-brand-100 ${
                                c.numero ? 'ml-auto' : ''
                              }`}
                            >
                              <span className="truncate">{texto}</span>
                              <span className="shrink-0 text-brand-500">×</span>
                            </button>
                          )}
                        </th>
                      )
                    })}

                    {hayColumnaAcciones && <th className="px-3 py-2" />}
                  </tr>
                </thead>

                <tbody>
                  {visibles.map((f) => {
                    const extra = resaltar?.(f)
                    return (
                      <tr
                        key={f.id}
                        className={`border-b border-slate-50 transition-colors last:border-0 ${
                          marcadas.has(f.id)
                            ? 'bg-brand-50/50'
                            : (extra ?? 'hover:bg-slate-50/60')
                        }`}
                      >
                        {seleccionable && (
                          <td className="px-2 py-1.5">
                            <button
                              type="button"
                              aria-label="Seleccionar fila"
                              onClick={() => alternarMarca(f.id)}
                              className={`flex h-4 w-4 items-center justify-center rounded border transition-all ${
                                marcadas.has(f.id)
                                  ? 'border-brand-700 bg-brand-700 text-white'
                                  : 'border-slate-300 bg-white hover:border-brand-400'
                              }`}
                            >
                              {marcadas.has(f.id) && <IconCheck className="h-3 w-3" />}
                            </button>
                          </td>
                        )}

                        {columnas.map((c) => {
                          const editable = puedeEditarCelda && Boolean(c.editable) && Boolean(onEditarCelda)
                          return (
                            <td
                              key={c.campo}
                              className={`py-1.5 ${editable ? 'px-1' : 'px-3'} ${
                                c.numero ? 'text-right tabular-nums text-slate-700' : 'text-slate-600'
                              }`}
                            >
                              {editable ? (
                                <Celda
                                  fila={f}
                                  columna={c}
                                  onGuardar={(v) => onEditarCelda?.(f, c.campo, v)}
                                />
                              ) : c.render ? (
                                c.render(f)
                              ) : (
                                textoDe(f, c) || <span className="text-slate-300">—</span>
                              )}
                            </td>
                          )
                        })}

                        {hayColumnaAcciones && (
                          <td className="whitespace-nowrap px-3 py-1.5 text-right">
                            {accionFila?.(f)}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {visibles.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                Ningún registro pasa los filtros.
              </p>
            )}
          </>
        )}
      </div>

      <p className="px-1 text-xs text-slate-400">
        {visibles.length === filas.length
          ? `${filas.length} ${filas.length === 1 ? 'fila' : 'filas'}`
          : `${visibles.length} de ${filas.length} filas`}
        <span className="hidden sm:inline">
          {' · toca un encabezado para ordenar, el embudo para filtrar'}
          {puedeEditarCelda && onEditarCelda
            ? ' · escribe sobre una celda para corregirla; se guarda con Enter o al salir'
            : ''}
        </span>
      </p>
    </div>
  )
}

/* ================================================================== */
/* Celda editable                                                      */
/* ================================================================== */

/**
 * Se escribe sobre la tabla, como en una hoja de cálculo: Enter guarda,
 * Escape cancela y salir del campo guarda.
 *
 * El borrador se sincroniza con el servidor DURANTE EL RENDER, que es el
 * patrón que React documenta para reajustar estado cuando cambia una
 * prop. Hacerlo en un efecto es error de lint en React 19 y además
 * parpadea: se vería un momento el valor viejo.
 */
function Celda<T extends { id: string }>({
  fila,
  columna,
  onGuardar,
}: {
  fila: T
  columna: ColumnaGrid<T>
  onGuardar: (valor: unknown) => void
}) {
  const inicial = columna.valorEdicion
    ? columna.valorEdicion(fila)
    : (() => {
        const v = columna.valor(fila)
        return v === null || v === undefined ? '' : String(v)
      })()

  const [borrador, setBorrador] = useState(inicial)
  const [servidor, setServidor] = useState(inicial)
  if (inicial !== servidor) {
    setServidor(inicial)
    setBorrador(inicial)
  }

  const clase = `w-full min-w-[70px] rounded-md border border-transparent px-1.5 py-1 transition-colors hover:border-slate-200 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-600/10 ${
    columna.numero ? 'text-right tabular-nums' : ''
  }`

  if (columna.editor === 'seleccion') {
    return (
      <select
        value={borrador}
        onChange={(e) => {
          setBorrador(e.target.value)
          if (e.target.value !== inicial) onGuardar(e.target.value || null)
        }}
        className={`${clase} bg-transparent`}
      >
        <option value="">—</option>
        {(columna.opciones ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }

  function confirmar() {
    if (borrador === inicial) return
    if (columna.editor === 'numero') {
      if (borrador !== '' && Number.isNaN(Number(borrador))) {
        setBorrador(inicial)
        return
      }
      return onGuardar(borrador === '' ? null : Number(borrador))
    }
    onGuardar(borrador === '' ? null : borrador)
  }

  return (
    <input
      type={columna.editor === 'fecha' ? 'date' : 'text'}
      inputMode={columna.editor === 'numero' ? 'decimal' : undefined}
      value={borrador}
      onChange={(e) => setBorrador(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          confirmar()
          ;(e.target as HTMLInputElement).blur()
        }
        if (e.key === 'Escape') {
          setBorrador(inicial)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      onBlur={confirmar}
      className={clase}
    />
  )
}
