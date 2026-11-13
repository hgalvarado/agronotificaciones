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
import { aEntradaLocal, ahoraIso, deEntradaLocal, hoyIso } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { productosDelPlan } from '@/lib/fertirriego/calculos'
import { leerEnvases, type FilaEnvase } from '@/lib/fertirriego/envases'
import { crearOperacion, nuevoId } from '@/lib/fertirriego/operaciones'
import { productosUsados } from '@/lib/fertirriego/productos'
import type { Chofer, EnvaseTipo, EstadoCampo, Estacion, Operacion, Persona, Vehiculo } from '@/lib/fertirriego/tipos'
import { EditorLineas, leerLineas, SIN_LINEAS, useCrearProducto, type LineaEditable } from './EditorLineas'
import { BloqueEnvases, SelectorChofer, SelectorVehiculo } from './ChoferVehiculo'
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
        <SelectorChofer
          valor={chofer}
          onCambiar={setChofer}
          choferes={choferes}
          onNuevo={(op, c) => {
            setNuevos((n) => [...n, op])
            setChoferesAqui((x) => [...x, c])
          }}
        />
      </Campo>

      <Campo etiqueta="Vehículo">
        <SelectorVehiculo
          valor={vehiculo}
          onCambiar={setVehiculo}
          vehiculos={vehiculos}
          chofer={chofer}
          choferesVehiculos={estado.choferes_vehiculos}
          onNuevo={(op, v) => {
            setNuevos((n) => [...n, op])
            setVehiculosAqui((x) => [...x, v])
          }}
        />
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
          <BloqueEnvases
            tipos={tiposEnvase}
            valores={envases}
            onCambiar={setEnvases}
            saldos={saldosEnvases}
            onNuevoTipo={(op, t) => {
              setNuevos((n) => [...n, op])
              setEnvasesAqui((x) => [...x, t])
            }}
          />
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
