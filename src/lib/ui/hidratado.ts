'use client'

/**
 * ¿Ya terminó la hidratación?
 *
 * ── El problema que resuelve ────────────────────────────────────────
 *
 * Un componente que lee `localStorage`, `document.cookie` o `matchMedia`
 * **durante el render** devuelve una cosa en el servidor y otra en el
 * navegador. Y la primera pintura del navegador NO es un render
 * cualquiera: es la HIDRATACIÓN, donde React compara lo que produce con
 * el HTML que vino del servidor. Si no calzan, React lanza el error 418
 * —«Hydration failed»—, **tira el HTML del servidor y vuelve a pintar el
 * árbol entero en el cliente**.
 *
 * En una pantalla con una cuadrícula de miles de filas, ese re-render
 * completo es medio segundo largo de bloqueo. Se ve como que la
 * aplicación «se guinda», y en la consola sólo queda un error con número
 * y sin explicación.
 *
 * El `typeof window === 'undefined'` NO protege de esto: durante la
 * hidratación `window` ya existe, así que se toma la rama del cliente y
 * el desajuste ocurre igual. Es la trampa que parece la solución.
 *
 * ── Por qué `useSyncExternalStore` y no un `useEffect` ──────────────
 *
 * Porque React llama a `getServerSnapshot` **en el servidor y también
 * durante la hidratación**, y sólo después pasa a `getSnapshot`. Eso es
 * exactamente lo que hace falta, sin un `setState` en un efecto —que
 * además es error de lint en React 19— y sin un cuadro de parpadeo
 * extra.
 */

import { useSyncExternalStore } from 'react'

/** Nadie avisa de nada: el valor cambia una sola vez, al hidratar. */
const sinSuscripcion = () => () => {}
const enCliente = () => true
const enServidor = () => false

export function useHidratado(): boolean {
  return useSyncExternalStore(sinSuscripcion, enCliente, enServidor)
}
