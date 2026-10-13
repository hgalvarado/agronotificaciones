import { getPerfilActual } from '@/lib/auth'
import { Logo } from '@/components/ui/Logo'
import { CREADOR, LEMA, VERSION } from '@/lib/version'

/**
 * La portada.
 *
 * ── Por qué existe (migración 71) ───────────────────────────────────
 *
 * La raíz redirigía a `/tickets` sin preguntar nada. Para quien no tiene
 * permiso sobre tickets —un capataz de riego, alguien de desinfección—
 * eso era entrar a la aplicación por una puerta que no es la suya: una
 * lista vacía, sin un aviso que lo explicara, y la sensación de que el
 * sistema está roto.
 *
 * Esta página **no consulta ningún módulo**: sólo el perfil, que el
 * armazón ya tiene cargado para poner el nombre en la barra. Así no hay
 * pantalla a la que se pueda entrar sin permiso, porque no hay nada que
 * pedir.
 *
 * Vive dentro de `(app)` y no en la raíz del proyecto para que traiga el
 * armazón: una bienvenida sin menú es una pantalla sin salida.
 */
export default async function PortadaPage() {
  const { perfil, rol } = await getPerfilActual()
  const nombre = perfil?.nombre?.trim() || ''
  // Sólo el primer nombre: «Bienvenido, Henry» se lee como un saludo y
  // el nombre completo del carné se lee como una credencial.
  const saludo = nombre ? nombre.split(/\s+/)[0] : null

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-10 text-center">
        <Logo tamano={88} className="drop-shadow-sm" />

        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {saludo ? `Bienvenido, ${saludo}` : 'Bienvenido'}
          </h1>
          <p className="text-balance text-sm text-slate-500 sm:text-base">{LEMA}</p>
        </div>

        {rol?.nombre && (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
            {rol.nombre}
          </span>
        )}

        <p className="max-w-sm text-balance text-xs leading-relaxed text-slate-400">
          Elige en el menú lo que vayas a trabajar. Sólo aparece lo que tu rol tiene permitido, así
          que si echas algo en falta, pídeselo a quien administra el sistema.
        </p>
      </div>

      {/* El pie se queda abajo sin `fixed`: en el teléfono un pie fijo le
          roba alto a la pantalla justo cuando sube el teclado. */}
      <footer className="mt-auto flex flex-col items-center gap-0.5 border-t border-slate-100 px-6 py-4 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          AgroNotificaciones v{VERSION}
        </p>
        <p className="text-[11px] text-slate-400">Creador: {CREADOR}</p>
      </footer>
    </div>
  )
}
