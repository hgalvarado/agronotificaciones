'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton } from '@/components/ui/Primitivos'
import { IconCheck, IconPencil, IconPlus, IconX } from '@/components/ui/Icons'
import {
  construirXlsxPlantilla,
  descargar,
  leerArchivoTabular,
  partirTextoTabular,
  type ListaPlantilla,
} from '@/lib/hojas'
import type { CampoCatalogo } from './CatalogoTable'
import { mensajeDeError } from '@/lib/errores'

/**
 * Una vinculación de muchos a muchos que también se puede importar.
 *
 * Las labores no son un catálogo plano: cada una lleva sus tareas SAP y
 * sus implementos en tablas puente. Sin esto, importar labores desde
 * Excel dejaría labores sin tareas —o sea inservibles, porque la captura
 * no ofrece ninguna tarea— y habría que entrar a vincularlas a mano una
 * por una, que es justo lo que se quiere evitar.
 *
 * En la hoja la celda lleva los nombres separados por coma:
 * «T101 · Arado, T108 · Emplasticado».
 */
export type RelacionCatalogo = {
  /** Encabezado que lleva en la plantilla. */
  label: string
  /** Tabla puente, p. ej. 'labores_tareas'. */
  tabla: string
  /** Columna que apunta a la fila del catálogo, p. ej. 'labor_id'. */
  columnaPadre: string
  /** Columna que apunta al catálogo relacionado, p. ej. 'tarea_id'. */
  columnaHijo: string
  opciones: { value: string; label: string }[]
}

/** Quita acentos y mayúsculas para comparar encabezados y opciones. */
function normalizar(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

// `normalizar` ya quita los acentos, asi que 'si' cubre tambien a 'si' con tilde.
const VERDADEROS = new Set(['si', 'true', 'verdadero', 'x', '1', 'activo', 'yes'])

type Fila = Record<string, string | number | boolean | null>

/** Qué se va a hacer con la fila cuando se confirme la importación. */
type Accion = 'insertar' | 'actualizar' | 'omitir'

type FilaPreparada = {
  numero: number
  valores: Record<string, string | number | boolean | null>
  errores: string[]
  accion: Accion
  /** id de la fila existente que se va a actualizar. */
  idExistente?: string
  /** Valor de la clave, para mostrarlo en los avisos. */
  etiquetaClave: string
  /**
   * Vinculaciones que trae la fila, por tabla puente. Sólo aparecen las
   * columnas que el archivo realmente trajo con algo escrito: una celda
   * en blanco deja las vinculaciones como están.
   */
  relaciones: Record<string, string[]>
}

/** Separa «A, B; C | D» en sus partes. */
function partirLista(texto: string) {
  return texto
    .split(/[,;|\n]+/)
    .map((t) => t.trim())
    .filter((t) => t !== '')
}

type Modo = 'agregar' | 'actualizar'

export function ImportarExcel({
  abierto,
  onCerrar,
  tabla,
  titulo,
  campos,
  filas,
  clave,
  relaciones = [],
}: {
  abierto: boolean
  onCerrar: () => void
  tabla: string
  titulo: string
  campos: CampoCatalogo[]
  /** Lo que ya existe en el catálogo, para reconocer repetidos. */
  filas: Fila[]
  /**
   * Campo que identifica una fila del mundo real (el código del puesto, el
   * nombre de la zona…). Es lo que permite ACTUALIZAR en vez de duplicar.
   */
  clave: string
  /** Vinculaciones de muchos a muchos que también entran por el archivo. */
  relaciones?: RelacionCatalogo[]
}) {
  const supabase = createClient()
  const router = useRouter()
  const refArchivo = useRef<HTMLInputElement>(null)

  const [modo, setModo] = useState<Modo>('agregar')
  const [pegado, setPegado] = useState('')
  // Se guarda la matriz cruda para poder rearmar todo si cambia el modo,
  // sin obligar a volver a subir el archivo.
  const [matriz, setMatriz] = useState<string[][] | null>(null)
  const [preparadas, setPreparadas] = useState<FilaPreparada[] | null>(null)
  const [columnasIgnoradas, setColumnasIgnoradas] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  // Los campos generados por la base no se importan.
  const importables = campos.filter((c) => c.key !== 'id')
  const campoClave = importables.find((c) => c.key === clave)

  // Índice de lo que ya existe: clave normalizada → id.
  const existentes = new Map<string, string>()
  for (const f of filas) {
    const valor = f[clave]
    if (valor !== null && valor !== undefined && String(valor).trim() !== '') {
      existentes.set(normalizar(String(valor)), String(f.id))
    }
  }

  function reiniciar() {
    setMatriz(null)
    setPreparadas(null)
    setColumnasIgnoradas([])
    setError(null)
    setResultado(null)
    setPegado('')
    if (refArchivo.current) refArchivo.current.value = ''
  }

  function cerrar() {
    reiniciar()
    onCerrar()
  }

  /* ----------------------------- Plantilla ---------------------------- */

  function bajarPlantilla() {
    // El encabezado lleva las etiquetas que se ven en pantalla, no los
    // nombres internos de las columnas: es lo que él reconoce. Al leer se
    // aceptan ambos, así que un archivo con `familia_id` también entra.
    // Va sólo el encabezado, sin fila de ejemplo: una fila de ejemplo se
    // importaría junto con los datos reales y habría que andar borrándola.
    const encabezados = [...importables.map((c) => c.label), ...relaciones.map((r) => r.label)]

    // «La plantilla debe contener validación de datos (listas
    //  desplegables) preconfiguradas.»
    //
    // Cada columna que apunta a otro catálogo sale con su desplegable, y
    // los interruptores con SI/NO. Así el que llena la hoja no tiene que
    // adivinar cómo se escribe «Preparación de suelo» y el importador ya
    // no rebota filas por una tilde.
    const listas: ListaPlantilla[] = []

    importables.forEach((c, i) => {
      if (c.tipo === 'select' && (c.opciones ?? []).length > 0) {
        listas.push({ columna: i, titulo: c.label, valores: (c.opciones ?? []).map((o) => o.label) })
      } else if (c.tipo === 'checkbox') {
        listas.push({ columna: i, titulo: c.label, valores: ['SI', 'NO'] })
      }
    })

    relaciones.forEach((r, i) => {
      if (r.opciones.length === 0) return
      listas.push({
        columna: importables.length + i,
        titulo: r.label,
        valores: r.opciones.map((o) => o.label),
        // En estas caben varias separadas por coma, así que el
        // desplegable se ofrece pero no se obliga.
        varios: true,
      })
    })

    descargar(
      construirXlsxPlantilla(titulo, encabezados, listas),
      `plantilla-${tabla}.xlsx`
    )
  }

  /* ------------------------------ Lectura ----------------------------- */

  function preparar(datos: string[][], modoActual: Modo) {
    setError(null)
    setResultado(null)
    setMatriz(datos)

    if (datos.length < 2) {
      setPreparadas(null)
      setError('El archivo debe traer la fila de encabezados y al menos una fila de datos.')
      return
    }

    const encabezados = datos[0]
    // Cada columna del archivo se asocia a un campo por etiqueta o por
    // nombre interno. Lo que no coincida se avisa en vez de descartarlo en
    // silencio: un encabezado mal escrito perdería la columna completa sin
    // que nadie se enterara.
    const mapa: (CampoCatalogo | null)[] = encabezados.map((h) => {
      const n = normalizar(h)
      return importables.find((c) => normalizar(c.label) === n || normalizar(c.key) === n) ?? null
    })

    // Las columnas de vinculación se resuelven aparte porque no son
    // columnas de la tabla: van a su tabla puente.
    const mapaRel: (RelacionCatalogo | null)[] = encabezados.map((h, i) => {
      if (mapa[i]) return null
      const n = normalizar(h)
      return relaciones.find((r) => normalizar(r.label) === n || normalizar(r.tabla) === n) ?? null
    })

    setColumnasIgnoradas(
      encabezados.filter((h, i) => h.trim() !== '' && mapa[i] === null && mapaRel[i] === null)
    )

    if (mapa.every((m) => m === null)) {
      setPreparadas(null)
      setError(
        `Ningún encabezado coincide con las columnas de ${titulo}. Descarga la plantilla y pega los datos ahí.`
      )
      return
    }

    const columnaClave = mapa.findIndex((c) => c?.key === clave)
    if (columnaClave < 0 && modoActual === 'actualizar') {
      setPreparadas(null)
      setError(
        `Para actualizar hace falta la columna «${campoClave?.label ?? clave}»: es con eso que se reconoce cada fila.`
      )
      return
    }

    const resultadoFilas: FilaPreparada[] = []

    for (let i = 1; i < datos.length; i++) {
      const cruda = datos[i]
      if (cruda.every((c) => (c ?? '').trim() === '')) continue // fila vacía

      const valores: Record<string, string | number | boolean | null> = {}
      const errores: string[] = []

      mapa.forEach((campo, col) => {
        if (!campo) return
        const bruto = (cruda[col] ?? '').trim()
        // Una celda en blanco significa «no tocar», no «poner en blanco».
        // Es lo seguro al actualizar: si alguien sube sólo dos columnas, no
        // quiere borrar el resto del catálogo.
        if (bruto === '') return

        if (campo.tipo === 'number') {
          // Excel puede entregar "1.234,50" según la configuración regional.
          const limpio = bruto.replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')
          const n = Number(limpio)
          if (Number.isNaN(n)) errores.push(`«${campo.label}»: “${bruto}” no es un número`)
          else valores[campo.key] = n
        } else if (campo.tipo === 'checkbox') {
          valores[campo.key] = VERDADEROS.has(normalizar(bruto))
        } else if (campo.tipo === 'select') {
          // El usuario escribe el nombre («Tractores 60-90HP»), no el UUID.
          const opciones = campo.opciones ?? []
          const n = normalizar(bruto)
          const encontrada =
            opciones.find((o) => normalizar(o.label) === n) ??
            // Los puestos vienen como "CODIGO · 0040": basta con que el
            // texto escrito sea el comienzo de la etiqueta.
            opciones.find((o) => normalizar(o.label).startsWith(n)) ??
            opciones.find((o) => o.value === bruto)
          if (!encontrada) errores.push(`«${campo.label}»: no existe “${bruto}”`)
          else valores[campo.key] = encontrada.value
        } else if (campo.tipo === 'date') {
          // Se aceptan 2026-09-07 y 07/09/2026.
          const iso = /^\d{4}-\d{2}-\d{2}$/.test(bruto)
            ? bruto
            : (() => {
                const m = bruto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
                return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
              })()
          if (!iso) errores.push(`«${campo.label}»: “${bruto}” no es una fecha (usa 2026-09-07)`)
          else valores[campo.key] = iso
        } else {
          valores[campo.key] = bruto
        }
      })

      // Vinculaciones: «T101 · Arado, T108 · Emplasticado» → dos ids.
      const relacionesFila: Record<string, string[]> = {}
      mapaRel.forEach((rel, col) => {
        if (!rel) return
        const bruto = (cruda[col] ?? '').trim()
        if (bruto === '') return // en blanco = no tocar
        const ids: string[] = []
        for (const parte of partirLista(bruto)) {
          const n = normalizar(parte)
          const hallada =
            rel.opciones.find((o) => normalizar(o.label) === n) ??
            // Basta escribir «T101» aunque la lista diga «T101 · Arado».
            rel.opciones.find((o) => normalizar(o.label).startsWith(n)) ??
            rel.opciones.find((o) => o.value === parte)
          if (!hallada) errores.push(`«${rel.label}»: no existe “${parte}”`)
          else if (!ids.includes(hallada.value)) ids.push(hallada.value)
        }
        relacionesFila[rel.tabla] = ids
      })

      const valorClave = columnaClave >= 0 ? (cruda[columnaClave] ?? '').trim() : ''
      const idExistente = valorClave ? existentes.get(normalizar(valorClave)) : undefined

      let accion: Accion
      if (idExistente) {
        // Ya existe. En modo «agregar» se omite en vez de duplicarla; en
        // modo «actualizar» se sobreescribe.
        accion = modoActual === 'actualizar' ? 'actualizar' : 'omitir'
      } else {
        accion = 'insertar'
      }

      // Los campos obligatorios sólo se exigen al crear: al actualizar, lo
      // que no venga en el archivo se queda como está.
      if (accion === 'insertar') {
        importables
          .filter((c) => c.requerido)
          .forEach((c) => {
            if (valores[c.key] === undefined || valores[c.key] === '')
              errores.push(`falta «${c.label}»`)
          })
      }

      // Al actualizar, la clave no se reescribe: es la que identifica la
      // fila y ya coincide.
      if (accion === 'actualizar') delete valores[clave]

      if (
        accion === 'actualizar' &&
        Object.keys(valores).length === 0 &&
        Object.keys(relacionesFila).length === 0
      ) {
        accion = 'omitir'
      }

      resultadoFilas.push({
        numero: i + 1,
        valores,
        errores,
        accion,
        idExistente,
        etiquetaClave: valorClave || `fila ${i + 1}`,
        relaciones: relacionesFila,
      })
    }

    if (resultadoFilas.length === 0) {
      setPreparadas(null)
      setError('No se encontró ninguna fila con datos.')
      return
    }

    setPreparadas(resultadoFilas)
  }

  function cambiarModo(nuevo: Modo) {
    setModo(nuevo)
    if (matriz) preparar(matriz, nuevo)
  }

  async function alSubirArchivo(archivo: File) {
    try {
      preparar(await leerArchivoTabular(archivo), modo)
    } catch (e) {
      setMatriz(null)
      setPreparadas(null)
      setError(mensajeDeError(e, 'No se pudo leer el archivo.'))
    }
  }

  /* ----------------------------- Importar ----------------------------- */

  async function importar() {
    if (!preparadas) return

    const nuevas = preparadas.filter((f) => f.errores.length === 0 && f.accion === 'insertar')
    const cambios = preparadas.filter((f) => f.errores.length === 0 && f.accion === 'actualizar')
    if (nuevas.length === 0 && cambios.length === 0) return

    setImportando(true)
    setError(null)

    let insertadas = 0
    let actualizadas = 0

    /**
     * Reemplaza las vinculaciones de una fila: borra las que tiene y
     * mete las del archivo. Reemplazar y no agregar es lo que él espera
     * cuando sube la hoja corregida —si sólo se agregara, quitar una
     * tarea de una labor sería imposible desde Excel— y sólo se toca la
     * columna que el archivo trajo con algo escrito.
     */
    async function guardarRelaciones(idPadre: string, mapa: Record<string, string[]>) {
      for (const rel of relaciones) {
        const ids = mapa[rel.tabla]
        if (!ids) continue
        const { error: eBorrar } = await supabase
          .from(rel.tabla)
          .delete()
          .eq(rel.columnaPadre, idPadre)
        if (eBorrar) throw new Error(`al guardar «${rel.label}»: ${eBorrar.message}`)
        if (ids.length === 0) continue
        const { error: eMeter } = await supabase
          .from(rel.tabla)
          .insert(ids.map((id) => ({ [rel.columnaPadre]: idPadre, [rel.columnaHijo]: id })))
        if (eMeter) throw new Error(`al guardar «${rel.label}»: ${eMeter.message}`)
      }
    }

    try {
      if (relaciones.length > 0) {
        // Con vinculaciones hay que saber el id de CADA fila nueva para
        // colgarle sus tareas e implementos. Se insertan de una en una y
        // se pide el id de vuelta: fiarse del orden en que PostgREST
        // devuelve un insert masivo sería adivinar, y una labor con las
        // tareas de otra es peor que un error.
        for (const f of nuevas) {
          const { data, error: e } = await supabase
            .from(tabla)
            .insert(f.valores)
            .select('id')
            .single()
          if (e) throw new Error(`en «${f.etiquetaClave}»: ${e.message}`)
          await guardarRelaciones((data as { id: string }).id, f.relaciones)
          insertadas += 1
        }
      } else {
        // En tandas: un insert de 500 filas de golpe se puede pasar del límite
        // de la petición, y si falla no se sabe cuáles entraron.
        const TANDA = 200
        for (let i = 0; i < nuevas.length; i += TANDA) {
          const lote = nuevas.slice(i, i + TANDA).map((f) => f.valores)
          const { error: e } = await supabase.from(tabla).insert(lote)
          if (e) throw new Error(`al agregar: ${e.message}`)
          insertadas += lote.length
        }
      }

      // Las actualizaciones van una por una porque cada fila apunta a un id
      // distinto. Se mandan en grupos en paralelo para que 300 filas no
      // tarden 300 viajes en serie.
      const PARALELAS = 10
      for (let i = 0; i < cambios.length; i += PARALELAS) {
        const grupo = cambios.slice(i, i + PARALELAS)
        const respuestas = await Promise.all(
          grupo.map(async (f): Promise<{ error: { message: string } | null }> => {
            // Puede venir sólo la vinculación, sin ninguna columna: en
            // ese caso no hay nada que actualizar en la tabla.
            if (Object.keys(f.valores).length > 0) {
              const r = await supabase.from(tabla).update(f.valores).eq('id', f.idExistente!)
              if (r.error) return { error: { message: r.error.message } }
            }
            await guardarRelaciones(f.idExistente!, f.relaciones)
            return { error: null }
          })
        )
        const fallo = respuestas.findIndex((r) => r.error)
        if (fallo >= 0) {
          throw new Error(`en «${grupo[fallo].etiquetaClave}»: ${respuestas[fallo].error!.message}`)
        }
        actualizadas += grupo.length
      }

      setImportando(false)
      reiniciar()
      const partes = []
      if (insertadas > 0) partes.push(`${insertadas} agregada${insertadas === 1 ? '' : 's'}`)
      if (actualizadas > 0)
        partes.push(`${actualizadas} actualizada${actualizadas === 1 ? '' : 's'}`)
      setResultado(`Listo: ${partes.join(' y ')}.`)
      router.refresh()
    } catch (e) {
      setImportando(false)
      setError(
        `${mensajeDeError(e, 'No se pudo importar.')} — quedaron ${insertadas} agregadas y ${actualizadas} actualizadas.`
      )
      router.refresh()
    }
  }

  const nuevas = preparadas?.filter((f) => f.errores.length === 0 && f.accion === 'insertar') ?? []
  const cambios =
    preparadas?.filter((f) => f.errores.length === 0 && f.accion === 'actualizar') ?? []
  const omitidas = preparadas?.filter((f) => f.errores.length === 0 && f.accion === 'omitir') ?? []
  const conError = preparadas?.filter((f) => f.errores.length > 0) ?? []
  const aplicables = nuevas.length + cambios.length
  const camposRelacion = importables.filter((c) => c.tipo === 'select')

  return (
    <Modal
      abierto={abierto}
      onCerrar={cerrar}
      titulo={`Importar ${titulo}`}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={cerrar} disabled={importando}>
            Cerrar
          </Boton>
          <Boton className="flex-1" onClick={importar} disabled={importando || aplicables === 0}>
            {importando ? 'Importando…' : aplicables > 0 ? `Aplicar ${aplicables}` : 'Aplicar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Paso 1 */}
        <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-inset ring-slate-200/70">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Paso 1</p>
          <p className="mt-0.5 text-sm text-slate-600">
            Baja la plantilla vacía, o usa el botón «Excel» de la tabla para bajar lo que ya hay y
            corregirlo.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            La plantilla trae las <strong>listas desplegables</strong> ya puestas: en las columnas
            que apuntan a otro catálogo se elige de la lista en vez de escribir. Los valores válidos
            también quedan a la vista en la hoja «Listas» del mismo archivo.
          </p>
          <Boton variante="secundario" tamano="sm" className="mt-2.5" onClick={bajarPlantilla}>
            Descargar plantilla .xlsx
          </Boton>
        </div>

        {/* Paso 2 · qué hacer con las filas que ya existen */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Paso 2</p>
          <p className="mt-0.5 mb-2 text-sm text-slate-600">
            ¿Qué hago con las filas que ya existen? Se reconocen por «
            {campoClave?.label ?? clave}».
          </p>
          <div className="grid grid-cols-2 gap-2">
            <BotonModo
              activo={modo === 'agregar'}
              onClick={() => cambiarModo('agregar')}
              icono={<IconPlus className="h-4 w-4" />}
              titulo="Sólo agregar"
              descripcion="Las repetidas se saltan"
            />
            <BotonModo
              activo={modo === 'actualizar'}
              onClick={() => cambiarModo('actualizar')}
              icono={<IconPencil className="h-4 w-4" />}
              titulo="Agregar y actualizar"
              descripcion="Las repetidas se corrigen"
            />
          </div>
          {modo === 'actualizar' && (
            <p className="mt-2 text-xs text-slate-400">
              Sólo se cambian las columnas que traiga el archivo. Una celda en blanco se deja como
              está, no se borra.
            </p>
          )}
        </div>

        {/* Paso 3 */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Paso 3</p>
          <p className="mt-0.5 mb-2 text-sm text-slate-600">
            Sube el archivo lleno, o pega las filas directo desde Excel.
          </p>

          <input
            ref={refArchivo}
            type="file"
            accept=".xlsx,.csv,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) alSubirArchivo(f)
            }}
            className="w-full rounded-xl border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
          />

          <textarea
            value={pegado}
            onChange={(e) => {
              setPegado(e.target.value)
              const t = e.target.value.trim()
              if (t) preparar(partirTextoTabular(t), modo)
              else {
                setMatriz(null)
                setPreparadas(null)
              }
            }}
            rows={3}
            placeholder="…o pega aquí desde Excel (con la fila de encabezados)"
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs placeholder:font-sans placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>

        {camposRelacion.length > 0 && (
          <p className="text-xs text-slate-400">
            En {camposRelacion.map((c) => `«${c.label}»`).join(' y ')} escribe el nombre tal como
            aparece en su catálogo — no hace falta ningún código interno.
          </p>
        )}

        {relaciones.length > 0 && (
          <p className="text-xs text-slate-400">
            En {relaciones.map((r) => `«${r.label}»`).join(' y ')} caben varios separados por coma
            («T101 · Arado, T108 · Emplasticado»). Lo que traiga el archivo{' '}
            <strong>reemplaza</strong> lo que la fila tenía vinculado; si dejas la celda en blanco,
            no se toca nada.
          </p>
        )}

        {columnasIgnoradas.length > 0 && (
          <Alerta tono="ambar">
            Estas columnas del archivo no corresponden a ningún campo y se van a ignorar:{' '}
            {columnasIgnoradas.join(', ')}.
          </Alerta>
        )}

        {error && <Alerta>{error}</Alerta>}

        {resultado && (
          <Alerta tono="azul">
            <span className="inline-flex items-center gap-1.5">
              <IconCheck className="h-4 w-4" />
              {resultado}
            </span>
          </Alerta>
        )}

        {/* Revisión */}
        {preparadas && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Qué va a pasar
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              {nuevas.length > 0 && (
                <Etiqueta clase="bg-emerald-50 text-emerald-700">
                  <IconPlus className="h-3.5 w-3.5" />
                  {nuevas.length} nueva{nuevas.length === 1 ? '' : 's'}
                </Etiqueta>
              )}
              {cambios.length > 0 && (
                <Etiqueta clase="bg-blue-50 text-blue-700">
                  <IconPencil className="h-3.5 w-3.5" />
                  {cambios.length} a actualizar
                </Etiqueta>
              )}
              {omitidas.length > 0 && (
                <Etiqueta clase="bg-slate-100 text-slate-600">
                  {omitidas.length} sin cambios
                </Etiqueta>
              )}
              {conError.length > 0 && (
                <Etiqueta clase="bg-red-50 text-red-700">
                  <IconX className="h-3.5 w-3.5" />
                  {conError.length} con problema
                </Etiqueta>
              )}
            </div>

            {omitidas.length > 0 && modo === 'agregar' && (
              <p className="mt-2 text-xs text-slate-400">
                Hay {omitidas.length} fila{omitidas.length === 1 ? '' : 's'} que ya{' '}
                {omitidas.length === 1 ? 'existe' : 'existen'} en el catálogo. Si querías corregir
                lo que ya está, cambia arriba a «Agregar y actualizar».
              </p>
            )}

            {conError.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-red-50/60 p-3 text-xs text-red-800">
                {conError.slice(0, 25).map((f) => (
                  <li key={f.numero} className="py-0.5">
                    <span className="font-semibold">Fila {f.numero}:</span> {f.errores.join(' · ')}
                  </li>
                ))}
                {conError.length > 25 && (
                  <li className="pt-1 italic">…y {conError.length - 25} más.</li>
                )}
              </ul>
            )}

            <p className="mt-2 text-xs text-slate-400">
              Las filas con problema no se tocan y quedan intactas en tu archivo para corregirlas y
              volver a subirlas.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

function BotonModo({
  activo,
  onClick,
  icono,
  titulo,
  descripcion,
}: {
  activo: boolean
  onClick: () => void
  icono: React.ReactNode
  titulo: string
  descripcion: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition-all ${
        activo
          ? 'bg-brand-700 text-white shadow-[var(--shadow-raised)]'
          : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'
      }`}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        {icono}
        {titulo}
      </span>
      <span className={`text-[11px] ${activo ? 'text-white/70' : 'text-slate-400'}`}>
        {descripcion}
      </span>
    </button>
  )
}

function Etiqueta({ clase, children }: { clase: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ${clase}`}
    >
      {children}
    </span>
  )
}
