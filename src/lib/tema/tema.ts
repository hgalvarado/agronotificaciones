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

/** Dónde se recuerda la preferencia. Sólo en este navegador. */
export const CLAVE_TEMA = 'agro-tema'

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
