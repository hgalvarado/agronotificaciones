'use client'

/**
 * «Enviar por Outlook»: el reporte como cuerpo de correo, no como adjunto.
 *
 * `mailto:` no admite HTML en el cuerpo (Outlook lo pinta como texto
 * crudo y corta a ~2.000 caracteres). Por eso el cuerpo viaja por el
 * PORTAPAPELES como `text/html` y el `mailto:` sólo abre el correo con el
 * asunto: el usuario pega con Ctrl+V y Outlook conserva tablas y colores.
 *
 * El orden importa: el portapapeles se escribe ANTES de navegar, dentro
 * del mismo clic, que es lo único que el navegador acepta como gesto.
 */

import { useState } from 'react'
import { Boton } from '@/components/ui/Primitivos'
import {
  asuntoCorreo,
  htmlCorreoTrasplante,
  textoCorreoTrasplante,
  type DatosCorreo,
} from '@/lib/trasplante/correo'

/** Copia HTML enriquecido; con navegadores sin `ClipboardItem`, por selección. */
async function copiarHtml(html: string, texto: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([texto], { type: 'text/plain' }),
      }),
    ])
    return
  }
  // Respaldo (Firefox viejo, contextos sin permiso): se pinta fuera de
  // pantalla, se selecciona y se copia; el navegador lleva el HTML tal cual.
  const caja = document.createElement('div')
  caja.contentEditable = 'true'
  caja.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0'
  caja.innerHTML = html
  document.body.appendChild(caja)
  const rango = document.createRange()
  rango.selectNodeContents(caja)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(rango)
  const ok = document.execCommand('copy')
  sel?.removeAllRanges()
  caja.remove()
  if (!ok) throw new Error('portapapeles')
}

export function BotonOutlook(datos: DatosCorreo) {
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  function avisar(ok: boolean, texto: string) {
    setAviso({ ok, texto })
    window.setTimeout(() => setAviso(null), 7000)
  }

  async function enviar() {
    setOcupado(true)
    try {
      await copiarHtml(htmlCorreoTrasplante(datos), textoCorreoTrasplante(datos))
    } catch {
      setOcupado(false)
      avisar(false, 'El navegador no dejó copiar la plantilla. Usa «Imprimir o guardar PDF» y adjúntalo.')
      return
    }
    setOcupado(false)
    avisar(true, 'Plantilla copiada. Presiona Ctrl+V en tu correo para pegar el reporte.')
    window.location.href = `mailto:?subject=${encodeURIComponent(asuntoCorreo(datos.hasta))}`
  }

  return (
    <>
      <Boton variante="secundario" onClick={enviar} disabled={ocupado}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
        Enviar por Outlook
      </Boton>

      {aviso && (
        <div
          role="status"
          className="no-imprimir fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-raised)] sm:inset-x-auto sm:right-4"
          style={{ backgroundColor: aviso.ok ? '#165C27' : '#F37021' }}
        >
          {aviso.texto}
        </div>
      )}
    </>
  )
}
