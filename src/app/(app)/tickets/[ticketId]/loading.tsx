import { Esqueleto, Tarjeta } from '@/components/ui/Primitivos'

// Se muestra al instante mientras Next.js carga el detalle del ticket:
// el usuario percibe respuesta inmediata en vez de una pantalla congelada.
export default function CargandoTicket() {
  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <Tarjeta className="p-5">
        <Esqueleto className="h-6 w-56" />
        <Esqueleto className="mt-2 h-4 w-40" />
        <Esqueleto className="mt-1 h-4 w-28" />
        <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
          <Esqueleto className="h-9 w-24" />
          <Esqueleto className="h-9 w-28" />
        </div>
      </Tarjeta>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Tarjeta key={i} className="px-3.5 py-3">
            <Esqueleto className="h-5 w-5" />
            <Esqueleto className="mt-2 h-6 w-12" />
            <Esqueleto className="mt-1 h-3 w-16" />
          </Tarjeta>
        ))}
      </div>

      <Tarjeta className="p-4">
        <Esqueleto className="h-4 w-32" />
        <div className="mt-3 flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Esqueleto key={i} className="h-16 w-full" />
          ))}
        </div>
      </Tarjeta>
    </div>
  )
}
