'use client'

/**
 * Carga masiva del plan de siembra.
 *
 * El plan llega de gerencia en Excel una vez por temporada y se corrige
 * varias veces. Un mismo lote puede repetir variedad y ciclo —se siembra
 * en dos fechas, o con dos distancias— así que no hay ninguna combinación
 * prohibida y cada línea del archivo es un registro por derecho propio.
 *
 * Por eso la carga REEMPLAZA el plan de los lotes que vengan en el
 * archivo: es lo único que permite volver a subirlo corregido sin
 * duplicar y sin prohibir repeticiones legítimas. El plan de los lotes
 * que no estén en el archivo no se toca.
 */

import { ImportarHoja, type Preparada } from '@/components/ui/ImportarHoja'
import { aFecha, aNumero, resolver, type ColumnaHoja } from '@/lib/importacion'
import { guardarPlanesEnMasa, type PlanSiembraNuevo } from '@/lib/trasplante/repositorioCliente'
import type { FilaPlanSiembra, LoteOpcion, Variedad } from '@/lib/trasplante/tipos'

const COLUMNAS: ColumnaHoja[] = [
  { clave: 'ut', alias: ['UT', 'Lote', 'Nomenclatura'] },
  { clave: 'ciclo', alias: ['Ciclo'] },
  { clave: 'variedad', alias: ['Variedad', 'Hibrido', 'Híbrido'] },
  { clave: 'area', alias: ['Area plan', 'Área plan', 'Area', 'Área', 'Manzanas', 'Mz'] },
  { clave: 'fecha', alias: ['Fecha siembra', 'Fecha', 'Fecha prevista'] },
  { clave: 'distancia', alias: ['Distancia siembra', 'Distancia', 'Distanciamiento'] },
]

export function ImportarPlanSiembra({
  abierto,
  onCerrar,
  temporadaId,
  filas,
  lotes,
  variedades,
}: {
  abierto: boolean
  onCerrar: () => void
  temporadaId: string
  filas: FilaPlanSiembra[]
  lotes: LoteOpcion[]
  variedades: Variedad[]
}) {
  // Lotes que ya tienen plan: los suyos se reemplazan, no se suman.
  const conPlan = new Set(filas.map((f) => f.lote_temporada_id))

  function interpretar(celdas: string[], numero: number): Preparada<PlanSiembraNuevo> {
    const [bUt, bCiclo, bVariedad, bArea, bFecha, bDistancia] = celdas.map((c) => (c ?? '').trim())

    const vacio: PlanSiembraNuevo = {
      temporada_id: temporadaId,
      lote_temporada_id: '',
      ciclo: 1,
      variedad_id: '',
      fecha_siembra: null,
      area_plan: 0,
      distancia_siembra: null,
    }
    const resumen = [bUt, bCiclo || '1', bVariedad, bArea, bFecha || '—']
    const malo = (error: string): Preparada<PlanSiembraNuevo> => ({
      numero,
      accion: 'omitir',
      error,
      resumen,
      valores: vacio,
    })

    const lote = resolver(bUt, lotes, (l) => [l.nomenclatura, l.nombre ?? ''])
    if (!lote) return malo('Lote no encontrado')

    const variedad = resolver(bVariedad, variedades, (v) => [v.nombre, v.codigo_sap ?? ''])
    if (!variedad) return malo('Variedad no encontrada')

    const ciclo = bCiclo ? aNumero(bCiclo) : 1
    if (ciclo === null || ciclo < 1 || ciclo > 3) return malo('Ciclo debe ser 1, 2 o 3')

    const area = aNumero(bArea)
    if (area === null || area < 0) return malo('Área del plan inválida')

    // La fecha es opcional, pero si viene escrita y no se entiende hay que
    // decirlo: sin ella el plan no aparece en la gráfica semanal.
    const fecha = bFecha ? aFecha(bFecha) : null
    if (bFecha && !fecha) return malo('Fecha inválida')

    return {
      numero,
      accion: conPlan.has(lote.lote_temporada_id) ? 'actualizar' : 'insertar',
      // Números ya interpretados: «1.234,56» y «1,234.56» se ven distintos
      // y valen lo mismo, y es aquí donde el usuario puede desmentirlo.
      resumen: [lote.nomenclatura, String(ciclo), variedad.nombre, String(area), fecha ?? '—'],
      valores: {
        temporada_id: temporadaId,
        lote_temporada_id: lote.lote_temporada_id,
        ciclo: Math.trunc(ciclo),
        variedad_id: variedad.id,
        fecha_siembra: fecha,
        area_plan: area,
        distancia_siembra: bDistancia || null,
      },
    }
  }

  async function guardar(nuevas: PlanSiembraNuevo[]) {
    const lotes = new Set(nuevas.map((f) => f.lote_temporada_id)).size
    const { error, guardadas } = await guardarPlanesEnMasa(temporadaId, nuevas)
    return {
      error,
      mensaje: `Se cargaron ${guardadas} ${guardadas === 1 ? 'línea' : 'líneas'} del plan en ${lotes} ${
        lotes === 1 ? 'lote' : 'lotes'
      }.`,
    }
  }

  return (
    <ImportarHoja<PlanSiembraNuevo>
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Importar plan de siembra"
      ayuda="Cada fila es una línea de plan. Un mismo lote puede repetirse con la misma variedad y el mismo ciclo —dos fechas, dos distancias— y ninguna combinación está prohibida. Ojo: el archivo REEMPLAZA el plan completo de los lotes que aparezcan en él, y no toca el de los demás. La fecha prevista es opcional, pero sin ella esa área no sale en la gráfica semanal."
      columnas={COLUMNAS}
      cabecerasResumen={['Lote', 'Ciclo', 'Variedad', 'Área plan', 'Fecha']}
      etiquetaActualizar="Reemplaza el plan del lote"
      ejemplo={[
        lotes[0]?.nomenclatura ?? '1002-110',
        1,
        variedades[0]?.nombre ?? 'CANTALOUPE A',
        12.5,
        '2026-09-15',
        '1.80 x 0.35',
      ]}
      interpretar={interpretar}
      guardar={guardar}
    />
  )
}
