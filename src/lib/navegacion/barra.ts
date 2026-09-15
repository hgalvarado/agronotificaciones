/**
 * Qué accesos van en la barra inferior del teléfono y en qué orden.
 *
 * Antes lo decidía el orden en que estaban escritos los módulos en el
 * código: se aplanaban los visibles, cabían cuatro y el resto iba a
 * «Más». Funcionaba, pero un Jefe de Zona entra a Riego treinta veces al
 * día y lo tenía escondido detrás de «Más» porque «Tickets» estaba
 * declarado antes que él.
 *
 * Ahora el Administrador puede decir, por rol, qué va en la barra. Esta
 * capa es la regla pura de cómo se combinan esa preferencia y lo que el
 * usuario puede ver; no sabe de React ni de Supabase, así que se prueba
 * sola.
 *
 * Dos invariantes que no se negocian:
 *   1. Nada desaparece. Lo que no cabe en la barra sale en «Más».
 *   2. Un rol sin configurar se comporta EXACTAMENTE como antes. La
 *      función nueva no puede dejar a nadie sin menú el día que se
 *      instala.
 */

/** Lo mínimo que la barra necesita saber de un acceso. */
export type AccesoBarra = {
  /** Código de pantalla (`tickets`, `turnos_riego`…). Es la llave de la configuración. */
  pantalla: string
  href: string
  etiqueta: string
}

/** Cuántos botones caben abajo sin que el texto quede ilegible. */
export const CUPO_BARRA = 5

export type Reparto<T extends AccesoBarra> = { barra: T[]; mas: T[] }

/**
 * Reparte los accesos entre la barra y «Más».
 *
 * `preferidos` son los códigos de pantalla que el Administrador puso para
 * este rol, ya en orden. Los que no existan o que el usuario no pueda ver
 * se ignoran en silencio: la configuración puede ir por delante de los
 * permisos —se configura una pantalla y luego se concede— y quedarse sin
 * barra por eso sería peor que ignorar la línea.
 *
 * El último hueco de la barra siempre es para el botón «Más», así que
 * cuando sobra algo sólo caben `CUPO_BARRA - 1` accesos.
 */
export function repartir<T extends AccesoBarra>(
  disponibles: T[],
  preferidos: string[] = []
): Reparto<T> {
  const porPantalla = new Map(disponibles.map((a) => [a.pantalla, a]))

  // Lo elegido, en el orden elegido, sin repetir y sin lo que no existe.
  const vistos = new Set<string>()
  const elegidos: T[] = []
  for (const codigo of preferidos) {
    const acceso = porPantalla.get(codigo)
    if (!acceso || vistos.has(codigo)) continue
    vistos.add(codigo)
    elegidos.push(acceso)
  }

  // El resto conserva el orden del código, que es el orden de siempre.
  const resto = disponibles.filter((a) => !vistos.has(a.pantalla))

  // Sin configuración, el comportamiento de antes: los primeros del
  // código abajo y el resto en «Más».
  const ordenados = elegidos.length > 0 ? [...elegidos, ...resto] : disponibles

  if (ordenados.length <= CUPO_BARRA) return { barra: ordenados, mas: [] }

  return {
    barra: ordenados.slice(0, CUPO_BARRA - 1),
    mas: ordenados.slice(CUPO_BARRA - 1),
  }
}

/**
 * Cuántos accesos de los configurados caben de verdad en la barra.
 *
 * Lo usa el panel del Administrador para avisar mientras se configura:
 * marcar ocho pantallas no es un error, pero sólo las primeras se ven
 * abajo y conviene decirlo antes de guardar y no después.
 */
export function cabenEnBarra(cuantosTotales: number): number {
  return cuantosTotales <= CUPO_BARRA ? cuantosTotales : CUPO_BARRA - 1
}
