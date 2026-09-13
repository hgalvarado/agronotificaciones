import { IconTicket } from '@/components/ui/Icons'

// Sólo se ve en escritorio: en celular el layout muestra la lista a
// pantalla completa y este panel queda oculto.
export default function TicketsIndexPage() {
  return (
    <div className="hidden h-full flex-col items-center justify-center gap-3 px-6 text-center lg:flex">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
        <IconTicket className="h-7 w-7" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-600">Selecciona un ticket</p>
        <p className="mt-1 text-sm text-slate-400">
          Elige uno de la lista para ver sus horómetros y labores registradas.
        </p>
      </div>
    </div>
  )
}
