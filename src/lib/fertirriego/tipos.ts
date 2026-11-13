/**
 * Tipos de la app de campo de Fertirriego (Etapa B). Reflejan lo que devuelve fn_fert_estado_campo (sql/94) y lo
 * que se manda a fn_fert_sincronizar (sql/91).
 */

export type PermisosEstacion = {
  recibir: boolean
  aplicar: boolean
  contar: boolean
  relevo: boolean
  trasladar: boolean
  autorizar_traslado: boolean
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
  /** Quiénes pueden autorizar traslados desde esta estación (sql/96). */
  autorizadores?: Persona[]
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

export type Material = {
  id: string
  codigo: string
  descripcion: string | null
  unidad: string | null
  /** sql/99: clase para agrupar (grupo de artículos de SAP o la elegida en campo). */
  grupo?: string | null
  /** sql/99: MARA = viene de AGL; CAMPO = creado por el estacionero (nunca va a MARA). */
  origen?: 'MARA' | 'CAMPO'
  validado?: boolean
  /** sql/99: fertilizante que entra a los análisis (lo decide AGL). Los demás son solo control de inventario. */
  analisis?: boolean
  pendiente?: boolean
}
export type EnvaseTipo = { id: string; nombre: string; validado: boolean; pendiente?: boolean }
export type SaldoEnvase = { estacion_id: string; envase_id: string; saldo: number }
export type LineaEnvase = { envase_id: string; recibidos: number; entregados: number }
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

/** sql/100: datos de la operación que creó el registro (fert_operaciones), para el detalle. */
export type InfoOperacion = {
  creado_en: string | null
  recibido_en: string | null
  lat: number | null
  lon: number | null
  observaciones: string[] | null
}

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
  /** sql/99 */
  turnos?: string[] | null
  envases?: LineaEnvase[] | null
  /** sql/100: nombre del chofer y placa (también de los inactivos), operación y «solo envases» */
  chofer?: string | null
  vehiculo?: string | null
  operacion?: InfoOperacion | null
  solo_envases?: boolean | null
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
  /** sql/99: DDT del plan elegido (null si es extra o teléfono viejo) */
  ddt_plan?: number | null
  fecha_plan?: string | null
  extra?: boolean
  ddt_real?: number | null
  /** sql/100 */
  operacion?: InfoOperacion | null
}

/** sql/100: conteo físico con sus líneas. */
export type Conteo = {
  id: string
  estacion_id: string
  fecha_hora: string
  comentario: string | null
  registrado_por: string
  anulado_at: string | null
  motivo_anulacion: string | null
  lineas: { material_id: string; saldo_sistema: number; cantidad_real: number; diferencia: number }[] | null
  operacion?: InfoOperacion | null
}

/** sql/100: movimiento de envases (+ entra / − sale). */
export type MovimientoEnvase = {
  id: string
  estacion_id: string
  envase_id: string
  cantidad: number
  motivo: 'RECEPCION' | 'ENTREGA' | 'CONTEO' | 'ANULACION' | string
  documento_tipo: string | null
  documento_id: string | null
  fecha_hora: string
  registrado_por: string | null
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
  /** sql/99 */
  ppm_cloro_cabezal?: number | null
  ppm_cloro_campo?: number | null
}

export type EstadoNovedad = 'EN_APLICACION' | 'PREPARADO' | 'PENDIENTE' | 'TERMINADO'
export type Novedad = { turno_ciclo_id: string | null; estado: EstadoNovedad; nota: string }

export type Relevo = {
  id: string
  estacion_id: string
  estado: 'EN_ENTREGA' | 'RECIBIDO' | 'RECHAZADO' | 'CANCELADO' | 'ASIGNADO'
  metodo: 'CODIGO' | 'CODIGO_LARGO' | 'SESION' | 'ASIGNACION'
  entrega_id: string | null
  entrega: string | null
  recibe_id: string | null
  recibe: string | null
  entregado_at: string | null
  recibido_at: string | null
  novedades: Novedad[]
  nota_entrega: string | null
  nota_recibe: string | null
  motivo: string | null
  revisar: boolean
  diferencias: { material_id: string; saldo_sistema: number; cantidad_real: number; diferencia: number }[]
}

export type Traslado = {
  id: string
  origen_id: string
  destino_id: string
  origen: string
  destino: string
  estado: 'POR_AUTORIZAR' | 'EN_TRANSITO' | 'ACEPTADO' | 'RECHAZADO' | 'ANULADO'
  motivo: string
  autorizador_id: string | null
  autorizador: string | null
  creado_por: string
  creador: string | null
  creado_at: string
  autorizado_at: string | null
  resuelto_at: string | null
  nota_autorizacion: string | null
  nota_resolucion: string | null
  lineas: { material_id: string; cantidad_enviada: number; cantidad_recibida: number | null }[] | null
}

export type Destino = { id: string; nombre: string; zona: string | null; misma_zona: boolean }

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
  /** sql/96 (pueden faltar si la base aún no tiene la 96) */
  relevos?: Relevo[]
  traslados?: Traslado[]
  destinos?: Destino[]
  /** sql/99 (pueden faltar si la base aún no tiene la 99) */
  envases_tipos?: EnvaseTipo[]
  envases_saldos?: SaldoEnvase[]
  /** sql/100 (pueden faltar si la base aún no tiene la 100) */
  nombres?: Record<string, string>
  envases_movimientos?: MovimientoEnvase[]
  conteos?: Conteo[]
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
  | 'producto'
  | 'envase_tipo'
  | 'relevo_entregar'
  | 'relevo_recibir'
  | 'relevo_cancelar'
  | 'relevo_rechazar'
  | 'traslado_crear'
  | 'traslado_autorizar'
  | 'traslado_aceptar'
  | 'traslado_rechazar'
  | 'traslado_cancelar'

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
