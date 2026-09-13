'use client'

import { usePathname } from 'next/navigation'

// Layout maestro-detalle. En escritorio la lista queda fija a la izquierda
// y el detalle cambia a la derecha; como la lista vive en el layout de la
// ruta, Next.js NO la vuelve a renderizar al cambiar de ticket — por eso
// el salto entre tickets se siente inmediato.
// En celular se comporta como dos pantallas: lista o detalle, nunca ambas.
export function TicketsSplit({
  lista,
  children,
}: {
  lista: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const enLista = pathname === '/tickets'

  return (
    <div className="lg:flex lg:h-dvh lg:overflow-hidden">
      <div
        className={`${enLista ? 'flex' : 'hidden'} w-full flex-col border-slate-200 lg:flex lg:w-[22rem] lg:shrink-0 lg:border-r xl:w-96`}
      >
        {lista}
      </div>

      <div className={`${enLista ? 'hidden' : 'block'} min-w-0 flex-1 lg:block lg:overflow-y-auto scroll-suave`}>
        {children}
      </div>
    </div>
  )
}
