'use client'

/**
 * Preparar / aplicar un turno: descuenta la bodega en el momento en que el producto sale al tanque (decisión del
 * usuario: un solo paso obligatorio; las horas de riego se completan aparte, en la bitácora).
 *
 * Piloto 1 (docs/fertirriego-piloto1.md, puntos 3 y 4):
 *   - Turno con botones. «Día de aplicación» (antes «Día del turno»).
 *   - Botones con los DDT del plan de ese turno (los cercanos al día de aplicación, sin aplicar primero) + «Extra».
 *     Con un DDT se cargan sus productos y cantidades (se corrigen y se pueden agregar más); con Extra, vacío.
 *   - Se muestra el «DDT real» (día de aplicación − siembra del turno) y la diferencia con el del plan.
 *   - Se manda `ddt_plan` + `fecha_plan`, o `extra: true` (la base sin la 99 los ignora).
 */

import { useMemo, useState } from 'react'
import { Alerta, Campo, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { ayerIso, hoyIso } from '@/lib/fechas/zona'
import { cantidad, planDelDia } from '@/lib/fertirriego/calculos'
import { aplicacionesDelTurno, ddtReal, ddtsDelTurno, fechasPlanAplicadas, ordenarDdtsParaElegir } from '@/lib/fertirriego/ddt'
import { crearOperacion, nuevoId } from '@/lib/fertirriego/operaciones'
import { productosUsados } from '@/lib/fertirriego/productos'
import type { EstadoCampo, Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { EditorLineas, leerLineas, useCrearProducto, type LineaEditable } from './EditorLineas'
import { MarcoRegistro } from './MarcoRegistro'

/** Cuántos DDT se muestran antes de «Ver más». */
const DDT_VISIBLES = 6
const EXTRA = 'extra'
const DIA_CORTO = new Intl.DateTimeFormat('es-HN', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const diaCorto = (iso: string) => DIA_CORTO.format(new Date(`${iso}T12:00:00Z`))

type DatosAplicacion = {
  turno: string
  fecha: string
  ejecutor2: string
  editadas: LineaEditable[] | null
  /** `plan:AAAA-MM-DD`, 'extra' o null (= automático: el DDT del plan de ese día) */
  eleccion?: string | null
  productosNuevos?: Operacion[]
}

export function FormAplicacion({
  estado,
  cola = [],
  estacion,
  yo,
  saldos,
  turnoInicial,
  fechaInicial,
  eleccionInicial,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estado: EstadoCampo
  /** Lo pendiente de enviar (para saber qué DDT ya se aplicaron sin señal). */
  cola?: Operacion[]
  estacion: Estacion
  yo: Persona
  saldos: Map<string, number>
  turnoInicial?: string
  fechaInicial?: string
  /** Piloto 2: abierto desde una tarjeta de «Por turno» = ese DDT (`plan:AAAA-MM-DD`) o «extra». */
  eleccionInicial?: string
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const con99 = Array.isArray(estado.envases_tipos)
  const turnos = useMemo(
    () => estado.turnos.filter((t) => t.estacion_id === estacion.id).sort((a, b) => a.turno.localeCompare(b.turno, 'es', { numeric: true })),
    [estado.turnos, estacion.id]
  )
  // Un borrador por turno y día cuando se abre desde uno (Por turno); si no, uno general de la estación
  const borrador = useBorrador<DatosAplicacion>(
    claveBorrador('aplicacion', yo.id, estacion.id, [turnoInicial, fechaInicial, eleccionInicial].filter(Boolean).join('@'))
  )
  const b = borrador.inicial
  const [turno, setTurno] = useState(b?.turno ?? turnoInicial ?? (turnos.length === 1 ? turnos[0].id : ''))
  const [fecha, setFecha] = useState(b?.fecha ?? fechaInicial ?? hoyIso())
  const [ejecutor2, setEjecutor2] = useState(b?.ejecutor2 ?? '')
  // null = todavía no escribió nada: se muestran las cantidades del DDT elegido
  const [editadas, setEditadas] = useState<LineaEditable[] | null>(b?.editadas ?? null)
  const [elegida, setElegida] = useState<string | null>(b?.eleccion ?? eleccionInicial ?? null)
  const [verTodos, setVerTodos] = useState(false)
  const [aceptaNegativo, setAceptaNegativo] = useState(false)
  const productos = useCrearProducto(estado.materiales, b?.productosNuevos, con99 && estacion.permisos.recibir)
  useAutoguardado(borrador, { turno, fecha, ejecutor2, editadas, eleccion: elegida, productosNuevos: productos.nuevos })

  const t = turnos.find((x) => x.id === turno)
  const ddts = useMemo(() => ddtsDelTurno(estado.plan, turno), [estado.plan, turno])
  const aplicadas = useMemo(
    () => fechasPlanAplicadas(ddts, aplicacionesDelTurno(estado.aplicaciones, cola, turno, t?.fecha_siembra)),
    [ddts, estado.aplicaciones, cola, turno, t?.fecha_siembra]
  )
  // Sin elegir: el DDT del plan del día de aplicación; si el turno no tiene plan, Extra
  const eleccion = elegida ?? (ddts.some((d) => d.fecha === fecha) ? `plan:${fecha}` : turno && ddts.length === 0 ? EXTRA : '')
  const fechaPlan = eleccion.startsWith('plan:') ? eleccion.slice(5) : null
  const ddtElegido = fechaPlan ? (ddts.find((d) => d.fecha === fechaPlan) ?? null) : null

  const plan = useMemo(() => (fechaPlan ? planDelDia(estado.plan, turno, fechaPlan) : new Map<string, number>()), [estado.plan, turno, fechaPlan])

  // Al cambiar de turno o de DDT se proponen las cantidades del plan (mientras no haya escrito nada)
  const propuestas = useMemo<LineaEditable[]>(
    () =>
      plan.size
        ? [...plan.entries()].map(([material_id, c]) => ({ clave: nuevoId(), material_id, cantidad: String(Math.round(c * 100) / 100) }))
        : [{ clave: nuevoId(), material_id: '', cantidad: '' }],
    [plan]
  )
  const lineas = editadas ?? propuestas

  const faltante = lineas.filter((l) => l.material_id && Number(l.cantidad.replace(',', '.')) > (saldos.get(l.material_id) ?? 0))

  // Chips: los cercanos y sin aplicar primero; «Ver más» = todos por fecha
  const ordenados = ordenarDdtsParaElegir(ddts, aplicadas, fecha)
  const visibles = verTodos
    ? [...ordenados].sort((a, b) => a.fecha.localeCompare(b.fecha))
    : (() => {
        const primeros = ordenados.slice(0, DDT_VISIBLES)
        const sel = ordenados.find((d) => d.fecha === fechaPlan)
        return (sel && !primeros.includes(sel) ? [...primeros, sel] : primeros).sort((a, b) => a.fecha.localeCompare(b.fecha))
      })()

  const real = t ? ddtReal(t.fecha_siembra, fecha) : null
  const diferencia = real !== null && ddtElegido ? real - ddtElegido.ddt : null

  function elegir(v: string) {
    setElegida(v)
    setEditadas(null)
  }

  return (
    <MarcoRegistro
      titulo="Preparar / aplicar turno"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      rapido
      construir={({ ubicacion, enNombreDe, ejecutor }) => {
        if (!turno) return 'Elige el turno.'
        if (!fecha || fecha > hoyIso()) return 'El día de aplicación no puede ser futuro.'
        if (!eleccion) return 'Elige el DDT del plan que estás aplicando, o «Extra» si no es del plan.'
        const r = leerLineas(lineas)
        if ('error' in r) return r.error
        if (faltante.length && !aceptaNegativo) {
          return 'No alcanza lo que hay en bodega para algún producto. Revisa la cantidad, o marca la casilla para registrarlo de todos modos.'
        }
        const datos: Record<string, unknown> = {
          estacion_id: estacion.id,
          turno_ciclo_id: turno,
          fecha,
          ejecutor_id: ejecutor,
          ejecutor2_id: ejecutor2 || null,
          lineas: r.lineas,
        }
        if (ddtElegido) {
          datos.ddt_plan = ddtElegido.ddt
          datos.fecha_plan = ddtElegido.fecha
        } else datos.extra = true
        const etiqueta = ddtElegido ? `DDT ${ddtElegido.ddt}` : 'extra'
        return [
          ...productosUsados(productos.nuevos, r.lineas.map((l) => l.material_id)).map((o) => ({ ...o, ubicacion })),
          crearOperacion('aplicacion', datos, {
            ubicacion,
            enNombreDe,
            resumen: `Aplicación · ${t?.turno ?? 'turno'} · ${etiqueta} · ${r.lineas.length} producto(s)`,
          }),
        ]
      }}
    >
      {turnos.length === 0 ? (
        <Alerta tono="ambar">Esta estación no tiene turnos activos publicados desde AGL.</Alerta>
      ) : (
        <Campo etiqueta="Turno" requerido>
          <div className="flex flex-wrap gap-2" data-selector-turno>
            {turnos.map((x) => (
              <button
                key={x.id}
                type="button"
                aria-pressed={turno === x.id}
                data-turno-chip={x.turno}
                onClick={() => {
                  setTurno(x.id)
                  setElegida(null)
                  setEditadas(null)
                  setVerTodos(false)
                }}
                className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-inset transition-colors ${
                  turno === x.id ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'
                }`}
              >
                {x.turno}
              </button>
            ))}
          </div>
        </Campo>
      )}

      <Campo etiqueta="Día de aplicación" requerido>
        <div className="flex flex-wrap items-center gap-2">
          <Entrada
            type="date"
            value={fecha}
            max={hoyIso()}
            onChange={(e) => {
              setFecha(e.target.value)
              if (elegida === null) setEditadas(null)
            }}
            className="w-44"
            data-fecha
          />
          {[
            ['Hoy', hoyIso()],
            ['Ayer', ayerIso()],
          ].map(([txt, v]) => (
            <button
              key={txt}
              type="button"
              onClick={() => {
                setFecha(v)
                if (elegida === null) setEditadas(null)
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${fecha === v ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200'}`}
            >
              {txt}
            </button>
          ))}
        </div>
        {real !== null && (
          <p className="mt-1.5 text-xs text-slate-600" data-ddt-real={real}>
            DDT real <strong>{real}</strong>
            {diferencia !== null && (
              <span className={diferencia === 0 ? ' text-brand-700' : ' text-amber-700'}>
                {' · '}
                {diferencia === 0 ? 'igual al plan' : `${diferencia > 0 ? '+' : ''}${diferencia} día(s) respecto del plan (DDT ${ddtElegido?.ddt})`}
              </span>
            )}
          </p>
        )}
      </Campo>

      {turno && (
        <Campo etiqueta="¿Qué DDT del plan aplicas?" requerido>
          <div className="flex flex-wrap gap-2" data-ddts>
            {visibles.map((d) => {
              const marcado = fechaPlan === d.fecha
              return (
                <button
                  key={d.fecha}
                  type="button"
                  aria-pressed={marcado}
                  data-ddt-chip={d.ddt}
                  data-fecha-plan={d.fecha}
                  data-aplicado={d.aplicado ? '' : undefined}
                  onClick={() => elegir(`plan:${d.fecha}`)}
                  className={`flex min-h-11 flex-col items-center justify-center rounded-xl px-3 py-1.5 text-sm font-bold ring-1 ring-inset transition-colors ${
                    marcado
                      ? 'bg-brand-700 text-white ring-brand-700'
                      : d.aplicado
                        ? 'bg-slate-50 text-slate-400 ring-slate-200'
                        : 'bg-white text-slate-800 ring-slate-300'
                  }`}
                >
                  <span>DDT {d.ddt}</span>
                  <span className={`text-[10px] font-semibold ${marcado ? 'text-white/80' : 'text-slate-400'}`}>
                    {diaCorto(d.fecha)}
                    {d.aplicado ? ' · aplicado' : ''}
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              aria-pressed={eleccion === EXTRA}
              data-ddt-chip={EXTRA}
              onClick={() => elegir(EXTRA)}
              className={`min-h-11 rounded-xl px-4 py-1.5 text-sm font-bold ring-1 ring-inset transition-colors ${
                eleccion === EXTRA ? 'bg-amber-600 text-white ring-amber-600' : 'bg-white text-amber-800 ring-amber-300'
              }`}
            >
              Extra
            </button>
          </div>
          {ordenados.length > DDT_VISIBLES && (
            <button type="button" onClick={() => setVerTodos((v) => !v)} className="mt-1.5 text-xs font-semibold text-slate-500 underline" data-ver-mas-ddt>
              {verTodos ? 'Ver menos' : `Ver más (${ordenados.length} DDT en el plan)`}
            </button>
          )}
          {ddts.length === 0 && <p className="mt-1.5 text-xs text-amber-700">Este turno no tiene plan publicado: lo que apliques va como «Extra».</p>}
        </Campo>
      )}

      <Campo etiqueta="Productos al tanque" requerido>
        {plan.size > 0 && <p className="mb-2 text-xs text-slate-500">Vienen las cantidades del DDT elegido. Corrige lo que cambió y deja vacío lo que no se aplicó.</p>}
        {eleccion === EXTRA && <p className="mb-2 text-xs text-amber-700">Aplicación extra (fuera del plan): agrega los productos que se aplicaron.</p>}
        <EditorLineas
          materiales={productos.materiales}
          lineas={lineas}
          onCambiar={setEditadas}
          saldos={saldos}
          plan={fechaPlan ? plan : undefined}
          etiquetaCantidad="Aplicado"
          crearProducto={productos.crearProducto}
        />
      </Campo>

      {faltante.length > 0 && (
        <label className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
          <input type="checkbox" checked={aceptaNegativo} onChange={(e) => setAceptaNegativo(e.target.checked)} className="mt-1" data-acepta-negativo />
          <span>
            No alcanza en bodega:{' '}
            {faltante
              .map((l) => `${productos.materiales.find((m) => m.id === l.material_id)?.descripcion ?? 'producto'} (hay ${cantidad(saldos.get(l.material_id) ?? 0)})`)
              .join(', ')}
            . ¿Falta registrar una entrega? Si de verdad se aplicó, márcalo: quedará marcado para revisar.
          </span>
        </label>
      )}

      {estacion.personas.length > 1 && (
        <Campo etiqueta="Otro estacionero que participó (opcional)">
          <SelectorBuscable
            valor={ejecutor2}
            opciones={estacion.personas.map((p) => ({ id: p.id, titulo: p.nombre }))}
            onCambiar={setEjecutor2}
            placeholder="Nadie más"
            etiquetaBusqueda="Buscar persona"
            permitirVacio
            textoVacio="Nadie más"
          />
        </Campo>
      )}
    </MarcoRegistro>
  )
}
