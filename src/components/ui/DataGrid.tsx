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

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from 'react'
import { Boton, Esqueleto, EstadoVacio, Girador } from './Primitivos'
import { FiltroColumna } from './FiltroColumna'
import { SelectorCelda } from './SelectorCelda'
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
import { useHidratado } from '@/lib/ui/hidratado'
import type { ColumnaGrid, Filtro, Filtros, Orden } from '@/lib/grid/tipos'
import {
  agregacionesDe,
  calcular,
  guardarAgregaciones,
  leerAgregaciones,
  type Agregaciones,
  type Resultado,
  type TipoAgregacion,
} from '@/lib/grid/agregacion'
import { PieAgregacion } from './PieAgregacion'
import {
  aTsv,
  esRango,
  matrizDeRango,
  parsearTsv,
  planearPegado,
} from '@/lib/grid/portapapeles'

export type { ColumnaGrid } from '@/lib/grid/tipos'

/**
 * Filas dibujadas de entrada, y cuántas se añaden al llegar al final.
 *
 * No es una página de datos: los datos ya están todos aquí. Es cuántas
 * FILAS DE HTML existen a la vez. Con nueve mil líneas de labores, el
 * navegador tarda varios segundos en pintar la tabla y el teléfono se
 * queda congelado; con doscientas es instantáneo y al bajar aparecen las
 * siguientes sin pedirle nada a la base.
 *
 * Por eso el Excel NO usa esto: exporta `visibles`, que son todas las
 * filas que pasan los filtros, se hayan pintado o no.
 */
const POR_TANDA = 200

/** A cuántos píxeles del fondo se traen las siguientes. */
const MARGEN_FONDO = 600

/** Rango de celdas marcado, en índices de `visibles` × `columnas`. */
type Rango = { f0: number; c0: number; f1: number; c1: number }

const normal = (r: Rango) => ({
  fa: Math.min(r.f0, r.f1),
  fb: Math.max(r.f0, r.f1),
  ca: Math.min(r.c0, r.c1),
  cb: Math.max(r.c0, r.c1),
})

/** La celda de la tabla (td con `data-col`) desde la que salió el evento. */
function celdaDe(el: EventTarget | null): { fila: number; col: number } | null {
  const td = (el as HTMLElement | null)?.closest?.('td[data-col]') as HTMLElement | null
  const tr = td?.closest('tr[data-fila]') as HTMLElement | null
  if (!td || !tr) return null
  return { fila: Number(tr.dataset.fila), col: Number(td.dataset.col) }
}

/** ¿El foco está en un campo con texto seleccionado a mano? */
function hayTextoElegido(el: EventTarget | null): boolean {
  const i = el as HTMLInputElement | null
  if (i && (i.tagName === 'INPUT' || i.tagName === 'TEXTAREA')) {
    try {
      return i.selectionStart !== null && i.selectionStart !== i.selectionEnd
    } catch {
      return false // type="date" no tiene selección
    }
  }
  return (window.getSelection()?.toString() ?? '') !== ''
}

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
  exportacionesExtra,
  accionesSeleccion,
  accionFila,
  resaltar,
  vacio,
  puedeExportar = true,
  filtrosExternos,
  onEditarCelda,
  puedeEditarCelda = false,
  cargando = false,
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
  /**
   * Botones de exportación propios de la pantalla, junto al Excel
   * estándar. Reciben las filas TAL COMO SE VEN —filtradas y ordenadas—,
   * que es lo único que la cuadrícula sabe y la pantalla no: qué formato
   * espera SAP lo decide quien la usa, no este componente.
   */
  exportacionesExtra?: (visibles: T[]) => ReactNode
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
  /**
   * Hay una consulta en vuelo.
   *
   * Sin esto, volver a consultar con otro rango dejaba la tabla quieta
   * enseñando lo anterior: nada se movía y parecía colgada. Con filas
   * todavía en pantalla se mantienen visibles pero atenuadas y con el
   * aviso encima —lo viejo sigue siendo útil mientras llega lo nuevo—;
   * sin filas, se dibuja el esqueleto.
   */
  cargando?: boolean
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

  /* ------------------------- Carga progresiva ------------------------ */

  // Cuántas filas están pintadas. Se reinicia cuando cambia LO QUE SE VE
  // —otro filtro, otra búsqueda, otro orden, otra consulta—, porque
  // conservar «voy por la fila 3.000» sobre una lista nueva dejaría la
  // tabla arrancando por la mitad de algo que nadie ha desplazado.
  //
  // El reinicio va en el RENDER y no en un efecto: es el patrón que React
  // documenta para reajustar estado cuando cambia una prop, y en React 19
  // hacerlo desde un efecto además es error de lint.
  const [pintadas, setPintadas] = useState(POR_TANDA)
  const [rango, setRango] = useState<Rango | null>(null)
  const huella = `${filas.length}|${JSON.stringify(filtros)}|${busqueda}|${orden?.campo ?? ''}|${orden?.direccion ?? ''}`
  const [huellaPrevia, setHuellaPrevia] = useState(huella)
  if (huella !== huellaPrevia) {
    setHuellaPrevia(huella)
    setPintadas(POR_TANDA)
    setRango(null)
  }

  const contenedor = useRef<HTMLDivElement | null>(null)
  const enPantalla = useMemo(() => visibles.slice(0, pintadas), [visibles, pintadas])
  const faltanPorPintar = visibles.length - enPantalla.length

  function alDesplazar(e: UIEvent<HTMLDivElement>) {
    if (faltanPorPintar <= 0) return
    const c = e.currentTarget
    if (c.scrollHeight - c.scrollTop - c.clientHeight < MARGEN_FONDO) {
      setPintadas((n) => n + POR_TANDA)
    }
  }

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

  /* --------------------- Los totales del pie ----------------------- */

  /*
   * Qué total lleva cada columna.
   *
   * **Esto leía `localStorage` en el inicializador del `useState` y era
   * un desajuste de hidratación en toda regla** (migración 69). El
   * `typeof window === 'undefined'` no protegía de nada: durante la
   * hidratación `window` YA existe, así que el servidor pintaba el pie
   * en «Ninguno» y el navegador lo pintaba con lo guardado. React
   * lanzaba el error 418, tiraba el HTML del servidor y **volvía a
   * pintar el árbol entero en el cliente**. En una tabla de miles de
   * filas eso es el congelamiento que se reportaba desde el campo.
   *
   * Ahora el primer render del navegador es idéntico al del servidor
   * —sin totales— y lo guardado entra cuando la hidratación ya terminó.
   * Se cambió un cuadro de parpadeo por no re-pintar la pantalla entera.
   */
  const hidratado = useHidratado()
  const [elegidas, setElegidas] = useState<Agregaciones | null>(null)
  const guardadas = useMemo(
    () => (hidratado ? leerAgregaciones(titulo) : {}),
    [hidratado, titulo]
  )
  const agregaciones = elegidas ?? guardadas

  function elegirAgregacion(campo: string, tipo: TipoAgregacion) {
    const siguiente = { ...agregaciones, [campo]: tipo }
    guardarAgregaciones(titulo, siguiente)
    setElegidas(siguiente)
  }

  // Se calcula sobre `visibles` —lo filtrado y buscado— y NO sobre
  // `enPantalla`, que es sólo lo pintado hasta donde se ha desplazado.
  // Un total que creciera al bajar con el dedo sería un sinsentido.
  const totales = useMemo(() => {
    const salida: Record<string, Resultado> = {}
    for (const c of columnas) {
      const tipo = agregaciones[c.campo] ?? 'ninguna'
      salida[c.campo] = tipo === 'ninguna' ? null : calcular(visibles, c, tipo)
    }
    return salida
  }, [visibles, columnas, agregaciones])

  // ¿Hay algún total elegido? Sólo decide el GROSOR de la fila, no si se
  // pega abajo.
  //
  // Al principio el pie era `sticky` únicamente cuando ya había un total
  // elegido, y eso lo volvía inalcanzable: con cuatrocientas líneas de
  // labores el pie quedaba debajo de las cuatrocientas, así que para
  // poder ELEGIR un total había que desplazarse hasta el final de la
  // tabla. Con un filtro puesto la tabla se acortaba y el pie aparecía,
  // de donde salía la impresión de que los totales «sólo funcionan con
  // filtro». Funcionaban; lo que no se veía era dónde tocar.
  const hayTotales = columnas.some((c) => (agregaciones[c.campo] ?? 'ninguna') !== 'ninguna')

  /* ------------------ Portapapeles (SAP / Excel) ------------------- */

  /*
   * Copiar y pegar rangos como en Excel. SAP GUI y Excel intercambian TSV
   * (tabulador entre columnas, salto entre filas); la conversión y el
   * reparto viven en `lib/grid/portapapeles`, puros, para que cualquier
   * cuadrícula de captura futura se comporte igual.
   *
   *   · Clic en una celda la vuelve activa; Mayús+clic o arrastrar marca
   *     un rango.
   *   · Ctrl+C con un rango (o con filas marcadas y nada escrito
   *     seleccionado) copia TSV. Con texto elegido dentro de un campo se
   *     deja el copiado normal del navegador.
   *   · Ctrl+V de VARIAS celdas reparte desde la celda activa hacia la
   *     derecha y abajo, celda a celda por `onEditarCelda`: la misma vía,
   *     las mismas validaciones y el mismo RLS que escribir a mano. Un
   *     valor suelto se pega como siempre dentro del campo —la edición
   *     in situ no cambia—, salvo sobre un rango marcado, que lo rellena.
   */
  const arrastrando = useRef(false)
  const [pegando, setPegando] = useState(false)
  const [avisoPortapapeles, setAvisoPortapapeles] = useState<string | null>(null)
  const sePuedePegar = puedeEditarCelda && Boolean(onEditarCelda)

  const editableEn = (f: T, c: ColumnaGrid<T>) =>
    sePuedePegar && (typeof c.editable === 'function' ? c.editable(f) : Boolean(c.editable))

  /** Lo que una celda manda al portapapeles: el número crudo o lo que se lee. */
  const textoCopia = (f: T, c: ColumnaGrid<T>) => {
    if (c.numero) {
      const v = c.valor(f)
      return v === null || v === undefined ? '' : String(v)
    }
    return textoDe(f, c)
  }

  const enRango = (fila: number, col: number) => {
    if (!rango) return false
    const { fa, fb, ca, cb } = normal(rango)
    return fila >= fa && fila <= fb && col >= ca && col <= cb
  }
  const rangoMultiple = rango !== null && (rango.f0 !== rango.f1 || rango.c0 !== rango.c1)

  function avisar(texto: string) {
    setAvisoPortapapeles(texto)
    window.setTimeout(() => setAvisoPortapapeles((a) => (a === texto ? null : a)), 6000)
  }

  /** La matriz a copiar ahora mismo, o null si no hay nada que copiar. */
  function matrizACopiar(): string[][] | null {
    if (rango && rangoMultiple) {
      const { fa, fb, ca, cb } = normal(rango)
      return matrizDeRango(visibles.slice(fa, fb + 1), columnas.slice(ca, cb + 1), textoCopia)
    }
    if (marcadasVisibles.length > 0) {
      const cols = columnas.filter((c) => !c.sinExportar && c.tipo !== 'ninguno')
      return matrizDeRango(
        visibles.filter((f) => marcadas.has(f.id)),
        cols,
        textoCopia
      )
    }
    if (rango) {
      const f = visibles[rango.f0]
      const c = columnas[rango.c0]
      return f && c ? [[textoCopia(f, c)]] : null
    }
    return null
  }

  function alCopiar(e: ClipboardEvent<HTMLDivElement>) {
    if (!rangoMultiple && hayTextoElegido(e.target)) return
    const matriz = matrizACopiar()
    if (!matriz || matriz.length === 0) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', aTsv(matriz))
    const celdas = matriz.length * (matriz[0]?.length ?? 0)
    if (celdas > 1) avisar(`${celdas} celdas copiadas. Pégalas en SAP o Excel con Ctrl+V.`)
  }

  /** Botón de la barra de selección: las filas marcadas al portapapeles. */
  async function copiarMarcadas() {
    const cols = columnas.filter((c) => !c.sinExportar && c.tipo !== 'ninguno')
    const matriz = matrizDeRango(
      visibles.filter((f) => marcadas.has(f.id)),
      cols,
      textoCopia
    )
    try {
      await navigator.clipboard.writeText(aTsv([cols.map((c) => c.label), ...matriz]))
      avisar(`${matriz.length} ${matriz.length === 1 ? 'fila copiada' : 'filas copiadas'} con encabezados.`)
    } catch {
      avisar('El navegador no dejó usar el portapapeles. Usa Ctrl+C sobre la tabla.')
    }
  }

  async function alPegar(e: ClipboardEvent<HTMLDivElement>) {
    if (!sePuedePegar || pegando) return
    const destino = celdaDe(e.target)
    if (!destino) return
    let matriz = parsearTsv(e.clipboardData.getData('text/plain'))
    if (matriz.length === 0) return

    let inicioFila = destino.fila
    let inicioCol = destino.col
    if (rango && rangoMultiple && enRango(destino.fila, destino.col)) {
      const { fa, fb, ca, cb } = normal(rango)
      inicioFila = fa
      inicioCol = ca
      // Un valor suelto sobre un rango lo rellena entero, como Excel.
      if (!esRango(matriz)) {
        const v = matriz[0][0]
        matriz = Array.from({ length: fb - fa + 1 }, () => Array.from({ length: cb - ca + 1 }, () => v))
      }
    } else if (!esRango(matriz)) {
      // Un valor suelto DENTRO de un campo que se está editando: pegado
      // normal del navegador. Sobre una celda sólo seleccionada, la
      // reemplaza, como Excel.
      const t = (e.target as HTMLElement).tagName
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return
    }

    e.preventDefault()
    const plan = planearPegado(matriz, visibles, columnas, inicioFila, inicioCol, editableEn)
    if (plan.cambios.length === 0) {
      avisar(
        plan.saltadas + plan.invalidas > 0
          ? `Nada que pegar: ${plan.saltadas} celdas de sólo lectura o fuera de la tabla, ${plan.invalidas} con valores que la columna no admite.`
          : 'Lo pegado ya coincide con lo que hay.'
      )
      return
    }

    ;(document.activeElement as HTMLElement | null)?.blur?.()
    setPegando(true)
    let fallidas = 0
    // Una a una y en orden: es la misma escritura que a mano, y en
    // paralelo varias celdas de la misma fila se pisarían.
    for (const c of plan.cambios) {
      try {
        await onEditarCelda?.(c.fila, c.columna.campo, c.valor)
      } catch {
        fallidas++
      }
    }
    setPegando(false)
    setRango({
      f0: inicioFila,
      c0: inicioCol,
      f1: Math.min(inicioFila + matriz.length - 1, visibles.length - 1),
      c1: Math.min(inicioCol + Math.max(...matriz.map((m) => m.length)) - 1, columnas.length - 1),
    })
    const partes = [`${plan.cambios.length - fallidas} celdas pegadas`]
    if (fallidas) partes.push(`${fallidas} rechazadas al guardar`)
    if (plan.saltadas) partes.push(`${plan.saltadas} de sólo lectura o fuera de la tabla`)
    if (plan.invalidas) partes.push(`${plan.invalidas} con valores no válidos`)
    avisar(partes.join(' · ') + '.')
  }

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

        {exportacionesExtra?.(visibles)}

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
            <Boton variante="secundario" tamano="sm" onClick={copiarMarcadas}>
              Copiar (SAP/Excel)
            </Boton>
            {accionesSeleccion?.(marcadasVisibles, limpiarSeleccion)}
          </div>
        </div>
      )}

      {/* ---------------------------- Tabla -------------------------- */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
        {/* El aviso va DENTRO de la tarjeta y por encima, no empujando
            el contenido: si la tabla diera un salto al empezar cada
            consulta, el dedo que iba al botón acabaría en otro sitio. */}
        {cargando && filas.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-2">
            <span className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/85 px-3 py-1.5 text-xs font-semibold text-white shadow-[var(--shadow-raised)]">
              <Girador className="h-3.5 w-3.5" />
              Consultando…
            </span>
          </div>
        )}

        {(pegando || avisoPortapapeles) && (
          <div
            role="status"
            className="pointer-events-none absolute inset-x-0 bottom-12 z-20 flex justify-center p-2"
          >
            <span className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-white shadow-[var(--shadow-raised)]">
              {pegando && <Girador className="h-3.5 w-3.5" />}
              {pegando ? 'Pegando y guardando celda a celda…' : avisoPortapapeles}
            </span>
          </div>
        )}

        {cargando && filas.length === 0 ? (
          <div className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2 pb-1 text-xs font-semibold text-slate-400">
              <Girador className="h-3.5 w-3.5" />
              Consultando…
            </div>
            {Array.from({ length: 8 }).map((_, i) => (
              <Esqueleto key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : filas.length === 0 ? (
          <EstadoVacio
            icono={<IconInbox />}
            titulo={vacio?.titulo ?? 'Sin registros'}
            descripcion={vacio?.descripcion}
          />
        ) : (
          <>
            <div
              ref={contenedor}
              onScroll={alDesplazar}
              onCopy={alCopiar}
              onPaste={alPegar}
              onMouseUp={() => (arrastrando.current = false)}
              onMouseLeave={() => (arrastrando.current = false)}
              className={`scroll-suave max-h-[70svh] overflow-auto transition-opacity ${
                cargando ? 'pointer-events-none opacity-40' : ''
              }`}
            >
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
                          // `minWidth` y no `width`: en una tabla de ancho
                          // automático el `width` es una sugerencia que el
                          // navegador descarta en cuanto sobran columnas, y
                          // el código del turno se quedaba en «T1001-T…».
                          style={c.ancho ? { minWidth: c.ancho } : undefined}
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
                  {enPantalla.map((f, iFila) => {
                    const extra = resaltar?.(f)
                    return (
                      <tr
                        key={f.id}
                        data-fila={iFila}
                        className={`border-b border-slate-50 transition-colors last:border-0 ${
                          marcadas.has(f.id)
                            ? 'bg-brand-50/50'
                            : (extra ?? 'hover:bg-slate-50/60')
                        }`}
                      >
                        {seleccionable && (
                          <td className="px-2 py-1.5">
                            {/* `role="checkbox"` con `aria-checked`, no un
                                botón a secas: un lector de pantalla tiene
                                que poder decir si la fila está marcada,
                                que es lo único que informa esta casilla. */}
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={marcadas.has(f.id)}
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

                        {columnas.map((c, iCol) => {
                          // `editable` puede ser una función: hay columnas
                          // que sólo aplican a algunas filas.
                          const seEdita =
                            typeof c.editable === 'function' ? c.editable(f) : Boolean(c.editable)
                          const editable = puedeEditarCelda && seEdita && Boolean(onEditarCelda)
                          return (
                            <td
                              key={c.campo}
                              data-col={iCol}
                              onMouseDown={(e) => {
                                if (e.button !== 0) return
                                if (e.shiftKey && rango) {
                                  e.preventDefault()
                                  setRango({ ...rango, f1: iFila, c1: iCol })
                                } else {
                                  arrastrando.current = true
                                  setRango({ f0: iFila, c0: iCol, f1: iFila, c1: iCol })
                                }
                              }}
                              onMouseEnter={(e) => {
                                if (arrastrando.current && e.buttons === 1 && rango) {
                                  setRango({ ...rango, f1: iFila, c1: iCol })
                                }
                              }}
                              onFocus={() => {
                                // Con Tab se mueve la celda activa; dentro
                                // del rango marcado, el rango se respeta.
                                if (!enRango(iFila, iCol)) {
                                  setRango({ f0: iFila, c0: iCol, f1: iFila, c1: iCol })
                                }
                              }}
                              className={`py-1.5 ${editable ? 'px-1' : 'px-3'} ${
                                c.numero ? 'text-right tabular-nums text-slate-700' : 'text-slate-600'
                              } ${
                                rangoMultiple && enRango(iFila, iCol)
                                  ? 'bg-brand-50 outline outline-1 -outline-offset-1 outline-brand-400'
                                  : ''
                              }`}
                            >
                              {editable ? (
                                // Con `sufijo`, la marca va AL LADO del
                                // campo. Una celda editable no dibuja su
                                // `render`, así que sin esto no habría
                                // forma de enseñar nada sobre una celda
                                // que se escribe —por ejemplo, que esas
                                // horas las puso alguien a mano—.
                                c.sufijo ? (
                                  <span className="flex items-center justify-end gap-1">
                                    <Celda
                                      fila={f}
                                      columna={c}
                                      onGuardar={(v) => onEditarCelda?.(f, c.campo, v)}
                                    />
                                    {c.sufijo(f)}
                                  </span>
                                ) : (
                                  <Celda
                                    fila={f}
                                    columna={c}
                                    onGuardar={(v) => onEditarCelda?.(f, c.campo, v)}
                                  />
                                )
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

                {/* El pie va DENTRO de la tabla y pegado abajo: sacarlo
                    a un div aparte lo desalinearía de las columnas en
                    cuanto una tabla tenga desplazamiento horizontal, que
                    es justo cuando más falta hace leerlo. */}
                <tfoot className="sticky bottom-0 z-10 bg-slate-50">
                  <tr className="border-t border-slate-200">
                    {seleccionable && <th className={hayTotales ? 'px-2 py-1.5' : 'px-2 py-0.5'} />}
                    {columnas.map((c) => (
                      <td
                        key={c.campo}
                        className={`align-middle ${hayTotales ? 'px-2 py-1.5' : 'px-2 py-0.5'}`}
                      >
                        <PieAgregacion
                          etiqueta={c.label}
                          tipo={agregaciones[c.campo] ?? 'ninguna'}
                          opciones={agregacionesDe(c)}
                          resultado={totales[c.campo] ?? null}
                          alinearDerecha={Boolean(c.numero)}
                          onElegir={(t) => elegirAgregacion(c.campo, t)}
                        />
                      </td>
                    ))}
                    {hayColumnaAcciones && (
                      <td className={hayTotales ? 'px-3 py-1.5' : 'px-3 py-0.5'} />
                    )}
                  </tr>
                </tfoot>
              </table>

              {/* El botón es el respaldo del desplazamiento: con teclado,
                  o si el contenedor no llega a desbordar, seguir bajando
                  tiene que ser posible sin ratón. */}
              {faltanPorPintar > 0 && (
                <div className="border-t border-slate-100 p-2">
                  <button
                    type="button"
                    onClick={() => setPintadas((n) => n + POR_TANDA)}
                    className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-700"
                  >
                    Cargar más ({enPantalla.length} de {visibles.length})
                  </button>
                </div>
              )}
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
        {faltanPorPintar > 0 && (
          <span className="text-slate-500">
            {' · '}
            {enPantalla.length} dibujadas; baja para ver el resto. El Excel las exporta todas
          </span>
        )}
        <span className="hidden sm:inline">
          {' · toca un encabezado para ordenar, el embudo para filtrar'}
          {puedeEditarCelda && onEditarCelda
            ? ' · escribe sobre una celda para corregirla; se guarda con Enter o al salir · pega rangos de SAP o Excel con Ctrl+V'
            : ''}
          {' · clic selecciona, doble clic o Enter edita · Mayús+clic o arrastra para marcar celdas y Ctrl+C para copiarlas'}
        </span>
      </p>
    </div>
  )
}

/* ================================================================== */
/* Celda editable                                                      */
/* ================================================================== */

/** Las teclas que, sobre una celda seleccionada, empiezan a escribir. */
const esCaracter = (e: KeyboardEvent<HTMLElement>) =>
  e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey

/** Enfoca la celda editable vecina (flechas), saltando las de sólo lectura. */
function moverFoco(desde: HTMLElement, df: number, dc: number) {
  const td = desde.closest('td[data-col]') as HTMLElement | null
  const tr = td?.closest('tr[data-fila]') as HTMLElement | null
  const tabla = tr?.closest('tbody')
  if (!td || !tr || !tabla) return
  let f = Number(tr.dataset.fila)
  let c = Number(td.dataset.col)
  for (let paso = 0; paso < 50; paso++) {
    f += df
    c += dc
    const fila = tabla.querySelector(`tr[data-fila="${f}"]`)
    if (!fila) return
    const vista = fila.querySelector(`td[data-col="${c}"] [data-vista]`) as HTMLElement | null
    if (vista) {
      vista.focus()
      return
    }
    if (!fila.querySelector(`td[data-col="${c}"]`)) return
  }
}

/**
 * Celda estilo Excel: un clic SÓLO la selecciona (para copiar, pegar o
 * marcar un rango arrastrando); entra a editar con doble clic, Enter o F2,
 * o escribiendo directamente encima. Enter guarda, Escape cancela y salir
 * del campo guarda.
 *
 * Antes la celda ERA el campo: cualquier clic abría el editor —el
 * selector desplegaba su panel— y robaba el foco, así que no se podía
 * arrastrar un rango ni Mayús+clic sin abrir controles por el camino.
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
  const [editando, setEditando] = useState(false)
  // Lo tecleado sobre la celda seleccionada reemplaza el valor (Excel):
  // entonces el cursor va al final y no se selecciona todo.
  const reemplazo = useRef(false)
  const envoltura = useRef<HTMLDivElement | null>(null)
  const vista = useRef<HTMLDivElement | null>(null)

  if (inicial !== servidor) {
    setServidor(inicial)
    if (!editando) setBorrador(inicial)
  }

  // Al entrar a editar, el control recibe el foco; el selector, además,
  // se abre. Es DOM puro —ningún estado—, que es lo que un efecto admite.
  useEffect(() => {
    if (!editando) return
    const el = envoltura.current?.querySelector('input, select, button') as
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLButtonElement
      | null
    if (!el) return
    el.focus({ preventScroll: true })
    if (el instanceof HTMLInputElement) {
      if (reemplazo.current && el.type === 'text') {
        const n = el.value.length
        el.setSelectionRange(n, n)
      } else if (el.type === 'text') {
        el.select()
      }
    } else if (el instanceof HTMLButtonElement) {
      el.click()
    } else if (el instanceof HTMLSelectElement) {
      try {
        el.showPicker?.()
      } catch {
        // Sin gesto válido el navegador no deja abrir la rueda: queda enfocado.
      }
    }
    reemplazo.current = false
  }, [editando])

  function salir(volverASeleccion: boolean) {
    setEditando(false)
    if (!volverASeleccion) return
    // Sólo si el foco quedó huérfano: si se cerró el panel haciendo clic
    // en OTRA celda, el foco es de ésa y no se le roba.
    requestAnimationFrame(() => {
      const activo = document.activeElement
      if (!activo || activo === document.body) vista.current?.focus({ preventScroll: true })
    })
  }

  function entrar(texto?: string) {
    if (texto !== undefined) {
      reemplazo.current = true
      setBorrador(texto)
    }
    setEditando(true)
  }

  const clase = `w-full min-w-[70px] rounded-md border px-1.5 py-1 transition-colors ${
    columna.numero ? 'text-right tabular-nums' : ''
  }`
  const claseEditor = `${clase} border-brand-600 bg-white focus:outline-none focus:ring-4 focus:ring-brand-600/10`

  /* ------------------------- Seleccionada -------------------------- */
  if (!editando) {
    const texto =
      columna.editor === 'seleccion'
        ? (columna.opciones ?? []).find((o) => o.value === borrador)?.label ?? borrador
        : borrador
    return (
      <div
        ref={vista}
        data-vista=""
        tabIndex={0}
        role="gridcell"
        aria-readonly={false}
        title="Doble clic, Enter o empieza a escribir para editar"
        onDoubleClick={() => entrar()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'F2') {
            e.preventDefault()
            entrar()
          } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            if (inicial !== '') {
              setBorrador('')
              onGuardar(null)
            }
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            moverFoco(e.currentTarget, 1, 0)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            moverFoco(e.currentTarget, -1, 0)
          } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            moverFoco(e.currentTarget, 0, 1)
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            moverFoco(e.currentTarget, 0, -1)
          } else if (esCaracter(e) && (columna.editor ?? 'texto') !== 'fecha' && columna.editor !== 'seleccion') {
            e.preventDefault()
            entrar(e.key)
          } else if (esCaracter(e)) {
            e.preventDefault()
            entrar()
          }
        }}
        className={`${clase} min-h-[30px] cursor-cell select-none truncate border-transparent hover:border-slate-200 focus:border-brand-600 focus:bg-brand-50/40 focus:outline-none`}
      >
        {texto === '' ? <span className="text-slate-300">—</span> : texto}
      </div>
    )
  }

  /* --------------------------- Editando ---------------------------- */
  if (columna.editor === 'seleccion') {
    return (
      <div
        ref={envoltura}
        onBlur={(e) => {
          // El <select> nativo (catálogos cortos) sale al perder el foco.
          // El panel con buscador NO: su foco se va al buscador y salir
          // aquí lo cerraría; ése avisa por `onCerrar`.
          if (
            e.target instanceof HTMLSelectElement &&
            !e.currentTarget.contains(e.relatedTarget as Node | null)
          ) {
            salir(false)
          }
        }}
      >
        <SelectorCelda
          valor={borrador}
          opciones={columna.opciones ?? []}
          className={claseEditor}
          onCrear={columna.onCrearOpcion}
          onCerrar={() => salir(true)}
          onElegir={(v) => {
            setBorrador(v)
            if (v !== inicial) onGuardar(v || null)
            salir(true)
          }}
        />
      </div>
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
    <div ref={envoltura}>
      <input
        type={columna.editor === 'fecha' ? 'date' : 'text'}
        inputMode={columna.editor === 'numero' ? 'decimal' : undefined}
        value={borrador}
        onChange={(e) => setBorrador(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            confirmar()
            salir(true)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            setBorrador(inicial)
            salir(true)
          }
        }}
        onBlur={() => {
          confirmar()
          salir(false)
        }}
        className={claseEditor}
      />
    </div>
  )
}
