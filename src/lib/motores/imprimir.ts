/**
 * Imprime un documento HTML completo desde un iframe oculto (sin ventanas emergentes): en el diálogo se elige «Guardar como PDF»
 * y, en el teléfono, «Compartir». Solo cliente (usa el DOM).
 */
export function imprimirHtml(html: string): void {
  const marco = document.createElement('iframe')
  marco.setAttribute('aria-hidden', 'true')
  marco.setAttribute('title', 'Impresión')
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  marco.onload = () => {
    const w = marco.contentWindow
    if (!w) return
    w.focus()
    w.print()
    window.setTimeout(() => marco.remove(), 60_000)
  }
  marco.srcdoc = html
  document.body.appendChild(marco)
}
