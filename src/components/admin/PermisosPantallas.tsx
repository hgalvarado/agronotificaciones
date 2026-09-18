'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Entrada, Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { IconCheck, IconLock } from '@/components/ui/Icons'
import { mensajeDeError } from '@/lib/errores'

export type Pantalla = {
  codigo: string
  nombre: string
  descripcion: string | null
  ruta: string | null
  acciones: string[]
}

export type RolFila = {
  id: number
  codigo: string
  nombre: string
  /** Rol de fábrica: la aplicación lo nombra por código y no se elimina. */
  de_sistema?: boolean | null
}
export type PermisoFila = { rol_id: number; recurso: string; accion: string }

/**
 * Una acción del catálogo de la base.
 *
 * Las columnas de la matriz salen de aquí y NO de una lista escrita en
 * el navegador. Con la lista escrita a mano pasó justo lo que no podía
 * pasar: la base exigía `horometros:crear`, el navegador sólo dibujaba
 * cinco columnas, y esa casilla no existía en ninguna parte. El
 * Administrador se quedaba sin poder concederla y el Digitador sin poder
 * capturar.
 */
export type AccionCatalogo = {
  codigo: string
  nombre: string
  descripcion: string | null
  orden: number
}

/** Una llave que la base exige y la matriz no ofrece. Tiene que venir vacía. */
export type LlaveSinCasilla = { pantalla: string; accion: string; motivo: string }

/**
 * Cómo se lee un código de acción que el catálogo todavía no conoce.
 *
 * No debería pasar —la migración siembra el catálogo y el guardián avisa
 * si falta algo— pero si pasa, vale más una columna con el código crudo
 * que una restricción invisible. Eso era el problema de origen.
 */
function comoSeLee(codigo: string): string {
  const texto = codigo.replace(/_/g, ' ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export function PermisosPantallas({
  roles,
  pantallas,
  permisos,
  acciones,
  sinCasilla = [],
}: {
  roles: RolFila[]
  pantallas: Pantalla[]
  permisos: PermisoFila[]
  /** El catálogo de la base. Es lo que decide las columnas. */
  acciones: AccionCatalogo[]
  /** Lo que la base exige sin casilla. Se enseña como aviso, no se esconde. */
  sinCasilla?: LlaveSinCasilla[]
}) {
  const supabase = createClient()
  const router = useRouter()
  const [rolActivo, setRolActivo] = useState(
    roles.find((r) => r.codigo !== 'ADMIN')?.id ?? roles[0]?.id ?? 0
  )
  const [guardando, setGuardando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [ocupado, setOcupado] = useState(false)

  // El Administrador no se lista: su acceso total no sale de esta tabla
  // sino de `fn_es_admin()`, y dejarlo editable haría creer que se le
  // puede quitar algo.
  const editables = roles.filter((r) => r.codigo !== 'ADMIN')
  const rol = editables.find((r) => r.id === rolActivo) ?? editables[0]

  // Las columnas son TODAS las acciones que alguna pantalla declara. Si
  // una pantalla trae una acción que el catálogo no conoce, se dibuja
  // igual con su código: una llave sin casilla es peor que una columna
  // fea.
  const columnas = useMemo<AccionCatalogo[]>(() => {
    const porCodigo = new Map(acciones.map((a) => [a.codigo, a]))
    for (const p of pantallas) {
      for (const codigo of p.acciones) {
        if (!porCodigo.has(codigo)) {
          porCodigo.set(codigo, {
            codigo,
            nombre: comoSeLee(codigo),
            descripcion: 'Esta acción todavía no está en el catálogo de la base.',
            orden: 999,
          })
        }
      }
    }
    return [...porCodigo.values()].sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo))
  }, [acciones, pantallas])

  function tiene(recurso: string, accion: string) {
    return permisos.some(
      (p) => p.rol_id === rol?.id && p.recurso === recurso && p.accion === accion
    )
  }

  async function alternar(recurso: string, accion: string) {
    if (!rol) return
    const activo = tiene(recurso, accion)
    const llave = `${recurso}:${accion}`
    setGuardando(llave)
    setError(null)

    if (activo) {
      const { error: e } = await supabase
        .from('permisos')
        .delete()
        .match({ rol_id: rol.id, recurso, accion })
      if (e) setError(e.message)

      // Quitar «Ver» deja al rol con permisos que no puede alcanzar,
      // porque la pantalla desaparece del menú. Se limpian con él.
      if (!e && accion === 'ver') {
        await supabase.from('permisos').delete().match({ rol_id: rol.id, recurso })
      }
    } else {
      const filas = [{ rol_id: rol.id, recurso, accion }]
      // Al revés: dar cualquier acción implica poder entrar a la pantalla.
      if (accion !== 'ver' && !tiene(recurso, 'ver')) {
        filas.push({ rol_id: rol.id, recurso, accion: 'ver' })
      }
      const { error: e } = await supabase.from('permisos').insert(filas)
      if (e) setError(e.message)
    }

    setGuardando(null)
    router.refresh()
  }

  const cuenta = pantallas.filter((p) => tiene(p.codigo, 'ver')).length

  /* --------------------------- Roles: alta y baja -------------------- */

  async function crearRol() {
    if (!nombreNuevo.trim()) return setError('Escribe el nombre del rol.')
    setOcupado(true)
    setError(null)
    const { error: e } = await supabase.rpc('fn_crear_rol', {
      p_nombre: nombreNuevo.trim(),
      p_codigo: null,
      p_descripcion: null,
    })
    setOcupado(false)
    if (e) {
      return setError(
        mensajeDeError(e, 'No se pudo crear. Si dice que no existe «fn_crear_rol», falta la migración 41.')
      )
    }
    setNombreNuevo('')
    setCreando(false)
    router.refresh()
  }

  async function eliminarRol(r: RolFila) {
    // La base vuelve a comprobarlo todo; esto sólo evita el viaje y el
    // susto de ver desaparecer un rol de la lista sin querer.
    if (!window.confirm(`¿Eliminar el rol «${r.nombre}»? Se van también sus permisos.`)) return

    setOcupado(true)
    setError(null)
    const { error: e } = await supabase.rpc('fn_eliminar_rol', { p_rol_id: r.id })
    setOcupado(false)
    if (e) return setError(mensajeDeError(e, 'No se pudo eliminar el rol.'))
    setRolActivo(editables.find((x) => x.id !== r.id)?.id ?? 0)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------- Selector de rol ------------------------ */}
      <div className="flex flex-wrap items-center gap-1.5">
        {editables.map((r) => (
          <button
            key={r.id}
            onClick={() => setRolActivo(r.id)}
            className={`rounded-full px-3.5 py-2 text-sm font-semibold transition-all ${
              r.id === rol?.id
                ? 'bg-brand-700 text-white shadow-[var(--shadow-raised)]'
                : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:text-slate-900'
            }`}
          >
            {r.nombre}
          </button>
        ))}

        {creando ? (
          <span className="flex items-center gap-1.5">
            <Entrada
              value={nombreNuevo}
              onChange={(e) => setNombreNuevo(e.target.value)}
              placeholder="Nombre del rol"
              className="h-10 w-48 py-2"
              autoFocus
            />
            <Boton tamano="sm" onClick={() => void crearRol()} disabled={ocupado}>
              Guardar
            </Boton>
            <Boton
              variante="secundario"
              tamano="sm"
              onClick={() => {
                setCreando(false)
                setNombreNuevo('')
              }}
            >
              Cancelar
            </Boton>
          </span>
        ) : (
          <button
            onClick={() => setCreando(true)}
            className="rounded-full bg-white px-3.5 py-2 text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 transition-colors hover:ring-brand-400"
          >
            + Rol nuevo
          </button>
        )}
      </div>

      <Tarjeta className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-bold text-slate-900">{rol?.nombre}</p>
          <p className="text-xs text-slate-400">
            Ve {cuenta} de {pantallas.length} pantallas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Insignia tono="gris">{rol?.codigo}</Insignia>
          {/* Los de fábrica no se eliminan: la aplicación los nombra por
              código en policies y funciones, y borrar ADMIN deja la
              instalación sin administrador. */}
          {rol && !rol.de_sistema && (
            <Boton
              variante="secundario"
              tamano="sm"
              disabled={ocupado}
              onClick={() => void eliminarRol(rol)}
            >
              Eliminar
            </Boton>
          )}
        </div>
      </Tarjeta>

      {error && <Alerta>{error}</Alerta>}

      {/* El guardián. Si la base exige una llave que la matriz no ofrece,
          se dice AQUÍ en vez de que alguien lo descubra por un error de
          permisos en mitad de la captura. Debería venir siempre vacío. */}
      {sinCasilla.length > 0 && (
        <Alerta tono="ambar">
          <p className="font-semibold">
            Hay {sinCasilla.length} {sinCasilla.length === 1 ? 'restricción' : 'restricciones'} en la
            base sin casilla en esta pantalla:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {sinCasilla.map((l) => (
              <li key={`${l.pantalla}:${l.accion}`}>
                <code className="font-mono">
                  {l.pantalla}:{l.accion}
                </code>{' '}
                — {l.motivo}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            Mientras estén así, nadie puede encenderlas ni apagarlas desde aquí. Hay que agregarlas
            a <code className="font-mono">pantallas.acciones</code> en el SQL Editor.
          </p>
        </Alerta>
      )}

      {/* ----------------------------- Matriz ----------------------------- */}

      {/* Celular: una tarjeta por pantalla con sus acciones como fichas.
          Una matriz de seis columnas no cabe en un teléfono, y él dijo que
          casi todos van a usar la plataforma desde ahí. */}
      <div className="flex flex-col gap-2 sm:hidden">
        {pantallas.map((p) => {
          const puedeVer = tiene(p.codigo, 'ver')
          return (
            <div
              key={p.codigo}
              className={`rounded-2xl border p-3 shadow-[var(--shadow-card)] ${
                puedeVer ? 'border-brand-200 bg-white' : 'border-slate-200 bg-slate-50/60'
              }`}
            >
              <p
                className={`text-sm font-bold ${puedeVer ? 'text-slate-900' : 'text-slate-400'}`}
              >
                {p.nombre}
              </p>
              {p.descripcion && <p className="text-xs text-slate-400">{p.descripcion}</p>}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {columnas
                  .filter((a) => p.acciones.includes(a.codigo))
                  .map((a) => {
                    const activo = tiene(p.codigo, a.codigo)
                    const llave = `${p.codigo}:${a.codigo}`
                    return (
                      <button
                        key={a.codigo}
                        onClick={() => alternar(p.codigo, a.codigo)}
                        disabled={guardando === llave}
                        title={a.descripcion ?? undefined}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold transition-all disabled:opacity-40 ${
                          activo
                            ? 'bg-brand-700 text-white'
                            : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200'
                        }`}
                      >
                        {activo && <IconCheck className="h-3 w-3" />}
                        {a.nombre}
                      </button>
                    )
                  })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Escritorio: la matriz completa */}
      <div className="hidden sm:block">
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[var(--shadow-card)]">
          <div className="scroll-suave overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-left">
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Pantalla
                  </th>
                  {columnas.map((a) => (
                    <th
                      key={a.codigo}
                      title={a.descripcion ?? undefined}
                      className="w-24 px-2 py-2.5 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500"
                    >
                      {a.nombre}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pantallas.map((p) => {
                  const puedeVer = tiene(p.codigo, 'ver')
                  return (
                    <tr
                      key={p.codigo}
                      className={`border-b border-slate-50 last:border-0 ${
                        puedeVer ? '' : 'bg-slate-50/40'
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <p
                          className={`font-semibold ${
                            puedeVer ? 'text-slate-800' : 'text-slate-400'
                          }`}
                        >
                          {p.nombre}
                        </p>
                        {p.descripcion && (
                          <p className="text-xs text-slate-400">{p.descripcion}</p>
                        )}
                      </td>
  
                      {columnas.map((a) => {
                        const accion = a.codigo
                        const aplica = p.acciones.includes(accion)
                        const activo = tiene(p.codigo, accion)
                        const llave = `${p.codigo}:${accion}`
                        return (
                          <td key={accion} className="px-2 py-2.5 text-center">
                            {!aplica ? (
                              <span
                                className="text-slate-200"
                                title="Esta acción no aplica en esta pantalla"
                              >
                                —
                              </span>
                            ) : (
                              <button
                                onClick={() => alternar(p.codigo, accion)}
                                disabled={guardando === llave}
                                aria-label={`${a.nombre} en ${p.nombre}`}
                                className={`mx-auto flex h-6 w-6 items-center justify-center rounded-md border transition-all disabled:opacity-40 ${
                                  activo
                                    ? 'border-brand-700 bg-brand-700 text-white'
                                    : 'border-slate-300 bg-white hover:border-brand-400'
                                }`}
                              >
                                {activo && <IconCheck className="h-3.5 w-3.5" />}
                              </button>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-3 text-xs text-slate-500 ring-1 ring-inset ring-slate-200/70">
        <IconLock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div className="space-y-1">
          <p>
            El cambio aplica de inmediato: la próxima vez que el usuario cargue una pantalla, el
            menú y los botones ya salen según esto.
          </p>
          <p>
            No es sólo cosmético. Las mismas reglas están en la base de datos, así que aunque
            alguien intente entrar escribiendo la dirección a mano, Postgres le niega los datos.
          </p>
          <p>
            El <strong>Administrador</strong> no aparece en la lista porque siempre tiene acceso
            total. Un rol <strong>sin «Ver todo»</strong> ve únicamente lo que capturó él, aunque le
            des «Ver» en la pantalla: eso es una regla de fila, no de pantalla.
          </p>
          <p>
            Las columnas salen del catálogo de la base, no del navegador: cuando se agregue un
            módulo o una acción nueva, la casilla aparece sola aquí. Toda restricción que la base
            aplique tiene su casilla; si alguna se quedara sin ella, arriba sale el aviso.
          </p>
        </div>
      </div>
    </div>
  )
}
