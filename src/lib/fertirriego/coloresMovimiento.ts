/**
 * Tabla única de colores de la bitácora: cada tipo de movimiento pertenece a una «familia» con su color, icono y
 * nombre corto. Los tonos viven como variables CSS (`--mov-<familia>-fondo|borde|texto` en globals.css) y cambian
 * solos en tema claro y oscuro. El color NUNCA va solo: siempre lo acompaña el icono y el texto.
 * Reutilizable por Inyección. Sin React ni red (solo tipos de estilo).
 */

import type { CSSProperties } from 'react'

export type FamiliaMovimiento =
  | 'recepcion'
  | 'aplicacion'
  | 'conteo'
  | 'inyeccion'
  | 'devolucion'
  | 'traslado'
  | 'relevo'
  | 'envase'
  | 'historico'
  | 'motor'
  | 'neutro'

export type TonoMovimiento = { familia: FamiliaMovimiento; nombre: string; icono: string; descripcion: string }

export const FAMILIAS: Record<FamiliaMovimiento, { nombre: string; icono: string; descripcion: string }> = {
  recepcion: { nombre: 'Recepción', icono: '↓', descripcion: 'Entra producto a la bodega' },
  aplicacion: { nombre: 'Aplicación', icono: '↑', descripcion: 'Aplicación de Fertirriego por turno' },
  conteo: { nombre: 'Conteo', icono: '≈', descripcion: 'Ajuste por conteo físico' },
  inyeccion: { nombre: 'Inyección', icono: '◆', descripcion: 'Aplicación por lote (módulo de Inyección)' },
  devolucion: { nombre: 'Devolución', icono: '↩', descripcion: 'Devuelto a bodega, suministros o taller' },
  traslado: { nombre: 'Traslado', icono: '⇄', descripcion: 'Entre estaciones' },
  relevo: { nombre: 'Relevo', icono: '⟳', descripcion: 'Diferencia al cambiar de jornada' },
  envase: { nombre: 'Envases', icono: '▭', descripcion: 'Envases recibidos o entregados' },
  historico: { nombre: 'Histórico', icono: '◷', descripcion: 'Registro inicial: no mueve inventario' },
  motor: { nombre: 'Motor', icono: '⚙', descripcion: 'Diésel de motores' },
  neutro: { nombre: 'Otro', icono: '•', descripcion: 'Saldo inicial, anulaciones y archivo' },
}

/** Tipo de fila de la bitácora (TipoFila) → familia. Un tipo desconocido cae en «neutro». */
const FAMILIA_DE: Record<string, FamiliaMovimiento> = {
  SALDO_INICIAL: 'neutro',
  RECEPCION: 'recepcion',
  APLICACION: 'aplicacion',
  DEVOLUCION: 'devolucion',
  DEVOLUCION_BODEGA: 'devolucion',
  APLICACION_LOTE: 'inyeccion',
  RECEPCION_DIESEL: 'recepcion',
  SUMINISTRO_MOTOR: 'motor',
  AJUSTE_CONTEO: 'conteo',
  DIFERENCIA_RELEVO: 'relevo',
  TRASLADO_SALIDA: 'traslado',
  TRASLADO_ENTRADA: 'traslado',
  TRASLADO_DEVUELTO: 'traslado',
  ANULACION: 'neutro',
  ARCHIVO_TURNO: 'neutro',
  ENVASE: 'envase',
  HISTORICO: 'historico',
}

export function familiaDe(tipo: string): FamiliaMovimiento {
  return FAMILIA_DE[tipo] ?? 'neutro'
}

export function tonoDe(tipo: string): TonoMovimiento {
  const familia = familiaDe(tipo)
  return { familia, ...FAMILIAS[familia] }
}

/** Color de la banda vertical de la fila (el fondo de la fila NO se tiñe). Se pinta con `BandaLateral`. */
export function colorBanda(familia: FamiliaMovimiento): string {
  return `var(--mov-${familia}-borde)`
}

/** Insignia sobria de la familia: texto del color y borde fino; sin relleno. */
export function estiloInsignia(familia: FamiliaMovimiento): CSSProperties {
  return {
    color: `var(--mov-${familia}-texto)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--mov-${familia}-borde) 45%, transparent)`,
  }
}
