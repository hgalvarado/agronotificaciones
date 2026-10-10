'use client'

/**
 * El historial de tasas de cambio de UNA temporada.
 *
 * **Por qué un panel y no una columna.** La 64 la puso como una columna
 * suelta: un solo número por temporada y sin memoria. Pero el lempira se
 * mueve dentro del año, y un químico comprado en marzo tiene que
 * cuadrarse con la tasa de marzo aunque en octubre sea otra. Corregir
 * una columna reescribiría en silencio el costo de todo lo ya capturado.
 *
 * Es el mismo patrón —y a propósito el mismo gesto— que el historial de
 * precios de material y que las tarifas de puesto: versionar en vez de
 * sobreescribir.
 *
 * De aquí sale la conversión que `fn_tasa_de_temporada` aplica al precio
 * de un químico importado. Mientras una temporada no tenga ni una tasa,
 * un precio en dólares no se puede pasar a lempiras y el formulario de
 * desinfección deja el costo en blanco — diciendo por qué.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo, Entrada } from '@/components/ui/Primitivos'
import { IconPlus } from '@/components/ui/Icons'
import {
  TablaAvanzada,
  type ColumnaTabla,
  type FilaTabla,
} from '@/components/ui/TablaAvanzada'

type FilaTasa = {
  id: string
  temporada_id: string
  tasa_hnl_usd: number
  fecha_inicio: string
  fecha_fin: string | null
  comentario: string | null
}

const VACIO = {
  tasa_hnl_usd: '',
  fecha_inicio: '',
  fecha_fin: '',
  comentario: '',
}

export function TasasTemporada({
  temporadaId,
  titulo,
  abierto,
  soloLectura,
  onCerrar,
}: {
  temporadaId: string
  /** Nombre de la temporada, para saber de cuál se está hablando. */
  titulo: string
  abierto: boolean
  soloLectura: boolean
  onCerrar: () => void
}) {
  const [filas, setFilas] = useState<FilaTasa[]>([])
  const [error, setError] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState({ ...VACIO })
  const [guardando, setGuardando] = useState(false)
  /** La tasa que rige HOY, según la MISMA función que usa el costeo. */
  const [vigente, setVigente] = useState<number | null>(null)

  /**
   * Un contador de recargas, en vez de llamar a la lectura a mano.
   *
   * Toda la lectura vive en un solo sitio: no hay forma de que una
   * mutación se olvide de recargar, ni de que una recarga que llegue
   * tarde pise a una más nueva —de eso se encarga el `vivo`—.
   */
  const [version, setVersion] = useState(0)
  const recargar = () => setVersion((v) => v + 1)

  useEffect(() => {
    let vivo = true
    async function leer() {
      const cliente = createClient()
      const [lista, hoy] = await Promise.all([
        cliente
          .from('historial_tasas_temporada')
          .select('id, temporada_id, tasa_hnl_usd, fecha_inicio, fecha_fin, comentario')
          .eq('temporada_id', temporadaId)
          .order('fecha_inicio', { ascending: false }),
        // La tasa efectiva no se calcula aquí: se le pregunta a la MISMA
        // función que convierte los precios al guardar un costo.
        // Calcularla dos veces es la forma segura de que un día no
        // coincidan.
        cliente.rpc('fn_tasa_de_temporada', {
          p_fecha: new Date().toISOString().slice(0, 10),
          p_temporada_id: temporadaId,
        }),
      ])
      if (!vivo) return
      if (lista.error) {
        setError(lista.error.message)
        return
      }
      setError(null)
      setFilas((lista.data as FilaTasa[] | null) ?? [])
      const n = Number(hoy.data)
      setVigente(hoy.error || !Number.isFinite(n) || n <= 0 ? null : n)
    }
    void leer()
    return () => {
      vivo = false
    }
  }, [temporadaId, version])

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
      // estado normal de la tasa actual.
      render: (f) =>
        f.fecha_fin ? undefined : <span className="text-xs text-slate-400">Vigente</span>,
    },
    {
      key: 'tasa_hnl_usd',
      label: 'Tasa L/US$',
      tipo: 'numero',
      alinear: 'derecha',
      editable: !soloLectura,
    },
    {
      key: 'comentario',
      label: 'Comentario',
      tipo: 'texto',
      editable: !soloLectura,
      filtro: 'texto',
    },
  ]

  async function editarCelda(id: string, key: string, valor: unknown) {
    const { error: e } = await createClient()
      .from('historial_tasas_temporada')
      .update({ [key]: valor === '' ? null : valor })
      .eq('id', id)
    if (e) return setError(mensaje(e))
    setError(null)
    recargar()
  }

  async function eliminar(ids: string[]) {
    const { error: e } = await createClient()
      .from('historial_tasas_temporada')
      .delete()
      .in('id', ids)
    if (e) throw new Error(mensaje(e))
    recargar()
  }

  async function agregar() {
    // El vacío se mira ANTES de convertir: `Number('')` es 0, y un 0 pasa
    // por «finito y no negativo» sin que nadie haya escrito nada. Una
    // tasa de cero convertiría todos los dólares en cero lempiras.
    const texto = (nuevo.tasa_hnl_usd ?? '').trim().replace(',', '.')
    const tasa = Number(texto)
    if (!nuevo.fecha_inicio) return setError('Falta la fecha desde la que rige esta tasa.')
    if (texto === '' || !Number.isFinite(tasa) || tasa <= 0) {
      return setError('Escribe la tasa en lempiras por dólar.')
    }
    if (nuevo.fecha_fin && nuevo.fecha_fin < nuevo.fecha_inicio) {
      return setError('La fecha «hasta» no puede ser anterior a la de inicio.')
    }

    setGuardando(true)
    const { error: e } = await createClient().from('historial_tasas_temporada').insert({
      temporada_id: temporadaId,
      tasa_hnl_usd: tasa,
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
      titulo={`Tasas de cambio · ${titulo}`}
      pie={
        <Boton variante="secundario" className="w-full" onClick={onCerrar}>
          Cerrar
        </Boton>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-400">
          La tasa se versiona en vez de sobreescribirse: un químico comprado en marzo se sigue
          costeando con la tasa de marzo aunque hoy el lempira esté en otra cosa. De aquí sale la
          conversión de todo lo que se compra en dólares.
        </p>

        <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-inset ring-slate-200">
          <span className="text-slate-500">Tasa vigente hoy: </span>
          <strong className="tabular-nums text-slate-900">
            {vigente === null ? 'sin tasa para hoy' : `L ${vigente.toFixed(4)} por US$`}
          </strong>
        </div>

        {error && <Alerta>{error}</Alerta>}

        <TablaAvanzada
          titulo={`Tasas de ${titulo}`}
          columnas={columnas}
          filas={filas as unknown as FilaTabla[]}
          minAncho="560px"
          permisos={{ editar: !soloLectura, eliminar: !soloLectura, descargar: true }}
          vacio={{
            titulo: 'Sin tasas',
            descripcion:
              'Mientras no haya una, un químico comprado en dólares no se puede pasar a lempiras.',
          }}
          onEditarCelda={soloLectura ? undefined : editarCelda}
          onEliminar={soloLectura ? undefined : eliminar}
        />

        {!soloLectura && (
          <div className="rounded-xl border border-slate-200 p-3">
            <h3 className="text-sm font-semibold text-slate-900">Agregar una tasa</h3>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
              <Campo etiqueta="Tasa L/US$" requerido>
                <Entrada
                  inputMode="decimal"
                  value={nuevo.tasa_hnl_usd}
                  onChange={(e) => setNuevo((p) => ({ ...p, tasa_hnl_usd: e.target.value }))}
                  placeholder="0.0000"
                />
              </Campo>
            </div>
            <div className="mt-2">
              <Campo
                etiqueta="Comentario"
                ayuda="Por qué cambió: una compra puntual, el ajuste del banco…"
              >
                <Entrada
                  value={nuevo.comentario}
                  onChange={(e) => setNuevo((p) => ({ ...p, comentario: e.target.value }))}
                />
              </Campo>
            </div>
            <Boton className="mt-3 w-full" onClick={agregar} disabled={guardando}>
              <IconPlus className="h-4 w-4" />
              {guardando ? 'Agregando…' : 'Agregar tasa'}
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
 * `(temporada_id, fecha_inicio)`— y el texto crudo de Postgres no se lo
 * dice a nadie.
 */
function mensaje(e: { code?: string; message: string }): string {
  if (e.code === '23505') {
    return 'Ya hay una tasa que arranca ese mismo día. Corrige la que existe en vez de agregar otra.'
  }
  if (e.code === '42501' || /row-level security/i.test(e.message)) {
    return 'No tienes permiso para cambiar las tasas de cambio del catálogo de cultivos.'
  }
  return e.message
}
