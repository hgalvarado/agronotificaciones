'use client'

/**
 * El vigilante de bucles.
 *
 * ── Para qué es ─────────────────────────────────────────────────────
 *
 * Cuando la pantalla «se guinda», lo que de verdad hace falta saber es
 * QUÉ se está repitiendo. Pero para cuando el navegador se cuelga ya no
 * hay forma de preguntárselo: la pestaña no responde, las herramientas
 * de desarrollo tampoco, y lo único que queda es recargar y seguir sin
 * saber.
 *
 * Esto se adelanta. Cuenta dos cosas por segundo —cuántas veces se
 * repinta el árbol y cuántas peticiones salen hacia la base— y, en
 * cuanto una se dispara, escribe en la consola qué pasó, con qué tablas
 * y a qué ritmo. Después **se apaga solo**: un vigilante que sigue
 * contando dentro de un bucle es parte del bucle.
 *
 * ── Cómo se usa ─────────────────────────────────────────────────────
 *
 * Se arma con `?diagnostico=1` en la dirección:
 *
 *     https://…/controles/desinfeccion?diagnostico=1
 *
 * Se abre la consola del navegador (F12 → Console), se reproduce el
 * congelamiento y se mira el aviso que empieza por «BUCLE DETECTADO».
 *
 * Sin ese parámetro no se monta nada y no cuesta nada: ni un contador,
 * ni un envoltorio, ni una llamada interceptada. Por eso puede vivir en
 * el árbol de producción sin pesar.
 *
 * ── Por qué cuenta las dos cosas ────────────────────────────────────
 *
 * Un bucle de render se ve en los repintados; uno de datos —un efecto
 * que pide, guarda lo que recibe y vuelve a pedir— se ve en las
 * peticiones y casi no mueve el render. Contar sólo una de las dos deja
 * fuera la mitad de los casos, y son justo los que no se reproducen a la
 * primera.
 */

import { Profiler, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'

/** La ventana de observación. */
const VENTANA_MS = 1000
/** Repintados por segundo a partir de los cuales esto no es trabajo normal. */
const TOPE_RENDERS = 60
/** Peticiones por segundo que ninguna pantalla honrada necesita. */
const TOPE_PETICIONES = 25

export function Vigilante({ children }: { children: ReactNode }) {
  const params = useSearchParams()
  const armado = params.get('diagnostico') === '1'

  if (!armado) return <>{children}</>
  return <VigilanteArmado>{children}</VigilanteArmado>
}

function VigilanteArmado({ children }: { children: ReactNode }) {
  const renders = useRef(0)
  const peticiones = useRef<string[]>([])
  const [apagado, setApagado] = useState(false)

  useEffect(() => {
    // Se envuelve `fetch` porque es por donde sale todo lo de Supabase.
    // El original se guarda y se restituye al desmontar: dejar un
    // `fetch` ajeno puesto es peor que el problema que se investiga.
    const original = window.fetch
    window.fetch = function (...args: Parameters<typeof fetch>) {
      const url = typeof args[0] === 'string' ? args[0] : String((args[0] as Request)?.url ?? '')
      peticiones.current.push(url)
      return original.apply(this, args)
    }

    console.info(
      '%c[vigilante] armado',
      'color:#0369a1;font-weight:bold',
      `Avisa si en ${VENTANA_MS} ms hay más de ${TOPE_RENDERS} repintados o ${TOPE_PETICIONES} peticiones.`
    )

    const id = setInterval(() => {
      const r = renders.current
      const p = peticiones.current
      renders.current = 0
      peticiones.current = []

      if (r <= TOPE_RENDERS && p.length <= TOPE_PETICIONES) return

      // Las tablas, no las direcciones enteras: lo que hace falta saber
      // es QUÉ se está pidiendo en bucle, y una URL de PostgREST lleva
      // la consulta completa detrás.
      const porTabla = new Map<string, number>()
      for (const u of p) {
        const m = /\/rest\/v1\/(?:rpc\/)?([a-z0-9_]+)/i.exec(u)
        const k = m ? m[1] : 'otro'
        porTabla.set(k, (porTabla.get(k) ?? 0) + 1)
      }
      const ranking = [...porTabla.entries()].sort((a, b) => b[1] - a[1])

      console.error(
        '%c[vigilante] BUCLE DETECTADO',
        'color:#b91c1c;font-weight:bold;font-size:14px',
        `\n  repintados en ${VENTANA_MS} ms: ${r}` +
          `\n  peticiones en ${VENTANA_MS} ms: ${p.length}` +
          (ranking.length
            ? `\n  lo que más se repite: ${ranking
                .slice(0, 5)
                .map(([t, n]) => `${t} ×${n}`)
                .join(', ')}`
            : '') +
          '\n\n  Manda esta línea entera. Con el nombre de la tabla o la' +
          '\n  función se localiza el efecto que la está pidiendo.'
      )

      // Se apaga. Seguir midiendo dentro de un bucle es añadirle trabajo
      // al bucle, y el aviso ya está dado.
      setApagado(true)
    }, VENTANA_MS)

    return () => {
      clearInterval(id)
      window.fetch = original
    }
  }, [])

  if (apagado) return <>{children}</>

  return (
    <Profiler
      id="app"
      onRender={() => {
        renders.current += 1
      }}
    >
      {children}
    </Profiler>
  )
}
