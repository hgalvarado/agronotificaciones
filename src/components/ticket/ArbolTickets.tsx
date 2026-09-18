'use client'

/**
 * El historial de tickets, en árbol: mes → proceso → tickets.
 *
 * Antes la lista traía los últimos cien tickets y punto, así que marzo
 * simplemente no existía. Subir el número no era la solución —con dos
 * años de operación son miles de filas en cada navegación— y quitarlo
 * tampoco.
 *
 * Funciona como una bandeja de correo: la base entrega primero el
 * ÍNDICE —cuántos hay en cada mes y en cada proceso, una sola consulta
 * agregada— y los tickets de un bloque se bajan SÓLO al abrirlo, por
 * páginas de cuarenta. Así el historial es infinito hacia atrás sin que
 * la primera pantalla cueste más.
 *
 * Este componente es sólo el árbol. Quién se puede abrir, la selección
 * múltiple y el alta viven en `ListaTickets`, que es quien lo usa.
 */

import { useCallback, useState } from 'react'
import { Alerta, Esqueleto, Insignia } from '@/components/ui/Primitivos'
import { IconChevronDown, IconInbox } from '@/components/ui/Icons'
import { EstadoVacio } from '@/components/ui/Primitivos'
import { procesoInfo } from '@/lib/estados'
import { cursorDe, leerPagina, type Cursor } from '@/lib/tickets/repositorio'
import {
  llaveBloque,
  porMes,
  type BloqueTickets,
  type FilaTicket,
  type FiltrosTickets,
} from '@/lib/tickets/tipos'

/** Lo que se sabe de un bloque ya abierto. */
type Cargado = {
  filas: FilaTicket[]
  cursor: Cursor
  /** Quedan más por bajar: la última página vino llena. */
  hayMas: boolean
  cargando: boolean
  error: string | null
}

const POR_PAGINA = 40

export function ArbolTickets({
  bloques,
  filtros,
  cargandoResumen,
  error,
  fila,
  onFilasCargadas,
}: {
  bloques: BloqueTickets[]
  filtros: FiltrosTickets
  cargandoResumen: boolean
  error: string | null
  /** Cómo se dibuja cada ticket. Lo decide quien usa el árbol. */
  fila: (t: FilaTicket) => React.ReactNode
  /**
   * Los tickets que acaban de bajarse.
   *
   * El árbol no sabe de selección múltiple ni de acciones en masa, pero
   * quien lo usa necesita saber qué hay cargado para que «seleccionar
   * todos» signifique algo honesto: lo que la persona abrió, no cinco mil
   * tickets que nadie ha mirado.
   */
  onFilasCargadas?: (filas: FilaTicket[]) => void
}) {
  const meses = porMes(bloques)
  const primerMes = meses[0]?.mes

  // Qué está desplegado. Mientras nadie toque nada, el mes más reciente
  // sale abierto: es donde está el trabajo del día, y llegar a él con un
  // clic de más sería peor que la lista de antes. `null` es justamente
  // «nadie ha tocado nada todavía», y así el valor se DERIVA en vez de
  // fijarse desde un efecto —que en React 19 es error de lint y además
  // provoca un render de más—.
  const [mesesTocados, setMesesTocados] = useState<Set<string> | null>(null)
  const mesesAbiertos = mesesTocados ?? new Set(primerMes ? [primerMes] : [])

  const [bloquesAbiertos, setBloquesAbiertos] = useState<Set<string>>(new Set())
  const [cargados, setCargados] = useState<Record<string, Cargado>>({})

  // Los filtros cambian ⇒ lo bajado deja de valer. Se olvida todo en vez
  // de mezclar páginas de dos consultas distintas. Va en el RENDER y no
  // en un efecto: es el patrón que React documenta para reajustar estado
  // cuando cambia una prop, y evita el parpadeo de enseñar una página
  // vieja bajo un filtro nuevo.
  const huella = JSON.stringify(filtros)
  const [huellaPrevia, setHuellaPrevia] = useState(huella)
  if (huella !== huellaPrevia) {
    setHuellaPrevia(huella)
    setCargados({})
    setBloquesAbiertos(new Set())
    setMesesTocados(null)
  }

  const traer = useCallback(
    async (mes: string, proceso: string, siguiente: boolean) => {
      const llave = llaveBloque(mes, proceso)
      const actual = cargados[llave]
      const cursor = siguiente ? (actual?.cursor ?? null) : null

      setCargados((antes) => ({
        ...antes,
        [llave]: {
          filas: siguiente ? (antes[llave]?.filas ?? []) : [],
          cursor: antes[llave]?.cursor ?? null,
          hayMas: antes[llave]?.hayMas ?? false,
          cargando: true,
          error: null,
        },
      }))

      const { filas, error: e } = await leerPagina(mes, proceso, filtros, cursor, POR_PAGINA)

      onFilasCargadas?.(filas)

      setCargados((antes) => {
        const previas = siguiente ? (antes[llave]?.filas ?? []) : []
        // Por si dos páginas se solaparan: la llave del cursor lo evita,
        // pero un id repetido en la lista es un error de React y vale más
        // no depender de que nunca pase.
        const vistos = new Set(previas.map((f) => f.id))
        const nuevas = [...previas, ...filas.filter((f) => !vistos.has(f.id))]
        return {
          ...antes,
          [llave]: {
            filas: nuevas,
            cursor: cursorDe(nuevas),
            hayMas: filas.length === POR_PAGINA,
            cargando: false,
            error: e,
          },
        }
      })
    },
    [cargados, filtros, onFilasCargadas]
  )

  function alternarMes(mes: string) {
    const copia = new Set(mesesAbiertos)
    if (copia.has(mes)) copia.delete(mes)
    else copia.add(mes)
    setMesesTocados(copia)
  }

  async function alternarBloque(mes: string, proceso: string) {
    const llave = llaveBloque(mes, proceso)
    const abierto = bloquesAbiertos.has(llave)

    setBloquesAbiertos((antes) => {
      const copia = new Set(antes)
      if (abierto) copia.delete(llave)
      else copia.add(llave)
      return copia
    })

    // Se baja al abrirlo, y sólo la primera vez: volver a cerrarlo y
    // abrirlo no vuelve a pedir lo mismo.
    if (!abierto && !cargados[llave]) await traer(mes, proceso, false)
  }

  if (error) return <Alerta>{error}</Alerta>

  if (cargandoResumen) {
    return (
      <div className="flex flex-col gap-2 p-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Esqueleto key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (meses.length === 0) {
    return (
      <EstadoVacio
        icono={<IconInbox />}
        titulo="Sin tickets"
        descripcion="Ningún ticket coincide con lo que estás filtrando. Prueba a limpiar los filtros."
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {meses.map((m) => {
        const mesAbierto = mesesAbiertos.has(m.mes)
        return (
          <section key={m.mes} className="overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200/80">
            <button
              type="button"
              onClick={() => alternarMes(m.mes)}
              aria-expanded={mesAbierto}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
            >
              <IconChevronDown
                className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                  mesAbierto ? '' : '-rotate-90'
                }`}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">
                {m.nombre}
              </span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                {m.cuantos}
              </span>
            </button>

            {mesAbierto && (
              <div className="anim-aparecer border-t border-slate-100">
                {m.bloques.map((b) => {
                  const llave = llaveBloque(b.mes, b.proceso)
                  const abierto = bloquesAbiertos.has(llave)
                  const datos = cargados[llave]
                  const info = procesoInfo(b.proceso)

                  return (
                    <div key={llave} className="border-b border-slate-50 last:border-0">
                      <button
                        type="button"
                        onClick={() => void alternarBloque(b.mes, b.proceso)}
                        aria-expanded={abierto}
                        className="flex w-full items-center gap-2 px-3 py-2 pl-7 text-left transition-colors hover:bg-slate-50"
                      >
                        <IconChevronDown
                          className={`h-3.5 w-3.5 shrink-0 text-slate-300 transition-transform ${
                            abierto ? '' : '-rotate-90'
                          }`}
                        />
                        <Insignia tono={info.tono} punto>
                          {info.numero} · {info.etiqueta}
                        </Insignia>
                        <span className="ml-auto flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-400">
                          <span>{b.cuantos}</span>
                          {Number(b.abiertos) > 0 && (
                            <span className="text-brand-600">· {b.abiertos} abiertos</span>
                          )}
                        </span>
                      </button>

                      {abierto && (
                        <div className="anim-aparecer flex flex-col gap-1.5 px-3 pb-3 pl-7">
                          {datos?.error && <Alerta>{datos.error}</Alerta>}

                          {datos?.filas.map((t) => fila(t))}

                          {datos?.cargando && (
                            <>
                              <Esqueleto className="h-16 w-full" />
                              <Esqueleto className="h-16 w-full" />
                            </>
                          )}

                          {datos && !datos.cargando && datos.hayMas && (
                            <button
                              type="button"
                              onClick={() => void traer(b.mes, b.proceso, true)}
                              className="rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-700"
                            >
                              Cargar más ({datos.filas.length} de {b.cuantos})
                            </button>
                          )}

                          {datos && !datos.cargando && !datos.hayMas && datos.filas.length === 0 && (
                            <p className="py-2 text-xs text-slate-400">
                              Ninguno visible en este bloque.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
