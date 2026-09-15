'use client'

/**
 * Alta y corrección de un turno de riego: cabecera arriba, lotes abajo.
 *
 * Los dos van en el mismo formulario porque van en la misma transacción.
 * Partirlo en dos pasos —«crea el turno, luego agrégale lotes»— deja
 * cabeceras sin lotes cada vez que alguien cierra la pestaña a medias, y
 * una cabecera sin lotes no riega nada pero sí aparece en los conteos.
 *
 * Es sólo pantalla: valida `lib/riego/validacion` y guarda
 * `lib/riego/repositorioCliente`.
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo, Entrada, Selector } from '@/components/ui/Primitivos'
import { IconPlus, IconTrash } from '@/components/ui/Icons'
import { leerLotesRegables } from '@/lib/riego/repositorioCliente'
import { aNumero, validarCabecera, validarLineas } from '@/lib/riego/validacion'
import {
  ESTADOS_TURNO,
  FUENTES_AGUA,
  CICLOS_RIEGO,
  LINEA_VACIA,
  type CatalogosRiego,
  type EntradaTurno,
  type EstadoTurno,
  type LineaTurno,
  type LoteRegable,
} from '@/lib/riego/tipos'

export function TurnoRiegoModal({
  entrada,
  lineas,
  catalogos,
  guardando,
  onCambiarEntrada,
  onCambiarLineas,
  onGuardar,
  onCerrar,
}: {
  entrada: EntradaTurno
  lineas: LineaTurno[]
  catalogos: CatalogosRiego
  guardando: boolean
  onCambiarEntrada: (e: EntradaTurno) => void
  onCambiarLineas: (l: LineaTurno[]) => void
  onGuardar: () => void
  onCerrar: () => void
}) {
  const [saldos, setSaldos] = useState<LoteRegable[]>([])
  const [cargandoSaldos, setCargandoSaldos] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* ------------------------ El saldo de cada lote ---------------------- */
  // Se pide a la base y no se calcula aquí: el tope depende del plan de
  // siembra, de lo sembrado de verdad y de lo que ya se llevaron otros
  // turnos. Esa cuenta vive en `fn_lotes_regables` y tiene que decir lo
  // mismo que el disparador que después acepta o rechaza el guardado.
  useEffect(() => {
    // La consulta va dentro del efecto y el estado se toca después del
    // await: llamarlo en seco es `set-state-in-effect` en React 19.
    let vivo = true
    async function cargar() {
      if (!entrada.temporadaId) {
        setSaldos([])
        return
      }
      setCargandoSaldos(true)
      const { datos } = await leerLotesRegables(
        entrada.temporadaId,
        entrada.zonaId || null,
        entrada.turnoId
      )
      if (!vivo) return
      setSaldos(datos)
      setCargandoSaldos(false)
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [entrada.temporadaId, entrada.zonaId, entrada.turnoId])

  const porLote = useMemo(
    () => new Map(saldos.map((s) => [s.lote_temporada_id, s])),
    [saldos]
  )

  const totalMz = useMemo(
    () => lineas.reduce((a, l) => a + (aNumero(l.areaTurno) ?? 0), 0),
    [lineas]
  )

  /* ------------------------------ Acciones ----------------------------- */

  function cambiarZona(zonaId: string) {
    const zona = catalogos.zonas.find((z) => z.id === zonaId)
    onCambiarEntrada({
      ...entrada,
      zonaId,
      // El responsable sale de la zona, salvo que ya lo hayan escrito a
      // mano: un suplente atiende el turno sin que eso cambie el catálogo.
      responsable:
        entrada.responsable && entrada.responsable !== zonaAnterior(catalogos, entrada.zonaId)
          ? entrada.responsable
          : (zona?.responsable ?? ''),
    })
    // Los lotes elegidos pueden no ser de la zona nueva; se quedan, pero
    // el saldo se vuelve a pedir y la validación avisará.
  }

  /**
   * Elegir el turno del catálogo.
   *
   * «Al seleccionar un Turno el sistema debe autoseleccionar su Zona
   *  asignada, permitiendo cambiarla si el turno se movió temporalmente.»
   *
   * Por eso la zona se PROPONE y no se bloquea: el catálogo dice dónde
   * está ese turno normalmente, y el registro dice dónde estuvo ese día.
   * El responsable viene detrás, que es lo que cambia al cambiar de zona.
   */
  function cambiarTurno(turnoCatalogoId: string) {
    const turno = catalogos.turnos.find((t) => t.id === turnoCatalogoId)
    const zonaId = turno?.zona_id ?? entrada.zonaId
    const zona = catalogos.zonas.find((z) => z.id === zonaId)

    onCambiarEntrada({
      ...entrada,
      turnoCatalogoId,
      turno: turno?.codigo ?? entrada.turno,
      zonaId,
      responsable:
        entrada.responsable && entrada.responsable !== zonaAnterior(catalogos, entrada.zonaId)
          ? entrada.responsable
          : (zona?.responsable ?? ''),
    })
  }

  function cambiarLinea(i: number, cambios: Partial<LineaTurno>) {
    onCambiarLineas(lineas.map((l, j) => (i === j ? { ...l, ...cambios } : l)))
  }

  function guardar() {
    const problema = validarCabecera(entrada) ?? validarLineas(lineas, saldos)
    if (problema) return setError(problema)
    setError(null)
    onGuardar()
  }

  const esNuevo = !entrada.turnoId

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={esNuevo ? 'Nuevo turno de riego' : `Editar turno ${entrada.turno}`}
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

        {/* ------------------------ Cabecera ------------------------- */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Temporada" requerido>
            <Selector
              value={entrada.temporadaId}
              onChange={(e) => onCambiarEntrada({ ...entrada, temporadaId: e.target.value })}
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

          <Campo etiqueta="Ciclo" requerido>
            <Selector
              value={entrada.ciclo}
              onChange={(e) => onCambiarEntrada({ ...entrada, ciclo: e.target.value })}
            >
              {CICLOS_RIEGO.map((c) => (
                <option key={c} value={String(c)}>
                  Ciclo {c}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo
            etiqueta="Fecha de siembra"
            ayuda="De aquí sale el DDT, que se recalcula solo cada día."
            requerido
          >
            <Entrada
              type="date"
              value={entrada.fechaSiembra}
              onChange={(e) => onCambiarEntrada({ ...entrada, fechaSiembra: e.target.value })}
            />
          </Campo>

          <Campo
            etiqueta="Turno"
            ayuda={
              catalogos.turnos.length > 0
                ? 'Elegirlo pone su zona. Cámbiala si ese día se movió.'
                : 'Todavía no hay turnos en el catálogo: se escribe a mano.'
            }
            requerido
          >
            {catalogos.turnos.length > 0 ? (
              <Selector value={entrada.turnoCatalogoId} onChange={(e) => cambiarTurno(e.target.value)}>
                <option value="">Elige el turno…</option>
                {catalogos.turnos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.codigo}
                  </option>
                ))}
              </Selector>
            ) : (
              <Entrada
                value={entrada.turno}
                onChange={(e) => onCambiarEntrada({ ...entrada, turno: e.target.value })}
                placeholder="T1001-T05"
              />
            )}
          </Campo>

          <Campo etiqueta="Zona" requerido>
            <Selector value={entrada.zonaId} onChange={(e) => cambiarZona(e.target.value)}>
              <option value="">Elige la zona…</option>
              {catalogos.zonas.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Responsable" ayuda="Viene de la zona. Cámbialo si lo atiende otro.">
            <Entrada
              value={entrada.responsable}
              onChange={(e) => onCambiarEntrada({ ...entrada, responsable: e.target.value })}
              placeholder="Responsable de la zona"
            />
          </Campo>

          <Campo etiqueta="Plan nutricional">
            <Selector
              value={entrada.planNutricionalId}
              onChange={(e) =>
                onCambiarEntrada({ ...entrada, planNutricionalId: e.target.value })
              }
            >
              <option value="">Sin plan</option>
              {catalogos.planes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Estación de riego">
            {catalogos.estaciones.length > 0 ? (
              <Selector
                value={entrada.estacionRiegoId}
                onChange={(e) => {
                  const est = catalogos.estaciones.find((x) => x.id === e.target.value)
                  onCambiarEntrada({
                    ...entrada,
                    estacionRiegoId: e.target.value,
                    estacionRiego: est?.nombre ?? '',
                  })
                }}
              >
                <option value="">Sin estación</option>
                {catalogos.estaciones.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre}
                  </option>
                ))}
              </Selector>
            ) : (
              <Entrada
                value={entrada.estacionRiego}
                onChange={(e) => onCambiarEntrada({ ...entrada, estacionRiego: e.target.value })}
                placeholder="Congolon"
              />
            )}
          </Campo>

          <Campo etiqueta="Fuente de agua">
            <Selector
              value={entrada.fuenteAgua}
              onChange={(e) => onCambiarEntrada({ ...entrada, fuenteAgua: e.target.value })}
            >
              <option value="">Sin especificar</option>
              {FUENTES_AGUA.map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.etiqueta}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Orden SAP">
            <Entrada
              value={entrada.ordenSap}
              onChange={(e) => onCambiarEntrada({ ...entrada, ordenSap: e.target.value })}
              placeholder="Se llena al crearla"
            />
          </Campo>

          <Campo etiqueta="Estado">
            <Selector
              value={entrada.estado}
              onChange={(e) =>
                onCambiarEntrada({ ...entrada, estado: e.target.value as EstadoTurno })
              }
            >
              {ESTADOS_TURNO.map((e) => (
                <option key={e.valor} value={e.valor}>
                  {e.etiqueta}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Comentarios">
            <Entrada
              value={entrada.comentarios}
              onChange={(e) => onCambiarEntrada({ ...entrada, comentarios: e.target.value })}
            />
          </Campo>
        </div>

        {/* -------------------------- Lotes -------------------------- */}
        <div className="border-t border-slate-100 pt-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">Lotes del turno</h3>
              <p className="text-xs text-slate-400">
                {cargandoSaldos
                  ? 'Consultando cuánta área queda libre en cada lote…'
                  : 'El área libre sale del plan de siembra, o de lo sembrado si el lote ya se terminó.'}
              </p>
            </div>
            <span className="shrink-0 text-sm font-bold tabular-nums text-brand-700">
              {totalMz.toFixed(2)} mz
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {lineas.map((l, i) => {
              const saldo = porLote.get(l.loteTemporadaId)
              const area = aNumero(l.areaTurno) ?? 0
              const pasado = saldo ? area > saldo.area_disponible + 0.005 : false

              return (
                <div
                  key={i}
                  className={`rounded-xl p-2.5 ring-1 ring-inset ${
                    pasado ? 'bg-red-50 ring-red-300' : 'bg-slate-50 ring-slate-200'
                  }`}
                >
                  {/* La rejilla se deformaba al elegir un lote: el texto
                      de la opción («1001-040 · Guanacaste — 8.99 mz
                      libres») estiraba el `select`, y con `1fr` el resto
                      de columnas se encogía hasta que Área y Variedad
                      quedaban ilegibles. Se arregla con `minmax(0, …)`
                      —un `select` sin mínimo propio— y anchos fijos para
                      las dos columnas que no deben moverse nunca. */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,11rem)_2.5rem] sm:items-start">
                    <Selector
                      value={l.loteTemporadaId}
                      onChange={(e) => cambiarLinea(i, { loteTemporadaId: e.target.value })}
                      className="w-full min-w-0"
                    >
                      <option value="">Elige el lote…</option>
                      {saldos.map((s) => (
                        <option key={s.lote_temporada_id} value={s.lote_temporada_id}>
                          {s.ut}
                          {s.lote_nombre ? ` · ${s.lote_nombre}` : ''} — {s.area_disponible.toFixed(2)} mz libres
                        </option>
                      ))}
                    </Selector>

                    <Entrada
                      inputMode="decimal"
                      value={l.areaTurno}
                      onChange={(e) => cambiarLinea(i, { areaTurno: e.target.value })}
                      placeholder="Área"
                      className="w-full min-w-0"
                    />

                    <Selector
                      value={l.variedadId}
                      onChange={(e) => cambiarLinea(i, { variedadId: e.target.value })}
                      className="w-full min-w-0"
                    >
                      <option value="">Sin variedad</option>
                      {catalogos.variedades.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.nombre}
                        </option>
                      ))}
                    </Selector>

                    <button
                      type="button"
                      aria-label={`Eliminar renglón ${i + 1}`}
                      onClick={() => onCambiarLineas(lineas.filter((_, j) => j !== i))}
                      disabled={lineas.length === 1}
                      className="flex h-11 w-full shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white hover:text-red-600 disabled:opacity-30 sm:w-10"
                    >
                      <IconTrash className="h-4 w-4" />
                      <span className="ml-1.5 text-sm font-semibold sm:hidden">Eliminar</span>
                    </button>
                  </div>

                  {saldo && (
                    <p
                      className={`mt-1.5 px-0.5 text-[11px] ${
                        pasado ? 'font-semibold text-red-700' : 'text-slate-400'
                      }`}
                    >
                      {pasado
                        ? `Sólo quedan ${saldo.area_disponible.toFixed(2)} mz libres en ${saldo.ut}.`
                        : `${saldo.ut}: ${saldo.area_disponible.toFixed(2)} mz libres de ${saldo.area_total.toFixed(2)}.`}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => onCambiarLineas([...lineas, { ...LINEA_VACIA }])}
            className="mt-2 flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800"
          >
            <IconPlus className="h-4 w-4" />
            Agregar lote
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** El responsable que traía la zona anterior, para saber si se tocó a mano. */
function zonaAnterior(catalogos: CatalogosRiego, zonaId: string): string {
  return catalogos.zonas.find((z) => z.id === zonaId)?.responsable ?? ''
}
