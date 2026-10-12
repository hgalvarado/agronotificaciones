'use client'

/**
 * El interruptor de tema.
 *
 * Sólo escribe: pone `data-tema` en el `<html>` y guarda la preferencia.
 * Quién decide qué tema toca es `lib/tema/tema`, y la paleta entera vive
 * en `globals.css`; aquí no hay un solo color.
 *
 * Arranca leyendo lo que el guion del `<head>` ya dejó pintado, así que
 * no hay parpadeo ni desajuste entre lo que se ve y lo que dice el botón.
 */

import { useState } from 'react'
import { useHidratado } from '@/lib/ui/hidratado'
import { IconMoon, IconSun } from './Icons'
import {
  CLAVE_TEMA,
  COOKIE_TEMA_MAX_AGE,
  esTema,
  temaEfectivo,
  type Tema,
} from '@/lib/tema/tema'

/** Lo que el navegador tiene puesto AHORA, según el DOM y el almacén. */
function temaGuardado(): Tema {
  if (typeof window === 'undefined') return 'sistema'
  try {
    const v = localStorage.getItem(CLAVE_TEMA)
    if (esTema(v)) return v
  } catch {
    // Modo incógnito o almacenamiento bloqueado: se cae a la cookie, que
    // es la que de todos modos usa el servidor.
  }
  const deCookie = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${CLAVE_TEMA}=`))
    ?.slice(CLAVE_TEMA.length + 1)
  return esTema(deCookie) ? deCookie : 'sistema'
}

function aplicar(tema: Tema) {
  const oscuro =
    temaEfectivo(tema, window.matchMedia('(prefers-color-scheme: dark)').matches) === 'oscuro'
  const raiz = document.documentElement
  raiz.dataset.tema = oscuro ? 'oscuro' : 'claro'
  raiz.style.colorScheme = oscuro ? 'dark' : 'light'
  // Se escribe en los dos sitios: el almacén lo lee el guion del `<head>`
  // antes de pintar, y la cookie viaja al servidor para que la siguiente
  // recarga ya venga con el tema puesto desde el HTML.
  try {
    localStorage.setItem(CLAVE_TEMA, tema)
  } catch {
    // Si no se puede recordar ahí, la cookie de abajo basta.
  }
  document.cookie = `${CLAVE_TEMA}=${tema}; path=/; max-age=${COOKIE_TEMA_MAX_AGE}; samesite=lax`
}

export function SelectorTema({ compacto = false }: { compacto?: boolean }) {
  /*
   * ── El desajuste de hidratación que había aquí (migración 69) ──────
   *
   * El bloque de abajo leía `localStorage` y `matchMedia` DURANTE el
   * render, protegido por `typeof window !== 'undefined'`. Ese guardia
   * no protege de nada: durante la hidratación `window` ya existe, así
   * que el servidor pintaba la luna («Modo oscuro») y el navegador, con
   * el sistema en oscuro, pintaba el sol («Modo claro»).
   *
   * Dos marcados distintos en el mismo sitio es el error 418 de React, y
   * la respuesta de React al 418 **no es un aviso**: tira el HTML del
   * servidor y vuelve a pintar el árbol ENTERO en el cliente. Este botón
   * vive en el armazón, así que el árbol entero es la aplicación entera.
   *
   * `useHidratado` corre `false` en el servidor y también en la primera
   * pintura del navegador, así que los dos marcados calzan; el valor de
   * verdad entra después, ya con la página viva.
   *
   * El icono no parpadea porque lo que se VE —el fondo, los colores— ya
   * lo puso el guion del `<head>` antes de pintar nada. Lo único que se
   * ajusta un cuadro después es qué dibujo lleva el botón.
   */
  const hidratado = useHidratado()
  const [elegido, setElegido] = useState<Tema | null>(null)
  const tema: Tema = elegido ?? (hidratado ? temaGuardado() : 'sistema')

  const oscuroAhora =
    hidratado &&
    temaEfectivo(tema, window.matchMedia('(prefers-color-scheme: dark)').matches) === 'oscuro'

  function alternar() {
    // Dos estados y no tres: el desplegable con «Automático» estorba en
    // un botón de barra. Se guarda el tema explícito contrario al que se
    // está viendo, que es lo que el usuario quiere decir al pulsarlo.
    const siguiente: Tema = oscuroAhora ? 'claro' : 'oscuro'
    setElegido(siguiente)
    aplicar(siguiente)
  }

  const etiqueta = oscuroAhora ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={etiqueta}
      title={etiqueta}
      className={
        compacto
          ? 'rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:bg-slate-100'
          : 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900'
      }
    >
      {oscuroAhora ? <IconSun className="h-5 w-5" /> : <IconMoon className="h-5 w-5" />}
      {!compacto && <span>{oscuroAhora ? 'Modo claro' : 'Modo oscuro'}</span>}
    </button>
  )
}
