'use client'

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
import type { Rol } from '@/lib/types'
import { mensajeDeError } from '@/lib/errores'

type UsuarioAdmin = {
  id: string
  nombre: string
  email: string
  rol_id: number
  departamento: string | null
  whatsapp: string | null
  activo: boolean
  bloqueado: boolean
  roles?: Rol | Rol[] | null
  /**
   * Zonas a las que se le recortan los datos. VACÍO significa SIN
   * RESTRICCIÓN —ve todas—, no «no ve ninguna»: asignar zonas es
   * restringir, y lo contrario habría dejado a todo el mundo sin datos el
   * día que se instaló.
   */
  zonas?: string[]
}

const TONO_ROL: Record<number, 'violeta' | 'azul' | 'gris'> = {
  1: 'violeta',
  2: 'azul',
  3: 'gris',
}

export function GestionUsuarios({
  roles,
  departamentos,
  zonas,
  miId,
}: {
  roles: Rol[]
  departamentos: { id: string; nombre: string }[]
  zonas: { id: string; nombre: string }[]
  miId: string
}) {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<UsuarioAdmin | null>(null)

  // La llamada a la API se aísla en una función pura (sin setState) para
  // poder reutilizarla desde el efecto y desde los callbacks sin que el
  // linter la marque como render en cascada.
  async function obtenerUsuarios(): Promise<UsuarioAdmin[]> {
    const res = await fetch('/api/usuarios')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'No se pudieron cargar los usuarios.')
    return data.usuarios as UsuarioAdmin[]
  }

  async function cargar() {
    try {
      const lista = await obtenerUsuarios()
      setUsuarios(lista)
      setError(null)
    } catch (e) {
      setError(mensajeDeError(e, 'Error inesperado.'))
      setUsuarios([])
    }
  }

  useEffect(() => {
    let vivo = true

    async function cargarInicial() {
      try {
        const lista = await obtenerUsuarios()
        if (!vivo) return
        setUsuarios(lista)
        setError(null)
      } catch (e) {
        if (!vivo) return
        setError(mensajeDeError(e, 'Error inesperado.'))
        setUsuarios([])
      }
    }

    cargarInicial()
    return () => {
      vivo = false
    }
  }, [])

  const filtrados = (usuarios ?? []).filter((u) => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return true
    return (
      u.nombre.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.departamento ?? '').toLowerCase().includes(q)
    )
  })

  function nombreRol(u: UsuarioAdmin) {
    const r = Array.isArray(u.roles) ? u.roles[0] : u.roles
    return r?.nombre ?? roles.find((x) => x.id === u.rol_id)?.nombre ?? '—'
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, correo o departamento…"
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
          {filtrados.map((u) => (
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
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Insignia tono={TONO_ROL[u.rol_id] ?? 'gris'}>{nombreRol(u)}</Insignia>
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
          ))}
        </div>
      )}

      {/* key fuerza a remontar el formulario en cada apertura: así nunca
          quedan datos de una captura anterior. */}
      {creando && (
        <ModalUsuario
          key="nuevo"
          abierto
          onCerrar={() => setCreando(false)}
          onGuardado={cargar}
          roles={roles}
          departamentos={departamentos}
          zonas={zonas}
        />
      )}

      {editando && (
        <ModalUsuario
          key={editando.id}
          abierto
          usuario={editando}
          esYo={editando.id === miId}
          onCerrar={() => setEditando(null)}
          onGuardado={cargar}
          roles={roles}
          departamentos={departamentos}
          zonas={zonas}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Modal de alta / edición                                             */
/* ------------------------------------------------------------------ */

function ModalUsuario({
  abierto,
  usuario,
  esYo = false,
  onCerrar,
  onGuardado,
  roles,
  departamentos,
  zonas,
}: {
  abierto: boolean
  usuario?: UsuarioAdmin
  esYo?: boolean
  onCerrar: () => void
  onGuardado: () => void
  roles: Rol[]
  departamentos: { id: string; nombre: string }[]
  zonas: { id: string; nombre: string }[]
}) {
  const esEdicion = Boolean(usuario)
  const [form, setForm] = useState({
    nombre: usuario?.nombre ?? '',
    email: usuario?.email ?? '',
    password: '',
    rol_id: String(usuario?.rol_id ?? 3),
    departamento: usuario?.departamento ?? '',
    whatsapp: usuario?.whatsapp ?? '',
    zonas: usuario?.zonas ?? [],
    activo: usuario?.activo ?? true,
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    // Se valida aquí y se nombra el campo exacto que falta: antes el
    // mensaje era genérico y no se veía cuál faltaba si el modal estaba
    // desplazado.
    const faltantes: string[] = []
    if (!form.nombre.trim()) faltantes.push('Nombre completo')
    if (!esEdicion && !form.email.trim()) faltantes.push('Correo')
    if (!esEdicion && !form.password.trim()) faltantes.push('Contraseña')
    if (!form.rol_id) faltantes.push('Rol')

    if (faltantes.length > 0) {
      setError(`Falta completar: ${faltantes.join(', ')}.`)
      return
    }
    if (!esEdicion && form.password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }

    setError(null)
    setGuardando(true)

    const url = esEdicion ? `/api/usuarios/${usuario!.id}` : '/api/usuarios'
    const payload = esEdicion
      ? {
          nombre: form.nombre,
          rol_id: Number(form.rol_id),
          departamento: form.departamento,
          whatsapp: form.whatsapp,
          activo: form.activo,
          zonas: form.zonas,
          ...(form.password ? { password: form.password } : {}),
        }
      : {
          email: form.email,
          password: form.password,
          nombre: form.nombre,
          rol_id: Number(form.rol_id),
          departamento: form.departamento,
          whatsapp: form.whatsapp,
          zonas: form.zonas,
        }

    const res = await fetch(url, {
      method: esEdicion ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()

    setGuardando(false)
    if (!res.ok) return setError(data.error ?? 'No se pudo guardar.')

    onGuardado()
    onCerrar()
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={esEdicion ? 'Editar usuario' : 'Nuevo usuario'}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear usuario'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
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

        <Campo
          etiqueta={esEdicion ? 'Nueva contraseña' : 'Contraseña'}
          requerido={!esEdicion}
          ayuda={
            esEdicion
              ? 'Déjala vacía para no cambiarla. Mínimo 8 caracteres.'
              : 'Mínimo 8 caracteres. Compártela con el usuario.'
          }
        >
          <Entrada
            type="text"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={esEdicion ? '••••••••' : ''}
          />
        </Campo>

        <Campo etiqueta="Rol" requerido>
          <Selector
            value={form.rol_id}
            onChange={(e) => setForm({ ...form, rol_id: e.target.value })}
            disabled={esYo}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
              </option>
            ))}
          </Selector>
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Departamento">
            <Selector
              value={form.departamento}
              onChange={(e) => setForm({ ...form, departamento: e.target.value })}
            >
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

        {/* ------------------------- Zonas -------------------------- */}
        {/* Sin ninguna marcada NO se restringe: ve toda la finca. Se dice
            con todas las letras porque lo natural es leer una lista vacía
            como «no ve nada», y aquí es lo contrario. */}
        <Campo
          etiqueta="Zonas asignadas"
          ayuda={
            form.zonas.length === 0
              ? 'Sin ninguna marcada ve TODAS las zonas. Marca alguna sólo si quieres restringirlo.'
              : `Sólo verá datos de ${form.zonas.length} zona(s): lotes, labores, riego, siembra y reportes.`
          }
        >
          <div className="flex flex-col gap-1.5">
            <div className="max-h-44 overflow-y-auto rounded-xl ring-1 ring-inset ring-slate-200">
              {zonas.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-400">
                  No hay zonas en el catálogo.
                </p>
              ) : (
                zonas.map((z, i) => {
                  const marcada = form.zonas.includes(z.id)
                  return (
                    <button
                      key={z.id}
                      type="button"
                      role="checkbox"
                      aria-checked={marcada}
                      onClick={() =>
                        setForm({
                          ...form,
                          zonas: marcada
                            ? form.zonas.filter((x) => x !== z.id)
                            : [...form.zonas, z.id],
                        })
                      }
                      className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                        i > 0 ? 'border-t border-slate-100' : ''
                      } ${marcada ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          marcada
                            ? 'border-brand-700 bg-brand-700 text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {marcada && <IconCheck className="h-3 w-3" />}
                      </span>
                      <span className="truncate text-sm text-slate-700">{z.nombre}</span>
                    </button>
                  )
                })
              )}
            </div>

            {form.zonas.length > 0 && (
              <button
                type="button"
                onClick={() => setForm({ ...form, zonas: [] })}
                className="w-fit rounded-lg px-1 py-0.5 text-xs font-semibold text-slate-400 transition-colors hover:text-slate-900"
              >
                Limpiar · vuelve a ver todas
              </button>
            )}
          </div>
        </Campo>

        {esEdicion && (
          <Campo
            etiqueta="Estado de la cuenta"
            ayuda={
              esYo
                ? 'No puedes desactivar tu propia cuenta.'
                : 'Al desactivar, el usuario deja de poder iniciar sesión de inmediato.'
            }
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

        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}
