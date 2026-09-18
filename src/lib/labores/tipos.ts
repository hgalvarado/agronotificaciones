/**
 * Qué es una labor para las pantallas que la crean o la corrigen.
 *
 * Vive aquí porque lo comparten la pantalla de Vinculación y el
 * formulario del ticket: con el tipo dentro de uno de los dos, el otro
 * tendría que importar del módulo ajeno, que es como empiezan las
 * dependencias cruzadas.
 */

export type LaborVinculada = {
  id: string
  nombre: string
  categoria_labor_id: string | null
  activo: boolean
  /** Llegan con la migración 15. Ver `soportaProveedores`. */
  usa_proveedor_plastico?: boolean | null
  usa_proveedor_manguera?: boolean | null
  labores_tareas: { tarea_id: string }[]
  /** Códigos físicos vinculados. Llegan con la migración 19. */
  labores_implementos_fisicos?: { implemento_fisico_id: string }[]
}

export type ImplementoFisicoOpcion = {
  id: string
  codigo: string
  descripcion: string
  /** Tipo SAP del que cuelga. De aquí sale la tarifa al capturar. */
  implemento_id?: string | null
}

/** La labor en blanco con la que arranca el alta. */
export const LABOR_NUEVA: LaborVinculada = {
  id: '',
  nombre: '',
  categoria_labor_id: null,
  activo: true,
  usa_proveedor_plastico: false,
  usa_proveedor_manguera: false,
  labores_tareas: [],
  labores_implementos_fisicos: [],
}
