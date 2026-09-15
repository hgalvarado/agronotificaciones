'use client'

/**
 * Importador de hojas con llave compuesta.
 *
 * Vive en `ui` y no en un módulo concreto porque lo usan tres: el
 * trasplante, el plan de siembra y los turnos de riego. Cuando estaba
 * dentro de `trasplante/` el tercero que lo necesitó tuvo que importar
 * desde el módulo de otro, que es como empiezan las dependencias
 * cruzadas.
 *
 * Es la misma UX del importador de catálogos —plantilla, archivo o
 * pegado, vista previa fila por fila, agregar o actualizar— pero
 * sirviendo a tablas con llave compuesta, que el genérico no sabe
 * expresar.
 *
 * Reparto de responsabilidades: leer el archivo es de `hojas`, entender
 * las celdas es de `importacion` (puro), y este componente sólo enseña lo
 * entendido y manda a guardar lo que el usuario confirme.
 */

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton } from '@/components/ui/Primitivos'
import { IconCheck, IconPencil, IconPlus, IconX } from '@/components/ui/Icons'
import {
  construirXlsx,
  construirXlsxPlantilla,
  descargar,
  leerArchivoTabular,
  partirTextoTabular,
  type CeldaHoja,
  type ListaPlantilla,
} from '@/lib/hojas'
import { mapearColumnas, type ColumnaHoja } from '@/lib/importacion'
import { mensajeDeError } from '@/lib/errores'

export type Preparada<T> = {
  numero: number
  accion: 'insertar' | 'actualizar' | 'omitir'
  error?: string
  /** Cómo se ve la fila en la vista previa. */
  resumen: string[]
  valores: T
}

export function ImportarHoja<T>({
  abierto,
  onCerrar,
  titulo,
  ayuda,
  columnas,
  cabecerasResumen,
  ejemplo,
  listas = [],
  etiquetaActualizar = 'Actualiza',
  interpretar,
  guardar,
}: {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  ayuda: string
  columnas: ColumnaHoja[]
  /** Encabezados de la tabla de vista previa. */
  cabecerasResumen: string[]
  /** Una fila de ejemplo para la plantilla. */
  ejemplo: CeldaHoja[]
  /**
   * Desplegables de la plantilla, por índice de columna.
   *
   * Sin esto la plantilla es una hoja en blanco con encabezados y quien
   * la llena tiene que adivinar cómo se escribe «Preparación de suelo».
   * Con esto, Excel sólo deja elegir de la lista y el importador deja de
   * rebotar filas por una tilde.
   */
  listas?: ListaPlantilla[]
  /** Qué dice la vista previa cuando la fila pisa algo que ya existe. */
  etiquetaActualizar?: string
  /** Convierte una fila de texto en valores, o en un error. */
  interpretar: (celdas: string[], numero: number) => Preparada<T>
  /** Escribe en la base lo que se confirmó. */
  guardar: (filas: T[]) => Promise<{ error: string | null; mensaje: string }>
}) {
  const router = useRouter()
  const refArchivo = useRef<HTMLInputElement>(null)

  const [pegado, setPegado] = useState('')
  const [preparadas, setPreparadas] = useState<Preparada<T>[] | null>(null)
  const [ignoradas, setIgnoradas] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  function plantilla() {
    const encabezados = columnas.map((c) => c.alias[0])
    const nombre = `plantilla-${titulo.toLowerCase().replace(/\s+/g, '-')}.xlsx`

    // Con catálogos, la plantilla lleva los desplegables puestos. Sin
    // ellos se cae a la hoja simple con una fila de ejemplo, que es lo
    // que hacía antes: la plantilla inteligente no admite fila de
    // ejemplo —se importaría junto con los datos de verdad—.
    if (listas.length > 0) {
      return descargar(construirXlsxPlantilla(titulo, encabezados, listas), nombre)
    }

    const hoja: CeldaHoja[][] = [encabezados, ejemplo]
    descargar(construirXlsx('Plantilla', hoja), nombre)
  }

  function procesar(matriz: string[][]) {
    setError(null)
    setResultado(null)

    if (matriz.length < 2) {
      setPreparadas(null)
      return setError('El archivo no trae filas debajo del encabezado.')
    }

    const { posiciones, ignoradas: sobran } = mapearColumnas(matriz[0], columnas)
    const faltan = columnas.filter((c) => posiciones[c.clave] === -1).map((c) => c.alias[0])
    if (faltan.length === columnas.length) {
      setPreparadas(null)
      return setError(
        `No se reconoció ningún encabezado. La hoja debe traer: ${columnas
          .map((c) => c.alias[0])
          .join(', ')}.`
      )
    }

    setIgnoradas(sobran)
    setPreparadas(
      matriz
        .slice(1)
        .filter((fila) => fila.some((c) => (c ?? '').trim() !== ''))
        .map((fila, i) =>
          interpretar(
            columnas.map((c) => (posiciones[c.clave] >= 0 ? (fila[posiciones[c.clave]] ?? '') : '')),
            i + 2
          )
        )
    )
  }

  async function subir(archivo: File | null) {
    if (!archivo) return
    try {
      procesar(await leerArchivoTabular(archivo))
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo leer el archivo.'))
    }
  }

  async function confirmar() {
    const buenas = (preparadas ?? []).filter((p) => p.accion !== 'omitir').map((p) => p.valores)
    if (buenas.length === 0) return

    setImportando(true)
    const { error: e, mensaje } = await guardar(buenas)
    setImportando(false)

    if (e) return setError(e)
    setResultado(mensaje)
    setPreparadas(null)
    setPegado('')
    router.refresh()
  }

  const aImportar = (preparadas ?? []).filter((p) => p.accion !== 'omitir').length
  const conError = (preparadas ?? []).filter((p) => p.accion === 'omitir').length

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={titulo}
      pie={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Boton variante="secundario" tamano="sm" onClick={plantilla}>
            Descargar plantilla
          </Boton>
          <div className="flex gap-2">
            <Boton variante="secundario" onClick={onCerrar} disabled={importando}>
              Cerrar
            </Boton>
            <Boton onClick={confirmar} disabled={importando || aImportar === 0}>
              {importando ? 'Importando…' : `Importar ${aImportar}`}
            </Boton>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta>{error}</Alerta>}
        {resultado && <Alerta tono="azul">{resultado}</Alerta>}

        <p className="text-sm text-slate-500">{ayuda}</p>

        <div className="flex flex-wrap gap-2">
          <input
            ref={refArchivo}
            type="file"
            accept=".xlsx,.csv,.tsv,.txt"
            onChange={(e) => subir(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <Boton variante="secundario" tamano="sm" onClick={() => refArchivo.current?.click()}>
            Elegir archivo
          </Boton>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            …o pega las celdas desde Excel
          </span>
          <textarea
            rows={3}
            value={pegado}
            onChange={(e) => setPegado(e.target.value)}
            onBlur={() => pegado.trim() && procesar(partirTextoTabular(pegado))}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
            placeholder="Pega aquí, con su fila de encabezados"
          />
        </label>

        {ignoradas.length > 0 && (
          <Alerta tono="ambar">
            Estas columnas del archivo no se usaron: {ignoradas.join(', ')}.
          </Alerta>
        )}

        {preparadas && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-slate-600">
              <IconCheck className="mr-1 inline h-4 w-4 text-emerald-600" />
              {aImportar} {aImportar === 1 ? 'fila lista' : 'filas listas'}
              {conError > 0 && (
                <span className="ml-2 text-amber-700">
                  <IconX className="mr-1 inline h-4 w-4" />
                  {conError} con problemas, no se importan
                </span>
              )}
            </p>

            <div className="scroll-suave max-h-72 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1.5">Fila</th>
                    {cabecerasResumen.map((c) => (
                      <th key={c} className="px-2 py-1.5">
                        {c}
                      </th>
                    ))}
                    <th className="px-2 py-1.5">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {preparadas.map((p) => (
                    <tr
                      key={p.numero}
                      className={`border-t border-slate-100 ${
                        p.accion === 'omitir' ? 'bg-amber-50/60' : ''
                      }`}
                    >
                      <td className="px-2 py-1 text-slate-400">{p.numero}</td>
                      {p.resumen.map((v, i) => (
                        <td key={i} className="px-2 py-1 text-slate-700">
                          {v}
                        </td>
                      ))}
                      <td className="px-2 py-1">
                        {p.accion === 'omitir' ? (
                          <span className="text-amber-700">{p.error}</span>
                        ) : p.accion === 'actualizar' ? (
                          <span className="text-brand-700">
                            <IconPencil className="mr-1 inline h-3.5 w-3.5" />
                            {etiquetaActualizar}
                          </span>
                        ) : (
                          <span className="text-emerald-700">
                            <IconPlus className="mr-1 inline h-3.5 w-3.5" />
                            Agrega
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
