'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo, Selector } from '@/components/ui/Primitivos'
import { IconCheck, IconPencil, IconPlus, IconX } from '@/components/ui/Icons'
import {
  construirXlsx,
  descargar,
  leerArchivoTabular,
  partirTextoTabular,
  type CeldaHoja,
} from '@/lib/hojas'
import type { FilaPlan, Proceso } from './tipos'
import { mensajeDeError } from '@/lib/errores'

function normalizar(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

/** Lee 1,234.56 y 1.234,56: el decimal es el separador que esté más a la derecha. */
function aNumero(bruto: string): number | null {
  const limpio = bruto.replace(/[^\d.,-]/g, '')
  if (!limpio) return null
  const normalizado =
    limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
      ? limpio.replace(/\./g, '').replace(',', '.')
      : limpio.replace(/,/g, '')
  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

const VERDADEROS = new Set(['si', 'true', 'x', '1', 'conmoto', 'yes'])

type Modo = 'agregar' | 'actualizar'

type Linea = {
  numero: number
  lote?: FilaPlan
  etapa: number
  area: number
  conMoto: boolean | null
  accion: 'insertar' | 'actualizar' | 'omitir'
  error?: string
}

export function ImportarPlan({
  abierto,
  onCerrar,
  temporadaId,
  proceso,
  filas,
}: {
  abierto: boolean
  onCerrar: () => void
  temporadaId: string
  proceso: Proceso
  /** Los lotes de la temporada, con su plan actual si lo tienen. */
  filas: FilaPlan[]
}) {
  const supabase = createClient()
  const router = useRouter()
  const refArchivo = useRef<HTMLInputElement>(null)

  const [modo, setModo] = useState<Modo>('actualizar')
  const [matriz, setMatriz] = useState<string[][] | null>(null)
  const [lineas, setLineas] = useState<Linea[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ignoradas, setIgnoradas] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  const porUt = new Map(filas.map((f) => [normalizar(f.ut), f]))

  function reiniciar() {
    setMatriz(null)
    setLineas(null)
    setError(null)
    setIgnoradas([])
    setResultado(null)
    if (refArchivo.current) refArchivo.current.value = ''
  }

  function cerrar() {
    reiniciar()
    onCerrar()
  }

  /* ----------------------------- Plantilla ---------------------------- */

  function plantilla() {
    // Baja con los lotes de la temporada ya escritos y con el plan actual
    // si lo hay. Sólo hay que llenar o corregir la columna del área, que
    // es como le entregan la información.
    const cabecera = ['UT', 'Nomenclatura', 'Zona', 'Area Neta', 'Etapa', 'Area Plan', 'Con Moto']
    const cuerpo: CeldaHoja[][] = filas.map((f) => [
      f.ut,
      f.nombre ?? '',
      f.zona ?? '',
      f.area_neta,
      f.etapa ?? '',
      f.area_plan ?? '',
      f.con_moto === null ? '' : f.con_moto ? 'SI' : 'NO',
    ])
    descargar(
      construirXlsx(`Plan ${proceso.codigo}`, [cabecera, ...cuerpo]),
      `plantilla-plan-${proceso.codigo.toLowerCase()}.xlsx`
    )
  }

  /* ------------------------------ Lectura ----------------------------- */

  function preparar(datos: string[][], modoActual: Modo) {
    setError(null)
    setResultado(null)
    setMatriz(datos)

    if (datos.length < 2) {
      setLineas(null)
      setError('El archivo debe traer la fila de encabezados y al menos una fila de datos.')
      return
    }

    const cab = datos[0].map(normalizar)
    const col = (...nombres: string[]) =>
      cab.findIndex((h) => nombres.some((n) => h === normalizar(n)))

    const iUt = col('UT', 'lote', 'nomenclatura ut', 'ubicacion tecnica')
    const iArea = col('Area Plan', 'area planificada', 'mz plan', 'area', 'mz')
    const iEtapa = col('Etapa', 'etapa plan')
    const iMoto = col('Con Moto', 'moto', 'moto plan')

    if (iUt < 0 || iArea < 0) {
      setLineas(null)
      setError(
        'Faltan las columnas «UT» y «Area Plan». Descarga la plantilla, que ya viene con los lotes de la temporada.'
      )
      return
    }

    setIgnoradas(datos[0].filter((h, i) => h.trim() !== '' && ![iUt, iArea, iEtapa, iMoto].includes(i)))

    const salida: Linea[] = []
    for (let i = 1; i < datos.length; i++) {
      const fila = datos[i]
      const ut = (fila[iUt] ?? '').trim()
      const areaBruta = (fila[iArea] ?? '').trim()

      // Las filas sin área se saltan sin ruido: la plantilla trae todos
      // los lotes y lo normal es llenar sólo los que van en el plan.
      if (!ut || !areaBruta) continue

      const lote = porUt.get(normalizar(ut))
      const linea: Linea = {
        numero: i + 1,
        lote,
        etapa: 1,
        area: 0,
        conMoto: null,
        accion: 'insertar',
      }

      if (!lote) {
        linea.error = `el lote “${ut}” no está en esta temporada`
        salida.push(linea)
        continue
      }

      const area = aNumero(areaBruta)
      if (area === null || area < 0) {
        linea.error = `“${areaBruta}” no es un área válida`
        salida.push(linea)
        continue
      }
      linea.area = area

      if (iEtapa >= 0) {
        const bruto = (fila[iEtapa] ?? '').trim()
        if (bruto) {
          // Acepta «2» y «Etapa 2».
          const n = Number(bruto.replace(/[^\d]/g, ''))
          if (![1, 2, 3].includes(n)) {
            linea.error = `la etapa “${bruto}” no es 1, 2 ni 3`
            salida.push(linea)
            continue
          }
          linea.etapa = n
        } else {
          linea.etapa = lote.etapa ?? 1
        }
      } else {
        linea.etapa = lote.etapa ?? 1
      }

      if (iMoto >= 0) {
        const bruto = (fila[iMoto] ?? '').trim()
        linea.conMoto = bruto === '' ? lote.con_moto : VERDADEROS.has(normalizar(bruto))
      } else {
        linea.conMoto = lote.con_moto
      }

      if (lote.plan_id) {
        linea.accion = modoActual === 'actualizar' ? 'actualizar' : 'omitir'
      }

      salida.push(linea)
    }

    if (salida.length === 0) {
      setLineas(null)
      setError('Ninguna fila trae área. Escribe las manzanas planificadas al lado de cada lote.')
      return
    }
    setLineas(salida)
  }

  function cambiarModo(nuevo: Modo) {
    setModo(nuevo)
    if (matriz) preparar(matriz, nuevo)
  }

  async function leer(archivo: File) {
    try {
      preparar(await leerArchivoTabular(archivo), modo)
    } catch (e) {
      setMatriz(null)
      setLineas(null)
      setError(mensajeDeError(e, 'No se pudo leer el archivo.'))
    }
  }

  /* ----------------------------- Importar ----------------------------- */

  async function importar() {
    if (!lineas) return
    const nuevas = lineas.filter((l) => !l.error && l.accion === 'insertar')
    const cambios = lineas.filter((l) => !l.error && l.accion === 'actualizar')
    if (nuevas.length === 0 && cambios.length === 0) return

    setGuardando(true)
    setError(null)
    let insertadas = 0
    let actualizadas = 0

    try {
      if (nuevas.length > 0) {
        const { error: e } = await supabase.from('planes').insert(
          nuevas.map((l) => ({
            temporada_id: temporadaId,
            lote_temporada_id: l.lote!.id,
            proceso_id: proceso.id,
            etapa: l.etapa,
            area_plan: l.area,
            con_moto: l.conMoto,
          }))
        )
        if (e) throw new Error(`al agregar: ${e.message}`)
        insertadas = nuevas.length
      }

      // Las actualizaciones van de a diez en paralelo: cada una apunta a
      // un plan distinto y en serie serían un viaje por lote.
      const PARALELAS = 10
      for (let i = 0; i < cambios.length; i += PARALELAS) {
        const grupo = cambios.slice(i, i + PARALELAS)
        const res = await Promise.all(
          grupo.map((l) =>
            supabase
              .from('planes')
              .update({ etapa: l.etapa, area_plan: l.area, con_moto: l.conMoto })
              .eq('id', l.lote!.plan_id!)
          )
        )
        const fallo = res.findIndex((r) => r.error)
        if (fallo >= 0) {
          throw new Error(`en “${grupo[fallo].lote!.ut}”: ${res[fallo].error!.message}`)
        }
        actualizadas += grupo.length
      }

      setGuardando(false)
      reiniciar()
      const partes: string[] = []
      if (insertadas > 0) partes.push(`${insertadas} agregado${insertadas === 1 ? '' : 's'}`)
      if (actualizadas > 0)
        partes.push(`${actualizadas} actualizado${actualizadas === 1 ? '' : 's'}`)
      setResultado(`Listo: ${partes.join(' y ')}.`)
      router.refresh()
    } catch (e) {
      setGuardando(false)
      setError(
        `${mensajeDeError(e, 'No se pudo importar.')} — quedaron ${insertadas} agregados y ${actualizadas} actualizados.`
      )
      router.refresh()
    }
  }

  const nuevas = lineas?.filter((l) => !l.error && l.accion === 'insertar') ?? []
  const cambios = lineas?.filter((l) => !l.error && l.accion === 'actualizar') ?? []
  const omitidas = lineas?.filter((l) => !l.error && l.accion === 'omitir') ?? []
  const malas = lineas?.filter((l) => l.error) ?? []
  const aplicables = nuevas.length + cambios.length
  const totalMz = [...nuevas, ...cambios].reduce((a, l) => a + l.area, 0)

  return (
    <Modal
      abierto={abierto}
      onCerrar={cerrar}
      titulo={`Cargar el plan de ${proceso.nombre.toLowerCase()}`}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={cerrar} disabled={guardando}>
            Cerrar
          </Boton>
          <Boton className="flex-1" onClick={importar} disabled={guardando || aplicables === 0}>
            {guardando ? 'Cargando…' : aplicables > 0 ? `Aplicar ${aplicables}` : 'Aplicar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-inset ring-slate-200/70">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Paso 1</p>
          <p className="mt-0.5 text-sm text-slate-600">
            La plantilla baja con los {filas.length} lotes de la temporada y con el plan que ya
            tengan. Llena o corrige la columna <strong>Area Plan</strong> y vuelve a subirla.
          </p>
          <Boton variante="secundario" tamano="sm" className="mt-2.5" onClick={plantilla}>
            Descargar plantilla .xlsx
          </Boton>
        </div>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Paso 2</p>
          <p className="mt-0.5 mb-2 text-sm text-slate-600">
            ¿Qué hago con los lotes que ya tienen plan?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => cambiarModo('agregar')}
              className={`flex flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition-all ${
                modo === 'agregar'
                  ? 'bg-brand-700 text-white shadow-[var(--shadow-raised)]'
                  : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <IconPlus className="h-4 w-4" />
                Sólo agregar
              </span>
              <span className={`text-[11px] ${modo === 'agregar' ? 'text-white/70' : 'text-slate-400'}`}>
                Los que ya tienen plan se saltan
              </span>
            </button>
            <button
              type="button"
              onClick={() => cambiarModo('actualizar')}
              className={`flex flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition-all ${
                modo === 'actualizar'
                  ? 'bg-brand-700 text-white shadow-[var(--shadow-raised)]'
                  : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <IconPencil className="h-4 w-4" />
                Agregar y actualizar
              </span>
              <span
                className={`text-[11px] ${modo === 'actualizar' ? 'text-white/70' : 'text-slate-400'}`}
              >
                Los que ya tienen plan se corrigen
              </span>
            </button>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Paso 3</p>
          <p className="mt-0.5 mb-2 text-sm text-slate-600">
            Sube el archivo, o pega las filas directo desde Excel.
          </p>
          <input
            ref={refArchivo}
            type="file"
            accept=".xlsx,.csv,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) leer(f)
            }}
            className="w-full rounded-xl border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
          />
          <textarea
            rows={3}
            placeholder="…o pega aquí (UT y Area Plan, con encabezados)"
            onChange={(e) => {
              const t = e.target.value.trim()
              if (t) preparar(partirTextoTabular(t), modo)
              else {
                setMatriz(null)
                setLineas(null)
              }
            }}
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs placeholder:font-sans placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>

        {ignoradas.length > 0 && (
          <Alerta tono="ambar">
            Estas columnas no se usan y se ignoran: {ignoradas.join(', ')}.
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

        {lineas && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Qué va a pasar
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              {nuevas.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                  <IconPlus className="h-3.5 w-3.5" />
                  {nuevas.length} nuevo{nuevas.length === 1 ? '' : 's'}
                </span>
              )}
              {cambios.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                  <IconPencil className="h-3.5 w-3.5" />
                  {cambios.length} a actualizar
                </span>
              )}
              {omitidas.length > 0 && (
                <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                  {omitidas.length} sin cambios
                </span>
              )}
              {malas.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
                  <IconX className="h-3.5 w-3.5" />
                  {malas.length} con problema
                </span>
              )}
            </div>

            {aplicables > 0 && (
              <p className="mt-1.5 text-sm text-slate-500">
                Suman <strong className="text-slate-900">{totalMz.toFixed(2)} mz</strong> de plan.
              </p>
            )}

            {omitidas.length > 0 && modo === 'agregar' && (
              <p className="mt-2 text-xs text-slate-400">
                Hay {omitidas.length} lote{omitidas.length === 1 ? '' : 's'} que ya tiene plan. Si
                querías corregirlo, cambia arriba a «Agregar y actualizar».
              </p>
            )}

            {malas.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-red-50/60 p-3 text-xs text-red-800">
                {malas.slice(0, 25).map((l) => (
                  <li key={l.numero} className="py-0.5">
                    <span className="font-semibold">Fila {l.numero}:</span> {l.error}
                  </li>
                ))}
                {malas.length > 25 && (
                  <li className="pt-1 italic">…y {malas.length - 25} más.</li>
                )}
              </ul>
            )}
          </div>
        )}

        <Campo
          etiqueta="Proceso"
          ayuda="El plan se guarda amarrado a este proceso de SAP."
        >
          <Selector value={proceso.codigo} disabled>
            <option value={proceso.codigo}>
              {proceso.codigo} · {proceso.nombre}
            </option>
          </Selector>
        </Campo>
      </div>
    </Modal>
  )
}
