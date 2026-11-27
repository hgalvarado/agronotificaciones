/**
 * Fecha de un día en las bitácoras e historiales de Campo: se queda FIJA arriba al hacer scroll (pedido 2026-11-27: «a
 * veces solo me guío por la hora y me pierdo»). En el teléfono queda justo debajo del encabezado de la app (su alto real: --alto-encabezado);
 * en pantalla ancha, arriba del todo.
 */
export function EncabezadoDia({ children, derecha }: { children: React.ReactNode; derecha?: React.ReactNode }) {
  return (
    <div
      data-encabezado-dia
      className="sticky top-[var(--alto-encabezado,70px)] z-10 mb-1 flex items-baseline justify-between gap-2 rounded-lg bg-slate-200/95 px-3 py-1.5 shadow-sm backdrop-blur lg:top-0"
    >
      <span className="text-sm font-bold uppercase tracking-wide text-slate-900">{children}</span>
      {derecha && <span className="text-xs font-semibold text-slate-700">{derecha}</span>}
    </div>
  )
}
