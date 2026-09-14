'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  IconChart,
  IconChevronDown,
  IconDinero,
  IconGauge,
  IconLogout,
  IconMapPin,
  IconMas,
  IconPlan,
  IconSettings,
  IconTicket,
  IconUser,
} from './Icons'
import { CampanaNotificaciones } from './CampanaNotificaciones'
import { Logo } from './Logo'

type ItemNav = {
  href: string
  etiqueta: string
  icono: React.ReactNode
  visible: boolean
  /** Sub-secciones. Hoy sólo las usa «Avances». */
  hijos?: ItemNav[]
}

export function AppShell({
  nombre,
  rolNombre,
  esAdmin,
  esTorreControl,
  permisos,
  children,
}: {
  nombre: string
  rolNombre: string
  esAdmin: boolean
  esTorreControl: boolean
  /** Claves «pantalla:accion» que el usuario tiene concedidas. */
  permisos: string[]
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [abrirMas, setAbrirMas] = useState(false)
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(null)

  // Mientras la migración 12 no se haya corrido, `fn_mis_permisos` no
  // existe y el menú vuelve a decidirse por rol, como antes. Así el código
  // nuevo y el SQL pueden llegar en momentos distintos sin dejar a nadie
  // sin menú.
  const sinMigracion = permisos.includes('__sin_migracion__')
  const concedidos = new Set(permisos)
  const ve = (pantalla: string, siRol: boolean) =>
    sinMigracion ? siRol : concedidos.has(`${pantalla}:ver`)

  const revisor = esAdmin || esTorreControl

  const items: ItemNav[] = [
    { href: '/tickets', etiqueta: 'Tickets', icono: <IconTicket />, visible: ve('tickets', true) },
    {
      href: '/horometros',
      etiqueta: 'Horómetros',
      icono: <IconGauge />,
      visible: ve('horometros', revisor),
    },
    {
      href: '/labores',
      etiqueta: 'Labores',
      icono: <IconMapPin />,
      visible: ve('labores', revisor),
    },
    { href: '/dashboard', etiqueta: 'Avance', icono: <IconChart />, visible: ve('avance', true) },
    {
      // «Avances» agrupa el seguimiento de cada proceso de campo: lo que
      // se planificó contra lo que se lleva hecho. Emplasticado vive en
      // /plan/APS (el proceso APS de SAP) y trasplante en su propio
      // módulo; las direcciones no cambian, sólo dónde se entra.
      href: '/plan',
      etiqueta: 'Avances',
      icono: <IconPlan />,
      visible: ve('plan', revisor) || ve('trasplante', revisor),
      hijos: [
        {
          href: '/plan/APS',
          etiqueta: 'Emplasticado',
          icono: <IconPlan />,
          visible: ve('plan_aps', revisor),
        },
        {
          href: '/trasplante',
          etiqueta: 'Trasplante',
          icono: <IconChart />,
          visible: ve('trasplante', revisor),
        },
      ],
    },
    {
      href: '/costos',
      etiqueta: 'Costos',
      icono: <IconDinero />,
      visible: ve('costos', revisor),
    },
    {
      href: '/admin/catalogos',
      etiqueta: 'Catálogos',
      icono: <IconSettings />,
      visible: ve('catalogos', revisor),
    },
    {
      href: '/admin/reporte-publico',
      etiqueta: 'Reporte público',
      icono: <IconSettings />,
      visible: ve('reporte_publico', esAdmin),
    },
    { href: '/admin/usuarios', etiqueta: 'Usuarios', icono: <IconUser />, visible: ve('usuarios', esAdmin) },
  ]
  // Un grupo se muestra si él es visible y tiene al menos un hijo visible.
  const visibles = items
    .map((i) => (i.hijos ? { ...i, hijos: i.hijos.filter((h) => h.visible) } : i))
    .filter((i) => i.visible && (!i.hijos || i.hijos.length > 0))

  // Los avisos son para quien revisa: quien puede corregir un ticket es
  // quien necesita enterarse de que le cerraron uno.
  const verAvisos = sinMigracion ? revisor : concedidos.has('tickets:editar')

  // En el celular no caben más de cinco pestañas abajo sin que queden
  // ilegibles. Si hay más, las últimas se agrupan en «Más»: el digitador ve
  // dos y nunca lo alcanza, pero el administrador tiene siete.
  const CUPO = 5
  // En el celular los grupos se aplanan: cada plan es su propia entrada,
  // que es más directo que un desplegable dentro de una hoja.
  const planos: ItemNav[] = visibles.flatMap((i) =>
    i.hijos && i.hijos.length > 0
      ? i.hijos.map((h) => ({ ...h, etiqueta: `${i.etiqueta}: ${h.etiqueta}` }))
      : [i]
  )
  const cabenAbajo = planos.length > CUPO ? planos.slice(0, CUPO - 1) : planos
  const enMas = planos.length > CUPO ? planos.slice(CUPO - 1) : []

  function activo(href: string) {
    return pathname === href || pathname.startsWith(href + '/')
  }

  async function salir() {
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
        <div className="flex items-center gap-2.5 px-5 py-5">
          <Logo tamano={36} />
          <div>
            <p className="text-sm font-bold leading-tight text-slate-900">AgroNotificaciones</p>
            <p className="text-[11px] text-slate-400">Maquinaria agrícola</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
          {visibles.map((item) => {
            const hijos = item.hijos ?? []

            // Con un solo hijo el desplegable estorba: se entra directo.
            if (hijos.length === 1) {
              return (
                <EnlaceNav
                  key={item.href}
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
              <div key={item.href}>
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
        </div>
      </aside>

      {/* ---------------- Contenido ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Encabezado móvil */}
        <header className="no-imprimir sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-2.5">
            <Logo tamano={32} className="rounded-lg" />
            <div>
              <p className="text-sm font-bold leading-tight text-slate-900">{nombre}</p>
              <p className="text-[11px] text-slate-400">{rolNombre}</p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
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
        >
          {cabenAbajo.map((item) => (
            <Link
              key={item.href}
              href={item.href}
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
  href,
  icono,
  activo,
  children,
}: {
  href: string
  icono: React.ReactNode
  activo: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
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
