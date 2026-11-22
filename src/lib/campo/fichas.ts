/**
 * Fichas del menú «Campo»: cada una apunta a una ruta que ya existe y se muestra por el permiso propio de su
 * pantalla (el menú nunca da permisos). Puro: ni React ni red.
 */

export type FichaCampo = { codigo: string; nombre: string; descripcion: string; ruta: string; icono: string }

type FichaConPantalla = FichaCampo & { pantalla: string }

/** En orden de aparición. Inyección y Motores se agregan aquí después. */
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
    codigo: 'agrometricas',
    pantalla: 'agrometricas',
    nombre: 'AgroMétricas',
    descripcion: 'Parámetros de riego, índice de crecimiento y registros de la temporada.',
    ruta: '/agrometricas',
    icono: 'chart',
  },
]

/** Las fichas que la persona puede abrir: `ve(pantalla, 'ver')` verdadero. */
export function fichasCampo(ve: (pantalla: string, accion: string) => boolean): FichaCampo[] {
  return FICHAS.filter((f) => ve(f.pantalla, 'ver')).map(({ pantalla: _p, ...ficha }) => ficha)
}
