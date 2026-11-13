'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { marcarSalidaVoluntaria } from '@/components/auth/GuardiaSesion'
import { IconChevronDown, IconLogout, IconMas } from './Icons'
import { CampanaNotificaciones } from './CampanaNotificaciones'
import { Logo } from './Logo'
import { SelectorTema } from './SelectorTema'
import { IconoMenu } from './iconosMenu'
import { repartir } from '@/lib/navegacion/barra'
import { PANTALLAS_CATALOGO } from '@/lib/catalogos/grupos'
import type { PantallaDeMenu } from '@/lib/navegacion/menuBase'
import type { EntradaMenu } from '@/lib/navegacion/destinos'
import { construirMenu, tieneDesde, type MenuDeRol } from '@/lib/navegacion/menuRol'

type ItemNav = {
  href: string
  etiqueta: string
  icono: React.ReactNode
  /**
   * El código de pantalla (o del destino del menú). Es la llave con la que el Administrador
   * configura qué sale en la barra del teléfono, así que tiene que coincidir con `pantallas.codigo`.
   */
  pantalla: string
  /** Sub-secciones (un grupo del menú). */
  hijos?: ItemNav[]
}

/**
 * Pantallas que se precargan COMPLETAS desde el menú: al tocarlas se abren al instante (el navegador ya tiene la
 * página). Solo las de trabajo diario y cuyos datos se actualizan solos (useConsultaViva / useAvisosCambios): lo
 * precargado nunca enseña registros viejos. El resto sigue con la precarga normal de Next.js.
 */
const PRECARGA_COMPLETA = new Set(['/tickets', '/horometros', '/labores'])
const precargaCompleta = (href: string) => (PRECARGA_COMPLETA.has(href) ? true : undefined)

const aItem = (e: EntradaMenu): ItemNav => ({
  href: e.href,
  pantalla: e.pantalla,
  etiqueta: e.etiqueta,
  icono: <IconoMenu nombre={e.icono} />,
  hijos: e.hijos?.map(aItem),
})

export function AppShell({
  nombre,
  rolNombre,

  permisos,
  navegacion = [],
  pantallasMenu = [],
  menusRol = [],
  children,
}: {
  /** Pantallas nuevas que la base pone en el menú (migración 93). */
  pantallasMenu?: PantallaDeMenu[]
  /** Los roles de la persona y el menú diseñado de cada uno (migración 103). Sin diseño = el menú de siempre. */
  menusRol?: MenuDeRol[]
  nombre: string
  rolNombre: string

  /** Claves «pantalla:accion» que el usuario tiene concedidas. */
  permisos: string[]
  /**
   * Qué accesos quiere el Administrador en la barra del teléfono para
   * este rol, ya en orden. Vacío = el orden de siempre, el del código.
   */
  navegacion?: string[]
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [abrirMas, setAbrirMas] = useState(false)
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(null)

  // El menú lo decide la MATRIZ y nada más. Si `fn_mis_permisos` falta, `getPermisos` devuelve
  // `__sin_migracion__` y aquí se enseña todo, igual que hace `puede()`: quedarse sin menú por una
  // migración pendiente sería peor que ver un acceso de más.
  const sinMigracion = permisos.includes('__sin_migracion__')
  const concedidos = new Set(permisos)

  // Qué entradas y en qué orden: `lib/navegacion/menuRol`. Sin menú diseñado para ninguno de sus roles es
  // exactamente el menú de siempre; con diseño, solo ordena y nombra lo que la persona ya puede abrir.
  const menu = construirMenu({
    menus: menusRol,
    tiene: tieneDesde(permisos),
    pantallasMenu,
    pantallasCatalogo: PANTALLAS_CATALOGO,
  })
  const visibles: ItemNav[] = menu.entradas.map(aItem)

  // Los avisos son para quien revisa: quien puede corregir un ticket es
  // quien necesita enterarse de que le cerraron uno.
  const verAvisos = sinMigracion || concedidos.has('tickets:editar')

  // En el celular los grupos se aplanan: cada avance es su propia
  // entrada, que es más directo que un desplegable dentro de una hoja.
  const planos: ItemNav[] = visibles.flatMap((i) =>
    i.hijos && i.hijos.length > 0
      ? i.hijos.map((h) => ({ ...h, etiqueta: `${i.etiqueta}: ${h.etiqueta}` }))
      : [i]
  )

  // Qué va abajo y qué va en «Más» lo decide `lib/navegacion/barra`, con
  // lo que el Administrador configuró para este rol. Sin configuración
  // devuelve exactamente el reparto de siempre.
  const { barra: cabenAbajo, mas: enMas } = repartir(planos, navegacion)

  function activo(href: string) {
    return pathname === href || pathname.startsWith(href + '/')
  }

  async function salir() {
    marcarSalidaVoluntaria()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const iniciales = nombre
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()

  return (
    <div className="min-h-dvh lg:flex">
      {/* ---------------- Barra lateral (escritorio) ---------------- */}
      <aside className="no-imprimir sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        {/* La marca es el camino de vuelta a la portada (migración 71).
            Es donde todo el mundo busca el inicio, y sin eso la portada
            sólo se alcanzaba escribiendo la dirección a mano. */}
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-xl px-5 py-5 transition-colors hover:bg-slate-50"
        >
          <Logo tamano={36} />
          <div>
            <p className="text-sm font-bold leading-tight text-slate-900">AgroNotificaciones</p>
            <p className="text-[11px] text-slate-400">Maquinaria agrícola</p>
          </div>
        </Link>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3" data-menu-lateral={menu.disenado ? 'disenado' : 'siempre'} data-menu-inicio={menu.inicio ?? undefined}>
          {visibles.map((item) => {
            const hijos = item.hijos ?? []

            // Con un solo hijo el desplegable estorba: se entra directo.
            if (hijos.length === 1) {
              return (
                <EnlaceNav
                  key={item.href}
                  entrada={item.pantalla}
                  href={hijos[0].href}
                  icono={item.icono}
                  activo={activo(item.href)}
                >
                  {item.etiqueta}
                </EnlaceNav>
              )
            }

            if (hijos.length === 0) {
              return (
                <EnlaceNav
                  key={item.href}
                  entrada={item.pantalla}
                  href={item.href}
                  icono={item.icono}
                  activo={activo(item.href)}
                >
                  {item.etiqueta}
                </EnlaceNav>
              )
            }

            const desplegado = grupoAbierto === item.href || activo(item.href)
            return (
              <div key={item.href} data-menu-grupo={item.etiqueta}>
                <button
                  onClick={() => setGrupoAbierto(desplegado ? '' : item.href)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    activo(item.href)
                      ? 'bg-brand-50 text-brand-800'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {item.icono}
                  <span className="flex-1 text-left">{item.etiqueta}</span>
                  <IconChevronDown
                    className={`h-4 w-4 transition-transform ${desplegado ? 'rotate-180' : ''}`}
                  />
                </button>

                {desplegado && (
                  <div className="mt-0.5 flex flex-col gap-0.5 border-l border-slate-200 pl-3 ml-4">
                    {hijos.map((h) => (
                      <Link
                        key={h.href}
                        href={h.href}
                        data-menu-entrada={h.pantalla}
                        className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                          activo(h.href)
                            ? 'bg-brand-50 font-semibold text-brand-800'
                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        {h.etiqueta}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
              {iniciales}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800">{nombre}</p>
              <p className="truncate text-xs text-slate-400">{rolNombre}</p>
            </div>
            {verAvisos && <CampanaNotificaciones />}
            <button
              onClick={salir}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <IconLogout />
            </button>
          </div>
          <SelectorTema />
        </div>
      </aside>

      {/* ---------------- Contenido ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Encabezado móvil */}
        <header className="no-imprimir sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur-md lg:hidden">
          <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="Ir al inicio">
            <Logo tamano={32} className="rounded-lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight text-slate-900">{nombre}</p>
              <p className="truncate text-[11px] text-slate-400">{rolNombre}</p>
            </div>
          </Link>
          <div className="flex items-center gap-0.5">
            <SelectorTema compacto />
            {verAvisos && <CampanaNotificaciones compacta />}
            <button
              onClick={salir}
              className="rounded-lg p-2 text-slate-400 transition-colors active:bg-slate-100"
              aria-label="Cerrar sesión"
            >
              <IconLogout />
            </button>
          </div>
        </header>

        <main className="flex-1 pb-20 lg:pb-0">{children}</main>

        {/* Navegación inferior (celular) */}
        <nav
          className="no-imprimir fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] lg:hidden"
          aria-label="Navegación principal"
          data-barra-movil
        >
          {cabenAbajo.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              data-barra-entrada={item.pantalla}
              prefetch={precargaCompleta(item.href)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors ${
                activo(item.href) ? 'text-brand-700' : 'text-slate-400'
              }`}
            >
              {item.icono}
              {item.etiqueta}
            </Link>
          ))}

          {enMas.length > 0 && (
            <button
              onClick={() => setAbrirMas(true)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors ${
                enMas.some((i) => activo(i.href)) ? 'text-brand-700' : 'text-slate-400'
              }`}
            >
              <IconMas />
              Más
            </button>
          )}
        </nav>

        {/* Hoja con el resto de las secciones. Se manda al body porque la
            barra inferior tiene backdrop-blur y recortaría el `fixed`. */}
        {abrirMas &&
          typeof document !== 'undefined' &&
          createPortal(
            <div className="fixed inset-0 z-40 lg:hidden">
              <div
                className="absolute inset-0 bg-slate-900/30"
                onClick={() => setAbrirMas(false)}
                aria-hidden="true"
              />
              <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-raised)]">
                <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-200" />
                <div className="flex flex-col p-2">
                  {enMas.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      data-menu-mas={item.pantalla}
                      prefetch={precargaCompleta(item.href)}
                      onClick={() => setAbrirMas(false)}
                      className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-colors ${
                        activo(item.href) ? 'bg-brand-50 text-brand-800' : 'text-slate-600'
                      }`}
                    >
                      {item.icono}
                      {item.etiqueta}
                    </Link>
                  ))}
                </div>
              </div>
            </div>,
            document.body
          )}
      </div>
    </div>
  )
}

/** Enlace del menú lateral. Se sacó aparte porque ahora hay dos usos. */
function EnlaceNav({
  entrada,
  href,
  icono,
  activo,
  children,
}: {
  /** Llave de la entrada (data-menu-entrada, para las pruebas). */
  entrada: string
  href: string
  icono: React.ReactNode
  activo: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      data-menu-entrada={entrada}
      prefetch={precargaCompleta(href)}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
        activo
          ? 'bg-brand-50 text-brand-800'
          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      {icono}
      {children}
    </Link>
  )
}
