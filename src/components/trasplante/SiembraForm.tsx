'use client'

/**
 * Captura de siembra diaria.
 *
 * El formulario SÓLO recoge y muestra. Validar es de `validacion`,
 * guardar es de aquí abajo en un único sitio, y los cálculos que el
 * digitador ve —semana y plantas por manzana— salen de funciones puras
 * que son las mismas que usa la base.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Alerta,
  AreaTexto,
  Boton,
  Campo,
  Entrada,
  Selector,
  Tarjeta,
} from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { mensajeDeError } from '@/lib/errores'
import {
  hoyIso,
  limpiarProductos,
  plantasPorMz,
  semanaIso,
  validarSiembra,
} from '@/lib/trasplante/validacion'
import { CICLOS_SIEMBRA, type LoteOpcion, type Material, type Variedad } from '@/lib/trasplante/tipos'
import { n2 } from '@/lib/trasplante/formato'

type Producto = { material_id: string; cantidad: string; unidad: string }

export function SiembraForm({
  temporadaId,
  usuarioId,
  variedades,
  materiales,
  lotes,
}: {
  temporadaId: string
  usuarioId: string
  variedades: Variedad[]
  materiales: Material[]
  lotes: LoteOpcion[]
}) {
  const supabase = createClient()
  const router = useRouter()

  const [fecha, setFecha] = useState(hoyIso())
  const [loteId, setLoteId] = useState('')
  const [variedadId, setVariedadId] = useState('')
  const [ciclo, setCiclo] = useState('1')
  const [loteVariedad, setLoteVariedad] = useState('')
  const [avanceMz, setAvanceMz] = useState('')
  const [plantas, setPlantas] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [productos, setProductos] = useState<Producto[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const lote = lotes.find((l) => l.lote_temporada_id === loteId)
  const variedad = variedades.find((v) => v.id === variedadId)

  // Los tres campos automáticos, a la vista mientras se escribe: el
  // digitador confirma que cuadran antes de guardar en vez de
  // descubrirlo en el reporte.
  const semana = useMemo(() => semanaIso(fecha), [fecha])
  const densidad = useMemo(() => plantasPorMz(plantas, avanceMz), [plantas, avanceMz])

  function cambiarProducto(i: number, campo: keyof Producto, valor: string) {
    setProductos((p) => p.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)))
  }

  async function guardar(otra: boolean) {
    const problema = validarSiembra({
      fecha_siembra: fecha,
      lote_temporada_id: loteId,
      variedad_id: variedadId,
      ciclo,
      avance_mz: avanceMz,
      plantas_reportadas: plantas,
      lote_variedad: loteVariedad,
      observaciones,
    })
    if (problema) return setError(problema)

    setError(null)
    setAviso(null)
    setGuardando(true)

    try {
      const { data, error: e1 } = await supabase
        .from('siembras')
        .insert({
          temporada_id: temporadaId,
          lote_temporada_id: loteId,
          variedad_id: variedadId,
          fecha_siembra: fecha,
          ciclo: Number(ciclo),
          lote_variedad: loteVariedad || null,
          avance_mz: Number(avanceMz),
          plantas_reportadas: plantas.trim() ? Number(plantas) : null,
          observaciones: observaciones || null,
          usuario_id: usuarioId,
        })
        .select('id')
        .single()
      if (e1 || !data) throw e1 ?? new Error('No se pudo guardar la siembra.')

      const aplicados = limpiarProductos(productos)
      if (aplicados.length > 0) {
        const { error: e2 } = await supabase
          .from('siembra_productos')
          .insert(aplicados.map((p) => ({ ...p, siembra_id: data.id })))
        if (e2) throw e2
      }

      setGuardando(false)

      if (otra) {
        // Se limpia lo que cambia de una siembra a la siguiente y se
        // conservan fecha, lote y ciclo: lo normal es capturar varias
        // variedades del mismo lote seguidas.
        const nombre = variedad?.nombre ?? 'La siembra'
        setVariedadId('')
        setAvanceMz('')
        setPlantas('')
        setLoteVariedad('')
        setObservaciones('')
        setProductos([])
        setAviso(`${nombre} quedó guardada. El lote y la fecha siguen puestos para la siguiente.`)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        router.refresh()
        return
      }

      router.push('/trasplante')
      router.refresh()
    } catch (e) {
      setGuardando(false)
      setError(mensajeDeError(e, 'No se pudo guardar la siembra.'))
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        guardar(false)
      }}
      className="flex flex-col gap-4"
    >
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}
      {error && <Alerta>{error}</Alerta>}

      <Tarjeta className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo etiqueta="Fecha de siembra" requerido ayuda={semana ? `Semana ${semana}` : undefined}>
            <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
          </Campo>

          <Campo etiqueta="Ciclo" requerido>
            <Selector value={ciclo} onChange={(e) => setCiclo(e.target.value)}>
              {CICLOS_SIEMBRA.map((c) => (
                <option key={c} value={c}>
                  Ciclo {c}
                </option>
              ))}
            </Selector>
          </Campo>
        </div>

        <Campo
          etiqueta="Lote"
          requerido
          ayuda={lote ? `${lote.zona ?? 'Sin zona'} · ${n2(lote.area_neta)} mz netas` : undefined}
        >
          <SelectorBuscable
            valor={loteId}
            onCambiar={setLoteId}
            permitirVacio={false}
            placeholder="Buscar lote…"
            opciones={lotes.map((l) => ({
              id: l.lote_temporada_id,
              titulo: l.nomenclatura,
              subtitulo: [l.nombre, l.zona].filter(Boolean).join(' · ') || undefined,
            }))}
          />
        </Campo>

        <div className="grid grid-cols-1 gap-4">
          <Campo
            etiqueta="Variedad"
            requerido
            ayuda={variedad?.producto ? `Cultivo: ${variedad.producto}` : undefined}
          >
            <SelectorBuscable
              valor={variedadId}
              onCambiar={setVariedadId}
              permitirVacio={false}
              placeholder="Buscar variedad…"
              opciones={variedades.map((v) => ({
                id: v.id,
                titulo: v.nombre,
                subtitulo: [v.codigo_sap, v.producto].filter(Boolean).join(' · ') || undefined,
              }))}
            />
          </Campo>

        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo etiqueta="Avance en manzanas" requerido>
            <Entrada
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={avanceMz}
              onChange={(e) => setAvanceMz(e.target.value)}
              required
            />
          </Campo>

          <Campo
            etiqueta="Plantas reportadas"
            ayuda={densidad !== null ? `${n2(densidad)} plantas por manzana` : undefined}
          >
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

        <Campo
          etiqueta="Lote de variedad"
          ayuda="El código del lote de plántulas, para la trazabilidad hacia el vivero."
        >
          <Entrada value={loteVariedad} onChange={(e) => setLoteVariedad(e.target.value)} />
        </Campo>

        <Campo etiqueta="Observaciones">
          <AreaTexto
            rows={2}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
          />
        </Campo>
      </Tarjeta>

      {/* --------------------- Productos aplicados --------------------- */}
      <Tarjeta className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Productos aplicados</h2>
            <p className="text-xs text-slate-400">
              Los insumos que se pusieron en esta siembra. Se pueden agregar los que hagan falta.
            </p>
          </div>
          <Boton
            type="button"
            variante="secundario"
            tamano="sm"
            onClick={() => setProductos((p) => [...p, { material_id: '', cantidad: '', unidad: '' }])}
          >
            Agregar
          </Boton>
        </div>

        {productos.length === 0 ? (
          <p className="text-sm text-slate-400">Sin productos. No es obligatorio.</p>
        ) : (
          productos.map((p, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_110px_110px_auto]">
              <Selector
                value={p.material_id}
                onChange={(e) => cambiarProducto(i, 'material_id', e.target.value)}
              >
                <option value="">Elige el material…</option>
                {materiales.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.codigo} · {m.descripcion ?? ''}
                  </option>
                ))}
              </Selector>
              <Entrada
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                placeholder="Cantidad"
                value={p.cantidad}
                onChange={(e) => cambiarProducto(i, 'cantidad', e.target.value)}
              />
              <Entrada
                placeholder="Unidad"
                value={p.unidad}
                onChange={(e) => cambiarProducto(i, 'unidad', e.target.value)}
              />
              <Boton
                type="button"
                variante="peligro"
                tamano="sm"
                onClick={() => setProductos((lista) => lista.filter((_, j) => j !== i))}
              >
                Eliminar
              </Boton>
            </div>
          ))
        )}
      </Tarjeta>

      <div className="flex flex-wrap justify-end gap-2">
        <Boton type="button" variante="secundario" onClick={() => guardar(true)} disabled={guardando}>
          Guardar y capturar otra
        </Boton>
        <Boton type="submit" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar siembra'}
        </Boton>
      </div>
    </form>
  )
}
