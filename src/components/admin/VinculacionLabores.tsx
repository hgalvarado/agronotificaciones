'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import {
  Alerta,
  Boton,
  Campo,
  Entrada,
  EstadoVacio,
  Insignia,
  Selector,
  Tarjeta,
} from '@/components/ui/Primitivos'
import { IconCheck, IconGauge, IconPlus, IconSearch } from '@/components/ui/Icons'
import type { CategoriaLabor, Implemento, TareaSap } from '@/lib/types'
import { mensajeDeError } from '@/lib/errores'

export type LaborVinculada = {
  id: string
  nombre: string
  categoria_labor_id: string | null
  activo: boolean
  /** Llegan con la migración 15. Ver `soportaProveedores`. */
  usa_proveedor_plastico?: boolean | null
  usa_proveedor_manguera?: boolean | null
  labores_tareas: { tarea_id: string }[]
  /** Códigos físicos vinculados. Llegan con la migración 19. */
  labores_implementos_fisicos?: { implemento_fisico_id: string }[]
}

export type ImplementoFisicoOpcion = {
  id: string
  codigo: string
  descripcion: string
  /** Tipo SAP del que cuelga. De aquí sale la tarifa al capturar. */
  implemento_id?: string | null
}

const LABOR_NUEVA: LaborVinculada = {
  id: '',
  nombre: '',
  categoria_labor_id: null,
  activo: true,
  usa_proveedor_plastico: false,
  usa_proveedor_manguera: false,
  labores_tareas: [],
  labores_implementos_fisicos: [],
}

export function VinculacionLabores({
  labores,
  categorias,
  tareasSap,
  implementos,
  implementosFisicos = [],
  soportaProveedores = false,
}: {
  labores: LaborVinculada[]
  categorias: CategoriaLabor[]
  tareasSap: TareaSap[]
  implementos: Implemento[]
  /** Catálogo de máquinas concretas: ROMSR-01, ROMSR-08… */
  implementosFisicos?: ImplementoFisicoOpcion[]
  /**
   * Si la base ya tiene las columnas de la migración 15. Se comprueba en
   * el servidor con una consulta de prueba y no adivinando: mandar una
   * columna que no existe hace fallar el guardado completo, y esconder
   * los interruptores cuando sí existen lo dejaría sin poder decir qué
   * labor pide proveedor.
   */
  soportaProveedores?: boolean
}) {
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState<LaborVinculada | null>(null)

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return labores
    return labores.filter((l) => l.nombre.toLowerCase().includes(q))
  }, [labores, busqueda])

  const sinConfigurar = labores.filter((l) => l.labores_tareas.length === 0).length

  return (
    <div className="flex flex-col gap-4">
      {sinConfigurar > 0 && (
        <Alerta tono="ambar">
          Hay <strong>{sinConfigurar}</strong>{' '}
          {sinConfigurar === 1 ? 'labor sin tarea SAP asociada' : 'labores sin tarea SAP asociada'}.
          Mientras no tengan al menos una, no se pueden registrar en campo.
        </Alerta>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar labor…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>
        <Boton tamano="sm" onClick={() => setEditando(LABOR_NUEVA)}>
          <IconPlus className="h-4 w-4" />
          Nueva labor
        </Boton>
      </div>

      {filtradas.length === 0 ? (
        <Tarjeta>
          <EstadoVacio
            icono={<IconGauge />}
            titulo={busqueda ? 'Sin resultados' : 'Sin labores'}
            descripcion={
              busqueda
                ? 'Prueba con otro nombre.'
                : 'Crea la primera labor con el botón de arriba: nombre, categoría, tareas SAP y códigos físicos, todo de una vez.'
            }
          />
        </Tarjeta>
      ) : (
        <div className="flex flex-col gap-2">
          {filtradas.map((labor) => {
            const categoria = categorias.find((c) => c.id === labor.categoria_labor_id)
            const nTareas = labor.labores_tareas.length
            const nCodigos = labor.labores_implementos_fisicos?.length ?? 0

            return (
              <button
                key={labor.id}
                onClick={() => setEditando(labor)}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-[var(--shadow-card)] transition-all hover:border-slate-300"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-slate-900">{labor.nombre}</p>
                    {!labor.activo && <Insignia tono="gris">Inactiva</Insignia>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Insignia tono={categoria ? 'violeta' : 'ambar'}>
                      {categoria?.nombre ?? 'Sin categoría'}
                    </Insignia>
                    <Insignia tono={nTareas > 0 ? 'verde' : 'rojo'}>
                      {nTareas} {nTareas === 1 ? 'tarea SAP' : 'tareas SAP'}
                    </Insignia>
                    <Insignia tono={nCodigos > 0 ? 'azul' : 'gris'}>
                      {nCodigos} {nCodigos === 1 ? 'código físico' : 'códigos físicos'}
                    </Insignia>
                    {labor.usa_proveedor_plastico && <Insignia tono="ambar">Plástico</Insignia>}
                    {labor.usa_proveedor_manguera && <Insignia tono="ambar">Manguera</Insignia>}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold text-brand-700">Configurar</span>
              </button>
            )
          })}
        </div>
      )}

      {editando && (
        <ModalVinculacion
          labor={editando}
          categorias={categorias}
          tareasSap={tareasSap}
          implementos={implementos}
          implementosFisicos={implementosFisicos}
          soportaProveedores={soportaProveedores}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Modal: categoría, tareas SAP y códigos físicos de implemento        */
/* ------------------------------------------------------------------ */

function ModalVinculacion({
  labor,
  categorias,
  tareasSap,
  implementos,
  implementosFisicos,
  soportaProveedores,
  onCerrar,
}: {
  labor: LaborVinculada
  categorias: CategoriaLabor[]
  tareasSap: TareaSap[]
  implementos: Implemento[]
  implementosFisicos: ImplementoFisicoOpcion[]
  soportaProveedores: boolean
  onCerrar: () => void
}) {
  const supabase = createClient()
  const router = useRouter()
  const esNueva = labor.id === ''

  const tareasIniciales = useMemo(
    () => new Set(labor.labores_tareas.map((t) => t.tarea_id)),
    [labor]
  )
  const fisicosIniciales = useMemo(
    () => new Set((labor.labores_implementos_fisicos ?? []).map((i) => i.implemento_fisico_id)),
    [labor]
  )

  const [nombre, setNombre] = useState(labor.nombre)
  const [activo, setActivo] = useState(labor.activo)
  const [categoriaId, setCategoriaId] = useState(labor.categoria_labor_id ?? '')
  const [pidePlastico, setPidePlastico] = useState(Boolean(labor.usa_proveedor_plastico))
  const [pideManguera, setPideManguera] = useState(Boolean(labor.usa_proveedor_manguera))
  const [tareas, setTareas] = useState<Set<string>>(new Set(tareasIniciales))
  const [fisicos, setFisicos] = useState<Set<string>>(new Set(fisicosIniciales))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function alternar(set: Set<string>, aplicar: (s: Set<string>) => void, id: string) {
    const copia = new Set(set)
    if (copia.has(id)) copia.delete(id)
    else copia.add(id)
    aplicar(copia)
  }

  async function guardar() {
    if (!nombre.trim()) return setError('El nombre de la labor es obligatorio.')

    setError(null)
    setGuardando(true)

    try {
      // ---------- Alta: la labor y sus vínculos se crean de una sola vez ----------
      if (esNueva) {
        const { data: creada, error: e } = await supabase
          .from('labores')
          .insert({
            nombre: nombre.trim(),
            categoria_labor_id: categoriaId || null,
            activo,
            // Sólo si la base las tiene: mandar una columna que no
            // existe hace fallar el insert completo.
            ...(soportaProveedores
              ? {
                  usa_proveedor_plastico: pidePlastico,
                  usa_proveedor_manguera: pideManguera,
                }
              : {}),
          })
          .select('id')
          .single()
        if (e) throw e

        if (tareas.size > 0) {
          const { error: e2 } = await supabase
            .from('labores_tareas')
            .insert([...tareas].map((tarea_id) => ({ labor_id: creada.id, tarea_id })))
          if (e2) throw e2
        }
        if (fisicos.size > 0) {
          const { error: e4 } = await supabase
            .from('labores_implementos_fisicos')
            .insert(
              [...fisicos].map((implemento_fisico_id) => ({
                labor_id: creada.id,
                implemento_fisico_id,
              }))
            )
          if (e4) throw e4
        }

        setGuardando(false)
        onCerrar()
        router.refresh()
        return
      }

      // ---------- Edición: sólo se tocan las filas que cambiaron ----------
      const tareasAgregar = [...tareas].filter((id) => !tareasIniciales.has(id))
      const tareasQuitar = [...tareasIniciales].filter((id) => !tareas.has(id))
      const fisAgregar = [...fisicos].filter((id) => !fisicosIniciales.has(id))
      const fisQuitar = [...fisicosIniciales].filter((id) => !fisicos.has(id))

      const cambioProveedores =
        soportaProveedores &&
        (pidePlastico !== Boolean(labor.usa_proveedor_plastico) ||
          pideManguera !== Boolean(labor.usa_proveedor_manguera))

      const cambioCabecera =
        nombre.trim() !== labor.nombre ||
        activo !== labor.activo ||
        categoriaId !== (labor.categoria_labor_id ?? '') ||
        cambioProveedores

      if (cambioCabecera) {
        const { error: e } = await supabase
          .from('labores')
          .update({
            nombre: nombre.trim(),
            activo,
            categoria_labor_id: categoriaId || null,
            ...(soportaProveedores
              ? {
                  usa_proveedor_plastico: pidePlastico,
                  usa_proveedor_manguera: pideManguera,
                }
              : {}),
          })
          .eq('id', labor.id)
        if (e) throw e
      }

      if (tareasAgregar.length > 0) {
        const { error: e } = await supabase
          .from('labores_tareas')
          .insert(tareasAgregar.map((tarea_id) => ({ labor_id: labor.id, tarea_id })))
        if (e) throw e
      }
      if (tareasQuitar.length > 0) {
        const { error: e } = await supabase
          .from('labores_tareas')
          .delete()
          .eq('labor_id', labor.id)
          .in('tarea_id', tareasQuitar)
        if (e) throw e
      }
      if (fisAgregar.length > 0) {
        const { error: e } = await supabase
          .from('labores_implementos_fisicos')
          .insert(
            fisAgregar.map((implemento_fisico_id) => ({
              labor_id: labor.id,
              implemento_fisico_id,
            }))
          )
        if (e) throw e
      }
      if (fisQuitar.length > 0) {
        const { error: e } = await supabase
          .from('labores_implementos_fisicos')
          .delete()
          .eq('labor_id', labor.id)
          .in('implemento_fisico_id', fisQuitar)
        if (e) throw e
      }

      setGuardando(false)
      onCerrar()
      router.refresh()
    } catch (e) {
      setGuardando(false)
      setError(mensajeDeError(e, 'No se pudo guardar la labor.'))
    }
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={esNueva ? 'Nueva labor' : labor.nombre}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : esNueva ? 'Crear labor' : 'Guardar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Campo etiqueta="Nombre de la labor" requerido>
          <Entrada
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej. Romplonear"
            autoFocus={esNueva}
          />
        </Campo>

        <Campo
          etiqueta="Categoría de labor"
          ayuda="Define en qué grupo aparece la labor en el dashboard de avance."
        >
          <Selector value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">Sin categoría</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Selector>
        </Campo>

        <ListaSeleccion
          titulo="Tareas SAP donde se puede liquidar"
          ayuda="Al registrar esta labor en campo, sólo aparecerán estas tareas. Debe tener al menos una."
          vacio="No hay tareas SAP en el catálogo."
          seleccionados={tareas}
          items={tareasSap.map((t) => ({
            id: t.id,
            titulo: `${t.codigo} — ${t.nombre}`,
            subtitulo: t.ejecucion ?? undefined,
          }))}
          onToggle={(id) => alternar(tareas, setTareas, id)}
        />

        {/* «cada codigo de implemento se asignara por las labores, en la
            pestaña vinculacion de labores». Con esto la captura ofrece
            sólo los fierros de la labor —ROMSR-01, ROMSR-08— y no los 94
            del catálogo, que es lo que hacía que se eligiera el
            equivocado. */}
        {implementosFisicos.length > 0 && (
          <ListaSeleccion
            titulo="Códigos físicos de implemento"
            ayuda="La máquina concreta que puede hacer esta labor. Al capturarla, el digitador elige el código y el implemento SAP —con su tarifa— se completa solo. Los marcados «sin tipo» no traen tarifa: empárejalos en Catálogos → Implementos."
            vacio="No hay códigos físicos en el catálogo."
            buscable
            seleccionados={fisicos}
            items={implementosFisicos.map((i) => ({
              id: i.id,
              titulo: i.codigo,
              subtitulo: `${i.descripcion} · ${
                implementos.find((t) => t.id === i.implemento_id)?.nombre ?? 'sin tipo'
              }`,
            }))}
            onToggle={(id) => alternar(fisicos, setFisicos, id)}
          />
        )}

        {soportaProveedores && (
          <Campo
            etiqueta="¿Esta labor pide proveedor?"
            ayuda="Al capturarla en campo, el digitador tendrá que decir de qué proveedor salió el material de cada área. Déjalo apagado en las labores donde no aplica —arado, rastreo— para no estorbarle la pantalla."
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <InterruptorProveedor
                titulo="Proveedor de plástico"
                activo={pidePlastico}
                onCambiar={() => setPidePlastico((v) => !v)}
              />
              <InterruptorProveedor
                titulo="Proveedor de manguera"
                activo={pideManguera}
                onCambiar={() => setPideManguera((v) => !v)}
              />
            </div>
          </Campo>
        )}

        {!esNueva && (
          <Campo etiqueta="Estado">
            <div className="grid grid-cols-2 gap-2">
              {[
                { valor: true, etiqueta: 'Activa' },
                { valor: false, etiqueta: 'Inactiva' },
              ].map((op) => (
                <button
                  key={String(op.valor)}
                  type="button"
                  onClick={() => setActivo(op.valor)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all ${
                    activo === op.valor
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
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

function ListaSeleccion({
  titulo,
  ayuda,
  vacio,
  items,
  seleccionados,
  onToggle,
  buscable = false,
}: {
  titulo: string
  ayuda: string
  vacio: string
  items: { id: string; titulo: string; subtitulo?: string }[]
  seleccionados: Set<string>
  onToggle: (id: string) => void
  /** Con listas largas —los 94 códigos físicos— sin buscador no se encuentra nada. */
  buscable?: boolean
}) {
  const [filtro, setFiltro] = useState('')
  const q = filtro.trim().toLowerCase()
  const visibles =
    !buscable || q === ''
      ? items
      : items.filter(
          (i) =>
            i.titulo.toLowerCase().includes(q) || (i.subtitulo ?? '').toLowerCase().includes(q)
        )

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
        <span className="shrink-0 text-xs font-bold text-brand-700">{seleccionados.size}</span>
      </div>
      <p className="mb-2 text-xs text-slate-400">{ayuda}</p>

      {buscable && items.length > 12 && (
        <div className="relative mb-2">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar código o descripción…"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:bg-white focus:outline-none"
          />
        </div>
      )}

      <div className="scroll-suave max-h-56 overflow-y-auto rounded-xl border border-slate-200">
        {visibles.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-400">{vacio}</p>
        ) : (
          visibles.map((item) => {
            const marcado = seleccionados.has(item.id)
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onToggle(item.id)}
                className={`flex w-full items-center gap-3 border-b border-slate-50 px-3 py-2.5 text-left transition-colors last:border-0 ${
                  marcado ? 'bg-brand-50/60' : 'hover:bg-slate-50'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                    marcado ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'
                  }`}
                >
                  {marcado && <IconCheck className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800">{item.titulo}</span>
                  {item.subtitulo && (
                    <span className="block truncate text-xs text-slate-400">{item.subtitulo}</span>
                  )}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Un interruptor de proveedor                                         */
/* ------------------------------------------------------------------ */

function InterruptorProveedor({
  titulo,
  activo,
  onCambiar,
}: {
  titulo: string
  activo: boolean
  onCambiar: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      onClick={onCambiar}
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-all ${
        activo
          ? 'border-brand-700 bg-brand-50 text-brand-800'
          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
      }`}
    >
      <span>{titulo}</span>
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
          activo ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'
        }`}
      >
        {activo && <IconCheck className="h-3.5 w-3.5" />}
      </span>
    </button>
  )
}
