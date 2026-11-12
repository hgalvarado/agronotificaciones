'use client'

/**
 * Permisos por rol, organizados por módulo (migración 92).
 *
 * Antes era una matriz con una columna por cada acción de TODO el sistema (22 con Fertirriego): casi todas
 * las celdas eran «—» y cada módulo nuevo la ensanchaba. Ahora:
 *   - se elige un rol y se ven tarjetas por módulo, cada una solo con SUS acciones;
 *   - niveles rápidos (Ver · Operar · Supervisar · Todo) que salen de `acciones.nivel`;
 *   - el alcance se elige una vez por pantalla, con el nombre que le da el módulo («Sus estaciones»);
 *   - se guarda al instante, sin recargar la página, y se puede deshacer;
 *   - copiar un rol y compararlo con otro.
 * La base sigue siendo la que decide (fn_guardar_permisos_rol aplica la cascada de «Ver» y valida).
 * Un módulo nuevo aparece solo: lo declara la tabla `pantallas`.
 */

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Entrada, Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { IconLock, IconSearch } from '@/components/ui/Icons'
import { mensajeDeError } from '@/lib/errores'
import {
  PERMISO_APAGADO,
  leerAlcance,
  leerCondicion,
  type Alcance,
  type ConfigPermiso,
} from '@/lib/permisos/abac'
import { TarjetaPermisosPantalla, type AccionDePantalla, type CambioCelda } from './TarjetaPermisosPantalla'
import { HistorialAccesos } from './HistorialAccesos'

export type Pantalla = {
  codigo: string
  nombre: string
  descripcion: string | null
  ruta: string | null
  acciones: string[]
  /** Migración 92: agrupa la pantalla en Permisos. */
  modulo?: string | null
  usa_condicion?: boolean | null
  etiquetas_alcance?: Partial<Record<Alcance, string>> | null
}

export type RolFila = {
  id: number
  codigo: string
  nombre: string
  /** Rol de fábrica: la aplicación lo nombra por código y no se elimina. */
  de_sistema?: boolean | null
  /** Llave maestra: pasa por encima de la matriz. Lo decide la base, no un nombre. */
  acceso_total?: boolean | null
  /** Mira y exporta, nunca escribe, marquen lo que marquen aquí. */
  solo_lectura?: boolean | null
  /** 93: lo pueden asignar quienes administran usuarios solo de sus zonas (jefes de zona). */
  delegable?: boolean | null
}

/** Una celda guardada. `permitido` falso conserva el alcance y la condición configurados. */
export type PermisoFila = {
  rol_id: number
  recurso: string
  accion: string
  permitido: boolean | null
  alcance: string | null
  condicion: string | null
}

/** Una acción del catálogo de la base: de aquí salen los nombres y los niveles. */
export type AccionCatalogo = {
  codigo: string
  nombre: string
  descripcion: string | null
  orden: number
  /** La acción modifica datos: sólo entonces la condición significa algo. */
  escribe?: boolean | null
  /** Migración 92: 1 Ver · 2 Operar · 3 Supervisar · 4 Administrar. */
  nivel?: number | null
}

/** Una llave que la base exige y la matriz no ofrece. Tiene que venir vacía. */
export type LlaveSinCasilla = { pantalla: string; accion: string; motivo: string }

type Celdas = Map<string, ConfigPermiso>
const llave = (rol: number, recurso: string, accion: string) => `${rol}|${recurso}|${accion}`

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
  acciones: AccionCatalogo[]
  sinCasilla?: LlaveSinCasilla[]
}) {
  const supabase = createClient()

  // Los roles de bandera no se configuran por casillas: su regla está por encima de la matriz.
  const [listaRoles, setListaRoles] = useState<RolFila[]>(roles)
  const editables = useMemo(() => listaRoles.filter((r) => !r.acceso_total && !r.solo_lectura), [listaRoles])
  const conBandera = useMemo(() => listaRoles.filter((r) => r.acceso_total || r.solo_lectura), [listaRoles])

  const [rolActivo, setRolActivo] = useState<number>(editables[0]?.id ?? 0)
  const rol = editables.find((r) => r.id === rolActivo) ?? editables[0]

  const [celdas, setCeldas] = useState<Celdas>(() => {
    const m: Celdas = new Map()
    for (const p of permisos) {
      m.set(llave(p.rol_id, p.recurso, p.accion), {
        permitido: p.permitido ?? true,
        alcance: leerAlcance(p.alcance),
        condicion: leerCondicion(p.condicion),
      })
    }
    return m
  })

  const [busqueda, setBusqueda] = useState('')
  const [soloConAcceso, setSoloConAcceso] = useState(false)
  const [comparar, setComparar] = useState('')
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [deshacer, setDeshacer] = useState<{ rol: number; recurso: string; antes: CambioCelda[] } | null>(null)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [modoNombre, setModoNombre] = useState<'nuevo' | 'copia' | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [verHistorial, setVerHistorial] = useState(false)

  const catalogo = useMemo(() => new Map(acciones.map((a) => [a.codigo, a])), [acciones])

  function accionesDe(p: Pantalla): AccionDePantalla[] {
    return p.acciones
      .map((codigo) => {
        const a = catalogo.get(codigo)
        return {
          codigo,
          nombre: a?.nombre ?? comoSeLee(codigo),
          descripcion: a?.descripcion ?? null,
          nivel: a?.nivel ?? null,
          escribe: a?.escribe ?? codigo !== 'ver',
          orden: a?.orden ?? 999,
        }
      })
      .sort((x, y) => x.orden - y.orden)
  }

  function configDe(rolId: number, recurso: string, accion: string): ConfigPermiso {
    return celdas.get(llave(rolId, recurso, accion)) ?? PERMISO_APAGADO
  }

  /** La misma cascada que fn_guardar_permiso, para que la pantalla muestre lo que la base dejará. */
  function conCascada(p: Pantalla, rolId: number, cambios: CambioCelda[]): CambioCelda[] {
    const final = new Map(cambios.map((c) => [c.accion, c.config]))
    const tieneVer = p.acciones.includes('ver')
    const verApagado = final.get('ver')?.permitido === false
    if (tieneVer && verApagado) {
      for (const a of p.acciones) {
        if (a !== 'ver' && (final.get(a) ?? configDe(rolId, p.codigo, a)).permitido) {
          final.set(a, { ...(final.get(a) ?? configDe(rolId, p.codigo, a)), permitido: false })
        }
      }
    } else if (tieneVer) {
      const enciende = [...final.entries()].find(([a, c]) => a !== 'ver' && c.permitido)
      const ver = final.get('ver') ?? configDe(rolId, p.codigo, 'ver')
      if (enciende && !ver.permitido) {
        final.set('ver', { permitido: true, alcance: enciende[1].alcance, condicion: 'sin_restriccion' })
      }
    }
    return [...final.entries()].map(([accion, config]) => ({ accion, config }))
  }

  async function guardar(p: Pantalla, rolId: number, cambios: CambioCelda[], esDeshacer = false) {
    const completos = conCascada(p, rolId, cambios)
    const antes = completos.map((c) => ({ accion: c.accion, config: configDe(rolId, p.codigo, c.accion) }))

    // Al instante en pantalla; si la base lo rechaza, se vuelve atrás
    const aplicar = (lista: CambioCelda[]) =>
      setCeldas((prev) => {
        const m = new Map(prev)
        for (const c of lista) m.set(llave(rolId, p.codigo, c.accion), c.config)
        return m
      })
    aplicar(completos)
    setOcupada(p.codigo)
    setEstado(null)

    let { error } = await supabase.rpc('fn_guardar_permisos_rol', {
      p_rol_id: rolId,
      p_cambios: completos.map((c) => ({
        recurso: p.codigo,
        accion: c.accion,
        permitido: c.config.permitido,
        alcance: c.config.alcance,
        condicion: c.config.condicion,
      })),
    })
    // Código publicado antes de correr la 92: se guarda celda por celda con la función de siempre.
    // Primero lo que enciende y al final un «Ver» que apaga, como hace la base.
    if (error && /fn_guardar_permisos_rol|PGRST202|schema cache/i.test(`${error.code} ${error.message}`)) {
      error = null
      const orden = [...completos].sort(
        (a, b) => Number(a.accion === 'ver' && !a.config.permitido) - Number(b.accion === 'ver' && !b.config.permitido)
      )
      for (const c of orden) {
        const r = await supabase.rpc('fn_guardar_permiso', {
          p_rol_id: rolId,
          p_recurso: p.codigo,
          p_accion: c.accion,
          p_permitido: c.config.permitido,
          p_alcance: c.config.alcance,
          p_condicion: c.config.condicion,
        })
        if (r.error) {
          error = r.error
          break
        }
      }
    }
    setOcupada(null)

    if (error) {
      aplicar(antes)
      setEstado({
        tipo: 'error',
        texto: mensajeDeError(
          error,
          'No se pudo guardar. Si dice que no existe «fn_guardar_permisos_rol», falta correr la migración 92.'
        ),
      })
      return
    }
    setEstado({ tipo: 'ok', texto: esDeshacer ? `Deshecho en ${p.nombre}.` : `Guardado: ${p.nombre}.` })
    setDeshacer(esDeshacer ? null : { rol: rolId, recurso: p.codigo, antes })
  }

  /* ----------------------------- Roles ------------------------------ */

  async function crearOCopiar() {
    if (!nombreNuevo.trim()) return setEstado({ tipo: 'error', texto: 'Escribe el nombre del rol.' })
    setTrabajando(true)
    setEstado(null)
    const { data, error } =
      modoNombre === 'copia' && rol
        ? await supabase.rpc('fn_copiar_rol', { p_origen: rol.id, p_nombre: nombreNuevo.trim() })
        : await supabase.rpc('fn_crear_rol', { p_nombre: nombreNuevo.trim(), p_codigo: null, p_descripcion: null })
    setTrabajando(false)
    if (error) return setEstado({ tipo: 'error', texto: mensajeDeError(error, 'No se pudo crear el rol.') })

    const nuevoId = Number(data)
    const { data: nuevo } = await supabase.from('roles').select('*').eq('id', nuevoId).maybeSingle()
    if (nuevo) setListaRoles((l) => [...l, nuevo as RolFila])
    if (modoNombre === 'copia' && rol) {
      // La copia trae los mismos permisos: se reflejan sin volver a pedir todo
      setCeldas((prev) => {
        const m = new Map(prev)
        for (const [k, v] of prev) {
          const [r, recurso, accion] = k.split('|')
          if (Number(r) === rol.id) m.set(llave(nuevoId, recurso, accion), v)
        }
        return m
      })
    }
    setRolActivo(nuevoId)
    setDeshacer(null)
    setNombreNuevo('')
    setModoNombre(null)
    setEstado({ tipo: 'ok', texto: `Rol «${(nuevo as RolFila | null)?.nombre ?? nombreNuevo}» creado.` })
  }

  /** 93: marcar el rol como delegable (lo pueden asignar los jefes de zona en sus zonas). */
  async function alternarDelegable(r: RolFila) {
    setTrabajando(true)
    setEstado(null)
    const valor = !r.delegable
    const { error } = await supabase.from('roles').update({ delegable: valor }).eq('id', r.id)
    setTrabajando(false)
    if (error) {
      return setEstado({
        tipo: 'error',
        texto: mensajeDeError(error, 'No se pudo cambiar. Si dice que no existe «delegable», falta la migración 93.'),
      })
    }
    setListaRoles((l) => l.map((x) => (x.id === r.id ? { ...x, delegable: valor } : x)))
    setDeshacer(null)
    setEstado({
      tipo: 'ok',
      texto: valor
        ? `«${r.nombre}» ya lo pueden asignar los jefes de zona.`
        : `«${r.nombre}» solo lo asigna quien administra todo.`,
    })
  }

  async function eliminarRol(r: RolFila) {
    if (!window.confirm(`¿Eliminar el rol «${r.nombre}»? Se van también sus permisos.`)) return
    setTrabajando(true)
    setEstado(null)
    const { error } = await supabase.rpc('fn_eliminar_rol', { p_rol_id: r.id })
    setTrabajando(false)
    if (error) return setEstado({ tipo: 'error', texto: mensajeDeError(error, 'No se pudo eliminar el rol.') })
    setListaRoles((l) => l.filter((x) => x.id !== r.id))
    setDeshacer(null)
    setRolActivo(editables.find((x) => x.id !== r.id)?.id ?? 0)
    setEstado({ tipo: 'ok', texto: `Rol «${r.nombre}» eliminado.` })
  }

  /* ------------------------ Filtro y agrupación ---------------------- */

  const otro = editables.find((r) => String(r.id) === comparar && r.id !== rol?.id) ?? null
  const q = busqueda.trim().toLowerCase()

  const modulos = useMemo(() => {
    const porModulo = new Map<string, Pantalla[]>()
    for (const p of pantallas) {
      const nombres = [p.nombre, p.modulo ?? '', ...p.acciones.map((a) => catalogo.get(a)?.nombre ?? a)]
      if (q && !nombres.some((t) => t.toLowerCase().includes(q))) continue
      if (soloConAcceso && rol && !p.acciones.some((a) => configDe(rol.id, p.codigo, a).permitido)) continue
      const m = p.modulo || 'Otros'
      porModulo.set(m, [...(porModulo.get(m) ?? []), p])
    }
    return [...porModulo.entries()]
    // configDe depende de `celdas`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pantallas, q, soloConAcceso, rol, celdas, catalogo])

  const totalVe = rol ? pantallas.filter((p) => configDe(rol.id, p.codigo, 'ver').permitido).length : 0

  function comparacionDe(p: Pantalla) {
    if (!otro || !rol) return null
    const nombre = (a: string) => catalogo.get(a)?.nombre ?? comoSeLee(a)
    const deMas = p.acciones.filter((a) => configDe(otro.id, p.codigo, a).permitido && !configDe(rol.id, p.codigo, a).permitido)
    const deMenos = p.acciones.filter((a) => !configDe(otro.id, p.codigo, a).permitido && configDe(rol.id, p.codigo, a).permitido)
    return { nombreRol: otro.nombre, deMas: deMas.map(nombre), deMenos: deMenos.map(nombre) }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------- Roles ------------------------ */}
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Roles">
        {editables.map((r) => (
          <button
            key={r.id}
            role="tab"
            aria-selected={r.id === rol?.id}
            data-rol={r.codigo}
            onClick={() => {
              setRolActivo(r.id)
              setDeshacer(null)
              if (String(r.id) === comparar) setComparar('')
            }}
            className={`rounded-full px-3.5 py-2 text-sm font-semibold transition-all ${
              r.id === rol?.id
                ? 'bg-brand-700 text-white shadow-[var(--shadow-raised)]'
                : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:text-slate-900'
            }`}
          >
            {r.nombre}
          </button>
        ))}
        <button
          onClick={() => setModoNombre(modoNombre === 'nuevo' ? null : 'nuevo')}
          data-rol-nuevo
          className="rounded-full bg-white px-3.5 py-2 text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 transition-colors hover:ring-brand-400"
        >
          + Rol nuevo
        </button>
      </div>

      {modoNombre && (
        <Tarjeta className="flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm font-semibold text-slate-700">
            {modoNombre === 'copia' ? `Copiar «${rol?.nombre}» como:` : 'Nombre del rol nuevo:'}
          </span>
          <Entrada
            value={nombreNuevo}
            onChange={(e) => setNombreNuevo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void crearOCopiar()}
            placeholder="Ej. Estacionero"
            className="h-10 w-56 py-2"
            autoFocus
            data-nombre-rol
          />
          <Boton tamano="sm" onClick={() => void crearOCopiar()} disabled={trabajando}>
            Guardar
          </Boton>
          <Boton variante="secundario" tamano="sm" onClick={() => setModoNombre(null)}>
            Cancelar
          </Boton>
        </Tarjeta>
      )}

      {rol ? (
        <Tarjeta className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-base font-bold text-slate-900">{rol.nombre}</p>
              <p className="text-xs text-slate-400">
                Ve {totalVe} de {pantallas.length} pantallas
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Insignia tono="gris">{rol.codigo}</Insignia>
              <Boton
                variante="secundario"
                tamano="sm"
                data-copiar-rol
                onClick={() => {
                  setNombreNuevo(`${rol.nombre} (copia)`)
                  setModoNombre('copia')
                }}
              >
                Copiar
              </Boton>
              {!rol.de_sistema && (
                <Boton variante="secundario" tamano="sm" disabled={trabajando} onClick={() => void eliminarRol(rol)}>
                  Eliminar
                </Boton>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(rol.delegable)}
              disabled={trabajando}
              data-delegable
              onClick={() => void alternarDelegable(rol)}
              title="Quien administra usuarios solo de sus zonas (jefe de zona) podrá dar este rol a personas de sus zonas."
              className="flex items-center gap-2 text-xs font-semibold text-slate-600 disabled:opacity-50"
            >
              <span className={`relative h-4 w-7 rounded-full transition-colors ${rol.delegable ? 'bg-brand-700' : 'bg-slate-300'}`}>
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${rol.delegable ? 'left-3.5' : 'left-0.5'}`} />
              </span>
              Lo pueden asignar los jefes de zona
            </button>
            <button
              type="button"
              aria-expanded={verHistorial}
              data-ver-historial-rol
              onClick={() => setVerHistorial((v) => !v)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-900"
            >
              {verHistorial ? '▾' : '▸'} Historial de cambios
            </button>
          </div>
          {verHistorial && <HistorialAccesos key={rol.id} rolId={rol.id} />}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar módulo, pantalla o acción…"
                data-buscar-permiso
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
              />
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={soloConAcceso}
              onClick={() => setSoloConAcceso((v) => !v)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ring-1 ring-inset ${
                soloConAcceso ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200'
              }`}
            >
              Solo lo que tiene
            </button>
            <div className="w-56" data-comparar>
              <SelectorBuscable
                valor={comparar}
                opciones={editables
                  .filter((r) => r.id !== rol.id)
                  .map((r) => ({ id: String(r.id), titulo: r.nombre }))}
                onCambiar={setComparar}
                placeholder="Comparar con otro rol…"
                etiquetaBusqueda="Buscar rol"
                permitirVacio
                textoVacio="Sin comparar"
              />
            </div>
          </div>
        </Tarjeta>
      ) : (
        <Alerta tono="ambar">No hay roles configurables. Crea uno con «+ Rol nuevo».</Alerta>
      )}

      {estado && (
        <div
          role="status"
          data-estado-permisos={estado.tipo}
          className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm ${
            estado.tipo === 'ok' ? 'bg-brand-50 text-brand-800' : 'bg-red-50 text-red-700'
          }`}
        >
          <span>{estado.texto}</span>
          {estado.tipo === 'ok' && deshacer && (
            <button
              type="button"
              data-deshacer
              className="text-xs font-bold underline"
              onClick={() => {
                const p = pantallas.find((x) => x.codigo === deshacer.recurso)
                if (p) void guardar(p, deshacer.rol, deshacer.antes, true)
              }}
            >
              Deshacer
            </button>
          )}
        </div>
      )}

      {sinCasilla.length > 0 && (
        <Alerta tono="ambar">
          <p className="font-semibold">
            Hay {sinCasilla.length} {sinCasilla.length === 1 ? 'restricción' : 'restricciones'} en la base sin casilla aquí:
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
        </Alerta>
      )}

      {/* ------------------------- Módulos ------------------------ */}
      {rol &&
        modulos.map(([modulo, lista]) => (
          <details key={modulo} open className="group flex flex-col gap-2" data-modulo={modulo}>
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl bg-slate-100/70 px-3.5 py-2">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-600">{modulo}</span>
              <span className="text-xs text-slate-400">
                {lista.filter((p) => configDe(rol.id, p.codigo, 'ver').permitido).length}/{lista.length} con acceso
              </span>
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
              {lista.map((p) => (
                <TarjetaPermisosPantalla
                  key={`${rol.id}-${p.codigo}`}
                  codigo={p.codigo}
                  nombre={p.nombre}
                  descripcion={p.descripcion}
                  acciones={accionesDe(p)}
                  configDe={(a) => configDe(rol.id, p.codigo, a)}
                  usaCondicion={Boolean(p.usa_condicion)}
                  etiquetasAlcance={p.etiquetas_alcance ?? null}
                  comparacion={comparacionDe(p)}
                  ocupada={ocupada === p.codigo}
                  onCambiar={(cambios) => void guardar(p, rol.id, cambios)}
                />
              ))}
            </div>
          </details>
        ))}

      {rol && modulos.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-400">Nada coincide con la búsqueda.</p>
      )}

      <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-3 text-xs text-slate-500 ring-1 ring-inset ring-slate-200/70">
        <IconLock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div className="space-y-1">
          <p>
            <strong>Niveles:</strong> Ver (consulta y exporta) · Operar (además registra) · Supervisar (además aprueba,
            anula, elimina o registra por otros) · Todo (además administra). «A la medida» = una combinación propia.
          </p>
          <p>
            <strong>Alcance:</strong> sobre qué registros. «Sus zonas» usa las zonas de la persona en Usuarios (o
            todas, si tiene «Todas las zonas»). Una persona puede tener varios roles: se suma lo de todos y gana el
            alcance más amplio.
          </p>
          <p>
            La base aplica estas mismas reglas fila por fila: esconder un botón no es lo que protege, es la base.
          </p>
          {conBandera.length > 0 && (
            <p>
              {conBandera.map((r) => r.nombre).join(' y ')} no {conBandera.length === 1 ? 'aparece' : 'aparecen'} aquí:{' '}
              {conBandera.length === 1 ? 'se rige' : 'se rigen'} por su bandera (acceso total o solo lectura).
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
