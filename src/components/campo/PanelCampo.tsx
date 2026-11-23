import Link from 'next/link'
import { Tarjeta } from '@/components/ui/Primitivos'
import type { FichaCampo } from '@/lib/campo/fichas'
import { IndicadorConexion } from './IndicadorConexion'

/** Una tarjeta por ficha de Campo; cada una es un enlace de al menos 44 px de alto. */
export function PanelCampo({ fichas, usuarioId }: { fichas: FichaCampo[]; usuarioId: string }) {
  const rutaEnvios = fichas.find((f) => !f.proximamente && ['/fertirriego', '/inyeccion', '/motores'].includes(f.ruta))?.ruta ?? null
  return (
    <div className="flex flex-col gap-3" data-panel-campo>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900">Campo</h1>
        <IndicadorConexion usuarioId={usuarioId} rutaEnvios={rutaEnvios} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fichas.map((f) => f.proximamente ? (
          <div key={f.codigo} data-ficha-campo={f.codigo} aria-disabled="true" className="opacity-70">
            <Tarjeta className="h-full p-4">
              <p className="text-base font-bold text-slate-900">{f.nombre}</p>
              <p className="mt-1 text-sm text-slate-500">{f.descripcion}</p>
            </Tarjeta>
          </div>
        ) : (
          <Link
            key={f.codigo}
            href={f.ruta}
            data-ficha-campo={f.codigo}
            className="block min-h-11 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            <Tarjeta className="h-full p-4 transition-colors hover:border-brand-300">
              <p className="text-base font-bold text-slate-900">{f.nombre}</p>
              <p className="mt-1 text-sm text-slate-500">{f.descripcion}</p>
            </Tarjeta>
          </Link>
        ))}
      </div>
    </div>
  )
}
