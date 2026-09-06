'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

function NavItem({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium ${
        active ? 'text-emerald-700' : 'text-slate-400'
      }`}
    >
      <span className="text-xl leading-none">{icon}</span>
      {label}
    </Link>
  )
}

export function BottomNav({ esAdmin, esTorreControl }: { esAdmin: boolean; esTorreControl: boolean }) {
  const pathname = usePathname()
  const mostrarAdmin = esAdmin || esTorreControl

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
      aria-label="Navegación principal"
    >
      <NavItem href="/tickets" icon="🎫" label="Tickets" active={pathname.startsWith('/tickets')} />
      <NavItem href="/dashboard" icon="📊" label="Avance" active={pathname.startsWith('/dashboard')} />
      {mostrarAdmin && (
        <NavItem
          href="/admin/catalogos"
          icon="⚙️"
          label="Catálogos"
          active={pathname.startsWith('/admin')}
        />
      )}
    </nav>
  )
}
