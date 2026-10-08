'use client'

/**
 * Alta y corrección de una línea del plan de desinfección.
 *
 * Es un formulario corto, así que va en una sola columna apilada —sin
 * acordeón— y en escritorio se reparte en dos. La única sutileza está en
 * las dos cajas grises del final: enseñan lo que la BASE va a calcular
 * (la fecha de aplicación y los tres totales), no lo que el formulario
 * decide. Son columnas generadas; esto es sólo verlas antes de guardar.
 */

import { useCallback, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo, Entrada, Selector } from '@/components/ui/Primitivos'
import { formatearFecha } from '@/lib/estados'
import { n2 } from '@/lib/trasplante/formato'
import { fechaAplicacionPrevista, totalesPlan, validarPlan } from '@/lib/desinfeccion/calculo'
import { siembrasDeLotes } from '@/lib/desinfeccion/repositorioCliente'
import type { CatalogosDesinfeccion, EntradaPlan, LoteDesinfeccion } from '@/lib/desinfeccion/tipos'

export function PlanModal({
  entrada,
  catalogos,
  lotes,
  guardando,
  onCambiar,
  onGuardar,
  onCerrar,
}: {
  entrada: EntradaPlan
  catalogos: CatalogosDesinfeccion
  /** Los lotes que esta persona puede elegir, ya recortados por zona. */
  lotes: LoteDesinfeccion[]
  guardando: boolean
  onCambiar: (e: EntradaPlan) => void
  onGuardar: () => void
  onCerrar: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [autollenado, setAutollenado] = useState<string | null>(null)

  const totales = useMemo(() => totalesPlan(entrada), [entrada])
  const aplicacion = fechaAplicacionPrevista(entrada)
  const lote = lotes.find((l) => l.lote_temporada_id === entrada.loteTemporadaId)

  /**
   * Elegir el lote trae su siembra y su variedad.
   *
   * No es un adorno: la fecha de siembra es de donde sale la de
   * aplicación, y escribirla a mano con el plan de Trasplante abierto en
   * otra pestaña es cómo se cuelan las fechas equivocadas. Los días a la
   * aplicación siguen siendo a mano —eso lo decide el agrónomo, no el
   * sistema—.
   *
   * Lo que ya estaba escrito NO se pisa: si alguien corrigió la fecha a
   * propósito, el autollenado no puede deshacérsela. Y se DICE que se
   * rellenó, porque un campo que cambia solo y en silencio es un campo
   * que nadie vuelve a mirar.
   */
  const elegirLote = useCallback(
    async (loteTemporadaId: string) => {
      const base = { ...entrada, loteTemporadaId }
      onCambiar(base)
      setAutollenado(null)
      if (!loteTemporadaId) return

      const mapa = await siembrasDeLotes([loteTemporadaId], Number(entrada.ciclo) || null)
      const dato = mapa.get(loteTemporadaId)
      if (!dato) {
        setAutollenado('Ese lote todavía no tiene siembra capturada en Trasplante.')
        return
      }

      const cambios: Partial<EntradaPlan> = {}
      if (!base.fechaSiembraCongelada) cambios.fechaSiembraCongelada = dato.fecha
      if (!base.variedadId && dato.variedadId) cambios.variedadId = dato.variedadId

      if (Object.keys(cambios).length === 0) {
        setAutollenado('El lote ya tenía fecha y variedad escritas: no se tocaron.')
        return
      }
      onCambiar({ ...base, ...cambios })
      setAutollenado(
        `Se tomó de Trasplante: siembra ${dato.fecha}${dato.variedad ? ` · ${dato.variedad}` : ''}.`
      )
    },
    [entrada, onCambiar]
  )

  function guardar() {
    const problema = validarPlan(entrada)
    if (problema) return setError(problema)
    setError(null)
    onGuardar()
  }

  const cambiar = (cambios: Partial<EntradaPlan>) => onCambiar({ ...entrada, ...cambios })

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={entrada.id ? 'Editar línea del plan' : 'Nueva línea del plan'}
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
        {autollenado && <Alerta tono="azul">{autollenado}</Alerta>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Temporada" requerido>
            <Selector
              value={entrada.temporadaId}
              onChange={(e) => cambiar({ temporadaId: e.target.value, loteTemporadaId: '' })}
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

          <Campo etiqueta="Ciclo" requerido ayuda="Un lote no se planifica dos veces en el mismo ciclo.">
            <Entrada
              inputMode="numeric"
              value={entrada.ciclo}
              onChange={(e) => cambiar({ ciclo: e.target.value })}
            />
          </Campo>

          <Campo etiqueta="Lote" requerido className="sm:col-span-2">
            <Selector
              value={entrada.loteTemporadaId}
              onChange={(e) => void elegirLote(e.target.value)}
            >
              <option value="">Elige el lote…</option>
              {lotes.map((l) => (
                <option key={l.lote_temporada_id} value={l.lote_temporada_id}>
                  {l.nomenclatura}
                  {l.nombre ? ` · ${l.nombre}` : ''} — {n2(l.area_neta)} mz
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo
            etiqueta="Fecha de siembra"
            requerido
            ayuda="La trae el lote desde Trasplante y se queda quieta: si la siembra se mueve, el plan no se mueve solo."
          >
            <Entrada
              type="date"
              value={entrada.fechaSiembraCongelada}
              onChange={(e) => cambiar({ fechaSiembraCongelada: e.target.value })}
            />
          </Campo>

          <Campo etiqueta="Días a la aplicación" ayuda="Desde la siembra. Puede ser negativo si se aplica antes.">
            <Entrada
              inputMode="numeric"
              value={entrada.diasAplicacion}
              onChange={(e) => cambiar({ diasAplicacion: e.target.value })}
            />
          </Campo>

          <Campo etiqueta="Variedad">
            <Selector value={entrada.variedadId} onChange={(e) => cambiar({ variedadId: e.target.value })}>
              <option value="">Sin variedad</option>
              {catalogos.variedades.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Producto" ayuda="Sale de Materiales: es un insumo, no un cultivo.">
            <Selector value={entrada.productoId} onChange={(e) => cambiar({ productoId: e.target.value })}>
              <option value="">Sin producto</option>
              {catalogos.materiales.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.codigo}
                  {m.descripcion ? ` · ${m.descripcion}` : ''}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Dosis por mz (L)">
            <Entrada
              inputMode="decimal"
              value={entrada.dosisMz}
              onChange={(e) => cambiar({ dosisMz: e.target.value })}
              placeholder="0.00"
            />
          </Campo>

          <Campo
            etiqueta="Área planificada (mz)"
            ayuda={lote ? `El lote tiene ${n2(lote.area_neta)} mz netas.` : undefined}
          >
            <Entrada
              inputMode="decimal"
              value={entrada.areaPlanificadaMz}
              onChange={(e) => cambiar({ areaPlanificadaMz: e.target.value })}
              placeholder="0.00"
            />
          </Campo>

          <Campo etiqueta="Costo por litro (L)">
            <Entrada
              inputMode="decimal"
              value={entrada.costoLitro}
              onChange={(e) => cambiar({ costoLitro: e.target.value })}
              placeholder="0.0000"
            />
          </Campo>

          <Campo etiqueta="Comentarios" className="sm:col-span-2">
            <Entrada
              value={entrada.comentarios}
              onChange={(e) => cambiar({ comentarios: e.target.value })}
            />
          </Campo>
        </div>

        {/* Lo que va a calcular la base. No se puede escribir a mano. */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-inset ring-slate-200">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Fecha de aplicación
            </p>
            <p className="mt-0.5 text-sm font-bold text-slate-900">
              {aplicacion ? formatearFecha(aplicacion) : '—'}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Siembra + días. La calcula la base; aquí sólo se ve.
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-inset ring-slate-200">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Totales previstos
            </p>
            <p className="mt-0.5 text-sm font-bold text-slate-900 tabular-nums">
              {n2(totales.litros)} L · L {n2(totales.costo)}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              L {n2(totales.costoMz)} por manzana.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  )
}
