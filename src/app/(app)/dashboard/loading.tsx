import { Esqueleto, Tarjeta } from '@/components/ui/Primitivos'

export default function CargandoDashboard() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 lg:p-6">
      <Esqueleto className="h-6 w-44" />
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Esqueleto key={i} className="h-9 w-28 rounded-full" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Tarjeta key={i} className="p-4">
            <Esqueleto className="h-4 w-32" />
            <Esqueleto className="mt-3 h-2 w-full" />
            <Esqueleto className="mt-2 h-3 w-40" />
          </Tarjeta>
        ))}
      </div>
    </div>
  )
}
