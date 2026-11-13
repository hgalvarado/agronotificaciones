'use client'

/**
 * Diseñador de menú por rol (migración 103). Parecido al /SE02 de AGL, pero por rol y sin arrastrar: cada fila
 * se mueve con ↑ ↓ (botones, así sirve igual en el teléfono y con el teclado) y «Mover a…» la cambia de grupo.
 *
 * Solo pantalla: la regla de cómo se arma el menú vive en `lib/navegacion/menuRol` (la misma que usa el menú
 * real, así la vista previa es exacta) y el guardado en `fn_guardar_menu_rol`, que valida todo otra vez.
 * El menú no da acceso: la vista previa usa los permisos del rol elegido.
 */

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Selector, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorBuscable, type OpcionBuscable } from '@/components/ui/SelectorBuscable'
import { IconChevronDown } from '@/components/ui/Icons'
import { ICONOS_MENU, IconoMenu } from '@/components/ui/iconosMenu'
import { mensajeDeError } from '@/lib/errores'
import { PANTALLAS_CATALOGO } from '@/lib/catalogos/grupos'
import { catalogoDestinos } from '@/lib/navegacion/destinos'
import type { PantallaDeMenu } from '@/lib/navegacion/menuBase'
import { CUPO_BARRA } from '@/lib/navegacion/barra'
import {
  construirMenu,
  destinosDe,
  nodosDeSiempre,
  tieneDesde,
  type NodoMenu,
  type NodoPantalla,
} from '@/lib/navegacion/menuRol'

export type RolDelMenu = { id: number; codigo: string; nombre: string }
export type MenuGuardado = {
  nodos: NodoMenu[]
  inicio: string | null
  incluir_resto: boolean
  actualizado_en?: string | null
  actualizado_por?: string | null
}

type HijoEd = NodoPantalla & { uid: string }
type GrupoEd = { tipo: 'grupo'; uid: string; etiqueta: string; icono?: string | null; hijos: HijoEd[] }
type NodoEd = GrupoEd | HijoEd
type Borrador = { nodos: NodoEd[]; inicio: string | null; incluirResto: boolean }

let contador = 0
const uid = () => `n${++contador}`

const aEditable = (nodos: NodoMenu[]): NodoEd[] =>
  nodos.map((n) =>
    n.tipo === 'grupo'
      ? { ...n, uid: uid(), hijos: (n.hijos ?? []).map((h) => ({ ...h, tipo: 'pantalla' as const, uid: uid() })) }
      : { ...n, uid: uid() }
  )

const limpiarPantalla = (h: NodoPantalla): NodoPantalla => ({
  tipo: 'pantalla',
  destino: h.destino,
  ...(h.etiqueta?.trim() ? { etiqueta: h.etiqueta.trim() } : {}),
  ...(h.icono ? { icono: h.icono } : {}),
})

const aGuardar = (nodos: NodoEd[]): NodoMenu[] =>
  nodos.map((n) =>
    n.tipo === 'grupo'
      ? { tipo: 'grupo', etiqueta: n.etiqueta.trim(), ...(n.icono ? { icono: n.icono } : {}), hijos: n.hijos.map(limpiarPantalla) }
      : limpiarPantalla(n)
  )

const firma = (b: Borrador) => JSON.stringify([aGuardar(b.nodos), b.inicio, b.incluirResto])

const botonIcono =
  'rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600'

export function DisenadorMenu({
  roles,
  guardados: guardadosIniciales,
  pantallasMenu,
}: {
  roles: RolDelMenu[]
  guardados: Record<number, MenuGuardado>
  pantallasMenu: PantallaDeMenu[]
}) {
  const destinos = useMemo(() => catalogoDestinos(pantallasMenu, PANTALLAS_CATALOGO), [pantallasMenu])
  const porClave = useMemo(() => new Map(destinos.map((d) => [d.clave, d])), [destinos])
  const deSiempre = useMemo(() => nodosDeSiempre(pantallasMenu, PANTALLAS_CATALOGO), [pantallasMenu])

  const [guardados, setGuardados] = useState(guardadosIniciales)
  const [rolId, setRolId] = useState<number>(roles[0]?.id ?? 0)
  const borradorDe = (id: number, g = guardados): Borrador => {
    const m = g[id]
    return m
      ? { nodos: aEditable(m.nodos), inicio: m.inicio, incluirResto: m.incluir_resto }
      : { nodos: aEditable(deSiempre), inicio: null, incluirResto: true }
  }
  const [borrador, setBorrador] = useState<Borrador>(() => borradorDe(roles[0]?.id ?? 0))
  const [base, setBase] = useState(() => firma(borrador))
  const [permisosRol, setPermisosRol] = useState<string[] | null>(null)
  const [destinoNuevo, setDestinoNuevo] = useState<string>('')
  const [nombreGrupo, setNombreGrupo] = useState('')
  const [copiarDe, setCopiarDe] = useState('')
  const [agregarEn, setAgregarEn] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const sucio = firma(borrador) !== base
  const rol = roles.find((r) => r.id === rolId)
  const guardado = guardados[rolId]

  // Permisos del rol elegido, para la vista previa y el aviso de lo que falta
  useEffect(() => {
    let vigente = true
    createClient()
      .rpc('fn_menu_permisos_rol', { p_rol_id: rolId })
      .then(({ data, error: e }) => {
        if (!vigente) return
        if (e) {
          setPermisosRol([])
          setError(mensajeDeError(e, 'No se pudieron leer los permisos del rol.'))
          return
        }
        setPermisosRol(((data as { recurso: string; accion: string }[] | null) ?? []).map((p) => `${p.recurso}:${p.accion}`))
      })
    return () => {
      vigente = false
    }
  }, [rolId])

  const tieneRol = useMemo(() => tieneDesde(permisosRol ?? []), [permisosRol])
  const usados = new Set(destinosDe(aGuardar(borrador.nodos)))
  const grupos = borrador.nodos.filter((n): n is GrupoEd => n.tipo === 'grupo')

  const previa = useMemo(
    () =>
      construirMenu({
        menus: [
          { rol_id: rolId, principal: true, disenado: true, nodos: aGuardar(borrador.nodos), inicio: borrador.inicio, incluir_resto: borrador.incluirResto },
        ],
        tiene: tieneRol,
        pantallasMenu,
        pantallasCatalogo: PANTALLAS_CATALOGO,
      }),
    [borrador, rolId, tieneRol, pantallasMenu]
  )
  const faltan = permisosRol ? destinos.filter((d) => !usados.has(d.clave) && d.requiere.some(tieneRol)) : []
  const sinPermiso = permisosRol
    ? destinosDe(aGuardar(borrador.nodos)).filter((c) => !porClave.get(c)?.requiere.some(tieneRol))
    : []

  const nombreDestino = (c: string) => porClave.get(c)?.etiqueta ?? c

  // ---------------------------------------------------------------- cambios
  function cambiar(f: (b: Borrador) => Borrador) {
    setBorrador((b) => f(b))
    setAviso(null)
    setError(null)
  }
  const conNodos = (f: (n: NodoEd[]) => NodoEd[]) => cambiar((b) => ({ ...b, nodos: f(b.nodos) }))

  function intercambiar<T>(lista: T[], i: number, d: number): T[] {
    const j = i + d
    if (j < 0 || j >= lista.length) return lista
    const c = [...lista]
    ;[c[i], c[j]] = [c[j], c[i]]
    return c
  }

  function moverHijo(gUid: string, i: number, d: number) {
    conNodos((ns) => ns.map((n) => (n.uid === gUid && n.tipo === 'grupo' ? { ...n, hijos: intercambiar(n.hijos, i, d) } : n)))
  }

  /** Saca la pantalla de donde esté y la pone al final del grupo `destino` ('' = sin grupo, después de su grupo). */
  function moverA(pUid: string, destino: string) {
    conNodos((ns) => {
      let pieza: HijoEd | null = null
      let posGrupo = -1
      const sin = ns
        .filter((n) => {
          if (n.uid === pUid && n.tipo === 'pantalla') {
            pieza = n
            return false
          }
          return true
        })
        .map((n, i) => {
          if (n.tipo !== 'grupo') return n
          const h = n.hijos.find((x) => x.uid === pUid)
          if (!h) return n
          pieza = h
          posGrupo = i
          return { ...n, hijos: n.hijos.filter((x) => x.uid !== pUid) }
        })
      if (!pieza) return ns
      if (!destino) {
        const c = [...sin]
        c.splice(posGrupo >= 0 ? posGrupo + 1 : c.length, 0, pieza)
        return c
      }
      return sin.map((n) => (n.uid === destino && n.tipo === 'grupo' ? { ...n, hijos: [...n.hijos, pieza as HijoEd] } : n))
    })
  }

  function quitar(u: string) {
    conNodos((ns) => {
      const i = ns.findIndex((n) => n.uid === u)
      if (i >= 0) {
        const n = ns[i]
        // Quitar un grupo no pierde sus pantallas: quedan sueltas en su lugar
        return n.tipo === 'grupo' ? [...ns.slice(0, i), ...n.hijos, ...ns.slice(i + 1)] : ns.filter((x) => x.uid !== u)
      }
      return ns.map((g) => (g.tipo === 'grupo' ? { ...g, hijos: g.hijos.filter((h) => h.uid !== u) } : g))
    })
    cambiar((b) => (b.inicio && !destinosDe(aGuardar(b.nodos)).includes(b.inicio) ? { ...b, inicio: null } : b))
  }

  function editar(u: string, campo: 'etiqueta' | 'icono', valor: string) {
    const v = valor || null
    conNodos((ns) =>
      ns.map((n) =>
        n.uid === u
          ? ({ ...n, [campo]: campo === 'etiqueta' && n.tipo === 'grupo' ? valor : v } as NodoEd)
          : n.tipo === 'grupo'
            ? { ...n, hijos: n.hijos.map((h) => (h.uid === u ? { ...h, [campo]: v } : h)) }
            : n
      )
    )
  }

  function agregarPantalla(clave: string, enGrupo: string) {
    if (!clave || usados.has(clave)) return
    const nuevo: HijoEd = { tipo: 'pantalla', destino: clave, uid: uid() }
    conNodos((ns) =>
      enGrupo ? ns.map((n) => (n.uid === enGrupo && n.tipo === 'grupo' ? { ...n, hijos: [...n.hijos, nuevo] } : n)) : [...ns, nuevo]
    )
  }

  function agregarGrupo() {
    const e = nombreGrupo.trim()
    if (!e) return
    if (grupos.some((g) => g.etiqueta.trim().toLowerCase() === e.toLowerCase())) {
      setError(`Ya hay un grupo llamado «${e}».`)
      return
    }
    conNodos((ns) => [...ns, { tipo: 'grupo', uid: uid(), etiqueta: e, icono: null, hijos: [] }])
    setNombreGrupo('')
  }

  // ---------------------------------------------------------------- rol, guardar, restablecer, copiar
  function elegirRol(id: number) {
    if (id === rolId) return
    if (sucio && !window.confirm('Hay cambios sin guardar en este menú. ¿Descartarlos y cambiar de rol?')) return
    const b = borradorDe(id)
    setRolId(id)
    setBorrador(b)
    setBase(firma(b))
    setPermisosRol(null)
    setCopiarDe('')
    setAviso(null)
    setError(null)
  }

  async function guardar() {
    const nodos = aGuardar(borrador.nodos)
    if (nodos.some((n) => n.tipo === 'grupo' && !n.etiqueta)) return setError('Cada grupo necesita un nombre.')
    setTrabajando(true)
    setError(null)
    const { error: e } = await createClient().rpc('fn_guardar_menu_rol', {
      p_rol_id: rolId,
      p_nodos: nodos,
      p_inicio: borrador.inicio,
      p_incluir_resto: borrador.incluirResto,
    })
    setTrabajando(false)
    if (e) return setError(mensajeDeError(e, 'No se pudo guardar el menú.'))
    setGuardados((g) => ({
      ...g,
      [rolId]: { nodos, inicio: borrador.inicio, incluir_resto: borrador.incluirResto, actualizado_en: new Date().toISOString(), actualizado_por: null },
    }))
    setBase(firma(borrador))
    setAviso(`Menú de «${rol?.nombre}» guardado. Quien tenga este rol lo verá al recargar.`)
  }

  async function restablecer() {
    if (!window.confirm(`¿Volver «${rol?.nombre}» al menú de siempre? Se borra el menú diseñado.`)) return
    setTrabajando(true)
    setError(null)
    const { error: e } = await createClient().rpc('fn_restablecer_menu_rol', { p_rol_id: rolId })
    setTrabajando(false)
    if (e) return setError(mensajeDeError(e, 'No se pudo restablecer el menú.'))
    const g = { ...guardados }
    delete g[rolId]
    setGuardados(g)
    const b = borradorDe(rolId, g)
    setBorrador(b)
    setBase(firma(b))
    setAviso(`«${rol?.nombre}» vuelve al menú de siempre.`)
  }

  function copiar() {
    const origen = Number(copiarDe)
    if (!origen) return
    const b = borradorDe(origen)
    setBorrador(b)
    setAviso(
      `Se copió el menú de «${roles.find((r) => r.id === origen)?.nombre}». Revísalo y toca «Guardar» para dejarlo en «${rol?.nombre}».`
    )
    setError(null)
  }

  // ---------------------------------------------------------------- opciones de los selectores
  const opcionesRol: OpcionBuscable[] = roles.map((r) => ({
    id: String(r.id),
    titulo: r.nombre,
    subtitulo: guardados[r.id] ? 'Menú diseñado' : 'Menú de siempre',
  }))
  const opcionesDestino: OpcionBuscable[] = [...destinos]
    .filter((d) => !usados.has(d.clave))
    .sort((a, b) => a.seccion.localeCompare(b.seccion))
    .map((d) => ({
      id: d.clave,
      titulo: d.etiqueta,
      subtitulo: permisosRol && !d.requiere.some(tieneRol) ? `${d.href} · este rol no la puede abrir` : d.href,
      grupo: d.seccion,
    }))

  // ---------------------------------------------------------------- filas
  function filaPantalla(n: HijoEd, i: number, total: number, gUid: string | null, suelta = false) {
    const d = porClave.get(n.destino)
    const esInicio = borrador.inicio === n.destino
    const nombre = n.etiqueta || nombreDestino(n.destino)
    return (
      <li
        key={n.uid}
        className={`flex flex-wrap items-center gap-1.5 px-2 py-2 ${suelta ? 'rounded-xl ring-1 ring-inset ring-slate-200' : 'border-t border-slate-100 first:border-t-0'}`}
        data-nodo="pantalla"
        data-destino={n.destino}
      >
        <IconoMenu nombre={n.icono || d?.icono} className="h-4 w-4 text-slate-400" />
        <input
          value={n.etiqueta ?? ''}
          placeholder={nombreDestino(n.destino)}
          onChange={(e) => editar(n.uid, 'etiqueta', e.target.value)}
          aria-label={`Nombre en el menú de ${nombreDestino(n.destino)}`}
          maxLength={40}
          data-etiqueta
          className="min-w-0 flex-1 basis-40 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
        />
        {!d && <span className="text-[11px] font-semibold text-amber-700">Ya no existe</span>}
        <span className="w-36" data-icono>
          <Selector value={n.icono ?? ''} onChange={(e) => editar(n.uid, 'icono', e.target.value)} aria-label={`Ícono de ${nombre}`}>
            <option value="">Ícono: el suyo</option>
            {Object.entries(ICONOS_MENU).map(([k, v]) => (
              <option key={k} value={k}>
                {v.etiqueta}
              </option>
            ))}
          </Selector>
        </span>
        <span className="w-40" data-mover-a>
          <Selector value={gUid ?? ''} onChange={(e) => moverA(n.uid, e.target.value)} aria-label={`Mover ${nombre} a otro grupo`} buscable>
            <option value="">Sin grupo</option>
            {grupos.map((g) => (
              <option key={g.uid} value={g.uid}>
                En «{g.etiqueta || 'sin nombre'}»
              </option>
            ))}
          </Selector>
        </span>
        <button
          type="button"
          aria-pressed={esInicio}
          onClick={() => cambiar((b) => ({ ...b, inicio: esInicio ? null : n.destino }))}
          data-inicio
          className={`rounded-lg px-2 py-1.5 text-xs font-semibold ring-1 ring-inset ${
            esInicio ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-500 ring-slate-200'
          }`}
          title="Pantalla con la que entra el rol"
        >
          Inicio
        </button>
        <span className="flex items-center">
          <button type="button" className={botonIcono} aria-label={`Subir ${nombre}`} data-subir disabled={i === 0}
            onClick={() => (gUid ? moverHijo(gUid, i, -1) : conNodos((ns) => intercambiar(ns, i, -1)))}>
            <IconChevronDown className="h-4 w-4 rotate-180" />
          </button>
          <button type="button" className={botonIcono} aria-label={`Bajar ${nombre}`} data-bajar disabled={i === total - 1}
            onClick={() => (gUid ? moverHijo(gUid, i, 1) : conNodos((ns) => intercambiar(ns, i, 1)))}>
            <IconChevronDown className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => quitar(n.uid)} data-quitar aria-label={`Quitar ${nombre} del menú`}
            className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-400 hover:text-red-600">
            Quitar
          </button>
        </span>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-4" data-disenador-menu data-rol-actual={rol?.codigo} data-sucio={sucio ? 'si' : 'no'}>
      {error && (
        <div data-error-menu>
          <Alerta>{error}</Alerta>
        </div>
      )}
      {aviso && (
        <div data-aviso-menu>
          <Alerta tono="azul">{aviso}</Alerta>
        </div>
      )}

      <Tarjeta className="flex flex-col gap-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5" data-rol-menu>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Rol</span>
            <SelectorBuscable
              valor={String(rolId)}
              opciones={opcionesRol}
              onCambiar={(id) => id && elegirRol(Number(id))}
              permitirVacio={false}
              placeholder="Elige un rol"
              etiquetaBusqueda="Buscar rol…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Copiar el menú de otro rol</span>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1" data-copiar-de>
                <SelectorBuscable
                  valor={copiarDe}
                  opciones={opcionesRol.filter((o) => o.id !== String(rolId))}
                  onCambiar={setCopiarDe}
                  placeholder="Elige el rol de origen"
                  etiquetaBusqueda="Buscar rol…"
                  textoVacio="Ninguno"
                />
              </div>
              <Boton variante="secundario" onClick={copiar} disabled={!copiarDe || trabajando} data-copiar>
                Copiar
              </Boton>
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500" data-estado-menu={guardado ? 'disenado' : 'siempre'}>
          {guardado
            ? `Menú diseñado${guardado.actualizado_por ? ` · lo cambió ${guardado.actualizado_por}` : ''}${
                guardado.actualizado_en ? ` el ${new Date(guardado.actualizado_en).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa' })}` : ''
              }.`
            : 'Este rol usa el menú de siempre. Lo que armes aquí no cambia nada hasta que toques «Guardar».'}
          {sucio && <strong className="ml-1 text-amber-700">Cambios sin guardar.</strong>}
        </p>
      </Tarjeta>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* ------------------------------ Editor ------------------------------ */}
        <Tarjeta className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Menú de «{rol?.nombre}»</h2>
          <ul className="flex flex-col gap-2" data-editor-menu>
            {borrador.nodos.map((n, i) =>
              n.tipo === 'pantalla' ? (
                filaPantalla(n, i, borrador.nodos.length, null, true)
              ) : (
                <li key={n.uid} className="overflow-hidden rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200" data-nodo="grupo" data-grupo-etiqueta={n.etiqueta}>
                  <div className="flex flex-wrap items-center gap-1.5 px-2 py-2">
                    <IconoMenu nombre={n.icono} className="h-4 w-4 text-slate-500" />
                    <input
                      value={n.etiqueta}
                      onChange={(e) => editar(n.uid, 'etiqueta', e.target.value)}
                      aria-label="Nombre del grupo"
                      maxLength={40}
                      data-etiqueta-grupo
                      className="min-w-0 flex-1 basis-32 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold focus:border-brand-600 focus:outline-none"
                    />
                    <span className="w-36" data-icono>
                      <Selector value={n.icono ?? ''} onChange={(e) => editar(n.uid, 'icono', e.target.value)} aria-label={`Ícono del grupo ${n.etiqueta}`}>
                        <option value="">Ícono: el de su primera pantalla</option>
                        {Object.entries(ICONOS_MENU).map(([k, v]) => (
                          <option key={k} value={k}>{v.etiqueta}</option>
                        ))}
                      </Selector>
                    </span>
                    <span className="flex items-center">
                      <button type="button" className={botonIcono} aria-label={`Subir el grupo ${n.etiqueta}`} data-subir disabled={i === 0}
                        onClick={() => conNodos((ns) => intercambiar(ns, i, -1))}>
                        <IconChevronDown className="h-4 w-4 rotate-180" />
                      </button>
                      <button type="button" className={botonIcono} aria-label={`Bajar el grupo ${n.etiqueta}`} data-bajar disabled={i === borrador.nodos.length - 1}
                        onClick={() => conNodos((ns) => intercambiar(ns, i, 1))}>
                        <IconChevronDown className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => quitar(n.uid)} data-quitar aria-label={`Quitar el grupo ${n.etiqueta} (sus pantallas quedan sueltas)`}
                        className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-400 hover:text-red-600">
                        Quitar grupo
                      </button>
                    </span>
                  </div>
                  {n.hijos.length === 0 ? (
                    <p className="border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-400">Grupo vacío: no sale en el menú.</p>
                  ) : (
                    <ul className="border-t border-slate-200 bg-white">
                      {n.hijos.map((h, j) => (
                        filaPantalla(h, j, n.hijos.length, n.uid)
                      ))}
                    </ul>
                  )}
                </li>
              )
            )}
          </ul>

          {/* Agregar pantalla / grupo */}
          <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5" data-agregar-pantalla>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Agregar pantalla</span>
              <Selector value={agregarEn} onChange={(e) => setAgregarEn(e.target.value)} aria-label="Dónde agregarla" buscable>
                <option value="">Sin grupo (al final)</option>
                {grupos.map((g) => (
                  <option key={g.uid} value={g.uid}>
                    En «{g.etiqueta || 'sin nombre'}»
                  </option>
                ))}
              </Selector>
              <SelectorBuscable
                valor={destinoNuevo}
                opciones={opcionesDestino}
                onCambiar={(c) => {
                  agregarPantalla(c, grupos.some((g) => g.uid === agregarEn) ? agregarEn : '')
                  setDestinoNuevo('')
                }}
                placeholder="Elige la pantalla…"
                etiquetaBusqueda="Buscar pantalla…"
                permitirVacio={false}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Nuevo grupo</span>
              <div className="flex gap-2">
                <input
                  value={nombreGrupo}
                  onChange={(e) => setNombreGrupo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && agregarGrupo()}
                  placeholder="Nombre del grupo"
                  maxLength={40}
                  data-nuevo-grupo
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
                />
                <Boton variante="secundario" onClick={agregarGrupo} disabled={!nombreGrupo.trim()} data-agregar-grupo>
                  Agregar
                </Boton>
              </div>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={borrador.incluirResto}
              onChange={(e) => cambiar((b) => ({ ...b, incluirResto: e.target.checked }))}
              data-incluir-resto
              className="mt-0.5 h-4 w-4"
            />
            <span>
              Mostrar al final, en «Otros», lo que el menú de siempre le daría y aquí no está. Recomendado: así nadie pierde
              una pantalla de trabajo por olvido.
            </span>
          </label>

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            <Boton variante="peligro" onClick={() => void restablecer()} disabled={trabajando || !guardado} data-restablecer>
              Restablecer
            </Boton>
            <Boton
              variante="secundario"
              onClick={() => {
                const b = borradorDe(rolId)
                setBorrador(b)
                setAviso(null)
              }}
              disabled={trabajando || !sucio}
            >
              Descartar cambios
            </Boton>
            <Boton onClick={() => void guardar()} disabled={trabajando || borrador.nodos.length === 0} data-guardar>
              {trabajando ? 'Guardando…' : 'Guardar'}
            </Boton>
          </div>
        </Tarjeta>

        {/* ------------------------------ Vista previa ------------------------------ */}
        <Tarjeta className="flex flex-col gap-3 p-4 lg:sticky lg:top-4">
          <h2 className="text-sm font-semibold text-slate-900">Como lo ve «{rol?.nombre}»</h2>
          {permisosRol === null ? (
            <p className="text-xs text-slate-400">Leyendo los permisos del rol…</p>
          ) : (
            <div className="flex flex-col gap-3" data-vista-previa>
              {previa.entradas.length === 0 ? (
                <p className="text-xs text-amber-700">Con sus permisos, este rol no vería nada en el menú.</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {previa.entradas.map((e) => (
                    <li key={e.href} data-previa-entrada={e.etiqueta}>
                      <span className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700">
                        <IconoMenu nombre={e.icono} className="h-4 w-4 text-slate-400" />
                        {e.etiqueta}
                        {previa.inicio && !e.hijos && e.href === previa.inicio && (
                          <span className="rounded bg-brand-50 px-1.5 text-[10px] font-bold text-brand-800">INICIO</span>
                        )}
                      </span>
                      {e.hijos && e.hijos.length > 1 && (
                        <ul className="ml-6 border-l border-slate-200 pl-2">
                          {e.hijos.map((h) => (
                            <li key={h.href} className="py-1 text-xs text-slate-500" data-previa-hijo={h.etiqueta}>
                              {h.etiqueta}
                              {h.href === previa.inicio && <span className="ml-1 font-bold text-brand-800">· inicio</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-slate-400">
                En el teléfono salen abajo las primeras {CUPO_BARRA - 1} (o las que diga «Navegación móvil») y el resto en «Más».
              </p>
              {sinPermiso.length > 0 && (
                <div data-sin-permiso>
                  <Alerta tono="ambar">
                    No se le verán porque el rol no tiene permiso: {sinPermiso.map(nombreDestino).join(', ')}. El menú no da
                    acceso; dáselo en Permisos si hace falta.
                  </Alerta>
                </div>
              )}
              {faltan.length > 0 && (
                <div className="flex flex-col gap-1.5" data-faltan>
                  <p className="text-xs text-slate-500">
                    Puede abrir y no están en este menú{borrador.incluirResto ? ' (las del menú de siempre irán a «Otros»)' : ''}:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {faltan.map((d) => (
                      <button
                        key={d.clave}
                        type="button"
                        onClick={() => agregarPantalla(d.clave, '')}
                        data-agregar-faltante={d.clave}
                        className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 hover:text-brand-700 hover:ring-brand-400"
                      >
                        + {d.etiqueta}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Tarjeta>
      </div>
    </div>
  )
}
