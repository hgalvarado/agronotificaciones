'use client'

/**
 * Aviso «MODO PRUEBA» de las pantallas de Campo (Fertirriego, Inyección y Motores; migraciones 98 y 145).
 * Las estaciones de prueba las crea el modo de pruebas con el prefijo «PRUEBA · »; una sola regla para las tres pantallas.
 */
export function AvisoModoPruebas({ estacionNombre }: { estacionNombre: string }) {
  if (!estacionNombre.startsWith('PRUEBA · ')) return null
  return (
    <div
      className="rounded-xl bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900 ring-1 ring-inset ring-amber-300"
      data-modo-prueba
    >
      MODO PRUEBA · Lo que registres aquí es de práctica: no cuenta y se borrará.
    </div>
  )
}
