'use client'

/**
 * La marca, en un solo sitio.
 *
 * El archivo vive en `public/marca/logo.svg` y se sirve desde `/marca/
 * logo.svg`. Aquí no se dibuja ningún logotipo: se carga el suyo.
 *
 * Si el archivo todavía no está —o el día que alguien lo renombre—, en
 * vez de un icono roto sale el recuadro «AN» de siempre. Una pantalla de
 * login con una imagen rota parece un sistema caído, y eso cuesta más
 * que no tener logo.
 */

import { useState } from 'react'

/** La ruta estándar. Cambiarla aquí la cambia en toda la aplicación. */
export const RUTA_LOGO = '/marca/logo.svg'

export function Logo({
  tamano = 36,
  className = '',
}: {
  /** Lado del cuadro, en píxeles. */
  tamano?: number
  className?: string
}) {
  const [falla, setFalla] = useState(false)

  if (falla) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-xl bg-brand-700 font-bold text-white ${className}`}
        style={{ width: tamano, height: tamano, fontSize: Math.round(tamano * 0.36) }}
        aria-hidden
      >
        AN
      </span>
    )
  }

  return (
    // `img` y no `next/image`: un SVG no tiene nada que optimizar, y así
    // el logotipo se cambia dejando caer otro archivo, sin recompilar.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={RUTA_LOGO}
      alt="Agrolíbano"
      width={tamano}
      height={tamano}
      onError={() => setFalla(true)}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: tamano, height: tamano }}
    />
  )
}
