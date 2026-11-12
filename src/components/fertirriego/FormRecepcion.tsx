'use client'

/**
 * Recibir producto en la bodega de la estación: quién entregó (chofer y vehículo), cuándo y cuánto.
 * Chofer y vehículo se eligen de la lista o se crean aquí mismo, aun sin señal (quedan «por validar»).
 *
 * Pedidos del usuario (2026-11-12):
 *   - Sin «¿Dónde?»: siempre se recibe en la bodega de ESTA estación (se guarda su nombre).
 *   - Los productos vienen por defecto: los del plan de los turnos de la estación (lo que el plan nutricional usa),
 *     con lo planificado para los próximos días como guía. Se pueden quitar o agregar otros; lo que queda vacío no
 *     se registra.
 *   - Borrador: si se sale por error, al volver sigue donde iba.
 * Piloto 1 (docs/fertirriego-piloto1.md, punto 1; sql/99):
 *   - Para qué turnos es el pedido (botones, varios), «Comentarios / problemas».
 *   - Envases recibidos / entregados por tipo, con «Agregar otro envase» sin señal.
 *   - «Agregar producto que no está en la lista» (clase, por validar).
 *   Sin la 99 en la base, envases y productos nuevos no se ofrecen; turnos y comentario viajan igual (se ignoran).
 */

import { useMemo, useState } from 'react'
import { AreaTexto, Campo, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { aEntradaLocal, ahoraIso, deEntradaLocal, hoyIso } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { productosDelPlan } from '@/lib/fertirriego/calculos'
import { leerEnvases, type FilaEnvase } from '@/lib/fertirriego/envases'
import { crearOperacion, nuevoId } from '@/lib/fertirriego/operaciones'
import { productosUsados } from '@/lib/fertirriego/productos'
import type { Chofer, EnvaseTipo, EstadoCampo, Estacion, Operacion, Persona, Vehiculo } from '@/lib/fertirriego/tipos'
import { EditorLineas, leerLineas, SIN_LINEAS, useCrearProducto, type LineaEditable } from './EditorLineas'
import { MarcoRegistro } from './MarcoRegistro'

/** Días de plan que se muestran como guía junto a cada producto. */
const DIAS_PLAN = 7

type DatosRecepcion = {
  fechaHora: string
  chofer: string
  vehiculo: string
  documento: string
  lineas: LineaEditable[]
  nuevos: Operacion[]
  choferesAqui: Chofer[]
  vehiculosAqui: Vehiculo[]
  // piloto 1
  turnos?: string[]
  comentario?: string
  envases?: Record<string, { recibidos: string; entregados: string }>
  envasesAqui?: EnvaseTipo[]
  productosNuevos?: Operacion[]
}

const soloEnteros = (v: string) => v.replace(/\D/g, '').slice(0, 6)

export function FormRecepcion({
  estado,
  estacion,
  yo,
  saldos,
  saldosEnvases,
  choferesPendientes,
  vehiculosPendientes,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  saldos: Map<string, number>
  /** Envases por tipo en la estación (con lo pendiente). */
  saldosEnvases?: Map<string, number>
  /** Los creados en el teléfono que aún no llegan al servidor. */
  choferesPendientes: Chofer[]
  vehiculosPendientes: Vehiculo[]
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  // La base ya tiene la 99 (manda la lista de envases): se ofrecen envases y productos nuevos
  const con99 = Array.isArray(estado.envases_tipos)
  const turnosEstacion = useMemo(
    () => estado.turnos.filter((t) => t.estacion_id === estacion.id && t.activo !== false).sort((a, b) => a.turno.localeCompare(b.turno, 'es', { numeric: true })),
    [estado.turnos, estacion.id]
  )
  // Lo que necesitan los turnos de ESTA estación: sus productos van por defecto, con lo de los próximos días
  const { materiales: materialesPlan, proximos } = useMemo(
    () => productosDelPlan(estado.plan, estado.turnos, estacion.id, hoyIso(), DIAS_PLAN),
    [estado.plan, estado.turnos, estacion.id]
  )
  const borrador = useBorrador<DatosRecepcion>(claveBorrador('recepcion', yo.id, estacion.id))
  const b = borrador.inicial
  const [fechaHora, setFechaHora] = useState(b?.fechaHora ?? aEntradaLocal(ahoraIso()))
  const [chofer, setChofer] = useState(b?.chofer ?? '')
  const [vehiculo, setVehiculo] = useState(b?.vehiculo ?? '')
  const [documento, setDocumento] = useState(b?.documento ?? '')
  const [turnos, setTurnos] = useState<string[]>(b?.turnos ?? [])
  const [comentario, setComentario] = useState(b?.comentario ?? '')
  const [lineas, setLineas] = useState<LineaEditable[]>(
    () =>
      b?.lineas ??
      (materialesPlan.length
        ? materialesPlan.map((material_id) => ({ clave: nuevoId(), material_id, cantidad: '' }))
        : [{ clave: nuevoId(), material_id: '', cantidad: '' }])
  )
  // Lo creado aquí antes de guardar (se manda junto con la recepción, en orden)
  const [nuevos, setNuevos] = useState<Operacion[]>(b?.nuevos ?? [])
  const [choferesAqui, setChoferesAqui] = useState<Chofer[]>(b?.choferesAqui ?? [])
  const [vehiculosAqui, setVehiculosAqui] = useState<Vehiculo[]>(b?.vehiculosAqui ?? [])
  const [envases, setEnvases] = useState<Record<string, { recibidos: string; entregados: string }>>(b?.envases ?? {})
  const [envasesAqui, setEnvasesAqui] = useState<EnvaseTipo[]>(b?.envasesAqui ?? [])
  const [envaseNuevo, setEnvaseNuevo] = useState<string | null>(null)
  const productos = useCrearProducto(estado.materiales, b?.productosNuevos, con99 && estacion.permisos.recibir)
  useAutoguardado(borrador, {
    fechaHora,
    chofer,
    vehiculo,
    documento,
    lineas,
    nuevos,
    choferesAqui,
    vehiculosAqui,
    turnos,
    comentario,
    envases,
    envasesAqui,
    productosNuevos: productos.nuevos,
  })

  const choferes = useMemo(
    () => [...estado.choferes, ...choferesPendientes, ...choferesAqui],
    [estado.choferes, choferesPendientes, choferesAqui]
  )
  const vehiculos = useMemo(
    () => [...estado.vehiculos, ...vehiculosPendientes, ...vehiculosAqui],
    [estado.vehiculos, vehiculosPendientes, vehiculosAqui]
  )
  const tiposEnvase = useMemo(
    () => [...(estado.envases_tipos ?? []), ...envasesAqui.filter((e) => !(estado.envases_tipos ?? []).some((x) => x.id === e.id))],
    [estado.envases_tipos, envasesAqui]
  )
  // Primero los camiones en que ya vino este chofer
  const deEsteChofer = new Set(estado.choferes_vehiculos.filter((cv) => cv.chofer_id === chofer).map((cv) => cv.vehiculo_id))

  function cambiarEnvase(id: string, campo: 'recibidos' | 'entregados', valor: string) {
    setEnvases((e) => ({ ...e, [id]: { recibidos: e[id]?.recibidos ?? '', entregados: e[id]?.entregados ?? '', [campo]: soloEnteros(valor) } }))
  }

  function agregarEnvase() {
    const nombre = (envaseNuevo ?? '').trim()
    if (!nombre) return
    const ya = tiposEnvase.find((e) => e.nombre.trim().toLowerCase() === nombre.toLowerCase())
    if (!ya) {
      const id = nuevoId()
      setNuevos((n) => [...n, crearOperacion('envase_tipo', { envase_id: id, nombre }, { id, ubicacion: null, resumen: `Envase nuevo · ${nombre}` })])
      setEnvasesAqui((x) => [...x, { id, nombre, validado: false, pendiente: true }])
    }
    setEnvaseNuevo(null)
  }

  return (
    <MarcoRegistro
      titulo="Recibir producto"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      rapido
      construir={({ ubicacion, enNombreDe }) => {
        if (!chofer) return 'Indica quién entregó (chofer).'
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Indica la fecha y hora de la entrega.'
        if (Date.parse(fh) > Date.now() + 5 * 60_000) return 'La entrega no puede ser en el futuro.'
        const r = leerLineas(lineas)
        if ('error' in r) {
          return r.error === SIN_LINEAS ? 'Escribe la cantidad de al menos un producto recibido (lo que no llegó, déjalo vacío).' : r.error
        }
        const filas: FilaEnvase[] = tiposEnvase.map((t) => ({ envase_id: t.id, recibidos: envases[t.id]?.recibidos ?? '', entregados: envases[t.id]?.entregados ?? '' }))
        const e = con99 ? leerEnvases(filas) : { envases: [] }
        if ('error' in e) return e.error
        const datos: Record<string, unknown> = {
          estacion_id: estacion.id,
          fecha_hora: fh,
          chofer_id: chofer,
          vehiculo_id: vehiculo || null,
          lugar: estacion.nombre, // siempre se recibe en la bodega de esta estación
          documento: documento.trim() || null,
          comentario: comentario.trim() || null,
          turnos: turnos.filter((t) => turnosEstacion.some((x) => x.id === t)),
          lineas: r.lineas,
        }
        if (con99) datos.envases = e.envases
        const recepcion = crearOperacion('recepcion', datos, { ubicacion, enNombreDe, resumen: `Recepción · ${r.lineas.length} producto(s)` })
        // Lo nuevo va ANTES (la recepción lo necesita), con la misma ubicación. Envases y productos nuevos solo si
        // se usan; choferes y vehículos, siempre (como antes).
        const envasesUsados = new Set(e.envases.map((x) => x.envase_id))
        const previos = nuevos.filter((n) => n.tipo !== 'envase_tipo' || envasesUsados.has(String(n.datos.envase_id)))
        const productosNuevos = productosUsados(productos.nuevos, r.lineas.map((l) => l.material_id))
        return [...previos, ...productosNuevos, recepcion].map((n) => ({ ...n, ubicacion }))
      }}
    >
      <Campo etiqueta="Fecha y hora de la entrega" requerido>
        <Entrada type="datetime-local" value={fechaHora} onChange={(e) => setFechaHora(e.target.value)} data-fecha-hora />
      </Campo>

      <Campo etiqueta="¿Quién entregó? (chofer)" requerido>
        <div data-selector-chofer>
          <SelectorBuscable
            valor={chofer}
            opciones={choferes.map((c) => ({ id: c.id, titulo: c.nombre, subtitulo: c.validado ? undefined : 'por validar' }))}
            onCambiar={setChofer}
            placeholder="Elegir chofer…"
            etiquetaBusqueda="Buscar chofer"
            creacionRapida={{
              etiqueta: 'Agregar chofer',
              campos: [{ key: 'nombre', label: 'Nombre completo', requerido: true }, { key: 'telefono', label: 'Teléfono' }],
              onCrear: async (v) => {
                const id = nuevoId()
                setNuevos((n) => [
                  ...n,
                  crearOperacion('chofer', { chofer_id: id, nombre: v.nombre, telefono: v.telefono || null }, { id, ubicacion: null, resumen: `Chofer nuevo · ${v.nombre}` }),
                ])
                setChoferesAqui((c) => [...c, { id, nombre: v.nombre, validado: false, pendiente: true }])
                return { id, titulo: v.nombre, subtitulo: 'nuevo · por validar' }
              },
            }}
          />
        </div>
      </Campo>

      <Campo etiqueta="Vehículo">
        <div data-selector-vehiculo>
          <SelectorBuscable
            valor={vehiculo}
            opciones={[...vehiculos]
              .sort((a, b) => Number(deEsteChofer.has(b.id)) - Number(deEsteChofer.has(a.id)))
              .map((v) => ({
                id: v.id,
                titulo: v.placa,
                subtitulo: [v.tipo, v.marca, v.color, deEsteChofer.has(v.id) ? 'ya vino en este' : null, v.validado ? null : 'por validar']
                  .filter(Boolean)
                  .join(' · '),
              }))}
            onCambiar={setVehiculo}
            placeholder="Elegir vehículo…"
            etiquetaBusqueda="Buscar placa"
            permitirVacio
            textoVacio="Sin vehículo"
            creacionRapida={{
              etiqueta: 'Agregar vehículo',
              campos: [
                { key: 'placa', label: 'Placa', requerido: true },
                { key: 'tipo', label: 'Tipo (camión, pick-up…)' },
                { key: 'marca', label: 'Marca' },
                { key: 'color', label: 'Color' },
              ],
              onCrear: async (v) => {
                const id = nuevoId()
                const placa = v.placa.toUpperCase().replace(/\s+/g, '')
                setNuevos((n) => [
                  ...n,
                  crearOperacion(
                    'vehiculo',
                    { vehiculo_id: id, placa, tipo: v.tipo || null, marca: v.marca || null, color: v.color || null },
                    { id, ubicacion: null, resumen: `Vehículo nuevo · ${placa}` }
                  ),
                ])
                setVehiculosAqui((x) => [...x, { id, placa, tipo: v.tipo || null, marca: v.marca || null, color: v.color || null, validado: false, pendiente: true }])
                return { id, titulo: placa, subtitulo: 'nuevo · por validar' }
              },
            }}
          />
        </div>
      </Campo>

      {turnosEstacion.length > 0 && (
        <Campo etiqueta="¿Para qué turnos es? (puedes marcar varios)">
          <div className="flex flex-wrap gap-2" data-turnos-recepcion>
            {turnosEstacion.map((t) => {
              const marcado = turnos.includes(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={marcado}
                  data-turno-chip={t.turno}
                  onClick={() => setTurnos((x) => (marcado ? x.filter((y) => y !== t.id) : [...x, t.id]))}
                  className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-inset transition-colors ${
                    marcado ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'
                  }`}
                >
                  {marcado ? '✓ ' : ''}
                  {t.turno}
                </button>
              )
            })}
          </div>
        </Campo>
      )}

      <Campo etiqueta="Documento (opcional)">
        <Entrada value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="Remisión / vale" data-documento />
      </Campo>

      <Campo etiqueta="Productos recibidos" requerido>
        {materialesPlan.length > 0 && (
          <p className="mb-2 text-xs text-slate-500" data-productos-del-plan>
            Vienen los productos del plan de los turnos de esta estación. Escribe lo que llegó; lo que no llegó, déjalo
            vacío o quítalo.
          </p>
        )}
        <EditorLineas
          materiales={productos.materiales}
          lineas={lineas}
          onCambiar={setLineas}
          saldos={saldos}
          plan={proximos}
          etiquetaPlan={`Plan ${DIAS_PLAN} días`}
          etiquetaCantidad="Recibido"
          crearProducto={productos.crearProducto}
        />
      </Campo>

      {con99 && (
        <Campo etiqueta="Envases">
          <p className="mb-2 text-xs text-slate-500">Cuántos llegaron llenos y cuántos vacíos se llevó el chofer. Lo vacío cuenta como 0.</p>
          <div className="flex flex-col divide-y divide-slate-100 rounded-xl ring-1 ring-inset ring-slate-200" data-envases-recepcion>
            {tiposEnvase.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5" data-envase={t.nombre}>
                <div className="min-w-0 flex-1 basis-28">
                  <p className="truncate text-sm font-semibold text-slate-800">{t.nombre}</p>
                  <p className="text-[11px] text-slate-500">
                    {t.validado ? '' : 'por validar · '}En la estación: {saldosEnvases?.get(t.id) ?? 0}
                  </p>
                </div>
                <label className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] font-semibold uppercase text-slate-500">Recibidos</span>
                  <input
                    inputMode="numeric"
                    value={envases[t.id]?.recibidos ?? ''}
                    onChange={(e) => cambiarEnvase(t.id, 'recibidos', e.target.value)}
                    placeholder="0"
                    data-envase-recibidos
                    className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-2 text-right text-base font-semibold tabular-nums focus:border-brand-600 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] font-semibold uppercase text-slate-500">Entregados</span>
                  <input
                    inputMode="numeric"
                    value={envases[t.id]?.entregados ?? ''}
                    onChange={(e) => cambiarEnvase(t.id, 'entregados', e.target.value)}
                    placeholder="0"
                    data-envase-entregados
                    className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-2 text-right text-base font-semibold tabular-nums focus:border-brand-600 focus:outline-none"
                  />
                </label>
              </div>
            ))}
            {tiposEnvase.length === 0 && <p className="px-3 py-3 text-sm text-slate-400">Agrega el tipo de envase.</p>}
          </div>
          {envaseNuevo === null ? (
            <button
              type="button"
              data-agregar-envase
              onClick={() => setEnvaseNuevo('')}
              className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              + Agregar otro envase
            </button>
          ) : (
            <div className="mt-2 flex gap-2">
              <Entrada
                value={envaseNuevo}
                onChange={(e) => setEnvaseNuevo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    agregarEnvase()
                  }
                }}
                placeholder="Nombre (ej. Tote, Saco)"
                autoFocus
                data-nombre-envase-nuevo
              />
              <button type="button" onClick={agregarEnvase} data-crear-envase className="shrink-0 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white">
                Agregar
              </button>
              <button type="button" onClick={() => setEnvaseNuevo(null)} className="shrink-0 rounded-lg px-2 text-sm text-slate-500">
                No agregar
              </button>
            </div>
          )}
        </Campo>
      )}

      <Campo etiqueta="Comentarios / problemas (opcional)">
        <AreaTexto
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          rows={2}
          placeholder="Ej. llegó un barril golpeado, faltó el ácido…"
          data-comentario-recepcion
        />
      </Campo>
    </MarcoRegistro>
  )
}
