'use client'

import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { Boton } from '@/components/ui/Primitivos'
import { IconChevronDown, IconMenu, IconSearch, IconStar, IconX } from '@/components/ui/Icons'
import { agruparSecciones } from '@/lib/navegacion/adminSecciones'
import {
  alternarFavorito,
  cambiarAbierto,
  esFavorito,
  filtrarEntradas,
  registrarReciente,
  type EntradaNav,
} from '@/lib/navegacion/arbolAdmin'
import { usePrefsAdmin } from '@/lib/navegacion/prefsAdmin'
import type { BloqueArbol } from '@/lib/catalogos/grupos'
import { useConteosAdmin } from './ContextoAdmin'

const RUTA_CATALOGOS = '/admin/catalogos'

/**
 * Navegación de Administración: un ÁRBOL siempre a la vista.
 *
 * Las secciones llegan ya filtradas por permiso desde el layout, igual que
 * los bloques y catálogos (`arbolDeclarado`). «Catálogos» se despliega en sus
 * bloques y catálogos, así que pasar de uno a otro es un clic sin listas
 * desplegables. Arriba: buscador (`/` o Ctrl+K), Favoritos (☆) y Recientes,
 * guardados en el navegador por usuario.
 *
 * Pantalla ancha (xl): riel de la altura de la pantalla con su propio scroll
 * vertical. Pantalla angosta: una fila normal con el nombre de la sección y un
 * botón «Menú» que abre una hoja con el MISMO árbol.
 */
export function AdminNav({
  secciones,
  catalogos,
  usuarioId,
}: {
  secciones: { href: string; etiqueta: string; grupo: string }[]
  catalogos: BloqueArbol[]
  usuarioId: string
}) {
  const pathname = usePathname()
  const params = useSearchParams()
  const router = useRouter()
  const { conteos } = useConteosAdmin()
  const { prefs, cambiar } = usePrefsAdmin(usuarioId)
  const [consulta, setConsulta] = useState('')
  const [indice, setIndice] = useState(0)
  const [hoja, setHoja] = useState(false)
  const [enfocarHoja, setEnfocarHoja] = useState(false)

  const grupos = useMemo(() => agruparSecciones(secciones), [secciones])
  const catalogoActivo = pathname.startsWith(RUTA_CATALOGOS) ? params.get('catalogo') : null

  // Todo lo que se puede abrir, para la búsqueda: secciones y catálogos.
  const entradas = useMemo<EntradaNav[]>(() => {
    const titulos = new Map(grupos.flatMap((g) => g.secciones.map((s) => [s.href, g.titulo] as const)))
    const deSecciones = secciones.map((s) => ({
      href: s.href,
      etiqueta: s.etiqueta,
      contexto: titulos.get(s.href),
    }))
    const deCatalogos = catalogos.flatMap((b) =>
      b.items.map((i) => ({ href: i.href, etiqueta: i.etiqueta, contexto: `Catálogos · ${b.titulo}` }))
    )
    return [...deSecciones, ...deCatalogos]
  }, [secciones, catalogos, grupos])

  const esActivo = (href: string) => {
    const [ruta, q] = href.split('?')
    if (!q) return pathname.startsWith(ruta) && !(ruta === RUTA_CATALOGOS && catalogoActivo)
    return pathname === RUTA_CATALOGOS && new URLSearchParams(q).get('catalogo') === catalogoActivo
  }

  // La pantalla en la que se está, como una entrada (para «Recientes» y la barra móvil).
  const actual = ((): EntradaNav | null => {
    if (catalogoActivo) {
      for (const b of catalogos) {
        const i = b.items.find((x) => x.key === catalogoActivo)
        if (i) return { href: i.href, etiqueta: i.etiqueta, contexto: `Catálogos · ${b.titulo}` }
      }
    }
    const s = [...secciones]
      .sort((a, b) => b.href.length - a.href.length)
      .find((x) => pathname.startsWith(x.href))
    return s ? { href: s.href, etiqueta: s.etiqueta } : null
  })()
  const actualHref = actual?.href
  const actualEtiqueta = actual?.etiqueta
  const actualContexto = actual?.contexto

  useEffect(() => {
    if (!actualHref || !actualEtiqueta) return
    cambiar((p) =>
      registrarReciente(p, { href: actualHref, etiqueta: actualEtiqueta, contexto: actualContexto })
    )
  }, [actualHref, actualEtiqueta, actualContexto, cambiar])

  // «/» o Ctrl+K llevan al buscador; en pantalla angosta abren la hoja.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const atajo =
        (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')
      if (!atajo) return
      const t = e.target as HTMLElement | null
      if (
        e.key === '/' &&
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      )
        return
      e.preventDefault()
      const riel = document.getElementById('adm-buscar-riel')
      if (riel && riel.offsetParent !== null) riel.focus()
      else {
        setEnfocarHoja(true)
        setHoja(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const resultados = useMemo(() => filtrarEntradas(entradas, consulta), [entradas, consulta])

  function navegar(href: string) {
    if (pathname === RUTA_CATALOGOS && href.startsWith(RUTA_CATALOGOS)) {
      // Dentro de Catálogos los datos ya están: sólo cambia la URL.
      window.history.pushState(null, '', href)
      window.scrollTo({ top: 0 })
    } else router.push(href)
    setConsulta('')
    setHoja(false)
  }

  function alHacerClic(e: MouseEvent, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    if (pathname === RUTA_CATALOGOS && href.startsWith(RUTA_CATALOGOS)) {
      e.preventDefault()
      navegar(href)
    } else {
      setConsulta('')
      setHoja(false)
    }
  }

  const panel = (grande: boolean) => (
    <PanelArbol
      grande={grande}
      grupos={grupos}
      catalogos={catalogos}
      conteos={conteos}
      prefs={prefs}
      cambiar={cambiar}
      consulta={consulta}
      setConsulta={(v) => {
        setConsulta(v)
        setIndice(0)
      }}
      resultados={resultados}
      indice={indice}
      setIndice={setIndice}
      esActivo={esActivo}
      catalogoActivo={catalogoActivo}
      alHacerClic={alHacerClic}
      ir={(e) => navegar(e.href)}
      autoFoco={grande && enfocarHoja}
    />
  )

  const titulo =
    catalogoActivo && actual ? `Catálogos › ${actual.etiqueta}` : (actual?.etiqueta ?? 'Administración')

  return (
    <>
      {/* ------------------------ Pantalla ancha: riel ------------------------ */}
      <nav
        aria-label="Administración"
        className="scroll-suave hidden w-64 shrink-0 overflow-y-auto overflow-x-hidden border-r border-slate-200 bg-white xl:sticky xl:top-0 xl:block xl:h-dvh"
      >
        {panel(false)}
      </nav>

      {/* --------------- Pantalla angosta: fila normal con «Menú» --------------- */}
      <div className="flex items-center gap-3 px-4 pt-3 xl:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-600">Administración</p>
          <p className="break-words text-base font-semibold leading-tight text-slate-900">{titulo}</p>
        </div>
        <Boton
          variante="secundario"
          aria-haspopup="dialog"
          onClick={() => {
            setEnfocarHoja(false)
            setHoja(true)
          }}
        >
          <IconMenu className="h-5 w-5" />
          Menú
        </Boton>
      </div>

      <Modal abierto={hoja} onCerrar={() => setHoja(false)} titulo="Menú de administración">
        {panel(true)}
      </Modal>
    </>
  )
}

type PanelProps = {
  grande: boolean
  grupos: ReturnType<typeof agruparSecciones>
  catalogos: BloqueArbol[]
  conteos: Record<string, number>
  prefs: ReturnType<typeof usePrefsAdmin>['prefs']
  cambiar: ReturnType<typeof usePrefsAdmin>['cambiar']
  consulta: string
  setConsulta: (v: string) => void
  resultados: EntradaNav[]
  indice: number
  setIndice: (n: number) => void
  esActivo: (href: string) => boolean
  catalogoActivo: string | null
  alHacerClic: (e: MouseEvent, href: string) => void
  ir: (e: EntradaNav) => void
  autoFoco: boolean
}

function PanelArbol(p: PanelProps) {
  const { grande, prefs, cambiar } = p
  const buscando = p.consulta.trim() !== ''

  const fila = (
    e: EntradaNav,
    opciones: { nivel?: number; conteo?: number; resaltada?: boolean; contexto?: boolean } = {}
  ) => (
    <FilaNav
      key={e.href}
      entrada={e}
      grande={grande}
      nivel={opciones.nivel ?? 0}
      activo={p.esActivo(e.href)}
      conteo={opciones.conteo}
      favorito={esFavorito(prefs, e.href)}
      resaltada={opciones.resaltada}
      mostrarContexto={opciones.contexto}
      onAlternarFavorito={() => cambiar((x) => alternarFavorito(x, e))}
      onClic={(ev) => p.alHacerClic(ev, e.href)}
    />
  )

  const abierto = (clave: string, porDefecto: boolean) => prefs.abiertos[clave] ?? porDefecto
  const alternar = (clave: string, valor: boolean) => cambiar((x) => cambiarAbierto(x, clave, valor))

  return (
    <div className={`flex flex-col gap-4 ${grande ? 'p-3' : 'p-3 pb-8'}`}>
      {!grande && (
        <p className="px-2 pt-1 text-base font-bold tracking-tight text-slate-900">Administración</p>
      )}

      <div className="relative">
        <label className="sr-only" htmlFor={grande ? 'adm-buscar-hoja' : 'adm-buscar-riel'}>
          Buscar pantalla o catálogo
        </label>
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          id={grande ? 'adm-buscar-hoja' : 'adm-buscar-riel'}
          autoFocus={p.autoFoco}
          type="search"
          value={p.consulta}
          onChange={(e) => p.setConsulta(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              p.setIndice(Math.min(p.indice + 1, p.resultados.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              p.setIndice(Math.max(p.indice - 1, 0))
            } else if (e.key === 'Enter') {
              const r = p.resultados[p.indice] ?? p.resultados[0]
              if (r) {
                e.preventDefault()
                p.ir(r)
              }
            } else if (e.key === 'Escape' && p.consulta) {
              e.preventDefault()
              e.stopPropagation()
              p.setConsulta('')
            }
          }}
          placeholder={grande ? 'Buscar pantalla o catálogo' : 'Buscar…  ( / )'}
          className={`w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10 [&::-webkit-search-cancel-button]:hidden ${
            grande ? 'min-h-12' : 'min-h-10'
          }`}
        />
        {buscando && (
          <button
            type="button"
            aria-label="Borrar búsqueda"
            onClick={() => p.setConsulta('')}
            className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
          >
            <IconX className="h-4 w-4" />
          </button>
        )}
      </div>

      {buscando ? (
        <section aria-label="Resultados">
          {p.resultados.length === 0 ? (
            <p className="px-2 text-sm text-slate-600">Nada coincide con «{p.consulta}».</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {p.resultados.map((r, i) => (
                <li key={r.href}>{fila(r, { resaltada: i === p.indice, contexto: true })}</li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          {prefs.favoritos.length > 0 && (
            <section aria-label="Favoritos">
              <TituloSeccion>Favoritos</TituloSeccion>
              <ul className="flex flex-col gap-0.5">
                {prefs.favoritos.map((f) => (
                  <li key={f.href}>{fila(f, { contexto: true })}</li>
                ))}
              </ul>
            </section>
          )}

          {prefs.recientes.length > 0 && (
            <section aria-label="Recientes">
              <TituloSeccion>Recientes</TituloSeccion>
              <ul className="flex flex-col gap-0.5">
                {prefs.recientes.map((r) => (
                  <li key={r.href}>{fila(r, { contexto: true })}</li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-col gap-4" data-arbol="">
            {p.grupos.map((g) => (
              <section key={g.key} aria-label={g.titulo}>
                <TituloSeccion>{g.titulo}</TituloSeccion>
                <ul className="flex flex-col gap-0.5">
                  {g.secciones.map((s) => {
                    const esCatalogos = s.href === RUTA_CATALOGOS && p.catalogos.length > 0
                    const entrada = { href: s.href, etiqueta: s.etiqueta, contexto: g.titulo }
                    if (!esCatalogos) return <li key={s.href}>{fila(entrada)}</li>
                    const raizAbierta = abierto('raiz-catalogos', true)
                    return (
                      <li key={s.href}>
                        <div className="flex items-center">
                          <Plegar
                            abierto={raizAbierta}
                            grande={grande}
                            etiqueta="catálogos"
                            onClic={() => alternar('raiz-catalogos', !raizAbierta)}
                          />
                          <div className="min-w-0 flex-1">{fila(entrada)}</div>
                        </div>
                        {raizAbierta && (
                          <ul className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-slate-200 pl-1.5">
                            {p.catalogos.map((b) => {
                              const contiene = b.items.some((i) => i.key === p.catalogoActivo)
                              const abre = abierto(`bloque-${b.key}`, contiene)
                              return (
                                <li key={b.key}>
                                  <button
                                    type="button"
                                    aria-expanded={abre}
                                    onClick={() => alternar(`bloque-${b.key}`, !abre)}
                                    className={`flex w-full items-center gap-1.5 rounded-lg px-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
                                      grande ? 'min-h-12' : 'min-h-9'
                                    }`}
                                  >
                                    <IconChevronDown
                                      className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${abre ? '' : '-rotate-90'}`}
                                    />
                                    <span className="min-w-0 flex-1 break-words">{b.titulo}</span>
                                  </button>
                                  {abre && (
                                    <ul className="flex flex-col gap-0.5 pb-1">
                                      {b.items.map((i) => (
                                        <li key={i.key}>
                                          {fila(
                                            {
                                              href: i.href,
                                              etiqueta: i.etiqueta,
                                              contexto: `Catálogos · ${b.titulo}`,
                                            },
                                            { nivel: 1, conteo: p.conteos[i.key] }
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TituloSeccion({ children }: { children: React.ReactNode }) {
  return <h2 className="px-2 pb-1 text-sm font-semibold text-slate-600">{children}</h2>
}

function Plegar({
  abierto,
  grande,
  etiqueta,
  onClic,
}: {
  abierto: boolean
  grande: boolean
  etiqueta: string
  onClic: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={abierto}
      aria-label={`${abierto ? 'Contraer' : 'Desplegar'} ${etiqueta}`}
      onClick={onClic}
      className={`flex shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
        grande ? 'h-12 w-10' : 'h-9 w-7'
      }`}
    >
      <IconChevronDown className={`h-4 w-4 transition-transform ${abierto ? '' : '-rotate-90'}`} />
    </button>
  )
}

function FilaNav({
  entrada,
  grande,
  nivel,
  activo,
  conteo,
  favorito,
  resaltada,
  mostrarContexto,
  onAlternarFavorito,
  onClic,
}: {
  entrada: EntradaNav
  grande: boolean
  nivel: number
  activo: boolean
  conteo?: number
  favorito: boolean
  resaltada?: boolean
  mostrarContexto?: boolean
  onAlternarFavorito: () => void
  onClic: (e: MouseEvent) => void
}) {
  return (
    <div className="group relative">
      <Link
        href={entrada.href}
        onClick={onClic}
        aria-current={activo ? 'page' : undefined}
        className={`flex items-center gap-2 rounded-lg pr-16 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
          nivel > 0 ? 'pl-3' : 'pl-2'
        } ${grande ? 'min-h-12 py-2' : 'min-h-9 py-1.5'} ${
          activo
            ? 'bg-brand-50 font-semibold text-brand-700'
            : resaltada
              ? 'bg-slate-100 text-slate-900'
              : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="block break-words">{entrada.etiqueta}</span>
          {mostrarContexto && entrada.contexto && (
            <span className="block break-words text-xs font-normal text-slate-600">
              {entrada.contexto}
            </span>
          )}
        </span>
        {conteo !== undefined && (
          <span className="shrink-0 text-xs font-medium tabular-nums text-slate-600">{conteo}</span>
        )}
      </Link>
      <button
        type="button"
        aria-pressed={favorito}
        aria-label={`${favorito ? 'Quitar de favoritos' : 'Marcar como favorito'}: ${entrada.etiqueta}`}
        onClick={onAlternarFavorito}
        className={`absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md hover:bg-slate-200 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
          grande ? 'h-11 w-11' : 'h-8 w-8'
        } ${
          favorito
            ? 'text-amber-600'
            : grande
              ? 'text-slate-500'
              : 'text-slate-500 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100'
        }`}
      >
        <IconStar className="h-4 w-4" relleno={favorito} />
      </button>
    </div>
  )
}
