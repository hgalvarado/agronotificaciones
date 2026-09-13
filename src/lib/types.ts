// Tipos de dominio livianos. Cuando el proyecto de Supabase esté enlazado
// con la CLI, se recomienda reemplazar esto por tipos generados con:
//   npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts
// Mientras tanto, estos tipos reflejan 1:1 las columnas de sql/01_schema.sql.

export type RolCodigo = 'ADMIN' | 'TORRE_CONTROL' | 'DIGITADOR'
export type EstadoTicket = 'ABIERTO' | 'CERRADO'
export type TurnoTipo = 'DIURNO' | 'NOCTURNO'
export type ProcesoTicket = 'REGISTRADO' | 'REVISANDO' | 'PENDIENTE_APROBACION' | 'NOTIFICADO'

export type Perfil = {
  id: string
  nombre: string
  rol_id: number
  departamento: string | null
  whatsapp: string | null
  activo: boolean
}

export type Rol = {
  id: number
  codigo: RolCodigo
  nombre: string
}

export type Temporada = {
  id: string
  nombre: string
  fecha_inicio: string
  fecha_fin: string
  activa: boolean
}

export type Zona = {
  id: string
  nombre: string
  responsable: string | null
  correo_electronico: string | null
  telefono: string | null
  activo: boolean
}

export type Lote = {
  id: string
  nomenclatura: string
  nombre: string | null
  activo: boolean
}

export type LoteTemporada = {
  id: string
  lote_id: string
  temporada_id: string
  zona_id: string | null
  area_bruta: number | null
  area_neta: number
  activo: boolean
  lotes?: Lote
}

export type Equipo = {
  id: string
  codigo: string
  nombre: string
  familia_id: string | null
  categoria_id: string | null
  distrito: string | null
  en_mantenimiento: boolean
  visible_app: boolean
  activo: boolean
  comentario: string | null
}

export type Implemento = {
  id: string
  codigo: string
  nombre: string
  comentario: string | null
  activo: boolean
}

export type Operador = {
  id: string
  codigo: string | null
  nombre: string
  activo: boolean
}

export type CategoriaLabor = {
  id: string
  nombre: string
  activo: boolean
}

export type Labor = {
  id: string
  nombre: string
  categoria_labor_id: string | null
  activo: boolean
}

export type TareaSap = {
  id: string
  codigo: string
  nombre: string
  ejecucion: string | null
  activo: boolean
}

export type Ticket = {
  id: string
  codigo: string
  fecha: string
  usuario_id: string
  departamento: string | null
  estado: EstadoTicket
  proceso: ProcesoTicket
  temporada_id: string | null
  cerrado_at: string | null
  created_at: string
  perfiles?: { nombre: string } | null
}

export type Horometro = {
  id: string
  ticket_id: string
  fecha: string
  turno: TurnoTipo
  equipo_id: string
  horometro_inicial: number
  horometro_final: number
  horas_maquina: number
  horas_hombre: number | null
  operador_id: string | null
  comentario: string | null
  usuario_id: string
  created_at: string
  equipos?: Equipo
  operadores?: Operador | null
}

export type Registro = {
  id: string
  ticket_id: string
  horometro_id: string
  temporada_id: string | null
  fecha: string
  labor_id: string
  tarea_id: string
  implemento_id: string | null
  comentarios: string | null
  usuario_id: string
  labores?: Labor
  tareas_sap?: TareaSap
  implementos?: Implemento | null
}

export type RegistroDetalle = {
  id: string
  registro_id: string
  lote_temporada_id: string
  avance_mz: number | null
  comentarios: string | null
  fecha: string
  lotes_temporada?: LoteTemporada
}

export type AvancePorCategoria = {
  lote_id: string
  nomenclatura: string
  area_neta: number
  labor_id: string
  labor_nombre: string
  mz_trabajadas: number
  mz_pendientes: number
  labor_completada: boolean
}

export type ResumenAvancePorLote = {
  lote_id: string
  nomenclatura: string
  area_neta: number
  labores_totales: number
  labores_completas: number
  pct_avance: number
}
