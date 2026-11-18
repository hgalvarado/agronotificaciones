'use client'

/**
 * Catálogos en dos niveles.
 *
 * 1. «Hub»: todos los bloques a la vista, cada uno con sus catálogos, qué se
 *    cambia dentro y cuántos registros tiene. Nada plegado: lo que se ofrece
 *    se ve al entrar, y el buscador filtra por nombre o descripción.
 * 2. El catálogo a ANCHO COMPLETO, con migas, vuelta al hub y un selector
 *    para saltar a otro catálogo del mismo bloque.
 *
 * La selección vive en la URL (`?catalogo=<clave>`): se puede recargar,
 * compartir el enlace y usar «Atrás». Se escribe con `history.pushState`
 * (integrado con el router de Next) y no con `router.push`, porque este
 * último volvería a pedir al servidor los veinte catálogos para cambiar de
 * vista, y los datos ya están aquí.
 *
 * Sólo es pantalla. Qué va en qué bloque lo declara `lib/catalogos/grupos`;
 * los permisos los decide la página con la matriz de la base.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CatalogoTable } from './CatalogoTable'
import type { PestanaCatalogo } from './tipos'
import { Boton, EstadoVacio, Insignia, Selector, Tarjeta } from '@/components/ui/Primitivos'
import {
  IconChevronLeft,
  IconChevronRight,
  IconInbox,
  IconMapPin,
  IconPlan,
  IconSearch,
  IconSettings,
  IconTractor,
  IconUser,
  IconX,
} from '@/components/ui/Icons'
import { filtrar, organizar, type GrupoMenu, type ItemMenu } from '@/lib/catalogos/grupos'

const ICONOS: Record<string, (p: { className?: string }) => ReactNode> = {
  maquinaria: IconTractor,
  labores: IconUser,
  campo: IconMapPin,
  sap: IconSettings,
  organizacion: IconPlan,
}

const RUTA = '/admin/catalogos'

export function MenuCatalogos({
  pestanas,
  soloLectura,
  bloquesVisibles,
  bloquesEditables,
  aviso,
}: {
  pestanas: PestanaCatalogo[]
  soloLectura: boolean
  /** Bloques que esta persona puede ver, por el código de su pantalla en la matriz. */
  bloquesVisibles?: string[]
  /** Bloques en los que puede crear o editar. Sin esta lista rige `soloLectura` para todos. */
  bloquesEditables?: string[]
  /** Avisos de la página (se enseñan sólo en el hub). */
  aviso?: ReactNode
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [busqueda, setBusqueda] = useState('')
  const buscador = useRef<HTMLInputElement>(null)

  const grupos = useMemo(() => {
    const permitidos = bloquesVisibles ? new Set(bloquesVisibles) : null
    return organizar(pestanas, permitidos ? (p) => permitidos.has(p) : null)
  }, [pestanas, bloquesVisibles])
  const visibles = useMemo(() => filtrar(grupos, busqueda), [grupos, busqueda])

  // Qué catálogo está abierto, según la URL; si la clave no existe o no se
  // puede ver, se enseña el hub.
  const clave = params.get('catalogo')
  const ubicacion = (() => {
    if (!clave) return null
    for (const g of grupos) {
      const item = g.items.find((i) => i.key === clave && i.pestana)
      if (item) return { grupo: g, item }
    }
    return null
  })()

  function abrir(destino: ItemMenu<PestanaCatalogo>) {
    if (destino.href) return router.push(destino.href)
    window.history.pushState(null, '', `${RUTA}?catalogo=${encodeURIComponent(destino.key)}`)
    window.scrollTo({ top: 0 })
  }

  function volver() {
    window.history.pushState(null, '', RUTA)
    window.scrollTo({ top: 0 })
  }

  // «/» enfoca el buscador del hub, como en el resto de herramientas.
  useEffect(() => {
    if (ubicacion) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return
      e.preventDefault()
      buscador.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [ubicacion])

  const editable = (g: GrupoMenu<PestanaCatalogo>) =>
    bloquesEditables && g.pantalla ? bloquesEditables.includes(g.pantalla) : !soloLectura

  /* ------------------------- Catálogo abierto ------------------------- */
  if (ubicacion) {
    const { grupo, item } = ubicacion
    const pestana = item.pestana!
    const soloConsulta = !editable(grupo)
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <nav
            aria-label="Ruta"
            className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-slate-600"
          >
            <Link
              href={RUTA}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return
                e.preventDefault()
                volver()
              }}
              className="rounded font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              Catálogos
            </Link>
            <IconChevronRight className="h-3.5 w-3.5 text-slate-400" />
            <span>{grupo.titulo}</span>
            <IconChevronRight className="h-3.5 w-3.5 text-slate-400" />
            <span aria-current="page" className="font-semibold text-slate-900">
              {item.etiqueta}
            </span>
          </nav>

          <div className="flex flex-wrap items-center gap-3">
            <Boton variante="secundario" onClick={volver}>
              <IconChevronLeft className="h-4 w-4" />
              Catálogos
            </Boton>
            <div className="min-w-0 flex-1 basis-56">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-xl font-bold tracking-tight text-slate-900">
                  {item.etiqueta}
                </h1>
                <Insignia tono="gris">
                  {pestana.filas.length} registro{pestana.filas.length === 1 ? '' : 's'}
                </Insignia>
                {soloConsulta && <Insignia tono="ambar">Solo lectura</Insignia>}
              </div>
              <p className="mt-0.5 max-w-3xl text-sm text-slate-600">{item.descripcion}</p>
            </div>
            {grupo.items.length > 1 && (
              <label className="flex w-full flex-col gap-1 text-sm font-medium text-slate-600 sm:w-72">
                Ir a otro catálogo de este bloque
                <Selector
                  value={item.key}
                  onChange={(e) => {
                    const otro = grupo.items.find((i) => i.key === e.target.value)
                    if (otro) abrir(otro)
                  }}
                >
                  {grupo.items.map((i) => (
                    <option key={i.key} value={i.key}>
                      {i.etiqueta}
                    </option>
                  ))}
                </Selector>
              </label>
            )}
          </div>
        </div>

        <CatalogoTable
          key={pestana.key}
          tabla={pestana.tabla}
          titulo={pestana.label}
          campos={pestana.campos}
          filas={pestana.filas}
          clave={pestana.clave}
          relaciones={pestana.relaciones}
          detalle={pestana.detalle}
          soloLectura={soloConsulta}
        />
      </div>
    )
  }

  /* ------------------------------- Hub -------------------------------- */
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Catálogos</h1>
        <p className="max-w-3xl text-base text-slate-600">
          Los datos maestros, agrupados por lo que configuran. Abre un catálogo para ordenarlo,
          filtrarlo, cambiarlo en masa o cargarlo desde Excel; la plantilla de cada uno trae las
          listas desplegables ya puestas.
        </p>
      </div>

      {aviso}

      <label className="relative block max-w-xl">
        <span className="sr-only">Buscar catálogo</span>
        <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          ref={buscador}
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setBusqueda('')
              e.currentTarget.blur()
            }
          }}
          placeholder="Buscar un catálogo por nombre o descripción"
          className="min-h-12 w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-11 pr-14 text-base text-slate-900 shadow-[var(--shadow-card)] placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10 [&::-webkit-search-cancel-button]:hidden"
        />
        {busqueda ? (
          <button
            type="button"
            onClick={() => {
              setBusqueda('')
              buscador.current?.focus()
            }}
            aria-label="Borrar búsqueda"
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <IconX className="h-4 w-4" />
          </button>
        ) : (
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-500 sm:block"
          >
            /
          </kbd>
        )}
      </label>

      {visibles.length === 0 ? (
        <Tarjeta>
          <EstadoVacio
            icono={<IconInbox />}
            titulo={`Ningún catálogo coincide con «${busqueda}»`}
            descripcion="Prueba con otra palabra, por ejemplo el nombre del dato que quieres cambiar."
            accion={
              <Boton variante="secundario" onClick={() => setBusqueda('')}>
                Ver todos los catálogos
              </Boton>
            }
          />
        </Tarjeta>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {visibles.map((g) => (
            <TarjetaGrupo key={g.key} grupo={g} soloConsulta={!editable(g)} onAbrir={abrir} />
          ))}
        </div>
      )}
    </div>
  )
}

function TarjetaGrupo({
  grupo,
  soloConsulta,
  onAbrir,
}: {
  grupo: GrupoMenu<PestanaCatalogo>
  soloConsulta: boolean
  onAbrir: (i: ItemMenu<PestanaCatalogo>) => void
}) {
  const Icono = ICONOS[grupo.key] ?? IconInbox
  const registros = grupo.items.reduce((n, i) => n + (i.cuenta ?? 0), 0)

  return (
    <Tarjeta className="flex flex-col overflow-hidden">
      <div className="flex items-start gap-3 p-5 pb-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Icono className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-bold leading-tight tracking-tight text-slate-900">
            {grupo.titulo}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{grupo.descripcion}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Insignia tono="gris">
              {grupo.items.length} catálogo{grupo.items.length === 1 ? '' : 's'}
            </Insignia>
            <Insignia tono="gris">
              {registros} registro{registros === 1 ? '' : 's'}
            </Insignia>
            {soloConsulta && <Insignia tono="ambar">Solo lectura</Insignia>}
          </div>
        </div>
      </div>

      <ul className="border-t border-slate-100">
        {grupo.items.map((i, n) => (
          <li key={i.key} className={n > 0 ? 'border-t border-slate-100' : ''}>
            <Link
              href={i.href ?? `${RUTA}?catalogo=${encodeURIComponent(i.key)}`}
              onClick={(e) => {
                // Ctrl/Cmd/Shift + clic abre en otra pestaña como cualquier enlace.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                e.preventDefault()
                onAbrir(i)
              }}
              className="group flex min-h-14 items-center gap-3 px-5 py-3 transition-colors hover:bg-brand-50 focus-visible:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600"
            >
              <span className="min-w-0 flex-1">
                <span className="block break-words text-base font-semibold text-slate-900">
                  {i.etiqueta}
                </span>
                <span className="mt-0.5 block text-sm leading-snug text-slate-600">
                  {i.descripcion}
                </span>
              </span>
              {i.cuenta !== null && (
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-slate-700">
                  {i.cuenta}
                </span>
              )}
              <IconChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-700" />
            </Link>
          </li>
        ))}
      </ul>
    </Tarjeta>
  )
}
