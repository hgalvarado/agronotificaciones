'use client'

/**
 * El menú de catálogos: bloques por categoría y, dentro, sus accesos.
 *
 * Sustituye a la fila de pestañas. Con dieciséis catálogos esa fila ya no
 * cabía en un teléfono y obligaba a arrastrar de lado buscando a ciegas;
 * aquí cada bloque dice de qué trata y cada acceso qué se cambia dentro,
 * así que se encuentra leyendo en vez de probando.
 *
 * Sólo es pantalla. Qué va en qué bloque lo declara `lib/catalogos/grupos`
 * y los datos los trae la página; este componente no sabe de Supabase ni
 * decide agrupaciones.
 *
 * En teléfono funciona como cualquier pantalla de configuración: lista →
 * detalle, con una vuelta atrás. En escritorio el menú se queda a la
 * izquierda y el catálogo se abre al lado, porque ahí sí sobra ancho.
 *
 * Los bloques van PLEGADOS. Con seis bloques y veinte catálogos, la lista
 * abierta era medio metro de scroll para llegar al último, y en un
 * teléfono peor. Se ve el título de cada bloque, qué contiene y cuántos
 * son; se despliega el que se necesita.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CatalogoTable } from './CatalogoTable'
import type { PestanaCatalogo } from './tipos'
import { Entrada, EstadoVacio } from '@/components/ui/Primitivos'
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
} from '@/components/ui/Icons'
import { filtrar, organizar, type ItemMenu } from '@/lib/catalogos/grupos'

export function MenuCatalogos({
  pestanas,
  soloLectura,
}: {
  pestanas: PestanaCatalogo[]
  soloLectura: boolean
}) {
  const [abierta, setAbierta] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  // Qué bloques están desplegados. Arranca todo cerrado: con seis
  // bloques y veinte catálogos, la lista abierta era medio metro de
  // scroll para llegar a «Temporadas». Se abre el que se necesita.
  const [desplegados, setDesplegados] = useState<Set<string>>(new Set())

  const grupos = useMemo(() => organizar(pestanas), [pestanas])
  const visibles = useMemo(() => filtrar(grupos, busqueda), [grupos, busqueda])

  const pestanaAbierta = pestanas.find((p) => p.key === abierta)

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
      {/* ----------------------------- Menú ----------------------------- */}
      <nav
        className={`flex flex-col gap-5 lg:sticky lg:top-4 lg:w-80 lg:shrink-0 ${
          pestanaAbierta ? 'hidden lg:flex' : 'flex'
        }`}
      >
        <label className="relative block">
          <span className="sr-only">Buscar catálogo</span>
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Entrada
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en catálogos"
            className="pl-9"
          />
        </label>

        {visibles.length === 0 && (
          <p className="px-1 text-sm text-slate-400">
            Ningún catálogo coincide con «{busqueda}».
          </p>
        )}

        {visibles.map((g) => {
          // Buscando, los bloques se despliegan solos: si hay que abrir
          // uno por uno para ver los resultados, la búsqueda no sirve de
          // nada. El bloque del catálogo abierto también, para no perder
          // de vista dónde se está.
          const abiertoAhora =
            busqueda.trim() !== '' ||
            desplegados.has(g.key) ||
            g.items.some((i) => i.key === abierta)

          return (
            <section key={g.key} className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const copia = new Set(desplegados)
                  if (abiertoAhora) copia.delete(g.key)
                  else copia.add(g.key)
                  setDesplegados(copia)
                }}
                aria-expanded={abiertoAhora}
                className="flex w-full items-start gap-2 rounded-xl px-1 py-1.5 text-left transition-colors hover:bg-white"
              >
                <IconChevronDown
                  className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                    abiertoAhora ? '' : '-rotate-90'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold tracking-tight text-slate-900">
                    {g.titulo}
                  </span>
                  <span className="block text-xs text-slate-400">{g.descripcion}</span>
                </span>
                <span className="mt-0.5 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                  {g.items.length}
                </span>
              </button>

              {abiertoAhora && (
                <ul className="anim-aparecer overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-slate-200/80">
                  {g.items.map((i, indice) => (
                    <li key={i.key} className={indice > 0 ? 'border-t border-slate-100' : ''}>
                      <FilaMenu
                        item={i}
                        activa={i.key === abierta}
                        onAbrir={() => setAbierta(i.key)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </nav>

      {/* ---------------------------- Detalle ---------------------------- */}
      <div className={`min-w-0 flex-1 ${pestanaAbierta ? 'block' : 'hidden lg:block'}`}>
        {pestanaAbierta ? (
          <div className="anim-aparecer flex flex-col gap-3">
            <button
              onClick={() => setAbierta(null)}
              className="-ml-1 flex w-fit items-center gap-1 rounded-lg px-1 py-1 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-900 lg:hidden"
            >
              <IconChevronLeft className="h-4 w-4" />
              Catálogos
            </button>

            <CatalogoTable
              key={pestanaAbierta.key}
              tabla={pestanaAbierta.tabla}
              titulo={pestanaAbierta.label}
              campos={pestanaAbierta.campos}
              filas={pestanaAbierta.filas}
              clave={pestanaAbierta.clave}
              relaciones={pestanaAbierta.relaciones}
              soloLectura={soloLectura}
            />
          </div>
        ) : (
          <EstadoVacio
            titulo="Elige un catálogo"
            descripcion="Cada bloque de la izquierda agrupa los datos maestros que se tocan juntos. Abre uno para ordenarlo, filtrarlo, cambiarlo en masa o cargarlo desde Excel."
          />
        )}
      </div>
    </div>
  )
}

/**
 * Una fila del menú. Es un enlace cuando el catálogo vive en otra ruta
 * —Tarifas— y un botón cuando se abre aquí mismo: dos cosas distintas que
 * se ven igual, como debe ser.
 */
function FilaMenu({
  item,
  activa,
  onAbrir,
}: {
  item: ItemMenu<PestanaCatalogo>
  activa: boolean
  onAbrir: () => void
}) {
  const clases = `flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors ${
    activa ? 'bg-brand-50' : 'hover:bg-slate-50'
  }`

  const cuerpo = (
    <>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-semibold ${
            activa ? 'text-brand-700' : 'text-slate-900'
          }`}
        >
          {item.etiqueta}
        </span>
        {/* La descripción se parte en dos líneas en vez de cortarse: es la
            frase que dice qué se cambia dentro, y media frase no sirve. */}
        <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-slate-400">
          {item.descripcion}
        </span>
      </span>

      {item.cuenta !== null && (
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
          {item.cuenta}
        </span>
      )}
      <IconChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
    </>
  )

  if (item.href) {
    return (
      <Link href={item.href} className={clases}>
        {cuerpo}
      </Link>
    )
  }

  return (
    <button onClick={onAbrir} className={clases} aria-current={activa ? 'page' : undefined}>
      {cuerpo}
    </button>
  )
}
