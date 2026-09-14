/**
 * El tema: claro, oscuro, o el del sistema.
 *
 * Funciones puras y una constante con el guion de arranque. Nada de React
 * y nada de DOM salvo lo estrictamente necesario para pintar, porque de
 * esto depende que la pantalla no parpadee en blanco al cargar.
 */

export const TEMAS = [
  { valor: 'claro', etiqueta: 'Claro' },
  { valor: 'oscuro', etiqueta: 'Oscuro' },
  { valor: 'sistema', etiqueta: 'Automático' },
] as const

export type Tema = (typeof TEMAS)[number]['valor']

/**
 * Dónde se recuerda la preferencia.
 *
 * Se guarda en DOS sitios y no es redundancia:
 *
 *   · `localStorage` lo lee el guion del `<head>` antes de pintar, que es
 *     lo que evita el fogonazo blanco.
 *   · La COOKIE viaja con la petición, así que el servidor puede pintar
 *     el `<html>` ya con el tema puesto. Eso es lo que hace que el tema
 *     sobreviva a recargar la página aunque el guion no llegue a correr
 *     —una política de contenido estricta, un navegador con JavaScript
 *     lento— y lo que arregla el «se reinicia al actualizar».
 */
export const CLAVE_TEMA = 'agro-tema'

/** Un año: la preferencia de tema no caduca sola. */
export const COOKIE_TEMA_MAX_AGE = 60 * 60 * 24 * 365

export function esTema(v: unknown): v is Tema {
  return v === 'claro' || v === 'oscuro' || v === 'sistema'
}

/**
 * Qué se pinta de verdad. «Automático» sigue al sistema operativo, que es
 * lo que la gente espera del modo oscuro del teléfono.
 */
export function temaEfectivo(tema: Tema, prefiereOscuro: boolean): 'claro' | 'oscuro' {
  if (tema === 'sistema') return prefiereOscuro ? 'oscuro' : 'claro'
  return tema
}

/**
 * El guion que corre ANTES de pintar nada.
 *
 * Va en el `<head>` como script en línea y no en un componente de React:
 * si esperara a que React monte, la primera pintura saldría en claro y el
 * usuario vería un fogonazo blanco antes del oscuro. A las cinco de la
 * mañana en el campo eso es deslumbrar a alguien.
 *
 * Se escribe compacto y sin dependencias porque se inyecta como texto.
 */
export const GUION_TEMA = `(function(){try{
var t=localStorage.getItem('${CLAVE_TEMA}')||'sistema';
var o=t==='oscuro'||(t==='sistema'&&matchMedia('(prefers-color-scheme: dark)').matches);
var e=document.documentElement;
e.dataset.tema=o?'oscuro':'claro';
e.style.colorScheme=o?'dark':'light';
}catch(_){}})()`

/**
 * Lee el tema de la cabecera `Cookie`. Para el servidor, que no tiene
 * `localStorage` pero sí la cookie que el navegador le manda.
 */
export function temaDeCookies(valor: string | null | undefined): Tema | null {
  if (!valor) return null
  return esTema(valor) ? valor : null
}
