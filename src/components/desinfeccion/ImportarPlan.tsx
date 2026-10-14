'use client'

/**
 * Importador del PLAN de desinfección.
 *
 * **Sólo el plan.** La ejecución y la logística se capturan en vivo, con
 * el turno abierto, su candado por fase y sus autocálculos; meterles un
 * Excel por la puerta de atrás sería saltarse el embudo entero. El plan
 * se arma de una sentada —un lote por renglón, cien renglones— y eso es
 * lo que un importador resuelve de verdad.
 *
 * Monta `ImportarHoja`, que es el mismo importador que usan trasplante,
 * riego, rotación y telecom: plantilla con desplegables, archivo o
 * pegado, vista previa fila por fila con lo que se va a insertar y lo
 * que se rechaza, y sólo entonces se escribe. Que sea el mismo componente
 * no es ahorro de código: es que quien ya importó turnos de riego no
 * tiene que aprender otro gesto.
 */

import { useEffect, useMemo, useState } from 'react'
import { ImportarHoja, type Preparada } from '@/components/ui/ImportarHoja'
import type { ListaPlantilla } from '@/lib/hojas'
import { guardarPlan, leerPlan, siembrasDeLotes } from '@/lib/desinfeccion/repositorioCliente'
import {
  COLUMNAS_PLAN,
  MONEDAS_PLAN,
  fechaAplicacionDe,
  interpretarFilaPlan,
  llaveDePlan,
  resolver,
  type LineaPlan,
} from '@/lib/desinfeccion/excel'
import { CICLOS, type CatalogosDesinfeccion, type LoteDesinfeccion } from '@/lib/desinfeccion/tipos'

const CABECERAS = [
  'Lote',
  'Ciclo',
  // La siembra ya NO se escribe: sale del plan de trasplante. Se enseña
  // en la vista previa para que se vea de dónde salió y qué fecha de
  // aplicación produce, antes de guardar nada.
  'Siembra (auto)',
  'Aplicación',
  'Producto',
  'Dosis/mz',
  'Mz',
  'Costo/L',
]

/**
 * Lo que la línea trae ya RESUELTO contra los catálogos.
 *
 * Se resuelve en la vista previa y no al guardar, a propósito: un lote
 * que no existe tiene que verse en la tabla de antes, con su renglón
 * marcado, y no aparecer a mitad de la escritura como un error de llave
 * foránea cuando ya hay cuarenta filas dentro.
 */
type PlanResuelto = LineaPlan & {
  loteTemporadaId: string
  /** Las dos que salen del plan de trasplante, no del Excel. */
  fechaSiembra: string
  variedadId: string
  productoId: string
  /** El id de la línea que pisa, si ya existía. */
  idExistente: string
}

export function ImportarPlan({
  abierto,
  onCerrar,
  temporadaId,
  catalogos,
  lotes,
  onImportado,
}: {
  abierto: boolean
  onCerrar: () => void
  /** La temporada del filtro: el plan entero es de una temporada. */
  temporadaId: string
  catalogos: CatalogosDesinfeccion
  /** Los lotes YA recortados por zona: no se puede planificar fuera. */
  lotes: LoteDesinfeccion[]
  onImportado: () => void
}) {
  /**
   * Lo que ya está en el plan, para saber qué pisa cada renglón.
   *
   * Se pide una vez al abrir y se guarda en estado: preguntarlo por fila
   * sería una vuelta al servidor por renglón, y una hoja de cien líneas
   * tardaría más en previsualizarse que en escribirse.
   */
  const [existentes, setExistentes] = useState<Map<string, string>>(new Map())

  /**
   * Un contador de recargas, en vez de llamar a la lectura a mano.
   *
   * **Y en vez de leerlo durante el render**, que era la primera versión
   * y es un bucle: con el plan vacío el mapa se queda en cero, la
   * condición sigue cumpliéndose y la lectura se dispara en cada render
   * para siempre. Es la misma trampa que el efecto que depende de un
   * array en vez de una cadena.
   */
  const [version, setVersion] = useState(0)
  const recargar = () => setVersion((v) => v + 1)

  /**
   * La siembra de cada lote y ciclo, traída del plan de trasplante.
   *
   * **Por qué se precarga.** `interpretar` es síncrona —la llama
   * `ImportarHoja` fila a fila— y la siembra vive en otra tabla. Pedirla
   * por renglón sería una vuelta al servidor por fila, y una hoja de
   * cien líneas tardaría más en previsualizarse que en escribirse.
   *
   * Se pide por CICLO porque la siembra del ciclo 1 y la del 2 son
   * fechas distintas: mezclarlas movería la aplicación al día
   * equivocado.
   */
  const [siembras, setSiembras] = useState<Map<string, { fecha: string; variedadId: string | null }>>(
    new Map()
  )

  useEffect(() => {
    if (!abierto) return
    let vivo = true
    async function leer() {
      const { datos } = await leerPlan(temporadaId || null)
      if (!vivo) return
      setExistentes(
        new Map(
          datos.map((f) => [
            llaveDePlan(f.lote_temporada_id, f.ciclo, f.producto_id, Number(f.dosis_mz)),
            f.id,
          ])
        )
      )

      const ids = lotes.map((l) => l.lote_temporada_id)
      const mapa = new Map<string, { fecha: string; variedadId: string | null }>()
      for (const c of CICLOS) {
        const porLote = await siembrasDeLotes(ids, c)
        if (!vivo) return
        for (const [lote, dato] of porLote) {
          mapa.set(`${lote}|${c}`, { fecha: dato.fecha, variedadId: dato.variedadId })
        }
      }
      if (vivo) setSiembras(mapa)
    }
    void leer()
    return () => {
      vivo = false
    }
  }, [abierto, temporadaId, version, lotes])

  /**
   * Los desplegables de la plantilla, sacados de la BASE.
   *
   * Sin esto la plantilla es una hoja con encabezados y quien la llena
   * tiene que adivinar cómo se escribe cada lote; con esto Excel sólo
   * deja elegir de la lista y el importador deja de rebotar filas por una
   * tilde. El número es la columna dentro de `COLUMNAS_PLAN`.
   */
  const listas = useMemo<ListaPlantilla[]>(
    () => [
      {
        columna: 0,
        titulo: 'Lote',
        // Código y nombre juntos, que es como se reconoce un lote en el
        // campo. `resolver` sabe quedarse con el código.
        valores: lotes.map((l) => `${l.nomenclatura}${l.nombre ? ` · ${l.nombre}` : ''}`),
      },
      { columna: 1, titulo: 'Ciclo', valores: CICLOS.map((c) => String(c)) },
      {
        columna: 3,
        titulo: 'Producto',
        valores: catalogos.materiales.map(
          (m) => `${m.codigo}${m.descripcion ? ` · ${m.descripcion}` : ''}`
        ),
      },
      { columna: 7, titulo: 'Moneda', valores: [...MONEDAS_PLAN] },
    ],
    [lotes, catalogos.materiales]
  )

  function interpretar(celdas: string[], numero: number): Preparada<PlanResuelto> {
    const mapa: Record<string, string> = {}
    COLUMNAS_PLAN.forEach((c, i) => {
      mapa[c.clave] = celdas[i] ?? ''
    })

    const vacio = (error: string, resumen: string[]): Preparada<PlanResuelto> => ({
      numero,
      accion: 'omitir',
      error,
      resumen,
      valores: {} as PlanResuelto,
    })

    const leido = interpretarFilaPlan(mapa)
    if (!leido.ok) {
      return vacio(leido.error, [
        mapa.lote ?? '',
        mapa.ciclo ?? '',
        '',
        '',
        mapa.producto ?? '',
        '',
        '',
        '',
      ])
    }

    const l = leido.valor
    const base = [
      l.lote,
      String(l.ciclo),
      '',
      '',
      l.producto || '—',
      l.dosisMz.toFixed(2),
      l.areaMz.toFixed(2),
      l.costoLitro === null ? 'del catálogo' : `${l.costoLitro.toFixed(4)} ${l.moneda}`,
    ]

    // El lote se resuelve contra los lotes VISIBLES, que ya vienen
    // recortados por zona. Un lote de otra zona no es «no existe»: es
    // que esta persona no puede planificar ahí, y la base lo rechazaría
    // igual. Decirlo aquí ahorra el viaje.
    const lote = resolver(l.lote, lotes, (x) => [
      x.nomenclatura,
      x.nombre ?? '',
      `${x.nomenclatura} · ${x.nombre ?? ''}`,
    ])
    if (!lote) {
      return vacio(`El lote «${l.lote}» no está entre los que puedes planificar.`, base)
    }

    // **La siembra y la variedad salen del plan de trasplante**, no del
    // Excel: es lo que hace la pantalla al elegir el lote, y pedirlas en
    // la hoja era pedir que se copiara a mano un dato que el sistema ya
    // tiene —con el riesgo de que la copia y el original discrepen—.
    //
    // Sin siembra no hay de dónde contar los días a la aplicación, así
    // que la fila rebota diciendo dónde se arregla.
    const siembra = siembras.get(`${lote.lote_temporada_id}|${l.ciclo}`)
    if (!siembra) {
      return vacio(
        `El lote «${l.lote}» no tiene siembra ni plan de siembra con fecha para el ciclo ${l.ciclo}. Se carga en Trasplante.`,
        base
      )
    }
    base[2] = siembra.fecha
    base[3] = fechaAplicacionDe(siembra.fecha, l.diasAplicacion)

    // El producto es opcional —se puede planificar sin decidirlo—, pero
    // si viene escrito y no existe, eso es un error y no un hueco: callarlo
    // guardaría la línea sin químico y nadie se enteraría.
    let productoId = ''
    if (l.producto) {
      const m = resolver(l.producto, catalogos.materiales, (x) => [
        x.codigo,
        x.descripcion ?? '',
        `${x.codigo} · ${x.descripcion ?? ''}`,
      ])
      if (!m) return vacio(`El producto «${l.producto}» no está en el catálogo de materiales.`, base)
      productoId = m.id
    }

    const idExistente =
      existentes.get(
        llaveDePlan(lote.lote_temporada_id, l.ciclo, productoId || null, l.dosisMz)
      ) ?? ''

    return {
      numero,
      // La llave natural de la tabla es lote + ciclo + producto + DOSIS
      // desde la 67: si la línea ya está, se ACTUALIZA. Insertarla otra
      // vez la rechazaría la base con un error de llave duplicada a
      // mitad del lote. Y con la dosis dentro, el mismo químico a 300 y
      // a 350 L/mz son dos líneas, que es como se planifica un lote que
      // no es homogéneo.
      accion: idExistente ? 'actualizar' : 'insertar',
      resumen: base,
      valores: {
        ...l,
        loteTemporadaId: lote.lote_temporada_id,
        fechaSiembra: siembra.fecha,
        variedadId: siembra.variedadId ?? '',
        productoId,
        idExistente,
      },
    }
  }

  async function guardar(lineas: PlanResuelto[]) {
    if (!temporadaId) {
      return {
        error: 'Elige una temporada antes de importar: el plan entero es de una temporada.',
        mensaje: '',
      }
    }

    const problemas: string[] = []
    let guardadas = 0

    for (const l of lineas) {
      const r = await guardarPlan({
        id: l.idExistente,
        temporadaId,
        loteTemporadaId: l.loteTemporadaId,
        ciclo: String(l.ciclo),
        fechaSiembraCongelada: l.fechaSiembra,
        diasAplicacion: String(l.diasAplicacion),
        diasPreriego: l.diasPreriego === null ? '' : String(l.diasPreriego),
        variedadId: l.variedadId,
        productoId: l.productoId,
        dosisMz: String(l.dosisMz),
        areaPlanificadaMz: String(l.areaMz),
        // Vacío se manda vacío: el disparador lo rellena del historial de
        // precios con la fecha que toca. Mandar un cero sería decidir que
        // el químico es gratis.
        costoLitro: l.costoLitro === null ? '' : String(l.costoLitro),
        moneda: l.moneda,
        comentarios: l.comentarios,
      })

      if (r.ok) guardadas += 1
      else problemas.push(`${l.lote}: ${r.mensaje}`)
    }

    recargar()
    onImportado()

    if (problemas.length > 0) {
      return {
        error: problemas.slice(0, 5).join(' '),
        mensaje: `${guardadas} línea(s) cargadas. ${problemas.length} con problemas.`,
      }
    }
    return { error: null, mensaje: `${guardadas} línea(s) de plan cargadas.` }
  }

  return (
    <ImportarHoja<PlanResuelto>
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Plan de desinfección"
      ayuda="Un renglón por línea de plan. La llave es lote + ciclo + producto + dosis: si ya existe, la línea se actualiza; con otra dosis, es una línea nueva. La fecha de siembra y la variedad salen solas del plan de trasplante. El costo vacío lo toma del historial de precios."
      columnas={COLUMNAS_PLAN}
      cabecerasResumen={CABECERAS}
      ejemplo={['1001-040', '1', '21', 'VAP-01', '300', '10', '', 'HNL', '']}
      listas={listas}
      etiquetaActualizar="Actualiza"
      interpretar={interpretar}
      guardar={guardar}
    />
  )
}
