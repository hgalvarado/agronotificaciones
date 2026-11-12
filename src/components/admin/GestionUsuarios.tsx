'use client'

/**
 * Usuarios: la ficha completa de cada persona (migración 92).
 *
 *   - Varios roles por persona; uno es el principal (barra del teléfono). Los permisos son la suma.
 *   - Zonas con «Todas las zonas» explícito. Antes «ninguna marcada» quería decir «ve todas» y olvidar
 *     marcar abría todo.
 *   - Estaciones (Fertirriego) para quien tenga «Administrar estaciones»: se guardan con la regla de la base
 *     (fn_fert_asignar_persona), que solo deja tocar las estaciones de su alcance.
 *   - «Qué puede hacer»: los permisos efectivos, con el rol que da cada uno.
 * Ningún número ni nombre de rol escrito aquí: las banderas salen de la tabla `roles`.
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import {
  Alerta,
  Boton,
  Campo,
  Entrada,
  EstadoVacio,
  Insignia,
  ListaEsqueleto,
  Selector,
  Tarjeta,
} from '@/components/ui/Primitivos'
import { IconCheck, IconPencil, IconPlus, IconSearch, IconUser } from '@/components/ui/Icons'
import { createClient } from '@/lib/supabase/client'
import { mensajeDeError } from '@/lib/errores'
import { ListaCasillasBuscable } from './ListaCasillasBuscable'
import { FichaPermisosPersona, type PantallaFicha } from './FichaPermisosPersona'
import { HistorialAccesos } from './HistorialAccesos'
import { DataGrid, type ColumnaGrid } from '@/components/ui/DataGrid'
import { useMemoria } from '@/lib/memoria/useMemoria'

type RolUsuario = {
  id: number
  codigo: string
  nombre: string
  acceso_total?: boolean | null
  solo_lectura?: boolean | null
  /** 93: lo pueden asignar quienes administran solo sus zonas. */
  delegable?: boolean | null
}

/**
 * 93/97: quien administra usuarios solo de sus zonas (jefe de zona). null = administra todo.
 * oles: los que administra su rol (97, configurado en Permisos); null = sin la 97 (los «delegables»).
 */
export type Delegacion = { zonas: string[]; roles: number[] | null } | null

type UsuarioAdmin = {
  id: string
  nombre: string
  email: string
  rol_id: number
  departamento: string | null
  whatsapp: string | null
  activo: boolean
  bloqueado: boolean
  zonas?: string[]
  roles_ids?: number[]
  todas_las_zonas?: boolean
  estaciones?: string[]
}

type Estacion = { id: string; nombre: string; zona_id: string | null }

export function GestionUsuarios({
  roles,
  departamentos,
  zonas,
  estaciones,
  pantallas,
  acciones,
  puedeAsignarEstaciones,
  delegacion = null,
  miId,
}: {
  delegacion?: Delegacion
  roles: RolUsuario[]
  departamentos: { id: string; nombre: string }[]
  zonas: { id: string; nombre: string }[]
  estaciones: Estacion[]
  pantallas: PantallaFicha[]
  acciones: { codigo: string; nombre: string }[]
  puedeAsignarEstaciones: boolean
  miId: string
}) {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<UsuarioAdmin | null>(null)
  // Preferencias de la pantalla, por usuario (se recuerdan al volver)
  const [prefs, setPrefs] = useMemoria<Preferencias>('usuarios', { estado: 'activos', agrupar: 'rol', vista: 'lista' })
  const [rapido, setRapido] = useState<'bloqueados' | 'sin_zona' | null>(null)
  const [cerrados, setCerrados] = useState<Set<string>>(new Set())

  async function obtenerUsuarios(): Promise<UsuarioAdmin[]> {
    const res = await fetch('/api/usuarios')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'No se pudieron cargar los usuarios.')
    return data.usuarios as UsuarioAdmin[]
  }

  async function cargar() {
    try {
      setUsuarios(await obtenerUsuarios())
      setError(null)
    } catch (e) {
      setError(mensajeDeError(e, 'Error inesperado.'))
      setUsuarios([])
    }
  }

  useEffect(() => {
    let vivo = true
    obtenerUsuarios()
      .then((lista) => {
        if (!vivo) return
        setUsuarios(lista)
        setError(null)
      })
      .catch((e) => {
        if (!vivo) return
        setError(mensajeDeError(e, 'Error inesperado.'))
        setUsuarios([])
      })
    return () => {
      vivo = false
    }
  }, [])

  const rolPorId = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles])
  const zonaPorId = useMemo(() => new Map(zonas.map((z) => [z.id, z.nombre])), [zonas])
  const lista = usuarios ?? []
  const sinZona = (u: UsuarioAdmin) => !u.todas_las_zonas && (u.zonas?.length ?? 0) === 0
  const cuentas = {
    activos: lista.filter((u) => u.activo).length,
    inactivos: lista.filter((u) => !u.activo).length,
    bloqueados: lista.filter((u) => u.bloqueado).length,
    sin_zona: lista.filter((u) => u.activo && sinZona(u)).length,
  }

  const filtrados = lista.filter((u) => {
    if (prefs.estado === 'activos' && !u.activo) return false
    if (prefs.estado === 'inactivos' && u.activo) return false
    if (rapido === 'bloqueados' && !u.bloqueado) return false
    if (rapido === 'sin_zona' && !sinZona(u)) return false
    const q = busqueda.trim().toLowerCase()
    if (!q) return true
    const susRoles = (u.roles_ids ?? [u.rol_id]).map((id) => rolPorId.get(id)?.nombre ?? '').join(' ')
    const susZonas = (u.zonas ?? []).map((z) => zonaPorId.get(z) ?? '').join(' ')
    return [u.nombre, u.email, u.departamento ?? '', susRoles, susZonas].some((t) => t.toLowerCase().includes(q))
  })

  // Grupos: por rol principal, por zona (una persona sale en cada zona suya), por departamento o ninguno
  const grupos = useMemo(() => {
    const m = new Map<string, UsuarioAdmin[]>()
    const meter = (clave: string, u: UsuarioAdmin) => m.set(clave, [...(m.get(clave) ?? []), u])
    for (const u of filtrados) {
      if (prefs.agrupar === 'rol') meter(rolPorId.get(u.rol_id)?.nombre ?? 'Sin rol', u)
      else if (prefs.agrupar === 'departamento') meter(u.departamento || 'Sin departamento', u)
      else if (prefs.agrupar === 'zona') {
        if (u.todas_las_zonas) meter('Todas las zonas', u)
        else if (!(u.zonas?.length ?? 0)) meter('Sin zona', u)
        else for (const z of u.zonas!) meter(zonaPorId.get(z) ?? 'Zona desconocida', u)
      } else meter('', u)
    }
    const fin = new Set(['Sin rol', 'Sin departamento', 'Sin zona'])
    return [...m.entries()].sort(([a], [b]) => Number(fin.has(a)) - Number(fin.has(b)) || a.localeCompare(b, 'es'))
  }, [filtrados, prefs.agrupar, rolPorId, zonaPorId])

  // Delegación: solo sus zonas, las estaciones de esas zonas y los roles que administra su rol (la base lo exige)
  const permitidas = delegacion ? new Set(delegacion.zonas) : null
  const rolesAsignables = delegacion
    ? roles.filter((r) => !r.acceso_total && (delegacion.roles ? delegacion.roles.includes(r.id) : r.delegable))
    : roles
  const comun = {
    roles: rolesAsignables,
    departamentos,
    zonas: permitidas ? zonas.filter((z) => permitidas.has(z.id)) : zonas,
    estaciones: permitidas ? estaciones.filter((e) => e.zona_id && permitidas.has(e.zona_id)) : estaciones,
    pantallas,
    acciones,
    puedeAsignarEstaciones,
    delegado: Boolean(delegacion),
  }

  const columnas: ColumnaGrid<UsuarioAdmin>[] = [
    { campo: 'nombre', label: 'Nombre', tipo: 'texto', valor: (u) => u.nombre },
    { campo: 'email', label: 'Correo', tipo: 'texto', valor: (u) => u.email },
    { campo: 'principal', label: 'Rol principal', tipo: 'seleccion', valor: (u) => rolPorId.get(u.rol_id)?.nombre ?? null },
    {
      campo: 'roles',
      label: 'Roles',
      tipo: 'texto',
      valor: (u) => (u.roles_ids ?? [u.rol_id]).map((id) => rolPorId.get(id)?.nombre ?? '').filter(Boolean).join(', '),
    },
    { campo: 'zonas', label: 'Zonas', tipo: 'texto', valor: (u) => textoZonas(u, zonaPorId) },
    { campo: 'estaciones', label: 'Estaciones', tipo: 'numero', numero: true, valor: (u) => u.estaciones?.length ?? 0 },
    { campo: 'departamento', label: 'Departamento', tipo: 'seleccion', valor: (u) => u.departamento || null },
    { campo: 'estado', label: 'Estado', tipo: 'seleccion', valor: (u) => (u.bloqueado ? 'Bloqueado' : u.activo ? 'Activo' : 'Inactivo') },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* -------- Resumen: toca para filtrar -------- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-resumen-usuarios>
        <Contador
          titulo="Activos"
          valor={cuentas.activos}
          tono="verde"
          activo={prefs.estado === 'activos' && !rapido}
          dato="activos"
          onClick={() => {
            setRapido(null)
            setPrefs({ ...prefs, estado: 'activos' })
          }}
        />
        <Contador
          titulo="Inactivos"
          valor={cuentas.inactivos}
          tono="gris"
          activo={prefs.estado === 'inactivos' && !rapido}
          dato="inactivos"
          onClick={() => {
            setRapido(null)
            setPrefs({ ...prefs, estado: 'inactivos' })
          }}
        />
        <Contador
          titulo="Bloqueados"
          valor={cuentas.bloqueados}
          tono="rojo"
          activo={rapido === 'bloqueados'}
          dato="bloqueados"
          onClick={() => {
            setRapido(rapido === 'bloqueados' ? null : 'bloqueados')
            setPrefs({ ...prefs, estado: 'todos' })
          }}
        />
        <Contador
          titulo="Activos sin zona"
          valor={cuentas.sin_zona}
          tono="ambar"
          activo={rapido === 'sin_zona'}
          dato="sin_zona"
          ayuda="No ven datos de ninguna zona"
          onClick={() => {
            setRapido(rapido === 'sin_zona' ? null : 'sin_zona')
            setPrefs({ ...prefs, estado: 'activos' })
          }}
        />
      </div>

      {delegacion && (
        <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-inset ring-sky-200" data-delegado-aviso>
          Ves y administras solo a las personas de tus zonas con los roles que administra tu rol
          {rolesAsignables.length ? `: ${rolesAsignables.map((r) => r.nombre).join(', ')}` : ''}.
        </p>
      )}

      {/* -------- Barra: buscar, estado, agrupar, vista, nuevo -------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, correo, rol, zona o departamento…"
            data-buscar-usuario
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>
        <Segmentos
          etiqueta="Estado"
          valor={prefs.estado}
          opciones={[
            ['activos', 'Activos'],
            ['inactivos', 'Inactivos'],
            ['todos', 'Todos'],
          ]}
          onCambiar={(v) => {
            setRapido(null)
            setPrefs({ ...prefs, estado: v as Preferencias['estado'] })
          }}
          dato="estado"
        />
        {prefs.vista === 'lista' && (
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            Agrupar por
            <select
              value={prefs.agrupar}
              onChange={(e) => setPrefs({ ...prefs, agrupar: e.target.value as Preferencias['agrupar'] })}
              data-agrupar-usuarios
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 focus:border-brand-600 focus:outline-none"
            >
              <option value="rol">Rol principal</option>
              <option value="zona">Zona</option>
              <option value="departamento">Departamento</option>
              <option value="ninguno">Sin agrupar</option>
            </select>
          </label>
        )}
        <Segmentos
          etiqueta="Vista"
          valor={prefs.vista}
          opciones={[
            ['lista', 'Lista'],
            ['tabla', 'Tabla'],
          ]}
          onCambiar={(v) => setPrefs({ ...prefs, vista: v as Preferencias['vista'] })}
          dato="vista"
        />
        <Boton tamano="sm" onClick={() => setCreando(true)} data-nuevo-usuario>
          <IconPlus className="h-4 w-4" />
          Nuevo
        </Boton>
      </div>

      {error && <Alerta>{error}</Alerta>}

      {usuarios === null ? (
        <ListaEsqueleto filas={5} />
      ) : filtrados.length === 0 ? (
        <Tarjeta>
          <EstadoVacio
            icono={<IconUser />}
            titulo={busqueda || rapido ? 'Sin resultados' : prefs.estado === 'inactivos' ? 'No hay usuarios inactivos' : 'Sin usuarios'}
            descripcion={busqueda || rapido ? 'Prueba con otra búsqueda o quita el filtro.' : 'Crea el primer usuario con «Nuevo».'}
          />
        </Tarjeta>
      ) : prefs.vista === 'tabla' ? (
        <DataGrid
          filas={filtrados}
          columnas={columnas}
          titulo="Usuarios"
          nombreArchivo="usuarios"
          puedeExportar
          memoria="usuarios-tabla"
          accionFila={(u) => (
            <button
              type="button"
              onClick={() => setEditando(u)}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
              aria-label={`Editar ${u.nombre}`}
            >
              <IconPencil className="h-4 w-4" />
            </button>
          )}
        />
      ) : (
        <div className="flex flex-col gap-3" data-grupos-usuarios>
          {grupos.map(([grupo, personas]) => {
            const cerrado = cerrados.has(grupo)
            return (
              <section key={grupo || 'todos'} className="overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-slate-200" data-grupo={grupo}>
                {grupo && (
                  <button
                    type="button"
                    aria-expanded={!cerrado}
                    onClick={() => {
                      const s = new Set(cerrados)
                      if (cerrado) s.delete(grupo)
                      else s.add(grupo)
                      setCerrados(s)
                    }}
                    className="flex w-full items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 text-left"
                  >
                    <span className={`text-slate-400 transition-transform ${cerrado ? '' : 'rotate-90'}`}>▸</span>
                    <span className="text-sm font-bold text-slate-800">{grupo}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500 ring-1 ring-inset ring-slate-200">
                      {personas.length}
                    </span>
                  </button>
                )}
                {!cerrado && (
                  <ul className="divide-y divide-slate-100">
                    {personas.map((u) => (
                      <FilaUsuario key={`${grupo}|${u.id}`} u={u} yo={u.id === miId} rolPorId={rolPorId} zonaPorId={zonaPorId} onEditar={() => setEditando(u)} />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      {creando && (
        <ModalUsuario key="nuevo" {...comun} onCerrar={() => setCreando(false)} onGuardado={cargar} />
      )}
      {editando && (
        <ModalUsuario
          key={editando.id}
          {...comun}
          usuario={editando}
          esYo={editando.id === miId}
          onCerrar={() => setEditando(null)}
          onGuardado={cargar}
        />
      )}
    </div>
  )
}

type Preferencias = { estado: 'activos' | 'inactivos' | 'todos'; agrupar: 'rol' | 'zona' | 'departamento' | 'ninguno'; vista: 'lista' | 'tabla' }

function textoZonas(u: UsuarioAdmin, zonaPorId: Map<string, string>): string {
  if (u.todas_las_zonas) return 'Todas las zonas'
  const nombres = (u.zonas ?? []).map((z) => zonaPorId.get(z) ?? '?')
  return nombres.length ? nombres.join(', ') : 'Sin zona'
}

const TONOS_CONTADOR = {
  verde: 'text-brand-700',
  gris: 'text-slate-600',
  rojo: 'text-red-600',
  ambar: 'text-amber-700',
} as const

function Contador({
  titulo,
  valor,
  tono,
  activo,
  dato,
  ayuda,
  onClick,
}: {
  titulo: string
  valor: number
  tono: keyof typeof TONOS_CONTADOR
  activo: boolean
  dato: string
  ayuda?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      data-contador={dato}
      title={ayuda}
      className={`flex flex-col items-start rounded-2xl bg-white px-4 py-3 text-left ring-1 ring-inset transition-all hover:ring-brand-300 ${
        activo ? 'ring-2 ring-brand-600' : 'ring-slate-200'
      }`}
    >
      <span className={`text-2xl font-bold tabular-nums ${TONOS_CONTADOR[tono]}`}>{valor}</span>
      <span className="text-xs font-semibold text-slate-500">{titulo}</span>
    </button>
  )
}

function Segmentos({
  etiqueta,
  valor,
  opciones,
  onCambiar,
  dato,
}: {
  etiqueta: string
  valor: string
  opciones: [string, string][]
  onCambiar: (v: string) => void
  dato: string
}) {
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex rounded-lg bg-slate-100 p-0.5" data-segmentos={dato}>
      {opciones.map(([v, t]) => (
        <button
          key={v}
          type="button"
          aria-pressed={valor === v}
          data-opcion={v}
          onClick={() => onCambiar(v)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            valor === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

const COLORES_AVATAR = ['bg-brand-50 text-brand-700', 'bg-sky-50 text-sky-700', 'bg-violet-50 text-violet-700', 'bg-amber-50 text-amber-700', 'bg-rose-50 text-rose-700']

function FilaUsuario({
  u,
  yo,
  rolPorId,
  zonaPorId,
  onEditar,
}: {
  u: UsuarioAdmin
  yo: boolean
  rolPorId: Map<number, RolUsuario>
  zonaPorId: Map<string, string>
  onEditar: () => void
}) {
  const susRoles = [u.rol_id, ...(u.roles_ids ?? []).filter((id) => id !== u.rol_id)]
    .map((id) => rolPorId.get(id))
    .filter(Boolean) as RolUsuario[]
  const zonasTexto = u.todas_las_zonas ? ['Todas las zonas'] : (u.zonas ?? []).map((z) => zonaPorId.get(z) ?? '?')
  const color = u.activo ? COLORES_AVATAR[[...u.nombre].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORES_AVATAR.length] : 'bg-slate-100 text-slate-400'
  return (
    <li>
      <button
        type="button"
        onClick={onEditar}
        data-usuario={u.email}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none ${u.activo ? '' : 'opacity-70'}`}
      >
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${color}`}>
          {u.nombre
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((p) => p[0])
            .join('')
            .toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-bold text-slate-900">{u.nombre}</span>
            {yo && <Insignia tono="verde">Tú</Insignia>}
          </span>
          <span className="block truncate text-xs text-slate-400">{u.email}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5" data-roles-usuario>
            {susRoles.map((r) => (
              <Insignia key={r.id} tono={r.acceso_total ? 'violeta' : r.solo_lectura ? 'gris' : r.id === u.rol_id ? 'azul' : 'verde'}>
                {r.nombre}
              </Insignia>
            ))}
            {zonasTexto.length === 0 ? (
              <Insignia tono="ambar">Sin zona</Insignia>
            ) : (
              <Insignia tono="gris">
                {zonasTexto.slice(0, 2).join(', ')}
                {zonasTexto.length > 2 ? ` +${zonasTexto.length - 2}` : ''}
              </Insignia>
            )}
            {(u.estaciones?.length ?? 0) > 0 && <Insignia tono="gris">{u.estaciones!.length} estación(es)</Insignia>}
            {u.departamento && <Insignia tono="gris">{u.departamento}</Insignia>}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {u.bloqueado ? (
            <Insignia tono="rojo" punto>
              Bloqueado
            </Insignia>
          ) : u.activo ? (
            <Insignia tono="verde" punto>
              Activo
            </Insignia>
          ) : (
            <Insignia tono="gris" punto>
              Inactivo
            </Insignia>
          )}
          <IconPencil className="h-4 w-4 text-slate-300" />
        </span>
      </button>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Ficha de alta / edición                                             */
/* ------------------------------------------------------------------ */

function ModalUsuario({
  usuario,
  esYo = false,
  onCerrar,
  onGuardado,
  roles,
  departamentos,
  zonas,
  estaciones,
  pantallas,
  acciones,
  puedeAsignarEstaciones,
  delegado,
}: {
  delegado: boolean
  usuario?: UsuarioAdmin
  esYo?: boolean
  onCerrar: () => void
  onGuardado: () => void
  roles: RolUsuario[]
  departamentos: { id: string; nombre: string }[]
  zonas: { id: string; nombre: string }[]
  estaciones: Estacion[]
  pantallas: PantallaFicha[]
  acciones: { codigo: string; nombre: string }[]
  puedeAsignarEstaciones: boolean
}) {
  const esEdicion = Boolean(usuario)
  const [form, setForm] = useState({
    nombre: usuario?.nombre ?? '',
    email: usuario?.email ?? '',
    password: '',
    roles: usuario ? (usuario.roles_ids ?? [usuario.rol_id]) : ([] as number[]),
    principal: usuario?.rol_id ?? 0,
    departamento: usuario?.departamento ?? '',
    whatsapp: usuario?.whatsapp ?? '',
    todasLasZonas: delegado ? false : (usuario?.todas_las_zonas ?? false),
    zonas: usuario?.zonas ?? [],
    estaciones: usuario?.estaciones ?? [],
    activo: usuario?.activo ?? true,
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verPermisos, setVerPermisos] = useState(false)
  const [verHistorial, setVerHistorial] = useState(false)

  const nombreZona = new Map(zonas.map((z) => [z.id, z.nombre]))

  function alternarRol(id: number) {
    const tiene = form.roles.includes(id)
    const lista = tiene ? form.roles.filter((r) => r !== id) : [...form.roles, id]
    const principal = lista.includes(form.principal) ? form.principal : (lista[0] ?? 0)
    setForm({ ...form, roles: lista, principal })
  }

  async function guardar() {
    const faltantes: string[] = []
    if (!form.nombre.trim()) faltantes.push('Nombre completo')
    if (!esEdicion && !form.email.trim()) faltantes.push('Correo')
    if (!esEdicion && !form.password.trim()) faltantes.push('Contraseña')
    if (form.roles.length === 0) faltantes.push('Al menos un rol')
    if (faltantes.length > 0) return setError(`Falta completar: ${faltantes.join(', ')}.`)
    if (!esEdicion && form.password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.')

    setError(null)
    setGuardando(true)

    const comunes = {
      nombre: form.nombre,
      roles: form.roles,
      rol_id: form.principal,
      departamento: form.departamento,
      whatsapp: form.whatsapp,
      todas_las_zonas: form.todasLasZonas,
      zonas: form.todasLasZonas ? [] : form.zonas,
    }
    const res = await fetch(esEdicion ? `/api/usuarios/${usuario!.id}` : '/api/usuarios', {
      method: esEdicion ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        esEdicion
          ? { ...comunes, activo: form.activo, ...(form.password ? { password: form.password } : {}) }
          : { ...comunes, email: form.email, password: form.password }
      ),
    })
    const data = await res.json()
    if (!res.ok) {
      setGuardando(false)
      return setError(data.error ?? 'No se pudo guardar.')
    }

    // Estaciones: con la regla de la base (solo las de su alcance; no se quita a quien la tiene a cargo)
    const perfilId = (esEdicion ? usuario!.id : data.id) as string
    if (puedeAsignarEstaciones && perfilId) {
      const antes = new Set(usuario?.estaciones ?? [])
      const despues = new Set(form.estaciones)
      const supabase = createClient()
      const fallas: string[] = []
      for (const id of [...despues].filter((e) => !antes.has(e))) {
        const { error: e } = await supabase.rpc('fn_fert_asignar_persona', { p_estacion: id, p_perfil: perfilId, p_asignar: true })
        if (e) fallas.push(`${estaciones.find((x) => x.id === id)?.nombre}: ${mensajeDeError(e, 'no se pudo asignar')}`)
      }
      for (const id of [...antes].filter((e) => !despues.has(e))) {
        const { error: e } = await supabase.rpc('fn_fert_asignar_persona', { p_estacion: id, p_perfil: perfilId, p_asignar: false })
        if (e) fallas.push(`${estaciones.find((x) => x.id === id)?.nombre}: ${mensajeDeError(e, 'no se pudo quitar')}`)
      }
      if (fallas.length) {
        setGuardando(false)
        onGuardado()
        return setError(`Se guardó la persona, pero no las estaciones: ${fallas.join(' · ')}`)
      }
    }

    setGuardando(false)
    onGuardado()
    onCerrar()
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      ancho="ancho"
      titulo={esEdicion ? 'Editar usuario' : 'Nuevo usuario'}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={guardar} disabled={guardando} data-guardar-usuario>
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear usuario'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre completo" requerido>
            <Entrada
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              placeholder="Fernando Lazo"
              autoFocus
            />
          </Campo>
          <Campo
            etiqueta="Correo"
            requerido={!esEdicion}
            ayuda={esEdicion ? 'El correo no se puede cambiar desde aquí.' : undefined}
          >
            <Entrada
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              disabled={esEdicion}
              placeholder="flazo@agrolibano.com"
            />
          </Campo>
        </div>

        <Campo
          etiqueta={esEdicion ? 'Nueva contraseña' : 'Contraseña'}
          requerido={!esEdicion}
          ayuda={esEdicion ? 'Déjala vacía para no cambiarla. Mínimo 8 caracteres.' : 'Mínimo 8 caracteres. Compártela con el usuario.'}
        >
          <Entrada
            type="text"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={esEdicion ? '••••••••' : ''}
          />
        </Campo>

        {/* --------------------------- Roles --------------------------- */}
        <Campo
          etiqueta="Roles"
          requerido
          ayuda="Puede tener varios: se suma lo que da cada uno. El principal decide su barra del teléfono."
        >
          <div className="divide-y divide-slate-100 rounded-xl ring-1 ring-inset ring-slate-200" data-lista="roles">
            {roles.map((r) => {
              const marcado = form.roles.includes(r.id)
              const principal = marcado && form.principal === r.id
              return (
                <div key={r.id} className={`flex items-center gap-2 px-3 py-2 ${marcado ? 'bg-brand-50' : ''}`}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={marcado}
                    data-rol-opcion={r.codigo}
                    onClick={() => alternarRol(r.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        marcado ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {marcado && <IconCheck className="h-3 w-3" />}
                    </span>
                    <span className="truncate text-sm text-slate-700">{r.nombre}</span>
                    {r.acceso_total && <Insignia tono="violeta">Acceso total</Insignia>}
                    {r.solo_lectura && <Insignia tono="gris">Solo lectura</Insignia>}
                  </button>
                  {marcado && (
                    <button
                      type="button"
                      aria-pressed={principal}
                      data-principal={r.codigo}
                      onClick={() => setForm({ ...form, principal: r.id })}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${
                        principal ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-500 ring-slate-200'
                      }`}
                    >
                      {principal ? 'Principal' : 'Hacer principal'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Departamento">
            <Selector value={form.departamento} onChange={(e) => setForm({ ...form, departamento: e.target.value })}>
              <option value="">Sin departamento</option>
              {departamentos.map((d) => (
                <option key={d.id} value={d.nombre}>
                  {d.nombre}
                </option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="WhatsApp">
            <Entrada
              value={form.whatsapp}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              placeholder="+504 9999-9999"
            />
          </Campo>
        </div>

        {/* --------------------------- Zonas --------------------------- */}
        <Campo
          etiqueta="Zonas"
          ayudaVisible
          ayuda={
            form.todasLasZonas
              ? 'Ve los datos de todas las zonas (gerentes, Torre de Control).'
              : form.zonas.length === 0
                ? 'Sin zonas marcadas NO verá datos de ninguna zona.'
                : `Verá datos de: ${form.zonas.map((z) => nombreZona.get(z) ?? '?').join(', ')}.`
          }
        >
          <div className="flex flex-col gap-2">
            {delegado ? (
              <p className="text-xs text-slate-500" data-delegado>
                Puedes asignar solo tus zonas y los roles que administra tu rol.
              </p>
            ) : (
            <button
              type="button"
              role="switch"
              aria-checked={form.todasLasZonas}
              data-todas-las-zonas
              onClick={() => setForm({ ...form, todasLasZonas: !form.todasLasZonas })}
              className="flex w-fit items-center gap-2 text-sm font-semibold text-slate-700"
            >
              <span className={`relative h-5 w-9 rounded-full transition-colors ${form.todasLasZonas ? 'bg-brand-700' : 'bg-slate-300'}`}>
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${form.todasLasZonas ? 'left-4.5' : 'left-0.5'}`}
                />
              </span>
              Todas las zonas
            </button>
            )}
            {!form.todasLasZonas && (
              <ListaCasillasBuscable
                nombre="zonas"
                opciones={zonas.map((z) => ({ valor: z.id, etiqueta: z.nombre }))}
                marcados={form.zonas}
                onCambiar={(v) => setForm({ ...form, zonas: v })}
                vacio="No hay zonas en el catálogo."
              />
            )}
          </div>
        </Campo>

        {/* ------------------------- Estaciones ------------------------ */}
        {puedeAsignarEstaciones && estaciones.length > 0 && (
          <Campo
            etiqueta="Estaciones de riego (Fertirriego)"
            ayuda="Las estaciones donde trabaja: ahí podrá recibir, aplicar y hacer relevos según sus roles."
          >
            <ListaCasillasBuscable
              nombre="estaciones"
              opciones={estaciones.map((e) => ({
                valor: e.id,
                etiqueta: e.nombre,
                detalle: e.zona_id ? nombreZona.get(e.zona_id) : null,
              }))}
              marcados={form.estaciones}
              onCambiar={(v) => setForm({ ...form, estaciones: v })}
            />
          </Campo>
        )}

        {esEdicion && (
          <Campo
            etiqueta="Estado de la cuenta"
            ayuda={esYo ? 'No puedes desactivar tu propia cuenta.' : 'Al desactivar, el usuario deja de poder iniciar sesión de inmediato.'}
          >
            <div className="grid grid-cols-2 gap-2">
              {[
                { valor: true, etiqueta: 'Activo', color: 'bg-brand-500' },
                { valor: false, etiqueta: 'Inactivo', color: 'bg-red-500' },
              ].map((op) => (
                <button
                  key={String(op.valor)}
                  type="button"
                  disabled={esYo}
                  onClick={() => setForm({ ...form, activo: op.valor })}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition-all disabled:opacity-40 ${
                    form.activo === op.valor
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${op.color}`} />
                  {op.etiqueta}
                </button>
              ))}
            </div>
          </Campo>
        )}

        {/* ----------------------- Qué puede hacer --------------------- */}
        {esEdicion && (
          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <button
              type="button"
              aria-expanded={verPermisos}
              data-ver-permisos
              onClick={() => setVerPermisos((v) => !v)}
              className="text-sm font-bold text-slate-800"
            >
              {verPermisos ? '▾' : '▸'} Qué puede hacer (lo guardado)
            </button>
            {verPermisos && (
              <div className="mt-2">
                <FichaPermisosPersona perfilId={usuario!.id} pantallas={pantallas} acciones={acciones} />
              </div>
            )}
          </div>
        )}

        {/* --------------------- Historial de accesos ------------------- */}
        {esEdicion && (
          <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <button
              type="button"
              aria-expanded={verHistorial}
              data-ver-historial
              onClick={() => setVerHistorial((v) => !v)}
              className="text-sm font-bold text-slate-800"
            >
              {verHistorial ? '▾' : '▸'} Historial de sus accesos
            </button>
            {verHistorial && (
              <div className="mt-2">
                <HistorialAccesos perfilId={usuario!.id} />
              </div>
            )}
          </div>
        )}

        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}
