/**
 * Contratos del reporte público de maquinaria.
 *
 * Esta capa no hace nada: sólo nombra las formas que se pasan entre las
 * demás. Vive aparte para que validación, persistencia, negocio y
 * pantalla dependan de los mismos tipos y no unas de otras.
 */

/**
 * Los cuatro procesos del ticket, en el orden en que ocurren.
 *
 * Son una LISTA de los que se publican, no un tope hasta el que se
 * publica: el Administrador puede enseñar lo notificado y lo registrado
 * y dejar fuera lo que está en revisión, que con un tope no se podía.
 */
export const PROCESOS_TICKET = [
  { valor: 'REGISTRADO', etiqueta: 'Registrado' },
  { valor: 'REVISANDO', etiqueta: 'Revisando' },
  { valor: 'PENDIENTE_APROBACION', etiqueta: 'Pendiente de aprobación' },
  { valor: 'NOTIFICADO', etiqueta: 'Notificado' },
] as const

export type ProcesoTicket = (typeof PROCESOS_TICKET)[number]['valor']

/**
 * Los dos estados del ticket.
 *
 * Es otra pregunta que la del proceso y por eso es otro filtro: el
 * PROCESO dice por dónde va el ticket camino de SAP; el ESTADO dice si
 * todavía se puede capturar en él. Un ticket cerrado y notificado es lo
 * normal al final del mes, y uno abierto y notificado es un descuido que
 * conviene poder aislar.
 */
export const ESTADOS_TICKET = [
  { valor: 'ABIERTO', etiqueta: 'Abierto' },
  { valor: 'CERRADO', etiqueta: 'Cerrado' },
] as const

export type EstadoTicketPublico = (typeof ESTADOS_TICKET)[number]['valor']

/** Reglas que fija el Administrador para el visor público. */
export type ConfiguracionPublica = {
  activo: boolean
  procesos: ProcesoTicket[]
  estados: EstadoTicketPublico[]
  todosDepartamentos: boolean
  departamentos: string[]
  temporadaActiva: string | null
}

/** Lo que el visitante puede pedir. Todo opcional salvo la fecha. */
export type FiltrosReporte = {
  fecha: string
  departamento: string | null
  usuarioId: string | null
  ticketId: string | null
}

/** Opciones de los desplegables, ya recortadas a lo publicable. */
export type OpcionesFiltro = {
  departamentos: { valor: string; etiqueta: string }[]
  usuarios: { valor: string; etiqueta: string }[]
  tickets: { valor: string; etiqueta: string }[]
}

export type FilaDetalle = {
  detalle_id: string
  turno: string
  ubicacion_tecnica: string
  ut: string
  lote_nombre: string | null
  labor: string
  tarea_codigo: string
  tarea_nombre: string
  puesto_trabajo: string | null
  implemento: string | null
  equipo_codigo: string
  equipo_nombre: string | null
  /** Llegan con la migración 24; sirven para emparejar con el resumen. */
  horometro_inicial?: number | null
  horometro_final?: number | null
  horas_maquina: number | null
  avance_mz: number | null
  horas_hombre: number | null
  operador_codigo: string | null
  operador_nombre: string | null
  ticket_codigo: string
  departamento: string | null
  usuario_nombre: string | null
}

export type FilaHorometro = {
  equipo_codigo: string
  equipo_nombre: string | null
  horometro_inicial: number
  horometro_final: number
  horas_maquina: number
  horas_hombre: number | null
  familia: string | null
}

/** Todo lo que la pantalla necesita para dibujarse, ya resuelto. */
export type Reporte = {
  configuracion: ConfiguracionPublica
  filtros: FiltrosReporte
  opciones: OpcionesFiltro
  detalle: FilaDetalle[]
  horometros: FilaHorometro[]
  /** «Notificador: [Nombre de Usuario]» del pie del reporte. */
  notificadores: string[]
  totales: { horasMaquina: number; avanceMz: number; horasHombre: number }
  aviso: string | null
}
