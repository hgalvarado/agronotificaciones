'use client'

/**
 * Edición de una siembra, o de muchas a la vez.
 *
 * Es el mismo formulario para los dos casos y no dos parecidos: en masa,
 * los campos que se dejan en blanco NO se tocan. Esa es la diferencia
 * entera, y tenerla en un solo sitio evita que una de las dos versiones
 * se quede atrás.
 *
 * 79 · Es también el editor de UNA fila desde el lápiz de la cuadrícula
 * (la celda ya no edita: los desplegables se cortaban dentro del
 * `overflow` de la tabla). En una sola fila suma observaciones, el lote
 * de variedad elegido de las recepciones y los productos aplicados.
 */

import { useMemo, useState } from 'react'
import { Alerta, AreaTexto, Boton, Campo, Entrada, Selector } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { mensajeDeError } from '@/lib/errores'
import {
  guardarProductosSiembra,
  guardarSiembra,
  guardarSiembrasEnMasa,
  type CamposSiembra,
} from '@/lib/trasplante/repositorioCliente'
import { esFecha } from '@/lib/trasplante/validacion'
import {
  CICLOS_SIEMBRA,
  type FilaRecepcion,
  type FilaSiembra,
  type LoteOpcion,
  type Material,
  type ProductoAplicado,
  type Variedad,
} from '@/lib/trasplante/tipos'
import { ayudaLoteVariedad, EditorProductos, opcionesLoteVariedad } from './CamposSiembra'

export function EditarSiembraModal({
  fila,
  enMasa,
  lotes,
  variedades,
  recepciones = [],
  materiales = [],
  onCerrar,
  onGuardado,
}: {
  fila: FilaSiembra | null
  /** Ids a cambiar todos a la vez; `null` cuando se edita una sola. */
  enMasa: string[] | null
  lotes: LoteOpcion[]
  variedades: Variedad[]
  /** De dónde sale el lote de variedad (79). */
  recepciones?: FilaRecepcion[]
  /** El catálogo de materiales para los productos (79). */
  materiales?: Material[]
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
      recepciones={recepciones}
      materiales={materiales}
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
  recepciones,
  materiales,
  onCerrar,
  onGuardado,
}: {
  fila: FilaSiembra | null
  enMasa: string[] | null
  lotes: LoteOpcion[]
  variedades: Variedad[]
  recepciones: FilaRecepcion[]
  materiales: Material[]
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
  const [observaciones, setObservaciones] = useState(fila?.observaciones ?? '')
  const [productos, setProductos] = useState<ProductoAplicado[]>(() =>
    (fila?.productos ?? []).map((p) => ({
      material_id: p.material_id,
      cantidad: p.cantidad === null || p.cantidad === undefined ? '' : String(p.cantidad),
      unidad: p.unidad ?? '',
    }))
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const opcionesLote = useMemo(
    () => opcionesLoteVariedad(recepciones, variedadId, fecha, loteVariedad),
    [recepciones, variedadId, fecha, loteVariedad]
  )

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
    if (!masivo) {
      campos.lote_variedad = loteVariedad || null
      campos.observaciones = observaciones.trim() || null
    } else if (loteVariedad.trim()) campos.lote_variedad = loteVariedad

    if (Object.keys(campos).length === 0) {
      return setError('No hay ningún cambio que guardar.')
    }

    setError(null)
    setGuardando(true)
    const { error: e } = masivo
      ? await guardarSiembrasEnMasa(enMasa ?? [], campos)
      : await guardarSiembra(fila!.id, campos)
    if (e) {
      setGuardando(false)
      return setError(mensajeDeError(e, 'No se pudo guardar.'))
    }
    // Los productos van en su propia llamada: dejan la lista EXACTAMENTE
    // como queda en el formulario (`fn_guardar_productos_siembra`).
    if (!masivo) {
      const { error: e2 } = await guardarProductosSiembra(fila!.id, productos)
      if (e2) {
        setGuardando(false)
        return setError(mensajeDeError(e2, 'La siembra se guardó, pero no los productos.'))
      }
    }
    setGuardando(false)
    onGuardado()
    onCerrar()
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={masivo ? `Editar ${enMasa?.length} registros` : `Editar ${fila?.ut}`}
      ancho={masivo ? 'normal' : 'ancho'}
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

        {masivo ? (
          <Campo etiqueta="Lote de variedad">
            <Entrada value={loteVariedad} onChange={(e) => setLoteVariedad(e.target.value)} />
          </Campo>
        ) : (
          <>
            <Campo etiqueta="Lote de variedad" ayuda={ayudaLoteVariedad(variedadId, opcionesLote)}>
              <SelectorBuscable
                valor={loteVariedad}
                onCambiar={setLoteVariedad}
                opciones={opcionesLote}
                placeholder="Elegir de las recepciones…"
                etiquetaBusqueda="Buscar lote…"
                textoVacio="Sin lote de variedad"
                disabled={!variedadId}
              />
            </Campo>

            <Campo etiqueta="Observaciones">
              <AreaTexto
                rows={2}
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
              />
            </Campo>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Productos aplicados
              </span>
              <EditorProductos
                productos={productos}
                onCambiar={setProductos}
                materiales={materiales}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
