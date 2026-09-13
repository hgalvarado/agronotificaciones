/**
 * Rangos de fecha que usan las pantallas de consulta.
 *
 * El rango por omisión es EL MES EN CURSO, no los últimos treinta días.
 * Nadie abre el control de horómetros a mirar «lo de hace mes y medio»:
 * se abre a cuadrar el mes que se está notificando, y traer 3.000 filas
 * de las que sobran dos tercios sólo hace la pantalla lenta. El rango se
 * puede ampliar cuando de verdad se quiere mirar atrás.
 */

export function hoyIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** El primer día del mes en curso, en ISO. */
export function primerDiaDelMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** Desde el día 1 del mes hasta hoy. */
export function mesEnCurso(): { desde: string; hasta: string } {
  return { desde: primerDiaDelMes(), hasta: hoyIso() }
}
