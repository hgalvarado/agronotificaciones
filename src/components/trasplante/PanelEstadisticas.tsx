'use client'

/**
 * El tablero del trasplante: cómo va la temporada, arriba de todo.
 *
 * Antes había que entrar a la pestaña de cuadre y leer una tabla de
 * ochenta filas para saber si se iba adelantado o atrasado. Son tres
 * preguntas y ninguna necesita una tabla: cómo va la SEMANA —que es el
 * ritmo—, cómo va cada VARIEDAD —que es lo que se compra— y cómo va cada
 * UT —que es dónde hay que ir a empujar—.
 *
 * Sólo dibuja. Los números vienen sumados de la base y reagrupados en
 * `lib/trasplante/servicio`, que es puro y se prueba aparte.
 */

import { useMemo, useState } from 'react'
import { Tarjeta } from '@/components/ui/Primitivos'
import { BarrasCumplimiento, type BarraCumplimiento } from './BarrasCumplimiento'
import { GraficoSemanas } from './GraficoSemanas'
import { n0, n2, pct } from '@/lib/trasplante/formato'
import { resumirVariedades, semanasParaGrafico, totalGeneral } from '@/lib/trasplante/servicio'
import type {
  FilaAvanceUt,
  FilaEstadistica,
  FilaSemana,
  FilaVariedad,
} from '@/lib/trasplante/tipos'

type Vista = 'semana' | 'variedad' | 'ut'

export function PanelEstadisticas({
  estadisticas,
  variedades,
  semanas,
  avance,
}: {
  estadisticas: FilaEstadistica[]
  variedades: FilaVariedad[]
  semanas: FilaSemana[]
  avance: FilaAvanceUt[]
}) {
  // Un gráfico a la vez y no los tres apilados: en un teléfono, tres
  // gráficos son tres pantallas de desplazamiento antes de llegar a la
  // tabla, y la pregunta que trae a alguien aquí es siempre UNA.
  const [vista, setVista] = useState<Vista>('semana')

  const total = useMemo(() => totalGeneral(estadisticas), [estadisticas])
  const puntos = useMemo(() => semanasParaGrafico(semanas), [semanas])

  const porVariedad = useMemo<BarraCumplimiento[]>(
    () =>
      resumirVariedades(variedades).variedades.map((v) => ({
        etiqueta: v.variedad,
        detalle: v.cultivo,
        plan: v.total.area_plan,
        real: v.total.area_real,
      })),
    [variedades]
  )

  // Por UT se suman los ciclos y las variedades del mismo lote: la
  // pregunta del tablero es «cómo va ESE lote», no cómo va cada variedad
  // dentro de él. El desglose está en la pestaña de cuadre.
  const porUt = useMemo<BarraCumplimiento[]>(() => {
    const mapa = new Map<string, BarraCumplimiento>()
    for (const f of avance) {
      const x = mapa.get(f.ut) ?? { etiqueta: f.ut, detalle: f.lote_nombre, plan: 0, real: 0 }
      x.plan += Number(f.area_plan)
      x.real += Number(f.area_real)
      mapa.set(f.ut, x)
    }
    return [...mapa.values()]
  }, [avance])

  const hayAlgo = puntos.length > 0 || porVariedad.length > 0 || porUt.length > 0
  if (!hayAlgo) return null

  return (
    <Tarjeta className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra valor={n2(total.area_real)} etiqueta="Mz sembradas" destacado />
        <Cifra valor={n2(total.area_plan)} etiqueta="Mz del plan" />
        <Cifra valor={pct(total.pct)} etiqueta="Cumplimiento" />
        <Cifra valor={n0(total.plantas)} etiqueta="Plántulas" />
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {(
          [
            ['semana', 'Cumplimiento por semana'],
            ['variedad', 'Cumplimiento por variedad'],
            ['ut', 'Avance por UT'],
          ] as const
        ).map(([valor, etiqueta]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setVista(valor)}
            aria-pressed={vista === valor}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
              vista === valor
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-500 hover:text-slate-900'
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      <div className="min-h-[180px]">
        {vista === 'semana' && <GraficoSemanas puntos={puntos} />}
        {vista === 'variedad' && <BarrasCumplimiento filas={porVariedad} />}
        {vista === 'ut' && <BarrasCumplimiento filas={porUt} tope={15} />}
      </div>

      {vista !== 'semana' && (
        <p className="text-[11px] text-slate-400">
          La barra gris es el plan; la de color, lo sembrado. Verde llegó, ámbar va por debajo de
          la mitad.
        </p>
      )}
    </Tarjeta>
  )
}

function Cifra({
  valor,
  etiqueta,
  destacado,
}: {
  valor: string
  etiqueta: string
  destacado?: boolean
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-inset ring-slate-200/70">
      <p
        className={`text-xl font-bold tracking-tight ${
          destacado ? 'text-brand-700' : 'text-slate-900'
        }`}
      >
        {valor}
      </p>
      <p className="text-[11px] font-medium text-slate-400">{etiqueta}</p>
    </div>
  )
}
