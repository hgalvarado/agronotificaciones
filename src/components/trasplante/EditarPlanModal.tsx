'use client'

/**
 * Edición de una línea del plan, o de muchas a la vez.
 *
 * Mismo formulario para los dos casos, como en la siembra: en masa, los
 * campos que se dejan en blanco NO se tocan. Tener esa diferencia en un
 * solo sitio evita que una de las dos versiones se quede atrás.
 */

import { useState } from 'react'
import { Alerta, Boton, Campo, Entrada, Selector } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { mensajeDeError } from '@/lib/errores'
import {
  guardarPlanSiembra,
  guardarPlanesSiembraEnMasa,
  type CamposPlanSiembra,
} from '@/lib/trasplante/repositorioCliente'
import { esFecha } from '@/lib/trasplante/validacion'
import {
  CICLOS_SIEMBRA,
  type FilaPlanSiembra,
  type LoteOpcion,
  type Variedad,
} from '@/lib/trasplante/tipos'

export function EditarPlanModal({
  fila,
  enMasa,
  lotes,
  variedades,
  onCerrar,
  onGuardado,
}: {
  fila: FilaPlanSiembra | null
  /** Ids a cambiar todos a la vez; `null` cuando se edita una sola. */
  enMasa: string[] | null
  lotes: LoteOpcion[]
  variedades: Variedad[]
  onCerrar: () => void
  onGuardado: () => void
}) {
  const abierto = Boolean(fila) || Boolean(enMasa && enMasa.length > 0)
  if (!abierto) return null
  return (
    <Formulario
      key={fila?.id ?? `masa-${enMasa?.length}`}
      fila={fila}
      enMasa={enMasa}
      lotes={lotes}
      variedades={variedades}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
    />
  )
}

function Formulario({
  fila,
  enMasa,
  lotes,
  variedades,
  onCerrar,
  onGuardado,
}: {
  fila: FilaPlanSiembra | null
  enMasa: string[] | null
  lotes: LoteOpcion[]
  variedades: Variedad[]
  onCerrar: () => void
  onGuardado: () => void
}) {
  const masivo = enMasa !== null && enMasa.length > 0

  const [loteId, setLoteId] = useState(masivo ? '' : (fila?.lote_temporada_id ?? ''))
  const [variedadId, setVariedadId] = useState(masivo ? '' : (fila?.variedad_id ?? ''))
  const [ciclo, setCiclo] = useState(masivo ? '' : String(fila?.ciclo ?? 1))
  const [area, setArea] = useState(masivo ? '' : String(fila?.area_plan ?? ''))
  const [fecha, setFecha] = useState(masivo ? '' : (fila?.fecha_siembra ?? ''))
  const [distancia, setDistancia] = useState(masivo ? '' : (fila?.distancia_siembra ?? ''))

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    setError(null)

    if (fecha && !esFecha(fecha)) return setError('La fecha prevista no es válida.')
    if (area.trim() && (Number.isNaN(Number(area)) || Number(area) < 0)) {
      return setError('El área del plan tiene que ser un número mayor o igual que cero.')
    }

    const campos: CamposPlanSiembra = {}
    if (loteId) campos.lote_temporada_id = loteId
    if (variedadId) campos.variedad_id = variedadId
    if (ciclo) campos.ciclo = Number(ciclo)
    if (area.trim()) campos.area_plan = Number(area)

    if (masivo) {
      // En masa, blanco significa «no lo toques»: es la única forma de
      // que cambiar la fecha de veinte líneas no les borre la distancia.
      if (fecha) campos.fecha_siembra = fecha
      if (distancia.trim()) campos.distancia_siembra = distancia.trim()
      if (Object.keys(campos).length === 0) {
        return setError('Elige al menos un campo que cambiar.')
      }
    } else {
      // En una sola línea, blanco SÍ significa borrar el dato.
      campos.fecha_siembra = fecha || null
      campos.distancia_siembra = distancia.trim() || null
      if (!loteId) return setError('Elige el lote.')
      if (!variedadId) return setError('Elige la variedad.')
      if (!area.trim()) return setError('Escribe el área del plan.')
    }

    setGuardando(true)
    const { error: e } = masivo
      ? await guardarPlanesSiembraEnMasa(enMasa ?? [], campos)
      : await guardarPlanSiembra(fila!.id, campos)
    setGuardando(false)

    if (e) return setError(mensajeDeError(e, 'No se pudieron guardar los cambios.'))
    onGuardado()
    onCerrar()
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={masivo ? `Editar ${enMasa?.length} líneas del plan` : 'Editar línea del plan'}
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

        {masivo && (
          <Alerta tono="azul">
            Lo que dejes en blanco no se toca. Sólo se cambia lo que llenes.
          </Alerta>
        )}

        <Campo etiqueta="Lote" requerido={!masivo}>
          <SelectorBuscable
            valor={loteId}
            onCambiar={setLoteId}
            permitirVacio={masivo}
            placeholder={masivo ? 'No cambiar' : 'Buscar lote…'}
            opciones={lotes.map((l) => ({
              id: l.lote_temporada_id,
              titulo: l.nomenclatura,
              subtitulo: [l.nombre, l.zona].filter(Boolean).join(' · ') || undefined,
            }))}
          />
        </Campo>

        <Campo etiqueta="Variedad" requerido={!masivo}>
          <SelectorBuscable
            valor={variedadId}
            onCambiar={setVariedadId}
            permitirVacio={masivo}
            placeholder={masivo ? 'No cambiar' : 'Buscar variedad…'}
            opciones={variedades.map((v) => ({
              id: v.id,
              titulo: v.nombre,
              subtitulo: v.producto ?? undefined,
            }))}
          />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Ciclo" requerido={!masivo}>
            <Selector value={ciclo} onChange={(e) => setCiclo(e.target.value)}>
              {masivo && <option value="">No cambiar</option>}
              {CICLOS_SIEMBRA.map((c) => (
                <option key={c} value={c}>
                  Ciclo {c}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Área plan (mz)" requerido={!masivo}>
            <Entrada
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder={masivo ? 'No cambiar' : ''}
            />
          </Campo>
        </div>

        <Campo
          etiqueta="Fecha prevista de siembra"
          ayuda="Sin fecha, esa área no aparece en la gráfica semanal."
        >
          <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Campo>

        <Campo etiqueta="Distancia de siembra">
          <Entrada
            value={distancia}
            onChange={(e) => setDistancia(e.target.value)}
            placeholder={masivo ? 'No cambiar' : 'ej. 1.80 x 0.35'}
          />
        </Campo>
      </div>
    </Modal>
  )
}
