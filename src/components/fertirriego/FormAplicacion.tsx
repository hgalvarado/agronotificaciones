'use client'

/**
 * Preparar / aplicar un turno: descuenta la bodega en el momento en que el producto sale al tanque (decisión del
 * usuario: un solo paso obligatorio; las horas de riego se completan aparte, en la bitácora).
 * Las cantidades se proponen desde el plan del día del turno: si se aplicó lo planificado, es un toque.
 */

import { useMemo, useState } from 'react'
import { Alerta, Campo, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { ayerIso, hoyIso } from '@/lib/fechas/zona'
import { cantidad, planDelDia } from '@/lib/fertirriego/calculos'
import { crearOperacion, nuevoId } from '@/lib/fertirriego/operaciones'
import type { EstadoCampo, Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { EditorLineas, leerLineas, type LineaEditable } from './EditorLineas'
import { MarcoRegistro } from './MarcoRegistro'

type DatosAplicacion = { turno: string; fecha: string; ejecutor2: string; editadas: LineaEditable[] | null }

export function FormAplicacion({
  estado,
  estacion,
  yo,
  saldos,
  turnoInicial,
  fechaInicial,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  saldos: Map<string, number>
  turnoInicial?: string
  fechaInicial?: string
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const turnos = useMemo(() => estado.turnos.filter((t) => t.estacion_id === estacion.id), [estado.turnos, estacion.id])
  // Un borrador por turno y día cuando se abre desde uno (Por turno); si no, uno general de la estación
  const borrador = useBorrador<DatosAplicacion>(
    claveBorrador('aplicacion', yo.id, estacion.id, [turnoInicial, fechaInicial].filter(Boolean).join('@'))
  )
  const b = borrador.inicial
  const [turno, setTurno] = useState(b?.turno ?? turnoInicial ?? (turnos.length === 1 ? turnos[0].id : ''))
  const [fecha, setFecha] = useState(b?.fecha ?? fechaInicial ?? hoyIso())
  const [ejecutor2, setEjecutor2] = useState(b?.ejecutor2 ?? '')
  // null = todavía no escribió nada: se muestran las cantidades del plan del turno y día elegidos
  const [editadas, setEditadas] = useState<LineaEditable[] | null>(b?.editadas ?? null)
  const [aceptaNegativo, setAceptaNegativo] = useState(false)
  useAutoguardado(borrador, { turno, fecha, ejecutor2, editadas })

  const plan = useMemo(() => planDelDia(estado.plan, turno, fecha), [estado.plan, turno, fecha])

  // Al cambiar turno o fecha se proponen las cantidades del plan (mientras no haya escrito nada)
  const propuestas = useMemo<LineaEditable[]>(
    () =>
      plan.size
        ? [...plan.entries()].map(([material_id, c]) => ({ clave: nuevoId(), material_id, cantidad: String(Math.round(c * 100) / 100) }))
        : [{ clave: nuevoId(), material_id: '', cantidad: '' }],
    [plan]
  )
  const lineas = editadas ?? propuestas

  const faltante = lineas.filter((l) => l.material_id && Number(l.cantidad.replace(',', '.')) > (saldos.get(l.material_id) ?? 0))

  return (
    <MarcoRegistro
      titulo="Preparar / aplicar turno"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      construir={({ ubicacion, enNombreDe, ejecutor }) => {
        if (!turno) return 'Elige el turno.'
        if (!fecha || fecha > hoyIso()) return 'La fecha no puede ser futura.'
        const r = leerLineas(lineas)
        if ('error' in r) return r.error
        if (faltante.length && !aceptaNegativo) {
          return 'No alcanza lo que hay en bodega para algún producto. Revisa la cantidad, o marca la casilla para registrarlo de todos modos.'
        }
        const t = turnos.find((x) => x.id === turno)
        return [
          crearOperacion(
            'aplicacion',
            {
              estacion_id: estacion.id,
              turno_ciclo_id: turno,
              fecha,
              ejecutor_id: ejecutor,
              ejecutor2_id: ejecutor2 || null,
              lineas: r.lineas,
            },
            { ubicacion, enNombreDe, resumen: `Aplicación · ${t?.turno ?? 'turno'} · ${r.lineas.length} producto(s)` }
          ),
        ]
      }}
    >
      {turnos.length === 0 ? (
        <Alerta tono="ambar">Esta estación no tiene turnos activos publicados desde AGL.</Alerta>
      ) : (
        <Campo etiqueta="Turno" requerido>
          <div data-selector-turno>
            <SelectorBuscable
              valor={turno}
              opciones={turnos.map((t) => {
                const hoy = planDelDia(estado.plan, t.id, fecha).size
                return { id: t.id, titulo: t.turno, subtitulo: [t.ciclo, hoy ? `plan del día: ${hoy} producto(s)` : 'sin plan este día'].filter(Boolean).join(' · ') }
              })}
              onCambiar={(v) => {
                setTurno(v)
                setEditadas(null)
              }}
              placeholder="Elegir turno…"
              etiquetaBusqueda="Buscar turno"
            />
          </div>
        </Campo>
      )}

      <Campo etiqueta="Día del turno" requerido>
        <div className="flex flex-wrap items-center gap-2">
          <Entrada
            type="date"
            value={fecha}
            max={hoyIso()}
            onChange={(e) => {
              setFecha(e.target.value)
              setEditadas(null)
            }}
            className="w-44"
            data-fecha
          />
          {[
            ['Hoy', hoyIso()],
            ['Ayer', ayerIso()],
          ].map(([t, v]) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setFecha(v)
                setEditadas(null)
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${fecha === v ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </Campo>

      <Campo etiqueta="Productos al tanque" requerido>
        {plan.size > 0 && <p className="mb-2 text-xs text-slate-500">Vienen las cantidades del plan. Corrige lo que cambió y deja vacío lo que no se aplicó.</p>}
        {turno && plan.size === 0 && (
          <p className="mb-2 text-xs text-amber-700">Este día no tiene plan para el turno: lo que agregues queda «fuera de plan».</p>
        )}
        <EditorLineas
          materiales={estado.materiales}
          lineas={lineas}
          onCambiar={setEditadas}
          saldos={saldos}
          plan={plan}
          etiquetaCantidad="Aplicado"
        />
      </Campo>

      {faltante.length > 0 && (
        <label className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
          <input type="checkbox" checked={aceptaNegativo} onChange={(e) => setAceptaNegativo(e.target.checked)} className="mt-1" data-acepta-negativo />
          <span>
            No alcanza en bodega:{' '}
            {faltante
              .map((l) => `${estado.materiales.find((m) => m.id === l.material_id)?.descripcion ?? 'producto'} (hay ${cantidad(saldos.get(l.material_id) ?? 0)})`)
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
