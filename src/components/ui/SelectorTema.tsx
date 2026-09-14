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
import { IconMoon, IconSun } from './Icons'
import { CLAVE_TEMA, esTema, temaEfectivo, type Tema } from '@/lib/tema/tema'

/** Lo que el navegador tiene puesto AHORA, según el DOM y el almacén. */
function temaGuardado(): Tema {
  if (typeof window === 'undefined') return 'sistema'
  try {
    const v = localStorage.getItem(CLAVE_TEMA)
    if (esTema(v)) return v
  } catch {
    // Modo incógnito o almacenamiento bloqueado: se sigue con el del
    // sistema, que es mejor que no dejar cambiar el tema.
  }
  return 'sistema'
}

function aplicar(tema: Tema) {
  const oscuro =
    temaEfectivo(tema, window.matchMedia('(prefers-color-scheme: dark)').matches) === 'oscuro'
  const raiz = document.documentElement
  raiz.dataset.tema = oscuro ? 'oscuro' : 'claro'
  raiz.style.colorScheme = oscuro ? 'dark' : 'light'
  try {
    localStorage.setItem(CLAVE_TEMA, tema)
  } catch {
    // Si no se puede recordar, al menos se aplica en esta sesión.
  }
}

export function SelectorTema({ compacto = false }: { compacto?: boolean }) {
  // El estado arranca en 'sistema' tanto en el servidor como en la
  // primera pintura del navegador —así la hidratación calza— y se
  // corrige al primer toque. Lo que se VE ya lo puso el guion del head.
  const [tema, setTema] = useState<Tema>('sistema')
  const [montado, setMontado] = useState(false)

  // Sin efectos: el valor real se lee en el primer gesto del usuario, y
  // hasta entonces el icono muestra el del sistema, que es lo que el
  // guion del head aplicó.
  if (!montado && typeof window !== 'undefined') {
    // Se hace en el render pero SIN tocar el DOM: sólo se sincroniza el
    // estado con lo ya guardado, que es el patrón que React 19 permite
    // para ajustar estado durante el render.
    const guardado = temaGuardado()
    setMontado(true)
    if (guardado !== tema) setTema(guardado)
  }

  const oscuroAhora =
    typeof window !== 'undefined'
      ? temaEfectivo(tema, window.matchMedia('(prefers-color-scheme: dark)').matches) === 'oscuro'
      : false

  function alternar() {
    // Dos estados y no tres: el desplegable con «Automático» estorba en
    // un botón de barra. Se guarda el tema explícito contrario al que se
    // está viendo, que es lo que el usuario quiere decir al pulsarlo.
    const siguiente: Tema = oscuroAhora ? 'claro' : 'oscuro'
    setTema(siguiente)
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
