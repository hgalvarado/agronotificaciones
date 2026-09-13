'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton } from '@/components/ui/Primitivos'
import { IconCheck, IconPlus, IconX } from '@/components/ui/Icons'
import {
  construirXlsxPlantilla,
  descargar,
  leerArchivoTabular,
  partirTextoTabular,
  type ListaPlantilla,
} from '@/lib/hojas'
import { mensajeDeError } from '@/lib/errores'

/* ------------------------------------------------------------------ */
/* Catálogos que alimentan la plantilla                                */
/* ------------------------------------------------------------------ */

export type CatalogosTicket = {
  equipos: { id: string; codigo: string; nombre: string }[]
  operadores: { id: string; codigo: string | null; nombre: string }[]
  labores: {
    id: string
    nombre: string
    labores_tareas: { tarea_id: string }[]
    labores_implementos: { implemento_id: string }[]
    labores_implementos_fisicos?: { implemento_fisico_id: string }[]
  }[]
  tareasSap: { id: string; codigo: string; nombre: string }[]
  implementos: { id: string; codigo: string; nombre: string }[]
  lotes: { id: string; nomenclatura: string; nombre: string | null }[]
  proveedores: { id: string; nombre: string; tipo: string }[]
  /** Máquinas concretas: ROMSR-01, ROMSR-08… (migración 19). */
  implementosFisicos: { id: string; codigo: string; descripcion: string }[]
}

/** Quita acentos y mayúsculas para comparar encabezados y opciones. */
function normalizar(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

const VERDADEROS = new Set(['si', 'true', 'verdadero', 'x', '1', 'yes'])

/**
 * Una columna de la plantilla.
 *
 * `clave` es el nombre que espera `fn_importar_detalle_ticket`; `lista`
 * dice de qué catálogo sale su desplegable. Tener las columnas en una
 * sola tabla es lo que mantiene sincronizados el encabezado que se
 * descarga, las validaciones del archivo y la lectura de vuelta: antes
 * cada cosa vivía en un sitio distinto y una columna renombrada perdía
 * los datos en silencio.
 */
type Columna = {
  clave: string
  label: string
  tipo: 'texto' | 'numero' | 'entero' | 'booleano' | 'catalogo'
  lista?: keyof CatalogosTicket | 'turnos' | 'ciclos' | 'etapas' | 'plasticos' | 'mangueras'
  requerido?: boolean
  ayuda?: string
}

const COLUMNAS: Columna[] = [
  { clave: 'equipo_id', label: 'Equipo', tipo: 'catalogo', lista: 'equipos', requerido: true },
  { clave: 'turno', label: 'Turno', tipo: 'catalogo', lista: 'turnos', requerido: true },
  { clave: 'horometro_inicial', label: 'Horómetro inicial', tipo: 'numero' },
  { clave: 'horometro_final', label: 'Horómetro final', tipo: 'numero' },
  // En blanco se guardan 8 —la jornada—, que es lo que él pidió: en el
  // histórico el dato casi nunca viene y rellenarlo a mano en 300 filas
  // no tiene sentido. El valor por omisión lo pone la base.
  { clave: 'horas_hombre', label: 'Horas hombre', tipo: 'numero' },
  { clave: 'operador_id', label: 'Operador', tipo: 'catalogo', lista: 'operadores' },
  { clave: 'labor_id', label: 'Labor', tipo: 'catalogo', lista: 'labores', requerido: true },
  { clave: 'tarea_id', label: 'Tarea SAP', tipo: 'catalogo', lista: 'tareasSap', requerido: true },
  { clave: 'implemento_id', label: 'Implemento', tipo: 'catalogo', lista: 'implementos' },
  {
    clave: 'implemento_fisico_id',
    label: 'Cód. implemento',
    tipo: 'catalogo',
    lista: 'implementosFisicos',
  },
  { clave: 'horas_notificadas', label: 'Horas de la labor', tipo: 'numero' },
  { clave: 'lote_temporada_id', label: 'Lote (UT)', tipo: 'catalogo', lista: 'lotes', requerido: true },
  { clave: 'ciclo', label: 'Ciclo', tipo: 'catalogo', lista: 'ciclos' },
  { clave: 'avance_mz', label: 'Manzanas', tipo: 'numero' },
  { clave: 'etapa', label: 'Etapa', tipo: 'catalogo', lista: 'etapas' },
  { clave: 'proveedor_plastico_id', label: 'Prov. plástico', tipo: 'catalogo', lista: 'plasticos' },
  { clave: 'proveedor_manguera_id', label: 'Prov. manguera', tipo: 'catalogo', lista: 'mangueras' },
  { clave: 'comentario', label: 'Observaciones', tipo: 'texto' },
]

type Opcion = { value: string; label: string }

/** Opciones de cada columna de catálogo, ya con la etiqueta que se ve. */
function opcionesDe(lista: Columna['lista'], c: CatalogosTicket): Opcion[] {
  switch (lista) {
    case 'equipos':
      return c.equipos.map((e) => ({ value: e.id, label: `${e.codigo} · ${e.nombre}` }))
    case 'operadores':
      return c.operadores.map((o) => ({
        value: o.id,
        label: o.codigo ? `${o.codigo} · ${o.nombre}` : o.nombre,
      }))
    case 'labores':
      return c.labores.map((l) => ({ value: l.id, label: l.nombre }))
    case 'tareasSap':
      return c.tareasSap.map((t) => ({ value: t.id, label: `${t.codigo} · ${t.nombre}` }))
    case 'implementos':
      return c.implementos.map((i) => ({ value: i.id, label: `${i.codigo} · ${i.nombre}` }))
    case 'implementosFisicos':
      return c.implementosFisicos.map((i) => ({
        value: i.id,
        label: `${i.codigo} · ${i.descripcion}`,
      }))
    case 'lotes':
      return c.lotes.map((l) => ({
        value: l.id,
        label: l.nombre ? `${l.nomenclatura} · ${l.nombre}` : l.nomenclatura,
      }))
    case 'plasticos':
      return c.proveedores
        .filter((p) => p.tipo === 'PLASTICO')
        .map((p) => ({ value: p.id, label: p.nombre }))
    case 'mangueras':
      return c.proveedores
        .filter((p) => p.tipo === 'MANGUERA')
        .map((p) => ({ value: p.id, label: p.nombre }))
    case 'turnos':
      return [
        { value: 'DIURNO', label: 'DIURNO' },
        { value: 'NOCTURNO', label: 'NOCTURNO' },
      ]
    case 'ciclos':
      return [1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))
    case 'etapas':
      return [1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))
    default:
      return []
  }
}

type Valor = string | number | boolean | null
type FilaPreparada = { numero: number; valores: Record<string, Valor>; errores: string[] }

/* ------------------------------------------------------------------ */

export function ImportarDetalleTicket({
  abierto,
  onCerrar,
  ticketId,
  ticketCodigo,
  fechaTicket,
  catalogos,
}: {
  abierto: boolean
  onCerrar: () => void
  ticketId: string
  ticketCodigo: string
  fechaTicket: string
  catalogos: CatalogosTicket
}) {
  const supabase = createClient()
  const router = useRouter()
  const refArchivo = useRef<HTMLInputElement>(null)

  const [pegado, setPegado] = useState('')
  const [preparadas, setPreparadas] = useState<FilaPreparada[] | null>(null)
  const [columnasIgnoradas, setColumnasIgnoradas] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  function reiniciar() {
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
    const listas: ListaPlantilla[] = []
    COLUMNAS.forEach((c, i) => {
      if (c.tipo !== 'catalogo') return
      const opciones = opcionesDe(c.lista, catalogos)
      if (opciones.length === 0) return
      listas.push({ columna: i, titulo: c.label, valores: opciones.map((o) => o.label) })
    })

    descargar(
      construirXlsxPlantilla(
        'Detalle',
        COLUMNAS.map((c) => c.label),
        listas
      ),
      `plantilla-detalle-${ticketCodigo.replace(/[^a-zA-Z0-9-]/g, '')}.xlsx`
    )
  }

  /* ------------------------------ Lectura ----------------------------- */

  function preparar(datos: string[][]) {
    setError(null)
    setResultado(null)

    if (datos.length < 2) {
      setPreparadas(null)
      setError('El archivo debe traer la fila de encabezados y al menos una fila de datos.')
      return
    }

    const encabezados = datos[0]
    const mapa: (Columna | null)[] = encabezados.map((h) => {
      const n = normalizar(h)
      return COLUMNAS.find((c) => normalizar(c.label) === n || normalizar(c.clave) === n) ?? null
    })

    setColumnasIgnoradas(encabezados.filter((h, i) => h.trim() !== '' && mapa[i] === null))

    const faltan = COLUMNAS.filter(
      (c) => c.requerido && !mapa.some((m) => m?.clave === c.clave)
    )
    if (faltan.length > 0) {
      setPreparadas(null)
      setError(
        `Faltan columnas obligatorias: ${faltan.map((c) => `«${c.label}»`).join(', ')}. Descarga la plantilla y pega los datos ahí.`
      )
      return
    }

    // Las opciones se resuelven una vez, no por celda: con 400 lotes y
    // 300 filas, buscar dentro del bucle multiplica el trabajo por nada.
    const opciones = new Map<string, Opcion[]>()
    for (const c of COLUMNAS) {
      if (c.tipo === 'catalogo') opciones.set(c.clave, opcionesDe(c.lista, catalogos))
    }

    const filas: FilaPreparada[] = []

    for (let i = 1; i < datos.length; i++) {
      const cruda = datos[i]
      if (cruda.every((c) => (c ?? '').trim() === '')) continue

      const valores: Record<string, Valor> = {}
      const errores: string[] = []

      mapa.forEach((columna, col) => {
        if (!columna) return
        const bruto = (cruda[col] ?? '').trim()
        if (bruto === '') return

        if (columna.tipo === 'numero' || columna.tipo === 'entero') {
          // Excel puede entregar "1.234,50" según la configuración regional.
          const limpio = bruto
            .replace(/\s/g, '')
            .replace(/\.(?=\d{3}\b)/g, '')
            .replace(',', '.')
          const n = Number(limpio)
          if (Number.isNaN(n)) errores.push(`«${columna.label}»: “${bruto}” no es un número`)
          else valores[columna.clave] = columna.tipo === 'entero' ? Math.round(n) : n
        } else if (columna.tipo === 'booleano') {
          valores[columna.clave] = VERDADEROS.has(normalizar(bruto))
        } else if (columna.tipo === 'catalogo') {
          const lista = opciones.get(columna.clave) ?? []
          const n = normalizar(bruto)
          const hallada =
            lista.find((o) => normalizar(o.label) === n) ??
            // Basta escribir «A66» aunque la lista diga «A66 · Tractor».
            lista.find((o) => normalizar(o.label).startsWith(n)) ??
            lista.find((o) => o.value === bruto)
          if (!hallada) errores.push(`«${columna.label}»: no existe “${bruto}”`)
          else valores[columna.clave] = hallada.value
        } else {
          valores[columna.clave] = bruto
        }
      })

      for (const c of COLUMNAS) {
        if (c.requerido && (valores[c.clave] === undefined || valores[c.clave] === '')) {
          errores.push(`falta «${c.label}»`)
        }
      }

      // La tarea y el implemento tienen que aplicar a la labor, igual que
      // en la captura a mano. Sin esta comprobación entrarían
      // combinaciones que la pantalla nunca permitiría y que después no
      // se pueden editar sin cambiar la labor.
      const laborId = valores['labor_id'] as string | undefined
      if (laborId) {
        const labor = catalogos.labores.find((l) => l.id === laborId)
        const tareaId = valores['tarea_id'] as string | undefined
        const implId = valores['implemento_id'] as string | undefined
        if (labor && tareaId && !labor.labores_tareas.some((t) => t.tarea_id === tareaId)) {
          errores.push(`esa tarea SAP no está vinculada a «${labor.nombre}»`)
        }
        if (labor && implId && !labor.labores_implementos.some((x) => x.implemento_id === implId)) {
          errores.push(`ese implemento no está vinculado a «${labor.nombre}»`)
        }
        const fisId = valores['implemento_fisico_id'] as string | undefined
        if (
          labor &&
          fisId &&
          (labor.labores_implementos_fisicos?.length ?? 0) > 0 &&
          !labor.labores_implementos_fisicos!.some((x) => x.implemento_fisico_id === fisId)
        ) {
          errores.push(`ese código de implemento no está vinculado a «${labor.nombre}»`)
        }
      }

      const ini = valores['horometro_inicial'] as number | undefined
      const fin = valores['horometro_final'] as number | undefined
      if (ini !== undefined && fin !== undefined && fin < ini) {
        errores.push('el horómetro final es menor que el inicial')
      }

      filas.push({ numero: i + 1, valores, errores })
    }

    if (filas.length === 0) {
      setPreparadas(null)
      setError('No se encontró ninguna fila con datos.')
      return
    }

    setPreparadas(filas)
  }

  async function alSubirArchivo(archivo: File) {
    try {
      preparar(await leerArchivoTabular(archivo))
    } catch (e) {
      setPreparadas(null)
      setError(mensajeDeError(e, 'No se pudo leer el archivo.'))
    }
  }

  /* ----------------------------- Importar ----------------------------- */

  const buenas = preparadas?.filter((f) => f.errores.length === 0) ?? []
  const conError = preparadas?.filter((f) => f.errores.length > 0) ?? []

  async function importar() {
    if (buenas.length === 0) return
    setImportando(true)
    setError(null)

    const { data, error: e } = await supabase.rpc('fn_importar_detalle_ticket', {
      p_ticket_id: ticketId,
      p_filas: buenas.map((f) => f.valores),
    })

    setImportando(false)
    if (e) {
      setError(
        mensajeDeError(
          e,
          'No se pudo importar. Si dice que la función no existe, falta correr la migración 18 en el SQL Editor de Supabase.'
        )
      )
      return
    }

    const r = (data as { horometros_nuevos: number; labores_nuevas: number; lineas: number }[] | null)?.[0]
    const partes: string[] = []
    if (r && r.horometros_nuevos > 0)
      partes.push(`${r.horometros_nuevos} horómetro${r.horometros_nuevos === 1 ? '' : 's'}`)
    if (r && r.labores_nuevas > 0)
      partes.push(`${r.labores_nuevas} labor${r.labores_nuevas === 1 ? '' : 'es'}`)
    if (r && r.lineas > 0) partes.push(`${r.lineas} línea${r.lineas === 1 ? '' : 's'} de lote`)

    reiniciar()
    setResultado(partes.length > 0 ? `Listo: ${partes.join(', ')}.` : 'No entró nada.')
    router.refresh()
  }

  /* -------------------------------- UI -------------------------------- */

  const sinCatalogos = catalogos.equipos.length === 0 || catalogos.lotes.length === 0

  return (
    <Modal
      abierto={abierto}
      onCerrar={cerrar}
      titulo="Cargar el detalle desde Excel"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={cerrar} disabled={importando}>
            Cerrar
          </Boton>
          <Boton
            className="flex-1"
            onClick={importar}
            disabled={importando || buenas.length === 0}
          >
            {importando ? 'Importando…' : buenas.length > 0 ? `Cargar ${buenas.length}` : 'Cargar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {sinCatalogos && (
          <Alerta tono="ambar">
            {catalogos.lotes.length === 0
              ? 'Este ticket no tiene temporada, o su temporada no tiene lotes asignados. Asígnalos en Lotes de la temporada antes de cargar el detalle.'
              : 'No hay equipos en el catálogo.'}
          </Alerta>
        )}

        {/* Paso 1 */}
        <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-inset ring-slate-200/70">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Paso 1</p>
          <p className="mt-0.5 text-sm text-slate-600">
            Baja la plantilla de <strong>este</strong> ticket. Trae las listas desplegables de
            equipos, operadores, labores, tareas SAP, implementos, códigos físicos, lotes y
            proveedores, así que se llena eligiendo y no escribiendo.
          </p>
          <Boton variante="secundario" tamano="sm" className="mt-2.5" onClick={bajarPlantilla}>
            Descargar plantilla .xlsx
          </Boton>
        </div>

        {/* Paso 2 */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Paso 2</p>
          <p className="mt-0.5 mb-2 text-sm text-slate-600">
            Una fila por lote trabajado. Repite el equipo y el turno en cada fila: las que
            comparten equipo y turno se cuelgan del mismo horómetro, y las que comparten labor y
            tarea, de la misma labor.
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
              if (t) preparar(partirTextoTabular(t))
              else setPreparadas(null)
            }}
            rows={3}
            placeholder="…o pega aquí desde Excel (con la fila de encabezados)"
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs placeholder:font-sans placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>

        <p className="text-xs text-slate-400">
          La fecha no va en el archivo: todo lo que entra por aquí queda con la fecha del ticket
          {fechaTicket ? ` (${fechaTicket})` : ''}, que es lo que hace que el ticket tenga sentido.
          Si dejas «Horas hombre» en blanco se guardan <strong>8</strong>, que es la jornada.
        </p>

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

        {preparadas && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Qué va a pasar
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              {buenas.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                  <IconPlus className="h-3.5 w-3.5" />
                  {buenas.length} fila{buenas.length === 1 ? '' : 's'} lista
                  {buenas.length === 1 ? '' : 's'}
                </span>
              )}
              {conError.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
                  <IconX className="h-3.5 w-3.5" />
                  {conError.length} con problema
                </span>
              )}
            </div>

            {conError.length > 0 && (
              <>
                <ul className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-red-50/60 p-3 text-xs text-red-800">
                  {conError.slice(0, 25).map((f) => (
                    <li key={f.numero} className="py-0.5">
                      <span className="font-semibold">Fila {f.numero}:</span>{' '}
                      {f.errores.join(' · ')}
                    </li>
                  ))}
                  {conError.length > 25 && (
                    <li className="pt-1 italic">…y {conError.length - 25} más.</li>
                  )}
                </ul>
                <p className="mt-2 text-xs text-slate-400">
                  Las filas con problema no se cargan y quedan intactas en tu archivo para
                  corregirlas y volver a subirlas.
                </p>
              </>
            )}

            <p className="mt-2 text-xs text-slate-400">
              La carga es una sola operación: si la base rechaza algo —por ejemplo si las horas de
              las labores suman más de lo que dio el horómetro— no entra nada y el ticket se queda
              como estaba.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
