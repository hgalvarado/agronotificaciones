'use client'

/**
 * Carga masiva de turnos de riego desde Excel.
 *
 * La hoja viene PLANA —una fila por lote, con la cabecera repetida—
 * porque así se llena en campo. Este componente sólo enseña lo entendido
 * y manda a guardar: interpretar las celdas es de `lib/riego/importacion`
 * (puro) y escribir es de `repositorioCliente`.
 *
 * Los turnos se guardan de uno en uno y no en bloque a propósito: cada
 * uno tiene que pasar por `fn_guardar_turno_riego`, que es la que valida
 * el área contra el plan de siembra. Un insert masivo se saltaría esa
 * regla y metería turnos que riegan tierra que no existe.
 */

import { useState } from 'react'
import { ImportarHoja, type Preparada } from '@/components/ui/ImportarHoja'
import { guardarTurno } from '@/lib/riego/repositorioCliente'
import {
  COLUMNAS_RIEGO,
  agrupar,
  interpretarFila,
  resolver,
  type LineaImportada,
} from '@/lib/riego/importacion'
import { ESTADOS_TURNO, type CatalogosRiego, type EstadoTurno } from '@/lib/riego/tipos'

const CABECERAS = ['Fecha siembra', 'UT', 'Zona', 'Turno', 'Área', 'Variedad', 'Plan']

const EJEMPLO = [
  'Temp. 2026-2027', 'Ciclo 1', '01/01/2027', '1001-040', 'Guanacaste', '1',
  'T1001-T05', '8.99', 'Manchester', 'YHD Manchester FL', 'Arlis Castillo',
  'Congolon', 'Rio', '', 'Pendiente crear',
]

export function ImportarTurnos({
  abierto,
  onCerrar,
  catalogos,
  onImportado,
}: {
  abierto: boolean
  onCerrar: () => void
  catalogos: CatalogosRiego
  onImportado: () => void
}) {
  // Los lotes no vienen en `catalogos`: son miles y cambian por
  // temporada. Se resuelven contra lo que la propia hoja trae, pidiendo
  // los saldos de la temporada elegida en el momento de guardar.
  const [, setNada] = useState(0)

  function interpretar(celdas: string[], numero: number): Preparada<LineaImportada> {
    const mapa: Record<string, string> = {}
    COLUMNAS_RIEGO.forEach((c, i) => {
      mapa[c.clave] = celdas[i] ?? ''
    })

    const leido = interpretarFila(mapa)
    if (!leido.ok) {
      return {
        numero,
        accion: 'omitir',
        error: leido.error,
        resumen: [mapa.fecha_siembra ?? '', mapa.ut ?? '', mapa.zona ?? '', mapa.turno ?? '', '', '', ''],
        valores: {} as LineaImportada,
      }
    }

    const l = leido.valor

    // La zona tiene que existir: es de donde sale el responsable y con
    // qué se agrupa el turno. Sin ella no se puede guardar nada.
    const zona = resolver(l.zona, catalogos.zonas, (z) => [z.nombre])
    if (!zona) {
      return {
        numero,
        accion: 'omitir',
        error: `La zona «${l.zona}» no está en el catálogo.`,
        resumen: [l.fechaSiembra, l.ut, l.zona, l.turno, l.areaTurno.toFixed(2), l.variedad, l.planNutricional],
        valores: l,
      }
    }

    return {
      numero,
      accion: 'insertar',
      resumen: [
        l.fechaSiembra,
        l.ut,
        l.zona,
        l.turno,
        l.areaTurno.toFixed(2),
        l.variedad || '—',
        l.planNutricional || '—',
      ],
      valores: l,
    }
  }

  async function guardar(lineas: LineaImportada[]) {
    setNada((n) => n + 1)

    const temporadaActiva =
      catalogos.temporadas.find((t) => t.activa)?.id ?? catalogos.temporadas[0]?.id ?? ''

    const { leerLotesRegables } = await import('@/lib/riego/repositorioCliente')

    const grupos = agrupar(lineas)
    const problemas: string[] = []
    let guardados = 0

    for (const g of grupos) {
      const c = g.cabecera
      const temporada =
        resolver(c.temporada, catalogos.temporadas, (t) => [t.nombre])?.id ?? temporadaActiva
      const zona = resolver(c.zona, catalogos.zonas, (z) => [z.nombre])
      if (!zona || !temporada) {
        problemas.push(`Turno ${c.turno}: falta la zona o la temporada.`)
        continue
      }

      // Los lotes se resuelven contra los REGABLES de esa temporada: así
      // un lote que no existe en la temporada se detecta aquí y no como
      // un error críptico de llave foránea.
      const { datos: saldos } = await leerLotesRegables(temporada, null, null)

      const lotes = []
      let malo: string | null = null
      for (const l of g.lotes) {
        const encontrado = saldos.find(
          (s) => s.ut.toLowerCase() === l.ut.toLowerCase()
        )
        if (!encontrado) {
          malo = `el lote «${l.ut}» no existe en esa temporada`
          break
        }
        lotes.push({
          loteTemporadaId: encontrado.lote_temporada_id,
          areaTurno: String(l.areaTurno),
          variedadId: resolver(l.variedad, catalogos.variedades, (v) => [v.nombre])?.id ?? '',
        })
      }
      if (malo) {
        problemas.push(`Turno ${c.turno}: ${malo}.`)
        continue
      }

      const r = await guardarTurno(
        {
          turnoId: null,
          temporadaId: temporada,
          ciclo: String(c.ciclo),
          fechaSiembra: c.fechaSiembra,
          zonaId: zona.id,
          turno: c.turno,
          planNutricionalId:
            resolver(c.planNutricional, catalogos.planes, (p) => [p.nombre])?.id ?? '',
          responsable: c.responsable,
          estacionRiego: c.estacionRiego,
          fuenteAgua: c.fuenteAgua ?? '',
          ordenSap: c.ordenSap,
          estado: estadoDeTexto(c.estado),
          comentarios: '',
        },
        lotes
      )

      if (r.ok) guardados += 1
      else problemas.push(`Turno ${c.turno}: ${r.mensaje}`)
    }

    onImportado()

    if (problemas.length > 0) {
      return {
        error: problemas.slice(0, 5).join(' '),
        mensaje: `${guardados} turno(s) cargados. ${problemas.length} con problemas.`,
      }
    }
    return { error: null, mensaje: `${guardados} turno(s) cargados.` }
  }

  return (
    <ImportarHoja<LineaImportada>
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Turnos de riego"
      ayuda="Una fila por lote, repitiendo la cabecera. Los renglones que comparten fecha de siembra, ciclo, zona y turno se juntan en un solo turno."
      columnas={COLUMNAS_RIEGO}
      cabecerasResumen={CABECERAS}
      ejemplo={EJEMPLO}
      interpretar={interpretar}
      guardar={guardar}
    />
  )
}

function estadoDeTexto(bruto: string): EstadoTurno {
  const t = (bruto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
  if (t.includes('creada') || t.includes('orden creada')) return 'ORDEN_CREADA'
  if (t.includes('creando')) return 'CREANDO'
  return ESTADOS_TURNO[0].valor
}
