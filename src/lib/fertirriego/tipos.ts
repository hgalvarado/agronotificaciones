/**
 * Tipos de la app de campo de Fertirriego (Etapa B). Reflejan lo que devuelve fn_fert_estado_campo (sql/94) y lo
 * que se manda a fn_fert_sincronizar (sql/91).
 */

export type PermisosEstacion = {
  recibir: boolean
  aplicar: boolean
  contar: boolean
  relevo: boolean
  anular: boolean
  en_nombre_de: boolean
  administrar: boolean
  gestionar_choferes: boolean
}

export type Persona = { id: string; nombre: string }

export type Estacion = {
  id: string
  nombre: string
  zona_id: string | null
  zona: string | null
  custodio_id: string | null
  custodio: string | null
  custodia_estado: 'ACTIVA' | 'EN_ENTREGA' | null
  custodia_desde: string | null
  permisos: PermisosEstacion
  personas: Persona[]
}

export type Turno = {
  id: string
  turno: string
  temporada: string
  ciclo: string | null
  fecha_siembra: string | null
  estacion_id: string | null
  orden_sap: string | null
  plan: string | null
  area_mz: number | null
  activo: boolean
}

export type FilaPlan = {
  turno_ciclo_id: string
  fecha: string
  ddt: number
  material_id: string
  cantidad: number
  horas_riego: number | null
}

export type Material = { id: string; codigo: string; descripcion: string | null; unidad: string | null }
export type Chofer = { id: string; nombre: string; validado: boolean; pendiente?: boolean }
export type Vehiculo = {
  id: string
  placa: string
  tipo: string | null
  marca: string | null
  color: string | null
  validado: boolean
  pendiente?: boolean
}

export type Saldo = { estacion_id: string; material_id: string; disponible: number; en_transito: number }

export type TipoMovimiento =
  | 'SALDO_INICIAL'
  | 'RECEPCION'
  | 'APLICACION'
  | 'DEVOLUCION'
  | 'AJUSTE_CONTEO'
  | 'DIFERENCIA_RELEVO'
  | 'TRASLADO_SALIDA'
  | 'TRASLADO_ENTRADA'
  | 'TRASLADO_DEVUELTO'
  | 'ANULACION'

export type Movimiento = {
  id: string
  cursor: number
  estacion_id: string
  material_id: string
  tipo: TipoMovimiento
  cantidad: number
  fecha_hora: string
  turno_ciclo_id: string | null
  documento_tipo: string
  documento_id: string
  anula_id: string | null
  registrado_por: string
}

export type Linea = { material_id: string; cantidad: number; en_plan?: boolean }

export type Recepcion = {
  id: string
  estacion_id: string
  fecha_hora: string
  chofer_id: string
  vehiculo_id: string | null
  lugar: string | null
  documento: string | null
  comentario: string | null
  registrado_por: string
  anulado_at: string | null
  motivo_anulacion: string | null
}

export type Aplicacion = {
  id: string
  estacion_id: string
  turno_ciclo_id: string
  fecha: string
  fecha_hora: string
  ejecutor_id: string | null
  ejecutor2_id: string | null
  comentario: string | null
  registrado_por: string
  anulado_at: string | null
  motivo_anulacion: string | null
  lineas: Linea[] | null
}

export type BitacoraRiego = {
  turno_ciclo_id: string
  fecha: string
  horas_fertilizacion: number | null
  horas_riego: number | null
  hora_inicio: string | null
  hora_fin: string | null
  ejecutor_id: string | null
  ejecutor2_id: string | null
  comentario: string | null
}

export type OperacionServidor = {
  id: string
  tipo: string
  resultado: 'ACEPTADO' | 'ACEPTADO_CON_OBSERVACIONES' | 'RECHAZADO'
  mensaje: string | null
  observaciones: string[] | null
  recibido_en: string
}

/** Lo que el teléfono guarda para trabajar sin señal (respuesta de fn_fert_estado_campo). */
export type EstadoCampo = {
  servidor_en: string
  desde: string
  yo: Persona
  estaciones: Estacion[]
  turnos: Turno[]
  plan: FilaPlan[]
  materiales: Material[]
  choferes: Chofer[]
  vehiculos: Vehiculo[]
  choferes_vehiculos: { chofer_id: string; vehiculo_id: string; ultima_vez: string }[]
  saldos: Saldo[]
  saldos_previos: { estacion_id: string; material_id: string; saldo: number }[]
  movimientos: Movimiento[]
  recepciones: Recepcion[]
  aplicaciones: Aplicacion[]
  bitacora_riego: BitacoraRiego[]
  mis_operaciones: OperacionServidor[]
}

export type TipoOperacion =
  | 'recepcion'
  | 'aplicacion'
  | 'bitacora'
  | 'conteo'
  | 'devolucion'
  | 'anulacion'
  | 'chofer'
  | 'vehiculo'

export type Ubicacion = { lat: number; lon: number; precision: number }

/** Estado de un registro en el teléfono. */
export type EstadoLocal = 'PENDIENTE' | 'ACEPTADO' | 'OBSERVADO' | 'RECHAZADO'

/** Un registro hecho en el teléfono (el «sobre» que va a fn_fert_sincronizar + su estado local). */
export type Operacion = {
  id: string
  tipo: TipoOperacion
  creado_en: string
  dispositivo: string
  ubicacion: Ubicacion | null
  en_nombre_de: string | null
  datos: Record<string, unknown>
  // --- solo en el teléfono ---
  estado_local: EstadoLocal
  mensaje?: string | null
  observaciones?: string[]
  intentos: number
  /** Texto corto para listas: «Recepción · 3 productos». */
  resumen: string
}
