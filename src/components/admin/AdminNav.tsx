'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Las secciones llegan ya filtradas por permiso desde el layout. Antes la
 * lista estaba aquí codificada con un `soloAdmin`, que se desincronizaba
 * de lo que el panel de permisos decía.
 */
export function AdminNav({ secciones }: { secciones: { href: string; etiqueta: string }[] }) {
  const pathname = usePathname()

  return (
    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur-md">
      <div className="scroll-suave mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 py-2.5 lg:px-6">
        {secciones.map((s) => {
          const activo = pathname.startsWith(s.href)
          return (
            <Link
              key={s.href}
              href={s.href}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-all ${
                activo
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {s.etiqueta}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
