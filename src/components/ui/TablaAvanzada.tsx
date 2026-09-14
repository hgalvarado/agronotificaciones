'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { SelectorCelda } from './SelectorCelda'
import { Modal } from './Modal'
import { Alerta, Boton, Campo, Entrada, EstadoVacio, Selector } from './Primitivos'
import { FiltroColumna } from './FiltroColumna'
import { IconCheck, IconInbox, IconPencil, IconSearch, IconSend, IconTrash } from './Icons'
import { construirXlsx, descargar, type CeldaHoja } from '@/lib/hojas'
import { mensajeDeError } from '@/lib/errores'
import { estaActivo, filtroVacio, resumenFiltro } from '@/lib/grid/filtros'
import type { Filtro, Filtros, TipoFiltro } from '@/lib/grid/tipos'
import { VACIO } from '@/lib/grid/tipos'

/* ================================================================== */
/* Tipos                                                               */
/* ================================================================== */

export type FilaTabla = Record<string, unknown> & { id: string }

export type ColumnaTabla = {
  key: string
  label: string
  tipo?: 'texto' | 'numero' | 'fecha' | 'booleano' | 'seleccion'
  /** Sólo para 'seleccion': catálogo relacionado. */
  opciones?: { value: string; label: string }[]
  /**
   * Cómo se filtra esta columna. Por omisión lo decide el tipo: una fecha
   * por rango, un número por mínimo y máximo, y todo lo demás por lista de
   * casillas. Se pone a mano cuando la columna es descriptiva y la lista
   * de casillas tendría mil valores distintos.
   */
  filtro?: TipoFiltro
  /** Se puede editar en la celda y en los cambios en masa. */
  editable?: boolean
  /** Se excluye de los cambios en masa aunque sea editable (ej. el código). */
  sinMasivo?: boolean
  alinear?: 'izquierda' | 'derecha'
  ancho?: string
  /** Cómo se dibuja. Si falta, se dibuja el valor crudo. */
  render?: (fila: FilaTabla) => ReactNode
}

export type PermisosTabla = {
  editar?: boolean
  eliminar?: boolean
  descargar?: boolean
}

/* ================================================================== */
/* Utilidades                                                          */
/* ================================================================== */

function normalizar(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Texto que se usa para ordenar, filtrar, buscar y exportar. */
function textoDe(fila: FilaTabla, col: ColumnaTabla): string {
  const v = fila[col.key]
  if (v === null || v === undefined || v === '') return ''
  if (col.tipo === 'booleano') return v ? 'Sí' : 'No'
  if (col.tipo === 'seleccion') {
    // El value de la opción es texto, pero la fila puede traer un número
    // (el ciclo, por ejemplo). Se compara siempre como texto.
    return (col.opciones ?? []).find((o) => o.value === String(v))?.label ?? ''
  }
  return String(v)
}

function comparar(a: FilaTabla, b: FilaTabla, col: ColumnaTabla) {
  const va = a[col.key]
  const vb = b[col.key]

  // Los vacíos siempre al final, suba o baje el orden: una celda en blanco
  // no es "lo más chico", es una celda sin dato.
  const aVacio = va === null || va === undefined || va === ''
  const bVacio = vb === null || vb === undefined || vb === ''
  if (aVacio && bVacio) return 0
  if (aVacio) return 1
  if (bVacio) return -1

  if (col.tipo === 'numero') return Number(va) - Number(vb)
  if (col.tipo === 'booleano') return (va ? 1 : 0) - (vb ? 1 : 0)
  if (col.tipo === 'fecha') return String(va).localeCompare(String(vb))

  // El texto se compara con la intercalación del español, que ordena bien
  // los acentos y la ñ, y con `numeric` para que 1001-9 vaya antes de
  // 1001-10 en vez de después.
  return textoDe(a, col).localeCompare(textoDe(b, col), 'es', {
    numeric: true,
    sensitivity: 'base',
  })
}

/* ================================================================== */
/* Componente                                                          */
/* ================================================================== */

export function TablaAvanzada({
  columnas,
  filas,
  titulo,
  permisos = {},
  seleccionable = true,
  minAncho = '640px',
  vacio,
  acciones,
  accionFila,
  onEditarCelda,
  onEditarMasivo,
  onEliminar,
}: {
  columnas: ColumnaTabla[]
  filas: FilaTabla[]
  /** Nombre del conjunto; se usa en el Excel y en los textos. */
  titulo: string
  permisos?: PermisosTabla
  seleccionable?: boolean
  minAncho?: string
  vacio?: { titulo: string; descripcion?: string }
  acciones?: ReactNode
  accionFila?: (fila: FilaTabla) => ReactNode
  onEditarCelda?: (id: string, key: string, valor: unknown) => Promise<void> | void
  onEditarMasivo?: (ids: string[], cambios: Record<string, unknown>) => Promise<void>
  onEliminar?: (ids: string[]) => Promise<void>
}) {
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState<{ key: string; asc: boolean } | null>(null)
  const [filtros, setFiltros] = useState<Filtros>({})
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [abrirMasivo, setAbrirMasivo] = useState(false)
  const [abrirBorrar, setAbrirBorrar] = useState(false)

  const puedeEditar = permisos.editar !== false
  const puedeEliminar = permisos.eliminar !== false && Boolean(onEliminar)
  const puedeDescargar = permisos.descargar !== false

  // Red de seguridad: el tipo exige `id`, pero una función de la base que
  // devuelve `lote_temporada_id` y llega con un cast se cuela igual, y
  // entonces React se queda sin key y la selección se confunde entre filas.
  // Se les pone un id derivado de la posición en vez de fallar.
  const conId = useMemo(
    () =>
      filas.map((f, i) =>
        typeof f.id === 'string' && f.id ? f : { ...f, id: `fila-${i}` }
      ),
    [filas]
  )

  /* --------------------------- Filtrado --------------------------- */

  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim())
    let out = conId.filter((f) => {
      for (const [key, filtro] of Object.entries(filtros)) {
        if (!estaActivo(filtro)) continue
        const col = columnas.find((c) => c.key === key)
        if (!col) continue
        if (!pasaFiltro(f, col, filtro)) return false
      }
      if (!q) return true
      return columnas.some((c) => normalizar(textoDe(f, c)).includes(q))
    })

    if (orden) {
      const col = columnas.find((c) => c.key === orden.key)
      if (col) {
        // `toSorted` no está en todos los navegadores de campo todavía;
        // se copia a mano para no mutar las props.
        out = [...out].sort((a, b) => (orden.asc ? comparar(a, b, col) : comparar(b, a, col)))
      }
    }
    return out
  }, [conId, columnas, busqueda, filtros, orden])

  // Las listas de casillas miran las filas que pasan los filtros de LAS
  // DEMÁS columnas, como el autofiltro de Excel: filtrada una zona, la
  // lista de lotes enseña los de esa zona y no los que darían cero filas.
  const opciones = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const c of columnas) {
      if (tipoFiltroDe(c) !== 'seleccion') continue
      const otros = Object.entries(filtros).filter(([k, f]) => k !== c.key && estaActivo(f))
      const base = conId.filter((f) =>
        otros.every(([k, filtro]) => {
          const col = columnas.find((x) => x.key === k)
          return !col || pasaFiltro(f, col, filtro)
        })
      )
      const set = new Set<string>()
      for (const f of base) set.add(textoDe(f, c) || VACIO)
      out[c.key] = [...set].sort((a, b) => {
        if (a === VACIO) return 1
        if (b === VACIO) return -1
        return a.localeCompare(b, 'es', { numeric: true })
      })
    }
    return out
  }, [conId, columnas, filtros])

  const idsVisibles = useMemo(() => new Set(visibles.map((f) => f.id)), [visibles])
  const marcadosVisibles = useMemo(
    () => [...marcados].filter((id) => idsVisibles.has(id)),
    [marcados, idsVisibles]
  )

  // No se poda la selección al filtrar: se deja intacta y TODAS las
  // acciones trabajan sobre `marcadosVisibles`, la intersección con lo que
  // está en pantalla. Así nadie borra algo que el filtro le está tapando,
  // y quitar el filtro devuelve la selección tal como estaba.

  const todosMarcados = visibles.length > 0 && marcadosVisibles.length === visibles.length

  function alternarTodos() {
    setMarcados(todosMarcados ? new Set() : new Set(visibles.map((f) => f.id)))
  }

  function alternarFila(id: string) {
    setMarcados((prev) => {
      const copia = new Set(prev)
      if (copia.has(id)) copia.delete(id)
      else copia.add(id)
      return copia
    })
  }

  function alternarOrden(key: string) {
    setOrden((prev) => {
      if (!prev || prev.key !== key) return { key, asc: true }
      if (prev.asc) return { key, asc: false }
      return null // tercer clic: se quita el orden
    })
  }

  const hayFiltros = Object.values(filtros).some(estaActivo)

  function exportar() {
    const encabezado = columnas.map((c) => c.label)
    const cuerpo: CeldaHoja[][] = visibles.map((f) =>
      columnas.map((c) => {
        const v = f[c.key]
        if (c.tipo === 'numero') return v === null || v === undefined ? '' : Number(v)
        return textoDe(f, c)
      })
    )
    descargar(
      construirXlsx(titulo, [encabezado, ...cuerpo]),
      `${normalizar(titulo).replace(/[^a-z0-9]+/g, '-')}.xlsx`
    )
  }

  /* ----------------------------- Vista ---------------------------- */

  return (
    <div className="flex flex-col gap-3">
      {/* -------------------- Barra de herramientas -------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en toda la tabla…"
            inputMode="search"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>

        {(hayFiltros || orden || busqueda) && (
          <button
            onClick={() => {
              setFiltros({})
              setOrden(null)
              setBusqueda('')
            }}
            className="rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            Limpiar filtros
          </button>
        )}

        {/* En el celular no hay encabezados que tocar, así que el orden va
            en un selector. El filtro por columna sí queda sólo en
            escritorio: en un teléfono la búsqueda global resuelve mejor. */}
        <select
          value={orden ? `${orden.key}|${orden.asc ? 'asc' : 'desc'}` : ''}
          onChange={(e) => {
            const v = e.target.value
            if (!v) return setOrden(null)
            const [key, dir] = v.split('|')
            setOrden({ key, asc: dir === 'asc' })
          }}
          className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm font-medium focus:border-brand-600 focus:outline-none sm:hidden"
          aria-label="Ordenar"
        >
          <option value="">Sin orden</option>
          {columnas.map((c) => (
            <Fragment key={c.key}>
              <option value={`${c.key}|asc`}>{c.label} ↑</option>
              <option value={`${c.key}|desc`}>{c.label} ↓</option>
            </Fragment>
          ))}
        </select>

        {acciones}

        {puedeDescargar && (
          <Boton
            variante="secundario"
            tamano="sm"
            onClick={exportar}
            disabled={visibles.length === 0}
          >
            <IconSend className="h-4 w-4" />
            Exportar
          </Boton>
        )}
      </div>

      {/* --------------------- Barra de selección --------------------- */}
      {seleccionable && marcadosVisibles.length > 0 && (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 shadow-[var(--shadow-card)] lg:top-2">
          <span className="text-sm font-bold text-brand-800">
            {marcadosVisibles.length} seleccionado{marcadosVisibles.length === 1 ? '' : 's'}
          </span>
          <button
            onClick={() => setMarcados(new Set())}
            className="text-xs font-semibold text-brand-700 underline"
          >
            Limpiar selección
          </button>

          <div className="ml-auto flex flex-wrap gap-2">
            {puedeEditar && onEditarMasivo && (
              <Boton variante="secundario" tamano="sm" onClick={() => setAbrirMasivo(true)}>
                <IconPencil className="h-4 w-4" />
                Cambiar en masa
              </Boton>
            )}
            {puedeEliminar && (
              <Boton variante="peligro" tamano="sm" onClick={() => setAbrirBorrar(true)}>
                <IconTrash className="h-4 w-4" />
                Eliminar
              </Boton>
            )}
          </div>
        </div>
      )}

      {/* ---------------------------- Tabla ---------------------------- */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[var(--shadow-card)]">
        {visibles.length === 0 ? (
          <EstadoVacio
            icono={<IconInbox />}
            titulo={
              conId.length === 0 ? (vacio?.titulo ?? 'Sin registros') : 'Nada coincide con el filtro'
            }
            descripcion={
              conId.length === 0
                ? vacio?.descripcion
                : 'Prueba quitando algún filtro o cambiando la búsqueda.'
            }
          />
        ) : (
          <>
            {/* -------------------- Celular: tarjetas -------------------- */}
            <div className="flex flex-col divide-y divide-slate-100 sm:hidden">
              {visibles.map((fila) => {
                const marcada = marcados.has(fila.id)
                const [principal, ...resto] = columnas
                return (
                  <div
                    key={fila.id}
                    className={`px-3 py-3 ${marcada ? 'bg-brand-50/50' : ''}`}
                  >
                    <div className="flex items-start gap-2.5">
                      {seleccionable && (
                        <span className="pt-0.5">
                          <Casilla
                            marcada={marcada}
                            onClick={() => alternarFila(fila.id)}
                            etiqueta="Seleccionar"
                          />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <Celda
                          fila={fila}
                          columna={principal}
                          editable={
                            puedeEditar && Boolean(principal.editable) && Boolean(onEditarCelda)
                          }
                          onGuardar={(v) => onEditarCelda?.(fila.id, principal.key, v)}
                        />
                      </div>
                      {accionFila && <span className="shrink-0">{accionFila(fila)}</span>}
                    </div>

                    <dl className="mt-2 grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-x-3 gap-y-1.5">
                      {resto.map((c) => (
                        <Fragment key={c.key}>
                          <dt className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            {c.label}
                          </dt>
                          <dd className="min-w-0">
                            <Celda
                              fila={fila}
                              columna={c}
                              editable={puedeEditar && Boolean(c.editable) && Boolean(onEditarCelda)}
                              onGuardar={(v) => onEditarCelda?.(fila.id, c.key, v)}
                            />
                          </dd>
                        </Fragment>
                      ))}
                    </dl>
                  </div>
                )
              })}
            </div>

            {/* ------------------ Escritorio: tabla ---------------------- */}
            <div className="scroll-suave hidden max-h-[70svh] overflow-auto sm:block">
              <table className="w-full text-sm" style={{ minWidth: minAncho }}>
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr className="border-b border-slate-200 text-left">
                    {seleccionable && (
                      <th className="w-10 px-2 py-2">
                        <Casilla marcada={todosMarcados} onClick={alternarTodos} etiqueta="Todos" />
                      </th>
                    )}
                    {columnas.map((c) => (
                      <Encabezado
                        key={c.key}
                        columna={c}
                        orden={orden}
                        onOrdenar={() => alternarOrden(c.key)}
                        filtro={filtros[c.key] ?? filtroVacio(tipoFiltroDe(c))}
                        opciones={opciones[c.key] ?? []}
                        onFiltrar={(f) =>
                          setFiltros((prev) => {
                            const copia = { ...prev }
                            if (estaActivo(f)) copia[c.key] = f
                            else delete copia[c.key]
                            return copia
                          })
                        }
                      />
                    ))}
                    {accionFila && <th className="w-10 px-2 py-2" />}
                  </tr>
                </thead>
  
                <tbody>
                  {visibles.map((fila) => {
                    const marcada = marcados.has(fila.id)
                    return (
                      <tr
                        key={fila.id}
                        className={`border-b border-slate-50 transition-colors last:border-0 ${
                          marcada ? 'bg-brand-50/50' : 'hover:bg-slate-50/60'
                        }`}
                      >
                        {seleccionable && (
                          <td className="px-2 py-1.5">
                            <Casilla
                              marcada={marcada}
                              onClick={() => alternarFila(fila.id)}
                              etiqueta="Seleccionar fila"
                            />
                          </td>
                        )}
  
                        {columnas.map((c) => (
                          <td
                            key={c.key}
                            className={`px-3 py-1.5 ${
                              c.alinear === 'derecha' ? 'text-right' : ''
                            }`}
                          >
                            <Celda
                              fila={fila}
                              columna={c}
                              editable={puedeEditar && Boolean(c.editable) && Boolean(onEditarCelda)}
                              onGuardar={(v) => onEditarCelda?.(fila.id, c.key, v)}
                            />
                          </td>
                        ))}
  
                        {accionFila && <td className="px-2 py-1.5">{accionFila(fila)}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <p className="px-1 text-xs text-slate-400">
        {visibles.length === conId.length
          ? `${conId.length} fila${conId.length === 1 ? '' : 's'}`
          : `${visibles.length} de ${conId.length} filas`}
        {puedeEditar && onEditarCelda
          ? ' · toca una celda para editarla; se guarda con Enter o al salir'
          : ''}
        <span className="hidden sm:inline">
          {' · toca un encabezado para ordenar, el embudo para filtrar'}
        </span>
      </p>

      {/* ------------------------ Cambios en masa ---------------------- */}
      {onEditarMasivo && (
        <ModalMasivo
          abierto={abrirMasivo}
          onCerrar={() => setAbrirMasivo(false)}
          columnas={columnas.filter((c) => c.editable && !c.sinMasivo)}
          cantidad={marcadosVisibles.length}
          onAplicar={async (cambios) => {
            await onEditarMasivo(marcadosVisibles, cambios)
            setAbrirMasivo(false)
            setMarcados(new Set())
          }}
        />
      )}

      {/* --------------------------- Borrado --------------------------- */}
      {onEliminar && (
        <ModalBorrar
          abierto={abrirBorrar}
          onCerrar={() => setAbrirBorrar(false)}
          cantidad={marcadosVisibles.length}
          titulo={titulo}
          onConfirmar={async () => {
            await onEliminar(marcadosVisibles)
            setAbrirBorrar(false)
            setMarcados(new Set())
          }}
        />
      )}
    </div>
  )
}

/* ================================================================== */
/* Cómo se filtra cada columna                                         */
/* ================================================================== */

/**
 * Por omisión lo decide el tipo de la columna: una fecha por rango, un
 * número por mínimo y máximo, y todo lo demás por lista de casillas, que
 * es como se comportaba esta tabla desde el principio y funciona bien con
 * catálogos. Una columna puede pedir otra cosa con `filtro`.
 */
export function tipoFiltroDe(col: ColumnaTabla): TipoFiltro {
  if (col.filtro) return col.filtro
  if (col.tipo === 'fecha') return 'fecha'
  if (col.tipo === 'numero') return 'numero'
  return 'seleccion'
}

function numeroDe(bruto: string): number | null {
  const t = bruto.trim().replace(/,/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function pasaFiltro(fila: FilaTabla, col: ColumnaTabla, f: Filtro): boolean {
  if (!estaActivo(f)) return true
  const bruto = fila[col.key]

  switch (f.tipo) {
    case 'seleccion':
      return f.valores.includes(textoDe(fila, col) || VACIO)

    case 'texto': {
      const t = textoDe(fila, col)
      return t ? normalizar(t).includes(normalizar(f.texto.trim())) : false
    }

    case 'fecha': {
      if (bruto === null || bruto === undefined || bruto === '') return false
      // En ISO, comparar como texto es comparar como fecha.
      const iso = String(bruto).slice(0, 10)
      if (f.desde && iso < f.desde) return false
      if (f.hasta && iso > f.hasta) return false
      return true
    }

    case 'numero': {
      if (bruto === null || bruto === undefined || bruto === '') return false
      const n = Number(bruto)
      if (!Number.isFinite(n)) return false
      const min = numeroDe(f.min)
      const max = numeroDe(f.max)
      if (min !== null && n < min) return false
      if (max !== null && n > max) return false
      return true
    }
  }
}

/* ================================================================== */
/* Encabezado con orden y filtro                                       */
/* ================================================================== */

function Encabezado({
  columna,
  orden,
  onOrdenar,
  filtro,
  opciones,
  onFiltrar,
}: {
  columna: ColumnaTabla
  orden: { key: string; asc: boolean } | null
  onOrdenar: () => void
  filtro: Filtro
  opciones: string[]
  onFiltrar: (f: Filtro) => void
}) {
  const activo = orden?.key === columna.key
  const texto = resumenFiltro(filtro)

  return (
    <th
      className="whitespace-nowrap px-3 py-2 align-top text-[11px] font-bold uppercase tracking-wide text-slate-500"
      style={columna.ancho ? { width: columna.ancho } : undefined}
    >
      <span
        className={`flex items-center gap-1 ${columna.alinear === 'derecha' ? 'justify-end' : ''}`}
      >
        <button
          onClick={onOrdenar}
          className="inline-flex items-center gap-1 rounded transition-colors hover:text-slate-900"
          title={`Ordenar por ${columna.label}`}
        >
          {columna.label}
          <span className={activo ? 'text-brand-700' : 'text-slate-300'}>
            {activo ? (orden.asc ? '▲' : '▼') : '↕'}
          </span>
        </button>

        <FiltroColumna
          tipo={tipoFiltroDe(columna)}
          etiqueta={columna.label}
          filtro={filtro}
          opciones={opciones}
          onCambiar={onFiltrar}
        />
      </span>

      {texto && (
        <button
          type="button"
          onClick={() => onFiltrar(filtroVacio(tipoFiltroDe(columna)))}
          title="Limpiar este filtro"
          className={`mt-1 flex max-w-full items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-brand-800 hover:bg-brand-100 ${
            columna.alinear === 'derecha' ? 'ml-auto' : ''
          }`}
        >
          <span className="truncate">{texto}</span>
          <span className="shrink-0 text-brand-500">×</span>
        </button>
      )}
    </th>
  )
}


/* ================================================================== */
/* Celda                                                               */
/* ================================================================== */

function Celda({
  fila,
  columna,
  editable,
  onGuardar,
}: {
  fila: FilaTabla
  columna: ColumnaTabla
  editable: boolean
  onGuardar: (valor: unknown) => void
}) {
  if (columna.render) return <>{columna.render(fila)}</>

  const valor = fila[columna.key]

  if (columna.tipo === 'booleano') {
    return (
      <button
        type="button"
        disabled={!editable}
        onClick={() => onGuardar(!valor)}
        className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-60 ${
          valor ? 'bg-brand-600' : 'bg-slate-200'
        }`}
        aria-label={columna.label}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            valor ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    )
  }

  if (columna.tipo === 'seleccion') {
    if (!editable) {
      const etiqueta = (columna.opciones ?? []).find((o) => o.value === String(valor))?.label
      return <span className="text-slate-600">{etiqueta ?? '—'}</span>
    }
    return (
      <SelectorCelda
        valor={valor === null || valor === undefined ? '' : String(valor)}
        opciones={columna.opciones ?? []}
        onElegir={(v) => onGuardar(v || null)}
        className="w-full min-w-[120px] rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-slate-200 focus:border-brand-600 focus:bg-white focus:outline-none"
      />
    )
  }

  if (!editable) {
    const texto = textoDe(fila, columna)
    return (
      <span className={columna.tipo === 'numero' ? 'tabular-nums text-slate-700' : 'text-slate-700'}>
        {texto || <span className="text-slate-300">—</span>}
      </span>
    )
  }

  return <CeldaEditable valor={valor} columna={columna} onGuardar={onGuardar} />
}

function CeldaEditable({
  valor,
  columna,
  onGuardar,
}: {
  valor: unknown
  columna: ColumnaTabla
  onGuardar: (valor: unknown) => void
}) {
  const inicial = valor === null || valor === undefined ? '' : String(valor)
  const [borrador, setBorrador] = useState(inicial)
  const [servidor, setServidor] = useState(inicial)

  // Ajuste de estado durante el render (patrón documentado de React): si el
  // servidor devolvió otro valor, el borrador se pone al día.
  if (inicial !== servidor) {
    setServidor(inicial)
    setBorrador(inicial)
  }

  function confirmar() {
    if (borrador === inicial) return
    if (columna.tipo === 'numero') {
      if (borrador !== '' && Number.isNaN(Number(borrador))) {
        setBorrador(inicial)
        return
      }
      onGuardar(borrador === '' ? null : Number(borrador))
      return
    }
    onGuardar(borrador === '' ? null : borrador)
  }

  return (
    <input
      value={borrador}
      type={columna.tipo === 'fecha' ? 'date' : 'text'}
      inputMode={columna.tipo === 'numero' ? 'decimal' : undefined}
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
      className={`w-full min-w-[90px] rounded-md border border-transparent px-1.5 py-1 transition-colors hover:border-slate-200 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-600/10 ${
        columna.alinear === 'derecha' || columna.tipo === 'numero' ? 'text-right tabular-nums' : ''
      }`}
    />
  )
}

/* ================================================================== */
/* Piezas sueltas                                                      */
/* ================================================================== */

function Casilla({
  marcada,
  onClick,
  etiqueta,
}: {
  marcada: boolean
  onClick?: () => void
  etiqueta: string
}) {
  const clases = `flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
    marcada ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'
  }`
  const contenido = marcada ? <IconCheck className="h-3 w-3" /> : null

  if (!onClick) return <span className={clases}>{contenido}</span>
  return (
    <button type="button" onClick={onClick} className={clases} aria-label={etiqueta}>
      {contenido}
    </button>
  )
}

function ModalMasivo({
  abierto,
  onCerrar,
  columnas,
  cantidad,
  onAplicar,
}: {
  abierto: boolean
  onCerrar: () => void
  columnas: ColumnaTabla[]
  cantidad: number
  onAplicar: (cambios: Record<string, unknown>) => Promise<void>
}) {
  const [campo, setCampo] = useState('')
  const [valor, setValor] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const columna = columnas.find((c) => c.key === campo)

  async function aplicar() {
    if (!columna) return setError('Elige qué campo quieres cambiar.')
    setError(null)
    setGuardando(true)
    try {
      let v: unknown = valor
      if (columna.tipo === 'numero') {
        if (valor !== '' && Number.isNaN(Number(valor))) throw new Error('Ese no es un número.')
        v = valor === '' ? null : Number(valor)
      } else if (columna.tipo === 'booleano') {
        v = valor === 'si'
      } else if (valor === '') {
        v = null
      }
      await onAplicar({ [columna.key]: v })
      setCampo('')
      setValor('')
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo aplicar el cambio.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Cambiar en masa"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={aplicar} disabled={guardando || !campo}>
            {guardando ? 'Aplicando…' : `Aplicar a ${cantidad}`}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">
          El mismo valor se va a escribir en {cantidad} fila{cantidad === 1 ? '' : 's'}. Los demás
          campos no se tocan.
        </p>

        {columnas.length === 0 ? (
          <Alerta tono="ambar">Esta tabla no tiene campos que se puedan cambiar en masa.</Alerta>
        ) : (
          <>
            <Campo etiqueta="Campo a cambiar" requerido>
              <Selector
                value={campo}
                onChange={(e) => {
                  setCampo(e.target.value)
                  setValor('')
                }}
                autoFocus
              >
                <option value="">Selecciona…</option>
                {columnas.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Selector>
            </Campo>

            {columna && (
              <Campo etiqueta="Nuevo valor" ayuda="Déjalo vacío para borrar el contenido del campo.">
                {columna.tipo === 'seleccion' ? (
                  <Selector value={valor} onChange={(e) => setValor(e.target.value)}>
                    <option value="">—</option>
                    {(columna.opciones ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Selector>
                ) : columna.tipo === 'booleano' ? (
                  <Selector value={valor} onChange={(e) => setValor(e.target.value)}>
                    <option value="no">No</option>
                    <option value="si">Sí</option>
                  </Selector>
                ) : (
                  <Entrada
                    type={columna.tipo === 'fecha' ? 'date' : 'text'}
                    inputMode={columna.tipo === 'numero' ? 'decimal' : undefined}
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                  />
                )}
              </Campo>
            )}
          </>
        )}

        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}

function ModalBorrar({
  abierto,
  onCerrar,
  cantidad,
  titulo,
  onConfirmar,
}: {
  abierto: boolean
  onCerrar: () => void
  cantidad: number
  titulo: string
  onConfirmar: () => Promise<void>
}) {
  const [borrando, setBorrando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirmar() {
    setError(null)
    setBorrando(true)
    try {
      await onConfirmar()
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo eliminar.'))
    } finally {
      setBorrando(false)
    }
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Eliminar"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={borrando}>
            Cancelar
          </Boton>
          <Boton variante="peligro" className="flex-1" onClick={confirmar} disabled={borrando}>
            {borrando ? 'Eliminando…' : `Eliminar ${cantidad}`}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">
          Se van a eliminar {cantidad} fila{cantidad === 1 ? '' : 's'} de {titulo}. Esto no se puede
          deshacer.
        </p>
        <p className="text-sm text-slate-400">
          Lo que ya tenga movimiento registrado no se borra: la base lo rechaza y te dice cuántas
          labores lo están usando, para que lo desactives en vez de perder el histórico.
        </p>
        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}

/** Botón de borrado de una sola fila, para usar en `accionFila`. */
export function BotonBorrarFila({ onClick, titulo }: { onClick: () => void; titulo: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
    >
      <IconTrash className="h-4 w-4" />
    </button>
  )
}
