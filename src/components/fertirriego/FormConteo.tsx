'use client'

/**
 * Conteo físico de la bodega. El primero de cada producto es el SALDO INICIAL; los siguientes ajustan la
 * diferencia contra lo que dice el sistema (la base guarda las dos cifras). Lo que no se cuenta se deja vacío.
 */

import { useMemo, useState } from 'react'
import { Campo } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { ahoraIso } from '@/lib/fechas/zona'
import { cantidad } from '@/lib/fertirriego/calculos'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import { productosUsados } from '@/lib/fertirriego/productos'
import { creacionDeProducto, opcionesPorClase, useCrearProducto } from './EditorLineas'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import type { EstadoCampo, Estacion, Operacion, Persona } from '@/lib/fertirriego/tipos'
import { MarcoRegistro } from './MarcoRegistro'

export function FormConteo({
  estado,
  estacion,
  yo,
  saldos,
  saldosEnvases,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  saldos: Map<string, number>
  /** Envases por tipo en la estación (con lo pendiente). Piloto 1 (sql/99): entran al conteo. */
  saldosEnvases?: Map<string, number>
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const con99 = Array.isArray(estado.envases_tipos)
  // Se proponen los productos que la estación maneja: con saldo o en el plan de sus turnos
  const sugeridos = useMemo(() => {
    const turnos = new Set(estado.turnos.filter((t) => t.estacion_id === estacion.id).map((t) => t.id))
    const ids = new Set([...saldos.keys(), ...estado.plan.filter((p) => turnos.has(p.turno_ciclo_id)).map((p) => p.material_id)])
    return estado.materiales.filter((m) => ids.has(m.id))
  }, [estado, estacion.id, saldos])

  const borrador = useBorrador<{
    extra: string[]
    contado: Record<string, string>
    envases?: Record<string, string>
    productosNuevos?: Operacion[]
  }>(claveBorrador('conteo', yo.id, estacion.id))
  const [extra, setExtra] = useState<string[]>(borrador.inicial?.extra ?? [])
  const [contado, setContado] = useState<Record<string, string>>(borrador.inicial?.contado ?? {})
  const [envases, setEnvases] = useState<Record<string, string>>(borrador.inicial?.envases ?? {})
  const productos = useCrearProducto(estado.materiales, borrador.inicial?.productosNuevos, con99 && estacion.permisos.recibir)
  useAutoguardado(borrador, { extra, contado, envases, productosNuevos: productos.nuevos })
  const lista = [...sugeridos, ...productos.materiales.filter((m) => extra.includes(m.id) && !sugeridos.some((s) => s.id === m.id))]
  const tiposEnvase = estado.envases_tipos ?? []

  return (
    <MarcoRegistro
      titulo="Conteo físico"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      rapido
      construir={({ ubicacion, enNombreDe }) => {
        const lineas: { material_id: string; cantidad_real: number }[] = []
        for (const m of lista) {
          const v = (contado[m.id] ?? '').trim()
          if (!v) continue
          const n = Number(v.replace(',', '.'))
          if (!Number.isFinite(n) || n < 0) return `La cantidad contada de ${m.descripcion ?? m.codigo} no es válida.`
          lineas.push({ material_id: m.id, cantidad_real: Math.round(n * 10000) / 10000 })
        }
        const contadosEnvases: { envase_id: string; cantidad_real: number }[] = []
        if (con99) {
          for (const t of tiposEnvase) {
            const v = (envases[t.id] ?? '').trim()
            if (!v) continue
            const n = Number(v)
            if (!Number.isInteger(n) || n < 0 || n > 100_000) return `Los envases (${t.nombre}) se cuentan en números enteros.`
            contadosEnvases.push({ envase_id: t.id, cantidad_real: n })
          }
        }
        if (!lineas.length && !contadosEnvases.length) return 'Escribe lo contado de al menos un producto.'
        const datos: Record<string, unknown> = { estacion_id: estacion.id, fecha_hora: ahoraIso(), lineas }
        if (contadosEnvases.length) datos.envases = contadosEnvases
        const resumen = [lineas.length ? `${lineas.length} producto(s)` : null, contadosEnvases.length ? `${contadosEnvases.length} envase(s)` : null]
          .filter(Boolean)
          .join(' · ')
        return [
          ...productosUsados(productos.nuevos, lineas.map((l) => l.material_id)).map((o) => ({ ...o, ubicacion })),
          crearOperacion('conteo', datos, { ubicacion, enNombreDe, resumen: `Conteo · ${resumen}` }),
        ]
      }}
    >
      <p className="text-sm text-slate-500">
        Escribe lo que hay físicamente. Lo que no cuentes, déjalo vacío. La diferencia contra el sistema queda registrada.
      </p>
      <div className="flex flex-col divide-y divide-slate-100 rounded-xl ring-1 ring-inset ring-slate-200" data-conteo>
        {lista.length === 0 && <p className="px-3 py-3 text-sm text-slate-400">Agrega los productos que vas a contar.</p>}
        {lista.map((m) => {
          const sistema = saldos.get(m.id)
          const v = contado[m.id] ?? ''
          const dif = v.trim() ? Number(v.replace(',', '.')) - (sistema ?? 0) : null
          return (
            <div key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5" data-conteo-material={m.codigo}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">{m.descripcion ?? m.codigo}</p>
                <p className="text-[11px] text-slate-500">
                  Sistema: {sistema === undefined ? 'sin registros (será el saldo inicial)' : `${cantidad(sistema)} ${m.unidad ?? ''}`}
                  {dif !== null && Number.isFinite(dif) && dif !== 0 && (
                    <span className={dif < 0 ? ' text-red-600' : ' text-brand-700'}> · diferencia {dif > 0 ? '+' : ''}{cantidad(dif)}</span>
                  )}
                </p>
              </div>
              <input
                inputMode="decimal"
                value={v}
                onChange={(e) => setContado({ ...contado, [m.id]: e.target.value.replace(/[^\d.,]/g, '') })}
                placeholder="Contado"
                className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base font-semibold tabular-nums focus:border-brand-600 focus:outline-none"
              />
              <span className="w-8 text-xs text-slate-500">{m.unidad}</span>
            </div>
          )
        })}
      </div>
      <Campo etiqueta="Contar otro producto">
        <SelectorBuscable
          valor=""
          opciones={opcionesPorClase(productos.materiales).filter((o) => !lista.some((l) => l.id === o.id))}
          onCambiar={(id) => id && setExtra((e) => [...e, id])}
          placeholder="Agregar producto…"
          etiquetaBusqueda="Buscar producto"
          creacionRapida={creacionDeProducto(productos.crearProducto)}
        />
      </Campo>

      {con99 && tiposEnvase.length > 0 && (
        <Campo etiqueta="Envases (vacíos y llenos)">
          <div className="flex flex-col divide-y divide-slate-100 rounded-xl ring-1 ring-inset ring-slate-200" data-conteo-envases>
            {tiposEnvase.map((t) => {
              const sistema = saldosEnvases?.get(t.id) ?? 0
              const v = envases[t.id] ?? ''
              const dif = v.trim() ? Number(v) - sistema : null
              return (
                <div key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5" data-conteo-envase={t.nombre}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{t.nombre}</p>
                    <p className="text-[11px] text-slate-500">
                      Sistema: {sistema}
                      {dif !== null && Number.isFinite(dif) && dif !== 0 && (
                        <span className={dif < 0 ? ' text-red-600' : ' text-brand-700'}> · diferencia {dif > 0 ? '+' : ''}{dif}</span>
                      )}
                    </p>
                  </div>
                  <input
                    inputMode="numeric"
                    value={v}
                    onChange={(e) => setEnvases({ ...envases, [t.id]: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                    placeholder="Contado"
                    className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base font-semibold tabular-nums focus:border-brand-600 focus:outline-none"
                  />
                </div>
              )
            })}
          </div>
        </Campo>
      )}
    </MarcoRegistro>
  )
}
