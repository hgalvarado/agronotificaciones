'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Tarjeta } from '@/components/ui/Primitivos'
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
/* Catálogos                                                          */
/* ------------------------------------------------------------------ */

export type CatalogosHistorico = {
  usuarios: { id: string; nombre: string; departamento: string | null }[]
  temporadas: { id: string; nombre: string }[]
  equipos: { id: string; codigo: string; nombre: string }[]
  operadores: { id: string; codigo: string | null; nombre: string }[]
  labores: { id: string; nombre: string }[]
  tareasSap: { id: string; codigo: string; nombre: string }[]
  implementos: { id: string; codigo: string; nombre: string }[]
  implementosFisicos: { id: string; codigo: string; descripcion: string }[]
  lotes: { id: string; nomenclatura: string; nombre: string | null }[]
}

/** Quita acentos, espacios y signos para comparar. */
function normalizar(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

/**
 * Convierte a número textos que pueden venir en cualquiera de los dos
 * formatos que salen de Excel según la configuración regional:
 * «11,109.00» (inglés) y «11.109,00» (español).
 *
 * La regla: si aparecen los dos separadores, el ÚLTIMO es el decimal y
 * el otro es de miles. Con uno solo, se mira cuántos dígitos deja
 * detrás: tres son miles («1,234» → 1234) y otra cantidad es decimal
 * («1,5» → 1.5). Es la interpretación que no rompe los horómetros, que
 * es donde el error dolería: leer 11,109 como 11.109 metería un
 * horómetro de once horas donde hay uno de once mil.
 */
function aNumero(bruto: string): number | null {
  const s = bruto.replace(/\s/g, '').replace(/[^0-9.,-]/g, '')
  if (s === '' || s === '-') return null

  const iComa = s.lastIndexOf(',')
  const iPunto = s.lastIndexOf('.')
  let limpio: string

  if (iComa >= 0 && iPunto >= 0) {
    const decimal = iComa > iPunto ? ',' : '.'
    const miles = decimal === ',' ? '.' : ','
    limpio = s.split(miles).join('').replace(decimal, '.')
  } else if (iComa >= 0) {
    const partes = s.split(',')
    limpio =
      partes.length === 2 && partes[1].length !== 3 ? s.replace(',', '.') : partes.join('')
  } else if (iPunto >= 0) {
    const partes = s.split('.')
    limpio = partes.length > 2 ? partes.join('') : s
  } else {
    limpio = s
  }

  const n = Number(limpio)
  return Number.isNaN(n) ? null : n
}

/** Acepta 2026-04-10 y 10/4/2026 (día primero, como en su descarga). */
function aFecha(bruto: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return bruto
  const m = bruto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

/** Nombre a slug para el código del ticket: José Lazo → joselazo. */
function slug(nombre: string) {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
}

const PROCESOS = [
  { value: 'REGISTRADO', label: '0 - Registrado' },
  { value: 'REVISANDO', label: '1 - Revisando' },
  { value: 'PENDIENTE_APROBACION', label: '2 - Pendiente' },
  { value: 'NOTIFICADO', label: '3 - Notificado' },
]

type Lista =
  | keyof CatalogosHistorico
  | 'turnos'
  | 'procesos'
  | 'ciclos'
  | 'etapas'

type Columna = {
  clave: string
  label: string
  tipo: 'texto' | 'numero' | 'fecha' | 'catalogo'
  lista?: Lista
  requerido?: boolean
  /** Otros encabezados con los que también se reconoce la columna. */
  alias?: string[]
}

/**
 * Las columnas, con los nombres que trae su descarga de la plataforma
 * anterior como alias. Así el archivo entra tal como se descargó, sin
 * renombrar nada a mano.
 */
const COLUMNAS: Columna[] = [
  { clave: 'fecha', label: 'Fecha', tipo: 'fecha', requerido: true, alias: ['FECHA'] },
  {
    clave: 'ticket_codigo',
    label: 'Ticket anterior',
    tipo: 'texto',
    alias: ['Ticket', 'ID Ticket Anterior', 'ID Ticket'],
  },
  {
    clave: 'usuario_id',
    label: 'Usuario',
    tipo: 'catalogo',
    lista: 'usuarios',
    requerido: true,
  },
  { clave: 'departamento', label: 'Departamento', tipo: 'texto' },
  { clave: 'proceso', label: 'Proceso', tipo: 'catalogo', lista: 'procesos' },
  { clave: 'temporada_id', label: 'Temporada', tipo: 'catalogo', lista: 'temporadas' },
  { clave: 'turno', label: 'Turno', tipo: 'catalogo', lista: 'turnos', requerido: true },
  { clave: 'equipo_id', label: 'Equipo', tipo: 'catalogo', lista: 'equipos', requerido: true },
  { clave: 'horometro_inicial', label: 'HI', tipo: 'numero', alias: ['Horómetro inicial'] },
  { clave: 'horometro_final', label: 'HF', tipo: 'numero', alias: ['Horómetro final'] },
  { clave: 'horas_hombre', label: 'Horas Hombre', tipo: 'numero' },
  { clave: 'operador_id', label: 'Operador', tipo: 'catalogo', lista: 'operadores' },
  { clave: 'labor_id', label: 'Labor', tipo: 'catalogo', lista: 'labores', requerido: true },
  { clave: 'tarea_id', label: 'Tarea', tipo: 'catalogo', lista: 'tareasSap', requerido: true },
  // OJO: `Implemento` NO va como alias. Su descarga trae las DOS
  // columnas —«IDImplemento» con el código y «Implemento» con la
  // descripción— y si las dos apuntaran aquí, la segunda pisaría el
  // código bueno con un texto que no resuelve. `Implemento` está en
  // DERIVADAS, así que se ignora sin avisar.
  {
    clave: 'implemento_id',
    label: 'IDImplemento',
    tipo: 'catalogo',
    lista: 'implementos',
    alias: ['Cód. implemento SAP'],
  },
  {
    clave: 'implemento_fisico_id',
    label: 'Cód. implemento',
    tipo: 'catalogo',
    lista: 'implementosFisicos',
  },
  {
    clave: 'lote_temporada_id',
    label: 'Ubicacion Tecnica',
    tipo: 'catalogo',
    lista: 'lotes',
    requerido: true,
    alias: ['Lote', 'UT'],
  },
  { clave: 'avance_mz', label: 'Avance Mz', tipo: 'numero', alias: ['Manzanas'] },
  { clave: 'ciclo', label: 'Ciclo', tipo: 'catalogo', lista: 'ciclos' },
  { clave: 'etapa', label: 'Etapa', tipo: 'catalogo', lista: 'etapas' },
  {
    clave: 'horas_notificadas',
    label: 'Horas de la labor',
    tipo: 'numero',
    alias: ['H_NOT'],
  },
  { clave: 'comentario', label: 'Observaciones', tipo: 'texto' },
]

/**
 * Columnas de su descarga que no se importan porque son derivadas de
 * otras. Se reconocen para no avisar de ellas como «ignoradas».
 */
const DERIVADAS = ['Nomenclatura', 'Familia', 'Horas', 'Implemento']

type Opcion = { value: string; label: string }

function opcionesDe(lista: Lista | undefined, c: CatalogosHistorico): Opcion[] {
  switch (lista) {
    case 'usuarios':
      return c.usuarios.map((u) => ({ value: u.id, label: u.nombre }))
    case 'temporadas':
      return c.temporadas.map((t) => ({ value: t.id, label: t.nombre }))
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
    case 'turnos':
      return [
        { value: 'DIURNO', label: 'DIURNO' },
        { value: 'NOCTURNO', label: 'NOCTURNO' },
      ]
    case 'procesos':
      return PROCESOS
    case 'ciclos':
      return [1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))
    case 'etapas':
      return [1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))
    default:
      return []
  }
}

type Valor = string | number | null
type Fila = { numero: number; valores: Record<string, Valor>; errores: string[] }

/** Filas de un mismo ticket, que nunca se parten entre dos llamadas. */
type Grupo = { codigo: string; filas: Fila[] }

const RESUMEN_VACIO = {
  tickets_nuevos: 0,
  tickets_reusados: 0,
  horometros_nuevos: 0,
  labores_nuevas: 0,
  lineas_nuevas: 0,
  lineas_repetidas: 0,
  horas_repartidas: 0,
}

type Resumen = typeof RESUMEN_VACIO

/** Filas por llamada. Nunca se corta un ticket a la mitad. */
const TANDA = 400

/* ------------------------------------------------------------------ */

export function ImportarHistorico({ catalogos }: { catalogos: CatalogosHistorico }) {
  const supabase = createClient()
  const router = useRouter()
  const refArchivo = useRef<HTMLInputElement>(null)

  const [pegado, setPegado] = useState('')
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [ignoradas, setIgnoradas] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<Resumen | null>(null)

  const opciones = useMemo(() => {
    const mapa = new Map<string, Opcion[]>()
    for (const c of COLUMNAS) {
      if (c.tipo === 'catalogo') mapa.set(c.clave, opcionesDe(c.lista, catalogos))
    }
    return mapa
  }, [catalogos])

  function reiniciar() {
    setFilas(null)
    setIgnoradas([])
    setError(null)
    setProgreso(null)
    setPegado('')
    if (refArchivo.current) refArchivo.current.value = ''
  }

  /* ----------------------------- Plantilla ---------------------------- */

  function bajarPlantilla() {
    const listas: ListaPlantilla[] = []
    COLUMNAS.forEach((c, i) => {
      if (c.tipo !== 'catalogo') return
      const lista = opciones.get(c.clave) ?? []
      if (lista.length === 0) return
      listas.push({ columna: i, titulo: c.label, valores: lista.map((o) => o.label) })
    })
    descargar(
      construirXlsxPlantilla('Historico', COLUMNAS.map((c) => c.label), listas),
      'plantilla-historico.xlsx'
    )
  }

  /* ------------------------------ Lectura ----------------------------- */

  function preparar(datos: string[][]) {
    setError(null)
    setResultado(null)
    setProgreso(null)

    if (datos.length < 2) {
      setFilas(null)
      setError('El archivo debe traer la fila de encabezados y al menos una fila de datos.')
      return
    }

    const encabezados = datos[0]
    const mapa: (Columna | null)[] = encabezados.map((h) => {
      const n = normalizar(h)
      return (
        COLUMNAS.find(
          (c) =>
            normalizar(c.label) === n ||
            normalizar(c.clave) === n ||
            (c.alias ?? []).some((a) => normalizar(a) === n)
        ) ?? null
      )
    })

    // Una columna se cuenta como ignorada sólo si no es una de las
    // derivadas de su descarga: avisar de «Familia» u «Horas» en cada
    // carga sería ruido, porque salen del equipo y de los horómetros.
    setIgnoradas(
      encabezados.filter(
        (h, i) =>
          h.trim() !== '' &&
          mapa[i] === null &&
          !DERIVADAS.some((d) => normalizar(d) === normalizar(h))
      )
    )

    const faltan = COLUMNAS.filter((c) => c.requerido && !mapa.some((m) => m?.clave === c.clave))
    if (faltan.length > 0) {
      setFilas(null)
      setError(
        `Faltan columnas obligatorias: ${faltan.map((c) => `«${c.label}»`).join(', ')}. Descarga la plantilla o revisa los encabezados del archivo.`
      )
      return
    }

    const preparadas: Fila[] = []

    for (let i = 1; i < datos.length; i++) {
      const cruda = datos[i]
      if (cruda.every((c) => (c ?? '').trim() === '')) continue

      const valores: Record<string, Valor> = {}
      const errores: string[] = []

      mapa.forEach((columna, col) => {
        if (!columna) return
        const bruto = (cruda[col] ?? '').trim()
        if (bruto === '') return
        // Si dos encabezados apuntan al mismo campo, gana el primero con
        // dato. Sin esto una columna descriptiva más a la derecha pisaba
        // el código que ya se había leído bien.
        if (valores[columna.clave] !== undefined) return

        if (columna.tipo === 'numero') {
          const n = aNumero(bruto)
          if (n === null) errores.push(`«${columna.label}»: “${bruto}” no es un número`)
          else valores[columna.clave] = n
        } else if (columna.tipo === 'fecha') {
          const f = aFecha(bruto)
          if (!f) errores.push(`«${columna.label}»: “${bruto}” no es una fecha`)
          else valores[columna.clave] = f
        } else if (columna.tipo === 'catalogo') {
          const lista = opciones.get(columna.clave) ?? []
          const n = normalizar(bruto)
          // Último recurso: que el texto esté DENTRO de la etiqueta, y
          // sólo si no hay ambigüedad. Así «Arados DV-AR1» encuentra a
          // «DVIM-AR1 · Arados DV-AR1», pero si dos opciones lo
          // contuvieran se avisa en vez de elegir a la suerte.
          const contienen = lista.filter((o) => normalizar(o.label).includes(n))
          const hallada =
            lista.find((o) => normalizar(o.label) === n) ??
            // Basta «A61» aunque la lista diga «A61 · Tractor A61».
            lista.find((o) => normalizar(o.label).startsWith(n)) ??
            lista.find((o) => o.value === bruto) ??
            (contienen.length === 1 ? contienen[0] : undefined)
          if (!hallada) {
            errores.push(
              contienen.length > 1
                ? `«${columna.label}»: “${bruto}” coincide con ${contienen.length} opciones; escribe el código`
                : `«${columna.label}»: no existe “${bruto}”`
            )
          }
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

      const hi = valores['horometro_inicial'] as number | undefined
      const hf = valores['horometro_final'] as number | undefined
      if (hi !== undefined && hf !== undefined && hf < hi) {
        errores.push('el horómetro final es menor que el inicial')
      }

      // El departamento se hereda del usuario cuando el archivo no lo trae.
      if (valores['departamento'] === undefined && valores['usuario_id']) {
        const u = catalogos.usuarios.find((x) => x.id === valores['usuario_id'])
        if (u?.departamento) valores['departamento'] = u.departamento
      }

      /* --------------- La llave del ticket ----------------------------
         Con el código de la plataforma anterior, las filas caen en el
         mismo ticket que tenían allá. Sin él, se arma uno determinista
         con fecha + equipo + operador + inicial + final, que es la llave
         que él pidió: mismo equipo con otro horómetro u otro operador es
         OTRO ticket. Determinista para que reimportar no duplique. */
      if (!valores['ticket_codigo'] && valores['fecha'] && valores['equipo_id']) {
        const usuario = catalogos.usuarios.find((u) => u.id === valores['usuario_id'])
        const equipo = catalogos.equipos.find((e) => e.id === valores['equipo_id'])
        const operador = catalogos.operadores.find((o) => o.id === valores['operador_id'])
        const partes = [
          equipo?.codigo ?? 'eq',
          operador?.codigo ?? operador?.nombre?.slice(0, 6) ?? 'sinop',
          String(Math.round(hi ?? 0)),
          String(Math.round(hf ?? 0)),
        ]
        valores['ticket_codigo'] =
          `${String(valores['fecha']).replaceAll('-', '')}-${slug(usuario?.nombre ?? 'hist')}` +
          `-[${slug(partes.join('-')).slice(0, 40)}]`
      }

      preparadas.push({ numero: i + 1, valores, errores })
    }

    if (preparadas.length === 0) {
      setFilas(null)
      setError('No se encontró ninguna fila con datos.')
      return
    }

    setFilas(preparadas)
  }

  async function alSubirArchivo(archivo: File) {
    try {
      preparar(await leerArchivoTabular(archivo))
    } catch (e) {
      setFilas(null)
      setError(mensajeDeError(e, 'No se pudo leer el archivo.'))
    }
  }

  /* ------------------------------ Resumen ----------------------------- */

  const buenas = useMemo(() => filas?.filter((f) => f.errores.length === 0) ?? [], [filas])
  const conError = useMemo(() => filas?.filter((f) => f.errores.length > 0) ?? [], [filas])

  // Se agrupa por ticket para dos cosas: mostrarle cuántas jornadas va a
  // crear, y no cortar un ticket entre dos llamadas.
  const grupos = useMemo(() => {
    const mapa = new Map<string, Fila[]>()
    for (const f of buenas) {
      const codigo = String(f.valores['ticket_codigo'] ?? '')
      mapa.set(codigo, [...(mapa.get(codigo) ?? []), f])
    }
    return [...mapa.entries()].map(([codigo, filas]) => ({ codigo, filas }) as Grupo)
  }, [buenas])

  // Cuántos horómetros distintos va a crear: es el número que él va a
  // comparar con lo que espera, porque es donde estaba el error.
  const horometrosPrevistos = useMemo(() => {
    const llaves = new Set<string>()
    for (const f of buenas) {
      llaves.add(
        [
          f.valores['ticket_codigo'],
          f.valores['equipo_id'],
          f.valores['turno'],
          f.valores['horometro_inicial'] ?? 0,
          f.valores['horometro_final'] ?? 0,
          f.valores['operador_id'] ?? '',
        ].join('|')
      )
    }
    return llaves.size
  }, [buenas])

  /* ----------------------------- Importar ----------------------------- */

  async function importar() {
    if (grupos.length === 0) return
    setError(null)
    setResultado(null)

    // Tandas de grupos completos: un ticket entero siempre va en la
    // misma llamada, porque si se partiera, la segunda mitad no vería el
    // horómetro que creó la primera.
    const tandas: Grupo[][] = []
    let actual: Grupo[] = []
    let cuenta = 0
    for (const g of grupos) {
      if (cuenta > 0 && cuenta + g.filas.length > TANDA) {
        tandas.push(actual)
        actual = []
        cuenta = 0
      }
      actual.push(g)
      cuenta += g.filas.length
    }
    if (actual.length > 0) tandas.push(actual)

    const total = buenas.length
    let hechas = 0
    const acumulado: Resumen = { ...RESUMEN_VACIO }
    setProgreso({ hechas: 0, total })

    for (const tanda of tandas) {
      const cuerpo = tanda.flatMap((g) => g.filas.map((f) => f.valores))
      const { data, error: e } = await supabase.rpc('fn_importar_historico', {
        p_filas: cuerpo,
      })

      if (e) {
        setProgreso(null)
        setResultado(hechas > 0 ? acumulado : null)
        setError(
          `${mensajeDeError(
            e,
            'No se pudo importar. Si dice que la función no existe, falta correr la migración 20 en el SQL Editor de Supabase.'
          )}${hechas > 0 ? ` — alcanzaron a entrar ${hechas} de ${total} filas; las tandas ya cargadas quedaron guardadas y volver a subir el archivo no las duplica.` : ''}`
        )
        router.refresh()
        return
      }

      const r = (data as Resumen[] | null)?.[0]
      if (r) {
        for (const k of Object.keys(acumulado) as (keyof Resumen)[]) {
          acumulado[k] += Number(r[k] ?? 0)
        }
      }
      hechas += cuerpo.length
      setProgreso({ hechas, total })
    }

    setProgreso(null)
    setResultado(acumulado)
    reiniciar()
    router.refresh()
  }

  const sinCatalogos = catalogos.equipos.length === 0 || catalogos.lotes.length === 0

  /* -------------------------------- UI -------------------------------- */

  return (
    <div className="flex flex-col gap-4">
      {sinCatalogos && (
        <Alerta tono="ambar">
          Faltan catálogos: sin equipos o sin lotes asignados a alguna temporada no hay contra qué
          resolver el archivo.
        </Alerta>
      )}

      {/* Paso 1 */}
      <Tarjeta className="p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Paso 1</p>
        <p className="mt-0.5 text-sm text-slate-600">
          Sube el archivo tal como lo descargaste de la plataforma anterior. Se reconocen sus
          encabezados —FECHA, Ticket, Usuario, Ubicacion Tecnica, HI, HF, Operador…— sin renombrar
          nada.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Si prefieres partir de una plantilla en limpio, ésta trae las listas desplegables de
          usuarios, temporadas, equipos, operadores, labores, tareas, implementos y lotes.
        </p>
        <Boton variante="secundario" tamano="sm" className="mt-2.5" onClick={bajarPlantilla}>
          Descargar plantilla .xlsx
        </Boton>
      </Tarjeta>

      {/* Paso 2 */}
      <Tarjeta className="p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Paso 2</p>
        <p className="mt-0.5 mb-2 text-sm text-slate-600">
          Los tickets, los horómetros y las labores se crean solos. No hace falta crear nada antes.
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
            else setFilas(null)
          }}
          rows={3}
          placeholder="…o pega aquí desde Excel (con la fila de encabezados)"
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs placeholder:font-sans placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
        />
      </Tarjeta>

      {ignoradas.length > 0 && (
        <Alerta tono="ambar">
          Estas columnas no corresponden a ningún campo y se van a ignorar: {ignoradas.join(', ')}.
        </Alerta>
      )}

      {error && <Alerta>{error}</Alerta>}

      {resultado && (
        <Alerta tono="azul">
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <IconCheck className="h-4 w-4" />
            Listo: {resultado.tickets_nuevos} ticket
            {resultado.tickets_nuevos === 1 ? '' : 's'} nuevo
            {resultado.tickets_nuevos === 1 ? '' : 's'}
            {resultado.tickets_reusados > 0
              ? ` (${resultado.tickets_reusados} ya existían y se reutilizaron)`
              : ''}
            , {resultado.horometros_nuevos} horómetro
            {resultado.horometros_nuevos === 1 ? '' : 's'}, {resultado.labores_nuevas} labor
            {resultado.labores_nuevas === 1 ? '' : 'es'} y {resultado.lineas_nuevas} línea
            {resultado.lineas_nuevas === 1 ? '' : 's'} de lote.
            {resultado.lineas_repetidas > 0
              ? ` Se saltaron ${resultado.lineas_repetidas} líneas que ya estaban cargadas.`
              : ''}
          </span>
        </Alerta>
      )}

      {progreso && (
        <Tarjeta className="p-4">
          <p className="text-sm font-semibold text-slate-700">
            Cargando… {progreso.hechas} de {progreso.total} filas
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-brand-600 transition-all"
              style={{ width: `${(progreso.hechas / Math.max(progreso.total, 1)) * 100}%` }}
            />
          </div>
        </Tarjeta>
      )}

      {/* Paso 3 · revisión */}
      {filas && (
        <Tarjeta className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Qué va a pasar
          </p>

          <div className="mt-1.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Cifra etiqueta="Tickets" valor={grupos.length} />
            <Cifra etiqueta="Horómetros" valor={horometrosPrevistos} />
            <Cifra etiqueta="Líneas listas" valor={buenas.length} />
            <Cifra etiqueta="Con problema" valor={conError.length} alerta={conError.length > 0} />
          </div>

          {conError.length > 0 && (
            <>
              <ul className="mt-3 max-h-48 overflow-y-auto rounded-xl bg-red-50/60 p-3 text-xs text-red-800">
                {conError.slice(0, 30).map((f) => (
                  <li key={f.numero} className="py-0.5">
                    <span className="font-semibold">Fila {f.numero}:</span> {f.errores.join(' · ')}
                  </li>
                ))}
                {conError.length > 30 && (
                  <li className="pt-1 italic">…y {conError.length - 30} más.</li>
                )}
              </ul>
              <p className="mt-2 text-xs text-slate-400">
                Las filas con problema no se cargan. Lo más común es que falte el equipo, el lote o
                el operador en su catálogo: agrégalo y vuelve a subir el archivo completo, que las
                líneas ya cargadas no se duplican.
              </p>
            </>
          )}

          <div className="mt-3 rounded-xl bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-500 ring-1 ring-inset ring-slate-200/70">
            <p className="font-semibold text-slate-600">Cómo se agrupa</p>
            <p className="mt-1">
              Las filas con el <strong>mismo ticket</strong> van al mismo ticket. Dentro de él, el
              horómetro se reconoce por <strong>equipo + turno + lectura inicial + lectura final +
              operador</strong>: el mismo equipo puede salir dos veces el mismo día con dos
              operadores y dos tramos, y son dos horómetros. Filas con esas cinco cosas iguales pero
              en <strong>lotes distintos</strong> son un solo horómetro con varias líneas.
            </p>
            <p className="mt-1.5">
              Si el archivo no trae el ticket de la plataforma anterior, se arma uno por{' '}
              <strong>fecha + equipo + operador + HI + HF</strong>.
            </p>
            <p className="mt-1.5">
              Las horas del horómetro se reparten entre sus labores cuando el archivo no trae las
              horas de cada una, para que el costo no se multiplique. Las horas hombre en blanco
              quedan en <strong>8</strong>.
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Boton onClick={importar} disabled={grupos.length === 0 || progreso !== null}>
              {progreso ? 'Cargando…' : `Cargar ${buenas.length} filas`}
            </Boton>
            <Boton variante="secundario" onClick={reiniciar} disabled={progreso !== null}>
              <IconX className="h-4 w-4" />
              Descartar
            </Boton>
          </div>
        </Tarjeta>
      )}
    </div>
  )
}

function Cifra({
  etiqueta,
  valor,
  alerta = false,
}: {
  etiqueta: string
  valor: number
  alerta?: boolean
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        alerta ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-white'
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{etiqueta}</p>
      <p
        className={`mt-0.5 flex items-center gap-1 text-lg font-bold tabular-nums ${
          alerta ? 'text-red-700' : 'text-slate-900'
        }`}
      >
        {!alerta && valor > 0 && <IconPlus className="h-3.5 w-3.5 text-slate-300" />}
        {valor}
      </p>
    </div>
  )
}
