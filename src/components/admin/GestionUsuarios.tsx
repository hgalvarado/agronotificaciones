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

import { useEffect, useState } from 'react'
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

type RolUsuario = {
  id: number
  codigo: string
  nombre: string
  acceso_total?: boolean | null
  solo_lectura?: boolean | null
}

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
  miId,
}: {
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

  const nombreRol = new Map(roles.map((r) => [r.id, r]))
  const filtrados = (usuarios ?? []).filter((u) => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return true
    const susRoles = (u.roles_ids ?? [u.rol_id]).map((id) => nombreRol.get(id)?.nombre ?? '').join(' ')
    return [u.nombre, u.email, u.departamento ?? '', susRoles].some((t) => t.toLowerCase().includes(q))
  })

  const comun = { roles, departamentos, zonas, estaciones, pantallas, acciones, puedeAsignarEstaciones }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, correo, departamento o rol…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>
        <Boton tamano="sm" onClick={() => setCreando(true)}>
          <IconPlus className="h-4 w-4" />
          Nuevo
        </Boton>
      </div>

      {error && <Alerta>{error}</Alerta>}

      {usuarios === null ? (
        <ListaEsqueleto filas={4} />
      ) : filtrados.length === 0 ? (
        <Tarjeta>
          <EstadoVacio
            icono={<IconUser />}
            titulo={busqueda ? 'Sin resultados' : 'Sin usuarios'}
            descripcion={busqueda ? 'Prueba con otra búsqueda.' : 'Crea el primer usuario.'}
          />
        </Tarjeta>
      ) : (
        <div className="flex flex-col gap-2">
          {filtrados.map((u) => {
            const susRoles = (u.roles_ids ?? [u.rol_id])
              .map((id) => nombreRol.get(id))
              .filter(Boolean) as RolUsuario[]
            return (
              <Tarjeta key={u.id} className="flex items-center gap-3 p-4">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    u.activo ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {u.nombre
                    .split(' ')
                    .slice(0, 2)
                    .map((p) => p[0])
                    .join('')
                    .toUpperCase()}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-bold text-slate-900">{u.nombre}</p>
                    {u.id === miId && <Insignia tono="verde">Tú</Insignia>}
                  </div>
                  <p className="truncate text-xs text-slate-400">{u.email}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-roles-usuario>
                    {susRoles.map((r) => (
                      <Insignia
                        key={r.id}
                        tono={r.acceso_total ? 'violeta' : r.solo_lectura ? 'gris' : r.id === u.rol_id ? 'azul' : 'verde'}
                      >
                        {r.nombre}
                      </Insignia>
                    ))}
                    <Insignia tono="gris">
                      {u.todas_las_zonas ? 'Todas las zonas' : `${u.zonas?.length ?? 0} zona(s)`}
                    </Insignia>
                    {(u.estaciones?.length ?? 0) > 0 && (
                      <Insignia tono="gris">{u.estaciones!.length} estación(es)</Insignia>
                    )}
                    {u.departamento && <Insignia tono="gris">{u.departamento}</Insignia>}
                    {!u.activo && <Insignia tono="rojo">Inactivo</Insignia>}
                  </div>
                </div>

                <button
                  onClick={() => setEditando(u)}
                  className="shrink-0 rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                  aria-label={`Editar ${u.nombre}`}
                >
                  <IconPencil className="h-4 w-4" />
                </button>
              </Tarjeta>
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
}: {
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
    todasLasZonas: usuario?.todas_las_zonas ?? false,
    zonas: usuario?.zonas ?? [],
    estaciones: usuario?.estaciones ?? [],
    activo: usuario?.activo ?? true,
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verPermisos, setVerPermisos] = useState(false)

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

        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}
