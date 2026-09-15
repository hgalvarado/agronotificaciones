'use client'

/**
 * Carga masiva de siembra diaria.
 *
 * No decide nada: sólo dice qué columnas espera la hoja, cómo se traduce
 * una fila de texto a una siembra y a quién se le manda. La lectura de
 * celdas es de `importacion` y la escritura de `repositorioCliente`.
 */

import { ImportarHoja, type Preparada } from '@/components/ui/ImportarHoja'
import { aFecha, aNumero, resolver, type ColumnaHoja } from '@/lib/importacion'
import { insertarSiembras, type SiembraNueva } from '@/lib/trasplante/repositorioCliente'
import type { LoteOpcion, Variedad } from '@/lib/trasplante/tipos'

const COLUMNAS: ColumnaHoja[] = [
  { clave: 'fecha', alias: ['Fecha', 'Fecha siembra', 'Fecha de siembra'] },
  { clave: 'ut', alias: ['UT', 'Lote', 'Nomenclatura'] },
  { clave: 'variedad', alias: ['Variedad', 'Hibrido', 'Híbrido'] },
  { clave: 'ciclo', alias: ['Ciclo'] },
  { clave: 'avance', alias: ['Avance Mz', 'Avance', 'Area', 'Área', 'Manzanas', 'Mz'] },
  { clave: 'plantas', alias: ['Plantas', 'Plantas reportadas', 'Plantulas', 'Plántulas'] },
  { clave: 'lote_variedad', alias: ['Lote variedad', 'Lote semilla', 'Lote de plantula'] },
  { clave: 'observaciones', alias: ['Observaciones', 'Nota', 'Notas'] },
]

export function ImportarSiembras({
  abierto,
  onCerrar,
  temporadaId,
  lotes,
  variedades,
}: {
  abierto: boolean
  onCerrar: () => void
  temporadaId: string
  lotes: LoteOpcion[]
  variedades: Variedad[]
}) {
  function interpretar(celdas: string[], numero: number): Preparada<SiembraNueva> {
    const [bFecha, bUt, bVariedad, bCiclo, bAvance, bPlantas, bLoteVar, bObs] = celdas.map((c) =>
      (c ?? '').trim()
    )

    const vacio: SiembraNueva = {
      temporada_id: temporadaId,
      lote_temporada_id: '',
      variedad_id: '',
      fecha_siembra: '',
      ciclo: 1,
      lote_variedad: null,
      avance_mz: 0,
      plantas_reportadas: null,
      observaciones: null,
    }
    const resumen = [bFecha, bUt, bVariedad, bCiclo || '1', bAvance, bPlantas]
    const malo = (error: string): Preparada<SiembraNueva> => ({
      numero,
      accion: 'omitir',
      error,
      resumen,
      valores: vacio,
    })

    const fecha = aFecha(bFecha)
    if (!fecha) return malo('Fecha inválida')

    const lote = resolver(bUt, lotes, (l) => [l.nomenclatura, l.nombre ?? ''])
    if (!lote) return malo('Lote no encontrado')

    const variedad = resolver(bVariedad, variedades, (v) => [v.nombre, v.codigo_sap ?? ''])
    if (!variedad) return malo('Variedad no encontrada')

    const ciclo = bCiclo ? aNumero(bCiclo) : 1
    if (ciclo === null || ciclo < 1 || ciclo > 3) return malo('Ciclo debe ser 1, 2 o 3')

    const avance = aNumero(bAvance)
    if (avance === null || avance <= 0) return malo('Avance en manzanas inválido')

    const plantas = bPlantas ? aNumero(bPlantas) : null

    // La vista previa enseña los números YA interpretados, no la celda
    // cruda: «1.234,56» y «1,234.56» se ven distintos y valen lo mismo, y
    // es aquí donde el usuario tiene que poder desmentirlo.
    return {
      numero,
      accion: 'insertar',
      resumen: [
        fecha,
        lote.nomenclatura,
        variedad.nombre,
        String(ciclo),
        String(avance),
        plantas === null ? '—' : String(plantas),
      ],
      valores: {
        temporada_id: temporadaId,
        lote_temporada_id: lote.lote_temporada_id,
        variedad_id: variedad.id,
        fecha_siembra: fecha,
        ciclo: Math.trunc(ciclo),
        lote_variedad: bLoteVar || null,
        avance_mz: avance,
        plantas_reportadas: plantas,
        observaciones: bObs || null,
      },
    }
  }

  async function guardar(filas: SiembraNueva[]) {
    const { error } = await insertarSiembras(filas)
    return {
      error,
      mensaje: `Se agregaron ${filas.length} ${filas.length === 1 ? 'siembra' : 'siembras'}.`,
    }
  }

  return (
    <ImportarHoja<SiembraNueva>
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Importar siembra diaria"
      ayuda="Cada fila del archivo es una siembra nueva. El lote y la variedad se buscan por su nombre o su código; las filas que no cuadren se marcan y no se importan."
      columnas={COLUMNAS}
      cabecerasResumen={['Fecha', 'Lote', 'Variedad', 'Ciclo', 'Avance', 'Plantas']}
      ejemplo={['2026-09-15', lotes[0]?.nomenclatura ?? '1002-110', variedades[0]?.nombre ?? 'CANTALOUPE A', 1, 3.5, 52500, '', '']}
      interpretar={interpretar}
      guardar={guardar}
    />
  )
}
