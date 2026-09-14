/**
 * Notificaciones: el único sitio donde se escribe lo que el usuario lee
 * cuando algo pasa —o cuando no hay nada que mostrar—.
 *
 * Vive aparte del negocio a propósito. Las reglas dicen qué pasó; esta
 * capa decide cómo contarlo. Así un mensaje se corrige en un solo sitio y
 * no se mezcla texto para humanos dentro de las consultas.
 */

export const AVISOS = {
  sinMigracion:
    'El reporte público todavía no está instalado. Corre la migración 23 en el SQL Editor de Supabase.',
  inactivo:
    'El reporte público está desactivado. El Administrador lo habilita desde Configuración del reporte público.',
  sinDepartamentos:
    'El reporte está activo pero no tiene departamentos publicados, así que no hay nada que mostrar.',
  sinProcesos:
    'El reporte está activo pero no tiene ningún proceso marcado, así que no hay tickets que enseñar.',
  sinEstados:
    'El reporte está activo pero no tiene ningún estado de ticket marcado, así que no hay tickets que enseñar.',
  sinDatos: 'No hay actividad registrada para ese día con los filtros elegidos.',
} as const

export const MENSAJES_CONFIG = {
  guardado: 'Configuración guardada. El reporte público ya usa estas reglas.',
  errorGuardar: 'No se pudo guardar la configuración.',
  sinPermiso: 'Sólo el Administrador puede cambiar las reglas del reporte público.',
} as const

/**
 * Traduce el error crudo de la base a algo accionable. Si la función no
 * existe, el problema no es del usuario: es una migración sin correr, y
 * decirlo ahorra media hora de búsqueda.
 */
export function avisoDeError(mensaje: string | null | undefined): string {
  const texto = (mensaje ?? '').toLowerCase()
  if (texto.includes('does not exist') || texto.includes('schema cache')) {
    return AVISOS.sinMigracion
  }
  return mensaje ?? MENSAJES_CONFIG.errorGuardar
}
