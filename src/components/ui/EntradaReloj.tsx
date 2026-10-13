'use client'

/**
 * Una hora que se teclea, no que se elige de una rueda.
 *
 * ── Por qué no `<input type="time">` ────────────────────────────────
 *
 * En el teléfono, el `type="time"` nativo abre una rueda a pantalla
 * completa que tapa el formulario, pide dos gestos por cifra y —en
 * Android— obliga a pasar por AM/PM aunque el turno se anote en reloj de
 * 24 horas. Capturar un turno son SEIS horas distintas: preriego,
 * presurización, inyección y lavado, con su inicio y su fin. Seis ruedas
 * es medio minuto de gestos para algo que se teclea en diez segundos.
 *
 * Y la captura se hace **con una mano**, de pie en el lote, a veces con
 * guantes. Un campo de texto numérico con máscara se llena con el
 * teclado numérico y sin soltar el teléfono.
 *
 * ── Cómo se usa ─────────────────────────────────────────────────────
 *
 * Se teclean cuatro cifras seguidas y salen puestas:
 *
 *     0 8 3 0   →   08:30
 *     2 3       →   23:__   (y sigue esperando los minutos)
 *     7 4 5     →   07:45   (una sola cifra de hora se completa sola)
 *
 * Los dos puntos los pone el componente: no se teclean y no se pueden
 * borrar por separado. Borrar quita cifras de derecha a izquierda, que
 * es lo que hace la tecla de borrar en cualquier otro sitio.
 *
 * El valor que sale hacia fuera es siempre `HH:MM` o cadena vacía —lo
 * mismo que daba el `type="time"`—, así que las pantallas que ya
 * guardaban una hora no cambian ni una línea.
 */

import { useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react'

const baseCampo =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-900 ' +
  'shadow-[var(--shadow-card)] transition-colors placeholder:text-slate-300 ' +
  'focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10 ' +
  'disabled:bg-slate-50 disabled:text-slate-400'

/** Las cifras de un texto, como mucho cuatro. */
function cifras(texto: string): string {
  return texto.replace(/\D/g, '').slice(0, 4)
}

/**
 * Las cifras tecleadas, con los dos puntos puestos.
 *
 * Mientras se escribe NO se valida nada: quien va a teclear «0830» pasa
 * por «08:3», y rechazar los pasos intermedios es impedir que llegue al
 * final. La hora se comprueba al salir del campo.
 */
export function conDosPuntos(d: string): string {
  if (d.length <= 2) return d
  return `${d.slice(0, 2)}:${d.slice(2)}`
}

/**
 * Lo tecleado a una hora de verdad, o vacío si no llega a serlo.
 *
 * **Tres cifras son una hora de una cifra**: «745» es las 07:45, que es
 * como se dice y como se apunta en una libreta. Obligar a teclear el
 * cero de delante es obligar a acordarse de una regla que el papel no
 * tiene.
 */
export function aHora(d: string): string {
  if (d.length === 0) return ''

  let hh: string
  let mm: string
  if (d.length <= 2) {
    // Sólo la hora: los minutos son en punto. «8» son las 08:00.
    hh = d.padStart(2, '0')
    mm = '00'
  } else if (d.length === 3) {
    hh = `0${d[0]}`
    mm = d.slice(1)
  } else {
    hh = d.slice(0, 2)
    mm = d.slice(2)
  }

  const h = Number(hh)
  const m = Number(mm)
  // Fuera de rango se descarta ENTERO y no se recorta a 23:59: un 25:00
  // es un error de tecleo, y «corregirlo» a 23:59 guardaría una hora que
  // nadie escribió y que nadie va a revisar.
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return ''
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function EntradaReloj({
  value,
  onChange,
  disabled,
  className = '',
  id,
  'aria-label': ariaLabel,
}: {
  /** `HH:MM` o vacío. Es el mismo contrato que tenía `type="time"`. */
  value: string
  onChange: (hora: string) => void
  disabled?: boolean
  className?: string
  id?: string
  'aria-label'?: string
}) {
  /**
   * Lo que se está tecleando, mientras se teclea.
   *
   * Existe aparte del valor de fuera porque «08:3» no es una hora y no
   * se puede mandar hacia arriba, pero sí hay que dejarlo escrito: sin
   * este borrador, la tercera cifra desaparecería según se teclea.
   */
  const [borrador, setBorrador] = useState<string | null>(null)

  const mostrado = borrador ?? (value ? conDosPuntos(cifras(value)) : '')

  function escribir(e: ChangeEvent<HTMLInputElement>) {
    const d = cifras(e.target.value)
    setBorrador(conDosPuntos(d))
    // Hacia fuera sólo va lo que YA es una hora. Las cuatro cifras
    // completas se mandan en el acto para que los totales calculados
    // —las horas de riego, el DDT— se muevan sin esperar al tabulador.
    if (d.length === 4) {
      const hora = aHora(d)
      if (hora) onChange(hora)
    } else if (d.length === 0) {
      onChange('')
    }
  }

  function salir(e: FocusEvent<HTMLInputElement>) {
    const hora = aHora(cifras(e.target.value))
    setBorrador(null)
    if (hora !== value) onChange(hora)
  }

  function teclear(e: KeyboardEvent<HTMLInputElement>) {
    // Enter confirma sin salir del campo: en el teléfono es la tecla que
    // queda debajo del pulgar y la que todo el mundo pulsa al terminar.
    if (e.key === 'Enter') {
      const hora = aHora(cifras((e.target as HTMLInputElement).value))
      setBorrador(null)
      if (hora !== value) onChange(hora)
    }
  }

  return (
    <input
      id={id}
      aria-label={ariaLabel}
      // `text` y no `number`: con `number` el navegador ofrece flechas de
      // subir y bajar que aquí no significan nada, y en iOS se come los
      // ceros de delante.
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="--:--"
      maxLength={5}
      value={mostrado}
      disabled={disabled}
      onChange={escribir}
      onBlur={salir}
      onKeyDown={teclear}
      className={`${baseCampo} tabular-nums ${className}`}
    />
  )
}
