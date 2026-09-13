'use client'

/**
 * Edición de una siembra, o de muchas a la vez.
 *
 * Es el mismo formulario para los dos casos y no dos parecidos: en masa,
 * los campos que se dejan en blanco NO se tocan. Esa es la diferencia
 * entera, y tenerla en un solo sitio evita que una de las dos versiones
 * se quede atrás.
 */

import { useState } from 'react'
import { Alerta, Boton, Campo, Entrada, Selector } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { mensajeDeError } from '@/lib/errores'
import {
  guardarSiembra,
  guardarSiembrasEnMasa,
  type CamposSiembra,
} from '@/lib/trasplante/repositorioCliente'
import { esFecha } from '@/lib/trasplante/validacion'
import { CICLOS_SIEMBRA, type FilaSiembra, type LoteOpcion, type Variedad } from '@/lib/trasplante/tipos'

export function EditarSiembraModal({
  fila,
  enMasa,
  lotes,
  variedades,
  onCerrar,
  onGuardado,
}: {
  fila: FilaSiembra | null
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
  fila: FilaSiembra | null
  enMasa: string[] | null
  lotes: LoteOpcion[]
  variedades: Variedad[]
  onCerrar: () => void
  onGuardado: () => void
}) {
  const masivo = Boolean(enMasa && enMasa.length > 0 && !fila)

  const [fecha, setFecha] = useState(fila?.fecha_siembra ?? '')
  const [loteId, setLoteId] = useState(fila?.lote_temporada_id ?? '')
  const [variedadId, setVariedadId] = useState(fila?.variedad_id ?? '')
  const [ciclo, setCiclo] = useState(fila ? String(fila.ciclo) : '')
  const [loteVariedad, setLoteVariedad] = useState(fila?.lote_variedad ?? '')
  const [avanceMz, setAvanceMz] = useState(fila ? String(fila.avance_mz) : '')
  const [plantas, setPlantas] = useState(
    fila?.plantas_reportadas === null || fila?.plantas_reportadas === undefined
      ? ''
      : String(fila.plantas_reportadas)
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    const campos: CamposSiembra = {}

    if (fecha.trim()) {
      if (!esFecha(fecha)) return setError('La fecha no es válida.')
      campos.fecha_siembra = fecha
    }
    if (loteId) campos.lote_temporada_id = loteId
    if (variedadId) campos.variedad_id = variedadId
    if (ciclo) campos.ciclo = Number(ciclo)
    if (avanceMz.trim()) {
      const mz = Number(avanceMz)
      if (!Number.isFinite(mz) || mz <= 0) return setError('El avance tiene que ser mayor que cero.')
      campos.avance_mz = mz
    }
    if (plantas.trim()) {
      const p = Number(plantas)
      if (!Number.isFinite(p) || p < 0) return setError('Las plantas no son un número válido.')
      campos.plantas_reportadas = p
    }
    // En una sola fila, vaciar el campo SÍ significa borrarlo; en masa,
    // significa «no lo toques».
    if (!masivo) campos.lote_variedad = loteVariedad || null
    else if (loteVariedad.trim()) campos.lote_variedad = loteVariedad

    if (Object.keys(campos).length === 0) {
      return setError('No hay ningún cambio que guardar.')
    }

    setError(null)
    setGuardando(true)
    const { error: e } = masivo
      ? await guardarSiembrasEnMasa(enMasa ?? [], campos)
      : await guardarSiembra(fila!.id, campos)
    setGuardando(false)
    if (e) return setError(mensajeDeError(e, 'No se pudo guardar.'))
    onGuardado()
    onCerrar()
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={masivo ? `Editar ${enMasa?.length} registros` : `Editar ${fila?.ut}`}
      pie={
        <div className="flex justify-end gap-2">
          <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta>{error}</Alerta>}

        {masivo && (
          <Alerta tono="azul">
            Lo que dejes en blanco no se toca. Sólo se cambian los campos que llenes, y en los{' '}
            {enMasa?.length} registros marcados.
          </Alerta>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha de siembra">
            <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Campo>

          <Campo etiqueta="Ciclo">
            <Selector value={ciclo} onChange={(e) => setCiclo(e.target.value)}>
              <option value="">{masivo ? 'Sin cambio' : 'Elige…'}</option>
              {CICLOS_SIEMBRA.map((c) => (
                <option key={c} value={c}>
                  Ciclo {c}
                </option>
              ))}
            </Selector>
          </Campo>
        </div>

        <Campo etiqueta="Lote">
          <SelectorBuscable
            valor={loteId}
            onCambiar={setLoteId}
            textoVacio={masivo ? 'Sin cambio' : 'Sin asignar'}
            placeholder={masivo ? 'Sin cambio' : 'Buscar lote…'}
            opciones={lotes.map((l) => ({
              id: l.lote_temporada_id,
              titulo: l.nomenclatura,
              subtitulo: [l.nombre, l.zona].filter(Boolean).join(' · ') || undefined,
            }))}
          />
        </Campo>

        <Campo etiqueta="Variedad">
          <SelectorBuscable
            valor={variedadId}
            onCambiar={setVariedadId}
            textoVacio={masivo ? 'Sin cambio' : 'Sin asignar'}
            placeholder={masivo ? 'Sin cambio' : 'Buscar variedad…'}
            opciones={variedades.map((v) => ({
              id: v.id,
              titulo: v.nombre,
              subtitulo: v.producto ?? undefined,
            }))}
          />
        </Campo>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Avance en manzanas">
            <Entrada
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={avanceMz}
              onChange={(e) => setAvanceMz(e.target.value)}
            />
          </Campo>

          <Campo etiqueta="Plantas reportadas">
            <Entrada
              type="number"
              inputMode="decimal"
              step="1"
              min="0"
              value={plantas}
              onChange={(e) => setPlantas(e.target.value)}
            />
          </Campo>
        </div>

        <Campo etiqueta="Lote de variedad">
          <Entrada value={loteVariedad} onChange={(e) => setLoteVariedad(e.target.value)} />
        </Campo>
      </div>
    </Modal>
  )
}
