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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo, Entrada, Selector } from '@/components/ui/Primitivos'
import { formatearFecha } from '@/lib/estados'
import { n2 } from '@/lib/formato/reporte'
import {
  fechaAplicacionPrevista,
  fechaCosechaPrevista,
  fechaPreriegoPrevista,
  totalesPlan,
  validarPlan,
} from '@/lib/desinfeccion/calculo'
import { siembrasAgl, type SiembraAgl } from '@/lib/desinfeccion/repositorioCliente'
import { MONEDAS_PLAN } from '@/lib/desinfeccion/tipos'
import type {
  CatalogosDesinfeccion,
  EntradaPlan,
  LoteDesinfeccion,
  MonedaPlan,
} from '@/lib/desinfeccion/tipos'

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
  const preriego = fechaPreriegoPrevista(entrada)
  const lote = lotes.find((l) => l.lote_temporada_id === entrada.loteTemporadaId)

  // El DDT de cosecha sale de la VARIEDAD elegida (migración 75). Sin
  // él no hay fecha, y la pantalla lo dice en vez de inventarla: una
  // fecha inventada aquí acabaría en el calendario de la finca.
  const variedad = catalogos.variedades.find((v) => v.id === entrada.variedadId)
  const ddtCosecha = variedad?.ddt_cosecha ?? null
  const cosecha = fechaCosechaPrevista(entrada, ddtCosecha)

  /**
   * Los turnos que AGL publicó para esta temporada y ciclo, con su siembra.
   *
   * Desde la 104 la siembra vive en AGL (Trasplante se retiró de aquí):
   * elegir el turno trae su fecha. Se pide al cambiar temporada o ciclo.
   */
  const [turnosAgl, setTurnosAgl] = useState<SiembraAgl[]>([])
  const [buscandoTurnos, setBuscandoTurnos] = useState(false)
  useEffect(() => {
    let vivo = true
    async function leer() {
      if (!entrada.temporadaId) {
        setTurnosAgl([])
        return
      }
      setBuscandoTurnos(true)
      const mapa = await siembrasAgl(entrada.temporadaId, Number(entrada.ciclo) || null)
      if (!vivo) return
      setTurnosAgl([...mapa.values()].sort((a, b) => a.turnoCodigo.localeCompare(b.turnoCodigo)))
      setBuscandoTurnos(false)
    }
    void leer()
    return () => {
      vivo = false
    }
  }, [entrada.temporadaId, entrada.ciclo])

  /**
   * Elegir el turno trae su fecha de siembra publicada por AGL.
   *
   * Elegirlo ES pedir esa fecha, así que se escribe aunque hubiera otra; y
   * se DICE, porque un campo que cambia solo y en silencio es un campo que
   * nadie vuelve a mirar. La fecha sigue congelada: si AGL la mueve
   * después, el plan no se mueve solo (para eso está «Sincronizar»).
   */
  const elegirTurno = useCallback(
    (turnoId: string) => {
      const dato = turnosAgl.find((t) => t.turnoId === turnoId)
      if (!turnoId || !dato) {
        onCambiar({ ...entrada, turnoId })
        setAutollenado(null)
        return
      }
      onCambiar({ ...entrada, turnoId, fechaSiembraCongelada: dato.fecha })
      setAutollenado(
        `Siembra tomada de AGL: turno ${dato.turnoCodigo}, ${formatearFecha(dato.fecha)}.` +
          (dato.candidatos > 1
            ? ` AGL tiene ${dato.candidatos} registros de este turno en el ciclo: se tomó la siembra más próxima.`
            : ''),
      )
    },
    [entrada, onCambiar, turnosAgl],
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
              onChange={(e) => cambiar({ temporadaId: e.target.value, loteTemporadaId: '', turnoId: '' })}
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
              onChange={(e) => cambiar({ ciclo: e.target.value, turnoId: '' })}
            />
          </Campo>

          <Campo etiqueta="Lote" requerido className="sm:col-span-2">
            {/* Buscable: el panel sale al `body` y no lo recorta el
                modal (migración 71). Y con treinta lotes, un buscador
                vale más que una rueda. */}
            <Selector
              value={entrada.loteTemporadaId}
              buscable
              onChange={(e) => cambiar({ loteTemporadaId: e.target.value })}
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
            etiqueta="Turno (siembra de AGL)"
            className="sm:col-span-2"
            ayuda={
              buscandoTurnos
                ? 'Buscando los turnos publicados desde AGL…'
                : turnosAgl.length === 0
                  ? 'AGL todavía no ha publicado turnos con fecha de siembra para esta temporada y ciclo («Publicar a campo» en AGL). Puedes escribir la fecha a mano.'
                  : 'Trae la fecha de siembra del turno tal como la publicó AGL.'
            }
          >
            <div data-turno-agl>
              <Selector
                value={entrada.turnoId}
                buscable
                onChange={(e) => elegirTurno(e.target.value)}
              >
                <option value="">Sin turno (fecha a mano)</option>
                {turnosAgl.map((t) => (
                  <option key={t.turnoId} value={t.turnoId}>
                    {t.turnoCodigo} — siembra {formatearFecha(t.fecha)}
                  </option>
                ))}
              </Selector>
            </div>
          </Campo>

          <Campo
            etiqueta="Fecha de siembra"
            requerido
            ayuda="Sale del turno de AGL y se queda quieta: si la siembra se mueve, el plan no se mueve solo."
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

          {/* Días del preriego CONTRA la aplicación (migración 75).
              Déjalo vacío y el preriego se queda sin planificar, que es
              distinto de planificarlo para el mismo día —eso es un cero—. */}
          <Campo
            etiqueta="Días pre-riego"
            ayuda="Contra la aplicación, no contra la siembra. Negativo = antes de aplicar, que es lo normal. Vacío = todavía sin planificar."
          >
            <Entrada
              inputMode="numeric"
              value={entrada.diasPreriego}
              onChange={(e) => cambiar({ diasPreriego: e.target.value })}
              placeholder="Sin planificar"
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

          <Campo etiqueta="Costo por litro">
            <Entrada
              inputMode="decimal"
              value={entrada.costoLitro}
              onChange={(e) => cambiar({ costoLitro: e.target.value })}
              placeholder="0.0000"
            />
          </Campo>

          {/* El químico se importa, así que el costo lleva su moneda
              desde la 67. La conversión a lempiras la hace la BASE con
              la tasa de SU temporada: el navegador no puede decidirla
              porque la tasa no vive aquí. */}
          <Campo
            etiqueta="Moneda"
            ayuda={
              entrada.moneda === 'USD'
                ? 'Se convierte a lempiras con la tasa de la temporada.'
                : 'Lempiras.'
            }
          >
            <Selector
              value={entrada.moneda}
              onChange={(e) => cambiar({ moneda: e.target.value as MonedaPlan })}
            >
              {MONEDAS_PLAN.map((m) => (
                <option key={m} value={m}>
                  {m === 'HNL' ? 'Lempiras (HNL)' : 'Dólares (USD)'}
                </option>
              ))}
            </Selector>
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
              Fecha pre-riego
            </p>
            <p className="mt-0.5 text-sm font-bold text-slate-900">
              {preriego ? formatearFecha(preriego) : '—'}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              {preriego
                ? 'Aplicación + días de pre-riego. La calcula la base.'
                : 'Escribe los días de pre-riego y sale sola.'}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-inset ring-slate-200">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Fecha de cosecha
            </p>
            <p className="mt-0.5 text-sm font-bold text-slate-900">
              {cosecha ? formatearFecha(cosecha) : '—'}
            </p>
            {/* Sin DDT en la variedad se dice POR QUÉ y dónde se arregla:
                un «—» mudo parece un fallo de la pantalla en vez de un
                hueco del catálogo. */}
            <p className="mt-1 text-[11px] text-slate-400">
              {cosecha
                ? `Siembra + ${ddtCosecha} días de la variedad.`
                : entrada.variedadId
                  ? 'Falta el DDT de cosecha de esta variedad: se configura en Catálogos → Variedades.'
                  : 'Elige la variedad y sale sola.'}
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
