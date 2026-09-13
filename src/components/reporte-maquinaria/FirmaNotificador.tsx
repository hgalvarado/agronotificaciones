/**
 * Espacio de firma del notificador.
 *
 * Una raya para firmar a mano y el nombre centrado debajo: el reporte se
 * imprime, se firma y se archiva, así que la raya tiene que estar en el
 * papel, no ser un texto que la imite.
 *
 * Si el día lo capturó más de una persona se dibuja una raya por cada
 * una; firmar una sola por todas no diría quién responde de qué.
 */
export function FirmaNotificador({ notificadores }: { notificadores: string[] }) {
  const nombres = notificadores.length > 0 ? notificadores : ['']

  return (
    <div className="flex flex-col gap-5 break-inside-avoid">
      {nombres.map((nombre, i) => (
        <div key={nombre || i} className="flex flex-col items-center">
          {/* El hueco de arriba es donde se firma: sin él la raya queda
              pegada a la tabla y no cabe la mano. */}
          <div className="h-12 w-full" aria-hidden="true" />
          <div className="w-full border-t border-slate-500" />
          <p className="mt-1 text-center text-xs font-semibold text-slate-800">
            {nombre || ' '}
          </p>
          <p className="text-center text-[10px] uppercase tracking-widest text-slate-400">
            Notificador
          </p>
        </div>
      ))}
    </div>
  )
}
