'use client'

/**
 * El historial de precios de UN material, en un panel maestro-detalle.
 *
 * **Por qué un panel y no columnas en el catálogo.** Un material no tiene
 * un precio: tiene una sucesión de precios con sus vigencias, y eso es
 * una lista, no una celda. Meter «precio» como columna del catálogo
 * obligaría a reescribirlo cada vez que sube el producto, y con eso se
 * perdería lo que de verdad importa — que un costo capturado en marzo se
 * siga cuadrando con el precio de marzo aunque en octubre el producto
 * valga el doble (ver `historial_precios_materiales`, migración 61).
 *
 * De aquí sale el número que el formulario de desinfección autocompleta
 * al elegir un químico, y el que el disparador copia a la fila al
 * guardar. Mientras un material no tenga ni un precio en esta lista,
 * aquel campo se queda vacío: no hay de dónde sacarlo.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo, Entrada, Selector } from '@/components/ui/Primitivos'
import { IconPlus } from '@/components/ui/Icons'
import {
  TablaAvanzada,
  type ColumnaTabla,
  type FilaTabla,
} from '@/components/ui/TablaAvanzada'

/** Las dos monedas en que se compra. El químico de desinfección se importa. */
export const MONEDAS = [
  { value: 'HNL', label: 'Lempiras (HNL)' },
  { value: 'USD', label: 'Dólares (USD)' },
] as const

type FilaPrecio = {
  id: string
  material_id: string
  moneda: string
  precio_unitario: number
  fecha_inicio: string
  fecha_fin: string | null
  comentario: string | null
}

const VACIO = {
  moneda: 'HNL',
  precio_unitario: '',
  fecha_inicio: '',
  fecha_fin: '',
  comentario: '',
}

export function PreciosMaterial({
  materialId,
  titulo,
  abierto,
  soloLectura,
  onCerrar,
}: {
  materialId: string
  /** Código y descripción del material, para saber de cuál se está hablando. */
  titulo: string
  abierto: boolean
  soloLectura: boolean
  onCerrar: () => void
}) {
  const [filas, setFilas] = useState<FilaPrecio[]>([])
  const [error, setError] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState({ ...VACIO })
  const [guardando, setGuardando] = useState(false)
  /** El precio que rige HOY, ya convertido a lempiras por la base. */
  const [vigente, setVigente] = useState<number | null>(null)

  /**
   * Un contador de recargas, en vez de llamar a la lectura a mano.
   *
   * Cada vez que algo cambia la lista se sube el contador y el efecto
   * vuelve a leer. Es una vuelta más larga de escribir que un
   * `await recargar()` después de cada mutación, y a cambio **toda** la
   * lectura vive en un solo sitio: no hay forma de que una mutación se
   * olvide de recargar, ni de que una recarga que llegue tarde pise a
   * una más nueva —de eso se encarga el `vivo`—.
   */
  const [version, setVersion] = useState(0)
  const recargar = () => setVersion((v) => v + 1)

  useEffect(() => {
    let vivo = true
    async function leer() {
      const cliente = createClient()
      const [lista, hoy] = await Promise.all([
        cliente
          .from('historial_precios_materiales')
          .select('id, material_id, moneda, precio_unitario, fecha_inicio, fecha_fin, comentario')
          .eq('material_id', materialId)
          .order('fecha_inicio', { ascending: false }),
        // El precio efectivo no se calcula aquí: se le pregunta a la MISMA
        // función que usa el disparador al guardar un costo. Calcularlo dos
        // veces es la forma segura de que un día no coincidan.
        cliente.rpc('fn_precio_material', {
          p_material_id: materialId,
          p_fecha: new Date().toISOString().slice(0, 10),
        }),
      ])
      if (!vivo) return
      if (lista.error) {
        setError(lista.error.message)
        return
      }
      setError(null)
      setFilas((lista.data as FilaPrecio[] | null) ?? [])
      const n = Number(hoy.data)
      setVigente(hoy.error || !Number.isFinite(n) || n <= 0 ? null : n)
    }
    void leer()
    return () => {
      vivo = false
    }
  }, [materialId, version])

  const columnas: ColumnaTabla[] = [
    {
      key: 'fecha_inicio',
      label: 'Desde',
      tipo: 'fecha',
      editable: !soloLectura,
      // La fecha de inicio es la llave natural de la fila: cambiarla en
      // masa pondría el mismo día en varias y la base lo rechazaría.
      sinMasivo: true,
    },
    {
      key: 'fecha_fin',
      label: 'Hasta',
      tipo: 'fecha',
      editable: !soloLectura,
      // Vacío NO es un hueco: es «vigente hasta nuevo aviso», que es el
      // estado normal del precio actual. Se escribe, para que nadie lo
      // lea como un dato que falta.
      render: (f) => (f.fecha_fin ? undefined : <span className="text-xs text-slate-400">Vigente</span>),
    },
    { key: 'moneda', label: 'Moneda', tipo: 'seleccion', opciones: [...MONEDAS], editable: !soloLectura },
    {
      key: 'precio_unitario',
      label: 'Precio por litro',
      tipo: 'numero',
      alinear: 'derecha',
      editable: !soloLectura,
    },
    { key: 'comentario', label: 'Comentario', tipo: 'texto', editable: !soloLectura, filtro: 'texto' },
  ]

  async function editarCelda(id: string, key: string, valor: unknown) {
    const { error: e } = await createClient()
      .from('historial_precios_materiales')
      .update({ [key]: valor === '' ? null : valor })
      .eq('id', id)
    if (e) return setError(mensaje(e))
    setError(null)
    recargar()
  }

  async function eliminar(ids: string[]) {
    const { error: e } = await createClient()
      .from('historial_precios_materiales')
      .delete()
      .in('id', ids)
    if (e) throw new Error(mensaje(e))
    recargar()
  }

  async function agregar() {
    // El vacío se mira ANTES de convertir: `Number('')` es 0, y un 0 pasa
    // por «finito y no negativo» sin que nadie haya escrito nada. Con eso,
    // dejar el campo en blanco guardaba un precio de cero —que no es un
    // precio, es un hueco— y el formulario de desinfección lo habría
    // autocompletado tan contento.
    const texto = (nuevo.precio_unitario ?? '').trim().replace(',', '.')
    const precio = Number(texto)
    if (!nuevo.fecha_inicio) return setError('Falta la fecha desde la que rige este precio.')
    if (texto === '' || !Number.isFinite(precio) || precio <= 0) {
      return setError('Escribe el precio por litro.')
    }
    if (nuevo.fecha_fin && nuevo.fecha_fin < nuevo.fecha_inicio) {
      return setError('La fecha «hasta» no puede ser anterior a la de inicio.')
    }

    setGuardando(true)
    const { error: e } = await createClient().from('historial_precios_materiales').insert({
      material_id: materialId,
      moneda: nuevo.moneda,
      precio_unitario: precio,
      fecha_inicio: nuevo.fecha_inicio,
      fecha_fin: nuevo.fecha_fin || null,
      comentario: nuevo.comentario.trim() || null,
    })
    setGuardando(false)
    if (e) return setError(mensaje(e))
    setError(null)
    setNuevo({ ...VACIO })
    recargar()
  }

  return (
    <Modal
      abierto={abierto}
      ancho="ancho"
      onCerrar={onCerrar}
      titulo={`Precios · ${titulo}`}
      pie={
        <Boton variante="secundario" className="w-full" onClick={onCerrar}>
          Cerrar
        </Boton>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-400">
          El precio se versiona en vez de sobreescribirse: un costo capturado en marzo se sigue
          cuadrando con el precio de marzo aunque hoy el producto valga otra cosa. Lo que esté en
          dólares se pasa a lempiras con la tasa de la fecha de la aplicación, no con la de hoy.
        </p>

        <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-inset ring-slate-200">
          <span className="text-slate-500">Precio vigente hoy: </span>
          <strong className="tabular-nums text-slate-900">
            {vigente === null ? 'sin precio para hoy' : `L ${vigente.toFixed(4)}`}
          </strong>
        </div>

        {error && <Alerta>{error}</Alerta>}

        <TablaAvanzada
          titulo={`Precios de ${titulo}`}
          columnas={columnas}
          filas={filas as unknown as FilaTabla[]}
          minAncho="560px"
          permisos={{ editar: !soloLectura, eliminar: !soloLectura, descargar: true }}
          vacio={{
            titulo: 'Sin precios',
            descripcion:
              'Mientras no haya uno, el formulario de desinfección no puede autocompletar el costo del químico.',
          }}
          onEditarCelda={soloLectura ? undefined : editarCelda}
          onEliminar={soloLectura ? undefined : eliminar}
        />

        {!soloLectura && (
          <div className="rounded-xl border border-slate-200 p-3">
            <h3 className="text-sm font-semibold text-slate-900">Agregar un precio</h3>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Campo etiqueta="Desde" requerido>
                <Entrada
                  type="date"
                  value={nuevo.fecha_inicio}
                  onChange={(e) => setNuevo((p) => ({ ...p, fecha_inicio: e.target.value }))}
                />
              </Campo>
              <Campo etiqueta="Hasta" ayuda="Vacío = vigente.">
                <Entrada
                  type="date"
                  value={nuevo.fecha_fin}
                  onChange={(e) => setNuevo((p) => ({ ...p, fecha_fin: e.target.value }))}
                />
              </Campo>
              <Campo etiqueta="Moneda">
                <Selector
                  value={nuevo.moneda}
                  onChange={(e) => setNuevo((p) => ({ ...p, moneda: e.target.value }))}
                >
                  {MONEDAS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Selector>
              </Campo>
              <Campo etiqueta="Precio por litro" requerido>
                <Entrada
                  inputMode="decimal"
                  value={nuevo.precio_unitario}
                  onChange={(e) => setNuevo((p) => ({ ...p, precio_unitario: e.target.value }))}
                  placeholder="0.0000"
                />
              </Campo>
            </div>
            <div className="mt-2">
              <Campo etiqueta="Comentario" ayuda="Por qué cambió: una compra puntual, un alza del proveedor…">
                <Entrada
                  value={nuevo.comentario}
                  onChange={(e) => setNuevo((p) => ({ ...p, comentario: e.target.value }))}
                />
              </Campo>
            </div>
            <Boton className="mt-3 w-full" onClick={agregar} disabled={guardando}>
              <IconPlus className="h-4 w-4" />
              {guardando ? 'Agregando…' : 'Agregar precio'}
            </Boton>
          </div>
        )}
      </div>
    </Modal>
  )
}

/**
 * El error de la base, dicho para quien administra un catálogo.
 *
 * `23505` aquí sólo puede ser una cosa —el índice único es
 * `(material_id, fecha_inicio)`— y el texto crudo de Postgres no se lo
 * dice a nadie.
 */
function mensaje(e: { code?: string; message: string }): string {
  if (e.code === '23505') {
    return 'Ya hay un precio que arranca ese mismo día. Corrige el que existe en vez de agregar otro.'
  }
  if (e.code === '42501' || /row-level security/i.test(e.message)) {
    return 'No tienes permiso para cambiar los precios del catálogo de cultivos.'
  }
  return e.message
}
