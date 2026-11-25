/**
 * Fichas del menú «Campo»: cada una apunta a una ruta que ya existe y se muestra por el permiso propio de su
 * pantalla (el menú nunca da permisos). Puro: ni React ni red.
 */

export type FichaCampo = { codigo: string; nombre: string; descripcion: string; ruta: string; icono: string; proximamente?: boolean }

/** `tambien`: otras acciones de la misma pantalla que bastan para abrir la ficha (p. ej. «Vista general» de solo lectura). */
type FichaConPantalla = FichaCampo & { pantalla: string; tambien?: string[] }

/** En orden de aparición (por frecuencia de uso). */
const FICHAS: FichaConPantalla[] = [
  {
    codigo: 'fertirriego',
    pantalla: 'fertirriego',
    nombre: 'Fertirriego',
    descripcion: 'Bodega de la estación: recibir, aplicar, contar, relevos y traslados.',
    ruta: '/fertirriego',
    icono: 'gota',
  },
  {
    codigo: 'inyeccion',
    pantalla: 'inyeccion',
    nombre: 'Inyección',
    descripcion: 'Inyección, drench y aseguramiento de calidad por lote.',
    ruta: '/inyeccion',
    icono: 'gota',
  },
  {
    codigo: 'motores',
    pantalla: 'motores',
    nombre: 'Motores y combustible',
    descripcion: 'Horas, diésel y mantenimiento de los motores de riego.',
    ruta: '/motores',
    icono: 'tractor',
    tambien: ['ver_general', 'auditar'],
  },
  {
    codigo: 'agrometricas',
    pantalla: 'agrometricas',
    nombre: 'Parámetros de riego',
    descripcion: 'Tensiómetros, agua, suelo, clima e índice de crecimiento por turno; ahí mismo ves los registros de la temporada.',
    ruta: '/agrometricas/parametros',
    icono: 'gota',
  },
  {
    codigo: 'analisis_savia',
    pantalla: 'agrometricas',
    nombre: 'Análisis de extractor y savia',
    descripcion: 'Ca, K, Na, NO3, pH, CE y P. Próximamente.',
    ruta: '',
    icono: 'gauge',
    proximamente: true,
  },
]

/** Las fichas que la persona puede abrir: `ve(pantalla, 'ver')` verdadero. */
export function fichasCampo(ve: (pantalla: string, accion: string) => boolean): FichaCampo[] {
  return FICHAS.filter((f) => ve(f.pantalla, 'ver') || (f.tambien ?? []).some((a) => ve(f.pantalla, a))).map(({ pantalla: _p, tambien: _t, ...ficha }) => ficha)
}
