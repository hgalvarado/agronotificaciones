import { AZUL, fechaLarga } from '@/lib/reporte-maquinaria/formato'

/**
 * Las cuatro líneas del membrete, tal como se dictan. Es lo que gerencia
 * reconoce del papel, así que no se abrevia ni se reordena.
 */
export function EncabezadoReporte({
  fecha,
  temporada,
}: {
  fecha: string
  temporada: string | null
}) {
  return (
    <header className="border-b-2 pb-3 text-center" style={{ borderColor: AZUL }}>
      <h1
        className="text-lg font-bold uppercase tracking-tight sm:text-xl"
        style={{ color: AZUL }}
      >
        Agropecuaria Montelíbano S.A.
      </h1>
      <p
        className="mt-0.5 text-sm font-bold uppercase tracking-tight sm:text-base"
        style={{ color: AZUL }}
      >
        Notificación de maquinaria — {fechaLarga(fecha)}
      </p>
      <p className="mt-0.5 text-xs font-semibold uppercase tracking-widest text-slate-600">
        Torre Control Finca Santa Rosa
      </p>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
        {temporada ?? 'Sin temporada activa'}
      </p>
    </header>
  )
}
