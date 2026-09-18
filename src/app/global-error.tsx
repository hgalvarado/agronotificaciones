'use client'

/**
 * La última red de seguridad.
 *
 * Si algo revienta fuera de toda pantalla —o dentro del propio layout—,
 * Next enseña esto en lugar de una página en blanco. Una página en blanco
 * en el celular de un digitador a las cinco de la mañana es indistinguible
 * de «se cayó el sistema», y acaba en una llamada.
 *
 * Reemplaza el documento completo, así que lleva sus propias etiquetas
 * `html` y `body`, y va con estilos en línea: si lo que falló fue la hoja
 * de estilos, las clases no servirían de nada.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: '420px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px' }}>
            Algo se rompió en la aplicación
          </h1>
          <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#64748b', margin: '0 0 20px' }}>
            No se perdió nada de lo que ya habías guardado. Vuelve a intentarlo; si sigue pasando,
            avisa con el código de abajo a quien administra el sistema.
          </p>
          <button
            onClick={reset}
            style={{
              height: '44px',
              padding: '0 20px',
              borderRadius: '12px',
              border: 'none',
              background: '#15803d',
              color: 'white',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
          {error.digest && (
            <p style={{ marginTop: '16px', fontSize: '11px', color: '#94a3b8' }}>
              Código: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  )
}
