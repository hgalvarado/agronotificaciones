'use client'

/**
 * Las dos cargas masivas de la rotación: el plan y el avance diario.
 *
 * La mecánica —plantilla, archivo o pegado, vista previa fila por fila—
 * es la estándar (`ImportarHoja`). Aquí sólo se declara qué columnas
 * tiene cada hoja, cómo se entiende una celda y qué se escribe.
 *
 * Las plantillas llevan DESPLEGABLES de los catálogos: sin ellos quien
 * llena el archivo tiene que adivinar cómo se escribe la nomenclatura
 * del lote y el importador rebota la fila por un guion de más.
 *
 * `temporada_id` no viaja en la hoja aunque la tabla lo tenga: lo pone la
 * base a partir del lote. Una fila guardada en una temporada y apuntando
 * a un lote de otra no aparecería en ningún resumen.
 */

import { ImportarHoja, type Preparada } from '@/components/ui/ImportarHoja'
import { aFecha, aNumero, resolver } from '@/lib/importacion'
import { hoyIso } from '@/lib/fechas'
import { createClient } from '@/lib/supabase/client'
import {
  TIPOS_SIEMBRA,
  UNIDADES,
  type LoteRotacion,
  type VariedadRotacion,
} from '@/lib/rotacion/tipos'

const cliente = () => createClient()

const listaUmb = UNIDADES.map((u) => u.etiqueta)
const listaTipos = TIPOS_SIEMBRA.map((t) => t.etiqueta)

/** «Kg» escrito de cualquier manera → el valor del enum. */
const aUmb = (texto: string) =>
  UNIDADES.find(
    (u) =>
      u.etiqueta.toLowerCase() === texto.trim().toLowerCase() ||
      u.valor.toLowerCase() === texto.trim().toLowerCase()
  )?.valor ?? null

const aTipoSiembra = (texto: string) =>
  TIPOS_SIEMBRA.find(
    (t) =>
      t.etiqueta.toLowerCase() === texto.trim().toLowerCase() ||
      t.valor.toLowerCase() === texto.trim().toLowerCase()
  )?.valor ?? null

/* ================================================================== */
/* Plan                                                                */
/* ================================================================== */

type PlanCarga = {
  temporada_id: string
  lote_temporada_id: string
  variedad_id: string
  area_planificada_mz: number
  dosis_mz: number | null
  umb: string | null
  observaciones: string | null
}

export function ImportarPlan({
  abierto,
  onCerrar,
  temporadaId,
  lotes,
  variedades,
}: {
  abierto: boolean
  onCerrar: () => void
  temporadaId: string
  lotes: LoteRotacion[]
  variedades: VariedadRotacion[]
}) {
  return (
    <ImportarHoja<PlanCarga>
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Plan de rotación"
      ayuda="Una fila por lote y variedad. El lote y la variedad se eligen del desplegable de la plantilla. La dosis total no se escribe: la calcula la base."
      columnas={[
        { clave: 'lote', alias: ['Lote', 'UT', 'Nomenclatura'] },
        { clave: 'variedad', alias: ['Variedad'] },
        { clave: 'area', alias: ['Área', 'Area', 'Área plan', 'Area planificada'] },
        { clave: 'dosis', alias: ['Dosis', 'Dosis/mz', 'Dosis por mz'] },
        { clave: 'umb', alias: ['UMB', 'Unidad', 'Unidad de medida'] },
        { clave: 'observaciones', alias: ['Observaciones', 'Notas'] },
      ]}
      cabecerasResumen={['Lote', 'Variedad', 'Área', 'Dosis']}
      ejemplo={[
        lotes[0]?.nomenclatura ?? 'L-01',
        variedades[0]?.nombre ?? 'Maíz H-59',
        '12.50',
        '20',
        'Kg',
        '',
      ]}
      listas={[
        { columna: 0, titulo: 'Lote', valores: lotes.map((l) => l.nomenclatura) },
        { columna: 1, titulo: 'Variedad', valores: variedades.map((v) => v.nombre) },
        { columna: 4, titulo: 'UMB', valores: listaUmb },
      ]}
      interpretar={(c, numero) => {
        const lote = resolver(c[0] ?? '', lotes, (l) => [l.nomenclatura])
        const variedad = resolver(c[1] ?? '', variedades, (v) => [v.nombre])
        const area = aNumero(c[2] ?? '')
        const dosis = aNumero(c[3] ?? '')

        const salida: Preparada<PlanCarga> = {
          numero,
          accion: 'insertar',
          resumen: [
            lote?.nomenclatura ?? (c[0] ?? '—'),
            variedad?.nombre ?? (c[1] ?? '—'),
            area === null ? '—' : String(area),
            dosis === null ? '—' : String(dosis),
          ],
          valores: {
            temporada_id: temporadaId,
            lote_temporada_id: lote?.lote_temporada_id ?? '',
            variedad_id: variedad?.id ?? '',
            area_planificada_mz: area ?? 0,
            dosis_mz: dosis,
            umb: aUmb(c[4] ?? ''),
            observaciones: (c[5] ?? '').trim() || null,
          },
        }

        if (!lote) {
          salida.accion = 'omitir'
          salida.error = 'Ese lote no está en la temporada'
        } else if (!variedad) {
          salida.accion = 'omitir'
          salida.error = 'Esa variedad no está en el catálogo'
        } else if (area === null || area < 0) {
          salida.accion = 'omitir'
          salida.error = 'Falta el área planificada'
        }
        return salida
      }}
      guardar={async (filas) => {
        const { error } = await cliente().from('rotacion_plan').insert(filas)
        return {
          error: error?.message ?? null,
          mensaje: `${filas.length} ${filas.length === 1 ? 'línea guardada' : 'líneas guardadas'}.`,
        }
      }}
    />
  )
}

/* ================================================================== */
/* Avance                                                              */
/* ================================================================== */

type AvanceCarga = {
  temporada_id: string
  fecha: string
  lote_temporada_id: string
  variedad_id: string
  avance_mz: number
  gasto_semilla: number | null
  umb: string | null
  tipo_siembra: string
  costo_tipo_siembra_mz: number | null
  observaciones: string | null
}

export function ImportarAvance({
  abierto,
  onCerrar,
  temporadaId,
  lotes,
  variedades,
}: {
  abierto: boolean
  onCerrar: () => void
  temporadaId: string
  lotes: LoteRotacion[]
  variedades: VariedadRotacion[]
}) {
  return (
    <ImportarHoja<AvanceCarga>
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Avance de rotación"
      ayuda="Una fila por siembra. Semilla/mz y costo total no se escriben: los calcula la base a partir del avance, el gasto y el costo por manzana."
      columnas={[
        { clave: 'fecha', alias: ['Fecha'] },
        { clave: 'lote', alias: ['Lote', 'UT', 'Nomenclatura'] },
        { clave: 'variedad', alias: ['Variedad'] },
        { clave: 'avance', alias: ['Avance', 'Avance mz', 'Manzanas'] },
        { clave: 'gasto', alias: ['Gasto semilla', 'Semilla', 'Gasto'] },
        { clave: 'umb', alias: ['UMB', 'Unidad', 'Unidad de medida'] },
        { clave: 'tipo', alias: ['Tipo de siembra', 'Tipo siembra', 'Tipo'] },
        { clave: 'costo', alias: ['Costo/mz', 'Costo por mz', 'Costo'] },
        { clave: 'observaciones', alias: ['Observaciones', 'Notas'] },
      ]}
      cabecerasResumen={['Fecha', 'Lote', 'Variedad', 'Avance', 'Tipo']}
      ejemplo={[
        hoyIso(),
        lotes[0]?.nomenclatura ?? 'L-01',
        variedades[0]?.nombre ?? 'Maíz H-59',
        '4.25',
        '85',
        'Kg',
        'Directa',
        '1200',
        '',
      ]}
      listas={[
        { columna: 1, titulo: 'Lote', valores: lotes.map((l) => l.nomenclatura) },
        { columna: 2, titulo: 'Variedad', valores: variedades.map((v) => v.nombre) },
        { columna: 5, titulo: 'UMB', valores: listaUmb },
        { columna: 6, titulo: 'Tipo de siembra', valores: listaTipos },
      ]}
      interpretar={(c, numero) => {
        const fecha = aFecha(c[0] ?? '')
        const lote = resolver(c[1] ?? '', lotes, (l) => [l.nomenclatura])
        const variedad = resolver(c[2] ?? '', variedades, (v) => [v.nombre])
        const avance = aNumero(c[3] ?? '')
        const tipo = aTipoSiembra(c[6] ?? '') ?? 'DIRECTA'

        const salida: Preparada<AvanceCarga> = {
          numero,
          accion: 'insertar',
          resumen: [
            fecha ?? (c[0] ?? '—'),
            lote?.nomenclatura ?? (c[1] ?? '—'),
            variedad?.nombre ?? (c[2] ?? '—'),
            avance === null ? '—' : String(avance),
            TIPOS_SIEMBRA.find((t) => t.valor === tipo)?.etiqueta ?? tipo,
          ],
          valores: {
            temporada_id: temporadaId,
            fecha: fecha ?? hoyIso(),
            lote_temporada_id: lote?.lote_temporada_id ?? '',
            variedad_id: variedad?.id ?? '',
            avance_mz: avance ?? 0,
            gasto_semilla: aNumero(c[4] ?? ''),
            umb: aUmb(c[5] ?? ''),
            tipo_siembra: tipo,
            costo_tipo_siembra_mz: aNumero(c[7] ?? ''),
            observaciones: (c[8] ?? '').trim() || null,
          },
        }

        if (!lote) {
          salida.accion = 'omitir'
          salida.error = 'Ese lote no está en la temporada'
        } else if (!variedad) {
          salida.accion = 'omitir'
          salida.error = 'Esa variedad no está en el catálogo'
        } else if (avance === null || avance <= 0) {
          salida.accion = 'omitir'
          salida.error = 'El avance tiene que ser mayor que cero'
        }
        return salida
      }}
      guardar={async (filas) => {
        const { error } = await cliente().from('rotacion_avance').insert(filas)
        return {
          error: error?.message ?? null,
          mensaje: `${filas.length} ${filas.length === 1 ? 'avance guardado' : 'avances guardados'}.`,
        }
      }}
    />
  )
}
