'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { IconChevronDown } from '@/components/ui/Icons'
import { agruparSecciones } from '@/lib/navegacion/adminSecciones'

/**
 * Navegación de Administración, agrupada y sin scroll lateral.
 *
 * Las secciones llegan ya filtradas por permiso desde el layout (la lista y
 * sus grupos viven en `lib/navegacion/adminSecciones`). Pantalla ancha (xl, 1280 px): riel
 * vertical pegajoso a la izquierda; con el menú lateral de la app ya ocupa 240 px, un
 * segundo riel en 1024 px le quita el sitio a las tablas. Teléfono y tableta: una barra
 * «Administración › sección» que abre una hoja con la lista agrupada.
 */
export function AdminNav({
  secciones,
}: {
  secciones: { href: string; etiqueta: string; grupo: string }[]
}) {
  const pathname = usePathname()
  const [abierta, setAbierta] = useState(false)
  const grupos = useMemo(() => agruparSecciones(secciones), [secciones])
  const activa = secciones.find((s) => pathname.startsWith(s.href))

  return (
    <>
      {/* ------------------------ Escritorio: riel ------------------------ */}
      <nav
        aria-label="Administración"
        className="hidden w-60 shrink-0 self-start px-4 py-6 xl:sticky xl:top-0 xl:block xl:max-h-dvh xl:overflow-y-auto"
      >
        <p className="px-3 pb-3 text-base font-bold tracking-tight text-slate-900">Administración</p>
        <div className="flex flex-col gap-5">
          {grupos.map((g) => {
            const grupoActivo = g.secciones.some((s) => s.href === activa?.href)
            return (
              <div key={g.key}>
                <p
                  className={`px-3 pb-1 text-sm font-semibold ${
                    grupoActivo ? 'text-slate-900' : 'text-slate-500'
                  }`}
                >
                  {g.titulo}
                </p>
                <ul className="flex flex-col gap-0.5 border-l border-slate-200 ml-3">
                  {g.secciones.map((s) => (
                    <li key={s.href}>
                      <EnlaceSeccion href={s.href} activo={s.href === activa?.href}>
                        {s.etiqueta}
                      </EnlaceSeccion>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </nav>

      {/* --------------------- Móvil y tableta: barra --------------------- */}
      <div className="sticky top-14 z-10 border-b border-slate-200 bg-white/90 backdrop-blur-md xl:hidden">
        <button
          type="button"
          onClick={() => setAbierta(true)}
          aria-haspopup="dialog"
          className="flex min-h-12 w-full items-center gap-2 px-4 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600"
        >
          <span className="text-slate-500">Administración</span>
          <span aria-hidden="true" className="text-slate-300">
            ›
          </span>
          <span className="min-w-0 flex-1 break-words font-semibold text-slate-900">
            {activa?.etiqueta ?? 'Elegir sección'}
          </span>
          <IconChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        </button>
      </div>

      <Modal abierto={abierta} onCerrar={() => setAbierta(false)} titulo="Administración">
        <nav aria-label="Secciones de administración" className="flex flex-col gap-4 p-3">
          {grupos.map((g) => (
            <div key={g.key}>
              <p className="px-3 pb-1 text-sm font-semibold text-slate-500">{g.titulo}</p>
              <ul className="flex flex-col gap-0.5">
                {g.secciones.map((s) => (
                  <li key={s.href}>
                    <EnlaceSeccion
                      href={s.href}
                      activo={s.href === activa?.href}
                      onClick={() => setAbierta(false)}
                      grande
                    >
                      {s.etiqueta}
                    </EnlaceSeccion>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </Modal>
    </>
  )
}

function EnlaceSeccion({
  href,
  activo,
  grande = false,
  onClick,
  children,
}: {
  href: string
  activo: boolean
  grande?: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={activo ? 'page' : undefined}
      className={`flex items-center break-words rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
        grande ? 'min-h-12 py-2.5' : 'min-h-10 py-2'
      } ${
        activo
          ? 'bg-brand-50 font-semibold text-brand-700'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {children}
    </Link>
  )
}
