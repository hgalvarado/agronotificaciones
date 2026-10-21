'use client'

/**
 * Un acarreo.
 *
 * ── Lo que cambió en la 76 ──────────────────────────────────────────
 *
 * Antes este formulario tenía una sola pregunta de reparto —la zona— y
 * una sola de dinero —el costo por hora—. Las dos se quedaron cortas:
 *
 *   · **El ciclo.** Sin él, un acarreo de enero se repartía entre las
 *     manzanas regadas de agosto. El ciclo es ahora obligatorio y es la
 *     primera llave del reparto.
 *   · **A quién se le cobra.** El acarreo que se hace PARA UN LOTE se
 *     diluía entre toda la zona. Ahora se dice de entrada: cargo a la
 *     zona (la bolsa de siempre) o cargo al lote (sólo los marcados).
 *   · **Las tres patas del costo.** Equipo, implemento y operador. El
 *     implemento no costaba nada «porque no tiene tabla de tarifas», lo
 *     que en la práctica quería decir que el acarreo salía barato en el
 *     informe. Ahora se escribe, y el jornal del operador también.
 *
 * El orden de los campos sigue el orden en que se decide: primero a qué
 * ciclo y a quién se le cobra, después el trabajo, después el dinero.
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo, Entrada, Selector } from '@/components/ui/Primitivos'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import {
  costoLogistica,
  implementoPorDefecto,
  validarLogistica,
} from '@/lib/desinfeccion/calculo'
import { n2 } from '@/lib/trasplante/formato'
import { salarioMinimo, tarifaEquipo } from '@/lib/desinfeccion/repositorioCliente'
import type {
  CatalogosDesinfeccion,
  EntradaLogistica,
  LoteDesinfeccion,
  TipoCargoLogistica,
} from '@/lib/desinfeccion/tipos'

const CARGOS: { valor: TipoCargoLogistica; titulo: string; pie: string }[] = [
  {
    valor: 'zona',
    titulo: '1. Cargo a Zona',
    pie: 'Se reparte entre las manzanas regadas de la zona en este ciclo.',
  },
  {
    valor: 'lote',
    titulo: '2. Cargo al Lote',
    pie: 'Se reparte SÓLO entre los lotes que marques, por su área.',
  },
]

export function LogisticaModal({
  entrada,
  catalogos,
  lotes,
  zonasPermitidas,
  guardando,
  onCambiar,
  onGuardar,
  onCerrar,
}: {
  entrada: EntradaLogistica
  catalogos: CatalogosDesinfeccion
  /** Los lotes de la temporada, ya recortados por zona por la base. */
  lotes: LoteDesinfeccion[]
  /** `null` = sin recorte. Lo decide `zonasParaCrear`. */
  zonasPermitidas: Set<string> | null
  guardando: boolean
  onCambiar: (e: EntradaLogistica) => void
  onGuardar: () => void
  onCerrar: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  const zonas =
    zonasPermitidas === null
      ? catalogos.zonas
      : catalogos.zonas.filter((z) => zonasPermitidas.has(z.id))

  const cambiar = (c: Partial<EntradaLogistica>) => onCambiar({ ...entrada, ...c })

  /* ---------------------- Lo que la pantalla adelanta ------------------ */

  // El implemento del trocón viene marcado: es con el que se hace casi
  // todo el acarreo y buscarlo cada vez en una lista larga es trabajo
  // que no hace falta. Sólo en un acarreo NUEVO y sin implemento puesto.
  useEffect(() => {
    if (entrada.id || entrada.implementoId) return
    const porDefecto = implementoPorDefecto(catalogos.implementos)
    if (porDefecto) cambiar({ implementoId: porDefecto })
    // Una vez, al abrir en blanco: después manda lo que el usuario elija.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /*
   * ── Los tres autorrellenos, en UN solo efecto ──────────────────────
   *
   * Tienen que ir juntos. Cada uno es una promesa, y cada uno construía
   * su cambio sobre el `entrada` que tenía en la mano al empezar: el
   * último en resolverse pisaba lo que habían escrito los otros dos.
   * Medido en el banco: la tarifa del equipo desaparecía en cuanto el
   * implemento traía la suya.
   *
   * Se resuelven las tres y se aplica UN cambio con lo que falte. Lo que
   * el usuario ya escribió nunca se toca: un costo tecleado gana siempre
   * sobre el del catálogo.
   */
  useEffect(() => {
    let vivo = true
    const { fecha, equipoId, implementoId, operadorId } = entrada
    if (!fecha) return

    const pendientes: Promise<Partial<EntradaLogistica>>[] = []

    if (equipoId && !entrada.costoHoraEquipo)
      pendientes.push(
        tarifaEquipo(equipoId, fecha).then((v) =>
          v !== null && v > 0 ? { costoHoraEquipo: String(v) } : {},
        ),
      )

    // El implemento sale de la MISMA tabla de tarifas que el equipo. Hoy
    // casi ninguno tiene una dada de alta, así que lo normal es que no
    // pase nada y se escriba a mano; el día que se le ponga, esto la
    // encuentra sin tocar una línea.
    if (implementoId && !entrada.costoHoraImplemento)
      pendientes.push(
        tarifaEquipo(implementoId, fecha).then((v) =>
          v !== null && v > 0 ? { costoHoraImplemento: String(v) } : {},
        ),
      )

    if (operadorId && !entrada.salarioOperador)
      pendientes.push(
        salarioMinimo(fecha).then((v) =>
          v !== null && v > 0 ? { salarioOperador: String(v) } : {},
        ),
      )

    if (pendientes.length === 0) return

    void Promise.all(pendientes).then((partes) => {
      const juntos = Object.assign({}, ...partes) as Partial<EntradaLogistica>
      if (vivo && Object.keys(juntos).length > 0) cambiar(juntos)
    })

    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entrada.equipoId, entrada.implementoId, entrada.operadorId, entrada.fecha])

  /* ------------------------------ Derivados ---------------------------- */

  const opcionesLotes = useMemo(
    () =>
      lotes.map((l) => ({
        valor: l.lote_temporada_id,
        etiqueta: `${l.nomenclatura}${l.nombre ? ` · ${l.nombre}` : ''}`,
      })),
    [lotes],
  )

  /**
   * La zona sale de los lotes marcados, no se pregunta aparte.
   *
   * Con cargo al lote la zona sigue siendo obligatoria en la base —es la
   * llave de la reja zonal—, pero preguntarla por separado invita a
   * dejarla distinta de la de los lotes, y entonces el acarreo lo ve
   * quien no debe. Se toma la del primer lote marcado.
   */
  const zonaDeLotes = useMemo(() => {
    if (entrada.tipoCargo !== 'lote' || entrada.lotesIds.length === 0) return ''
    for (const id of entrada.lotesIds) {
      const z = lotes.find((l) => l.lote_temporada_id === id)?.zona_id
      if (z) return z
    }
    return ''
  }, [entrada.tipoCargo, entrada.lotesIds, lotes])

  useEffect(() => {
    if (zonaDeLotes && zonaDeLotes !== entrada.zonaId) cambiar({ zonaId: zonaDeLotes })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonaDeLotes])

  const costo = costoLogistica(entrada)

  function guardar() {
    const problema = validarLogistica(entrada)
    if (problema) return setError(problema)
    setError(null)
    onGuardar()
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={entrada.id ? 'Editar acarreo' : 'Nuevo acarreo'}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta>{error}</Alerta>}

        {/* ---------------- 1 · A qué ciclo pertenece ------------------- */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Temporada" requerido>
            <Selector
              value={entrada.temporadaId}
              onChange={(e) => cambiar({ temporadaId: e.target.value })}
            >
              <option value="">Elige la temporada…</option>
              {catalogos.temporadas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                  {t.activa ? ' (activa)' : ''}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo
            etiqueta="Ciclo"
            requerido
            ayuda="El acarreo se reparte DENTRO de este ciclo. Uno de enero ya no ensucia el de agosto."
          >
            <Entrada
              inputMode="numeric"
              value={entrada.ciclo}
              onChange={(e) => cambiar({ ciclo: e.target.value })}
              placeholder="1"
            />
          </Campo>
        </div>

        {/* ---------------- 2 · A quién se le cobra --------------------- */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-semibold text-slate-500">
            Tipo de cargo <span className="text-rose-500">*</span>
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CARGOS.map((c) => {
              const activo = entrada.tipoCargo === c.valor
              return (
                <button
                  key={c.valor}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => cambiar({ tipoCargo: c.valor })}
                  className={`rounded-xl border px-3.5 py-2.5 text-left transition ${
                    activo
                      ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <span
                    className={`block text-sm font-semibold ${
                      activo ? 'text-emerald-900' : 'text-slate-700'
                    }`}
                  >
                    {c.titulo}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                    {c.pie}
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>

        {entrada.tipoCargo === 'zona' ? (
          <Campo
            etiqueta="Zona"
            requerido
            ayuda="El acarreo se reparte entre las manzanas regadas de ESTA zona en este ciclo."
          >
            <Selector value={entrada.zonaId} onChange={(e) => cambiar({ zonaId: e.target.value })}>
              <option value="">Elige la zona…</option>
              {zonas.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.nombre}
                </option>
              ))}
            </Selector>
          </Campo>
        ) : (
          <div className="flex flex-col gap-1.5">
            <SelectorMultiple
              etiqueta="Lotes cargados *"
              opciones={opcionesLotes}
              valores={entrada.lotesIds}
              onCambiar={(v) => cambiar({ lotesIds: v })}
            />
            <p className="text-[11px] text-slate-400">
              {entrada.lotesIds.length === 0
                ? 'Sin lotes marcados el cargo no se le puede cobrar a nadie.'
                : `La zona se toma de los lotes: ${
                    catalogos.zonas.find((z) => z.id === entrada.zonaId)?.nombre ?? '—'
                  }.`}
            </p>
          </div>
        )}

        {/* ---------------- 3 · El trabajo ------------------------------ */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha" requerido>
            <Entrada
              type="date"
              value={entrada.fecha}
              onChange={(e) => cambiar({ fecha: e.target.value })}
            />
          </Campo>

          <Campo etiqueta="Horas de trabajo" requerido>
            <Entrada
              inputMode="decimal"
              value={entrada.horasTrabajo}
              onChange={(e) => cambiar({ horasTrabajo: e.target.value })}
              placeholder="0.00"
            />
          </Campo>
        </div>

        {/* ---------------- 4 · El dinero, pata por pata ---------------- */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Equipo" requerido ayuda="De aquí sale la tarifa por hora.">
            {/* Buscables: el panel sale al `body` con `anclarPanel` y el
                modal ya no lo recorta (migración 71). */}
            <Selector
              value={entrada.equipoId}
              buscable
              onChange={(e) => cambiar({ equipoId: e.target.value })}
            >
              <option value="">Elige el equipo…</option>
              {catalogos.equipos.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.codigo} · {x.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo
            etiqueta="Costo por hora equipo"
            ayuda="Se propone desde la tarifa vigente del día. Lo que escribas manda."
          >
            <Entrada
              inputMode="decimal"
              value={entrada.costoHoraEquipo}
              onChange={(e) => cambiar({ costoHoraEquipo: e.target.value })}
              placeholder="De la tarifa del equipo"
            />
            <p className="mt-1 text-[11px] text-slate-400 tabular-nums">
              Subtotal equipo: L {n2(costo.equipo)}
            </p>
          </Campo>

          <Campo etiqueta="Implemento">
            <Selector
              value={entrada.implementoId}
              buscable
              onChange={(e) => cambiar({ implementoId: e.target.value })}
            >
              <option value="">Sin implemento</option>
              {catalogos.implementos.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.codigo} · {x.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo
            etiqueta="Costo por hora implemento"
            ayuda="Hasta la 75 no se cobraba: el acarreo salía más barato de lo que era."
          >
            <Entrada
              inputMode="decimal"
              value={entrada.costoHoraImplemento}
              onChange={(e) => cambiar({ costoHoraImplemento: e.target.value })}
              placeholder="0.00"
            />
            <p className="mt-1 text-[11px] text-slate-400 tabular-nums">
              Subtotal implemento: L {n2(costo.implemento)}
            </p>
          </Campo>

          <Campo etiqueta="Operador">
            <Selector
              value={entrada.operadorId}
              buscable
              onChange={(e) =>
                cambiar({
                  operadorId: e.target.value,
                  // Sin operador no hay jornal: el disparador lo borra en
                  // la base y la pantalla lo dice antes de guardar.
                  salarioOperador: e.target.value ? entrada.salarioOperador : '',
                })
              }
            >
              <option value="">Sin operador</option>
              {catalogos.operadores.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo
            etiqueta="Salario operador"
            ayuda="Se propone el salario mínimo del día. Es un jornal, no se multiplica por horas."
          >
            <Entrada
              inputMode="decimal"
              value={entrada.salarioOperador}
              onChange={(e) => cambiar({ salarioOperador: e.target.value })}
              placeholder={entrada.operadorId ? 'Del salario mínimo' : 'Sin operador'}
              disabled={!entrada.operadorId}
            />
          </Campo>

          <Campo etiqueta="Comentarios" className="sm:col-span-2">
            <Entrada
              value={entrada.comentarios}
              onChange={(e) => cambiar({ comentarios: e.target.value })}
            />
          </Campo>
        </div>

        {/* ---------------- 5 · El total, a la vista -------------------- */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="tabular-nums">Equipo L {n2(costo.equipo)}</span>
            <span className="tabular-nums">+ Implemento L {n2(costo.implemento)}</span>
            <span className="tabular-nums">+ Operador L {n2(costo.operador)}</span>
          </div>
          <p className="mt-1.5 flex items-baseline justify-between">
            <span className="text-xs font-semibold text-slate-600">Costo total</span>
            <span
              className="text-xl font-bold tracking-tight text-slate-900 tabular-nums"
              data-prueba="logistica-total"
            >
              L {n2(costo.total)}
            </span>
          </p>
        </div>
      </div>
    </Modal>
  )
}
