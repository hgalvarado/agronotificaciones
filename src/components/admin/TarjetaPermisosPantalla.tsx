'use client'

/**
 * Los permisos de UN rol en UNA pantalla (migración 92).
 *
 * Reemplaza a la fila de la matriz gigante: aquí solo aparecen las acciones de esta pantalla, en palabras,
 * con tres atajos —nivel rápido, alcance del módulo y condición— y el ajuste fino por acción escondido
 * en «Ajustar por acción». No guarda nada: avisa los cambios a quien la usa.
 */

import { useState } from 'react'
import { Insignia } from '@/components/ui/Primitivos'
import { IconCheck, IconChevronDown } from '@/components/ui/Icons'
import { PERMISO_APAGADO, type Alcance, type ConfigPermiso } from '@/lib/permisos/abac'
import {
  NIVELES,
  ORDEN_ALCANCES,
  accionesDelNivel,
  alcanceDominante,
  alcanceMixto,
  detalleAlcance,
  nivelActual,
  nivelDeAccion,
  nivelesDisponibles,
  nombreAlcance,
  type Nivel,
} from '@/lib/permisos/niveles'

export type AccionDePantalla = {
  codigo: string
  nombre: string
  descripcion: string | null
  nivel: number | null
  escribe: boolean
}

export type CambioCelda = { accion: string; config: ConfigPermiso }

const TONO_NIVEL: Record<number, string> = {
  1: 'ring-sky-300 bg-sky-50 text-sky-800',
  2: 'ring-brand-300 bg-brand-50 text-brand-800',
  3: 'ring-amber-300 bg-amber-50 text-amber-800',
  4: 'ring-violet-300 bg-violet-50 text-violet-800',
}

export function TarjetaPermisosPantalla({
  codigo,
  nombre,
  descripcion,
  acciones,
  configDe,
  usaCondicion,
  etiquetasAlcance,
  comparacion,
  ocupada,
  onCambiar,
}: {
  codigo: string
  nombre: string
  descripcion: string | null
  acciones: AccionDePantalla[]
  configDe: (accion: string) => ConfigPermiso
  usaCondicion: boolean
  etiquetasAlcance: Partial<Record<Alcance, string>> | null
  /** Con «Comparar con»: lo que el otro rol tiene de más y de menos aquí. */
  comparacion: { nombreRol: string; deMas: string[]; deMenos: string[] } | null
  ocupada: boolean
  onCambiar: (cambios: CambioCelda[]) => void
}) {
  const [detalle, setDetalle] = useState(false)

  const configs = acciones.map((a) => configDe(a.codigo))
  const encendidas = new Set(acciones.filter((a) => configDe(a.codigo).permitido).map((a) => a.codigo))
  const niveles = nivelesDisponibles(acciones)
  const nivel = nivelActual(acciones, encendidas)
  const alcance = alcanceDominante(configs)
  const mixto = alcanceMixto(configs)
  const conCondicion = configs.some(
    (c, i) => c.permitido && acciones[i].escribe && c.condicion === 'solo_abiertos_registrando'
  )
  const ve = encendidas.has('ver') || (!acciones.some((a) => a.codigo === 'ver') && encendidas.size > 0)
  const difiere = comparacion && (comparacion.deMas.length > 0 || comparacion.deMenos.length > 0)

  /** Encender exactamente lo de un nivel, conservando el alcance y la condición que ya tenía. */
  function aplicarNivel(n: Nivel) {
    const quedan = accionesDelNivel(acciones, n)
    const cambios: CambioCelda[] = []
    for (const a of acciones) {
      const actual = configDe(a.codigo)
      const debe = quedan.has(a.codigo)
      if (actual.permitido === debe) continue
      cambios.push({
        accion: a.codigo,
        config: {
          ...actual,
          permitido: debe,
          alcance: debe && !actual.permitido ? alcance : actual.alcance,
          condicion: debe && a.escribe && conCondicion ? 'solo_abiertos_registrando' : actual.condicion,
        },
      })
    }
    if (cambios.length) onCambiar(cambios)
  }

  function aplicarAlcance(nuevo: Alcance) {
    const cambios = acciones
      .filter((a) => configDe(a.codigo).permitido && configDe(a.codigo).alcance !== nuevo)
      .map((a) => ({ accion: a.codigo, config: { ...configDe(a.codigo), alcance: nuevo } }))
    if (cambios.length) onCambiar(cambios)
  }

  function aplicarCondicion(solo: boolean) {
    const condicion = solo ? 'solo_abiertos_registrando' : 'sin_restriccion'
    const cambios = acciones
      .filter((a) => a.escribe && configDe(a.codigo).permitido && configDe(a.codigo).condicion !== condicion)
      .map((a) => ({ accion: a.codigo, config: { ...configDe(a.codigo), condicion } as ConfigPermiso }))
    if (cambios.length) onCambiar(cambios)
  }

  function alternarAccion(a: AccionDePantalla) {
    const actual = configDe(a.codigo)
    onCambiar([
      {
        accion: a.codigo,
        config: actual.permitido
          ? { ...actual, permitido: false }
          : {
              permitido: true,
              alcance: encendidas.size ? alcance : actual.alcance ?? PERMISO_APAGADO.alcance,
              condicion: a.escribe && conCondicion ? 'solo_abiertos_registrando' : 'sin_restriccion',
            },
      },
    ])
  }

  return (
    <div
      data-pantalla={codigo}
      className={`rounded-2xl border bg-white p-3.5 shadow-[var(--shadow-card)] transition-colors sm:p-4 ${
        difiere ? 'border-amber-300' : ve ? 'border-brand-200' : 'border-slate-200'
      } ${ocupada ? 'opacity-70' : ''}`}
    >
      {/* ---- Encabezado ---- */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-sm font-bold ${ve ? 'text-slate-900' : 'text-slate-400'}`}>{nombre}</p>
          {descripcion && <p className="text-xs text-slate-400">{descripcion}</p>}
        </div>
        <span className="shrink-0 text-xs font-semibold text-slate-400" data-cuenta>
          {encendidas.size}/{acciones.length}
        </span>
      </div>

      {/* ---- Nivel rápido ---- */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Nivel en ${nombre}`}>
        {NIVELES.filter((n) => niveles.includes(n.valor) || n.valor === 0).map((n) => (
          <button
            key={n.valor}
            type="button"
            disabled={ocupada}
            data-nivel={n.valor}
            aria-pressed={nivel === n.valor}
            title={n.detalle}
            onClick={() => aplicarNivel(n.valor)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-all disabled:opacity-50 ${
              nivel === n.valor
                ? 'bg-slate-900 text-white ring-slate-900'
                : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-400'
            }`}
          >
            {n.nombre}
          </button>
        ))}
        {nivel === null && <Insignia tono="ambar">A la medida</Insignia>}
      </div>

      {/* ---- Alcance y condición (solo si tiene algo encendido) ---- */}
      {encendidas.size > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Alcance en ${nombre}`}>
            <span className="mr-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Alcance</span>
            {ORDEN_ALCANCES.map((al) => (
              <button
                key={al}
                type="button"
                disabled={ocupada}
                data-alcance={al}
                aria-pressed={!mixto && alcance === al}
                title={detalleAlcance(al)}
                onClick={() => aplicarAlcance(al)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition-all disabled:opacity-50 ${
                  !mixto && alcance === al
                    ? 'bg-brand-700 text-white ring-brand-700'
                    : 'bg-white text-slate-600 ring-slate-200 hover:ring-slate-400'
                }`}
              >
                {nombreAlcance(al, etiquetasAlcance)}
              </button>
            ))}
            {mixto && <Insignia tono="ambar">Mixto</Insignia>}
          </div>

          {usaCondicion && (
            <button
              type="button"
              role="switch"
              aria-checked={conCondicion}
              disabled={ocupada}
              data-condicion
              onClick={() => aplicarCondicion(!conCondicion)}
              title="Solo puede escribir con el ticket abierto y todavía en «0 · Registrando». En cuanto pasa a revisión, se le cierra."
              className="flex items-center gap-2 text-xs font-semibold text-slate-600 disabled:opacity-50"
            >
              <span
                className={`relative h-4 w-7 rounded-full transition-colors ${conCondicion ? 'bg-amber-500' : 'bg-slate-300'}`}
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${conCondicion ? 'left-3.5' : 'left-0.5'}`}
                />
              </span>
              Solo mientras se registra
            </button>
          )}
        </div>
      )}

      {/* ---- Las acciones ---- */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {acciones.map((a) => {
          const c = configDe(a.codigo)
          const propio = c.permitido && (mixto || c.alcance !== alcance)
          return (
            <button
              key={a.codigo}
              type="button"
              role="checkbox"
              aria-checked={c.permitido}
              disabled={ocupada}
              data-accion={a.codigo}
              title={`${a.descripcion ?? a.nombre}${c.permitido ? ` · ${nombreAlcance(c.alcance, etiquetasAlcance)}` : ''}`}
              onClick={() => alternarAccion(a)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold ring-1 ring-inset transition-all disabled:opacity-50 ${
                c.permitido ? TONO_NIVEL[nivelDeAccion(a)] : 'bg-white text-slate-400 ring-slate-200 hover:text-slate-700'
              }`}
            >
              {c.permitido && <IconCheck className="h-3 w-3" />}
              {a.nombre}
              {propio && (
                <span className="rounded bg-white/70 px-1 text-[10px]">{nombreAlcance(c.alcance, etiquetasAlcance)}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ---- Comparación ---- */}
      {comparacion && (
        <p className="mt-2 text-xs text-slate-500" data-comparacion>
          {difiere ? (
            <>
              <strong>{comparacion.nombreRol}</strong>
              {comparacion.deMas.length > 0 && <> tiene además: {comparacion.deMas.join(', ')}.</>}
              {comparacion.deMenos.length > 0 && <> No tiene: {comparacion.deMenos.join(', ')}.</>}
            </>
          ) : (
            <>Igual que {comparacion.nombreRol}.</>
          )}
        </p>
      )}

      {/* ---- Ajuste fino por acción ---- */}
      {encendidas.size > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setDetalle((v) => !v)}
            aria-expanded={detalle}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-700"
          >
            <IconChevronDown className={`h-3.5 w-3.5 transition-transform ${detalle ? 'rotate-180' : ''}`} />
            Ajustar por acción
          </button>
          {detalle && (
            <div className="mt-2 divide-y divide-slate-100 rounded-xl ring-1 ring-inset ring-slate-200">
              {acciones
                .filter((a) => configDe(a.codigo).permitido)
                .map((a) => {
                  const c = configDe(a.codigo)
                  return (
                    <div key={a.codigo} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="min-w-28 flex-1 text-xs font-semibold text-slate-700">{a.nombre}</span>
                      <span className="flex flex-wrap gap-1" role="group" aria-label={`Alcance de ${a.nombre}`}>
                        {ORDEN_ALCANCES.map((al) => (
                          <button
                            key={al}
                            type="button"
                            disabled={ocupada}
                            data-alcance-accion={`${a.codigo}:${al}`}
                            aria-pressed={c.alcance === al}
                            onClick={() => onCambiar([{ accion: a.codigo, config: { ...c, alcance: al } }])}
                            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset disabled:opacity-50 ${
                              c.alcance === al
                                ? 'bg-brand-700 text-white ring-brand-700'
                                : 'bg-white text-slate-500 ring-slate-200 hover:ring-slate-400'
                            }`}
                          >
                            {nombreAlcance(al, etiquetasAlcance)}
                          </button>
                        ))}
                      </span>
                      {usaCondicion && a.escribe && (
                        <label className="flex items-center gap-1 text-xs text-slate-500">
                          <input
                            type="checkbox"
                            checked={c.condicion === 'solo_abiertos_registrando'}
                            disabled={ocupada}
                            onChange={(e) =>
                              onCambiar([
                                {
                                  accion: a.codigo,
                                  config: {
                                    ...c,
                                    condicion: e.target.checked ? 'solo_abiertos_registrando' : 'sin_restriccion',
                                  },
                                },
                              ])
                            }
                          />
                          Solo en registro
                        </label>
                      )}
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
