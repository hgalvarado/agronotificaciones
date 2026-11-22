'use client'

/**
 * AgroMétricas › Fórmula del Índice de crecimiento (IC). Pantalla de administración (permiso «Configurar rangos»).
 *
 *   IC = hojas / (DDT ^ exponente) / divisor      y     plan IC por DDT.
 *
 * - Lista las versiones (cada una rige desde una fecha; la más reciente que no pase de la fecha del registro gana).
 * - Crear o editar una versión: fecha de vigencia, divisor, exponente, notas y tabla del plan por DDT.
 * - Guardar una versión NO recalcula lo ya registrado. «Recalcular» es aparte: primero muestra qué cambiaría
 *   (vista previa) y solo aplica con confirmación explícita.
 * Todo lo decide la base (sql/127); el permiso de la pantalla lo comprueba el servidor.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alerta, Boton, Campo, Entrada, AreaTexto, Insignia, Tarjeta, TarjetaEncabezado, bordeError } from '@/components/ui/Primitivos'
import { createClient } from '@/lib/supabase/client'
import { hoyIso } from '@/lib/fechas/zona'
import { normalizarVersiones, planParaGuardar, validarFormula, versionVigente, type VersionFormula } from '@/lib/agrometricas/indicePura'

type FilaPlan = { ddt: string; ic_plan: string }
type Previa = { total: number; cambian: number; muestra: { id: string; turno: string; fecha: string; ddt: number | null; hojas: number
  ic_real_antes: number | null; ic_real_despues: number | null; ic_plan_antes: number | null; ic_plan_despues: number | null }[] }

const aTexto = (n: number | null | undefined) => (n == null ? '—' : String(Number(n)))
const filasDe = (v: VersionFormula | null): FilaPlan[] => (v?.plan ?? []).map((p) => ({ ddt: String(p.ddt), ic_plan: String(p.ic_plan) }))

export function FormulaIC() {
  const [versiones, setVersiones] = useState<VersionFormula[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  // formulario
  const [desde, setDesde] = useState(hoyIso())
  const [divisor, setDivisor] = useState('10')
  const [exponente, setExponente] = useState('1')
  const [notas, setNotas] = useState('')
  const [plan, setPlan] = useState<FilaPlan[]>([])
  const [editando, setEditando] = useState<string | null>(null)   // id de la versión que se edita (null = nueva)
  const [problemas, setProblemas] = useState<Record<string, string>>({})

  // recálculo
  const [rDesde, setRDesde] = useState('')
  const [rHasta, setRHasta] = useState('')
  const [rTemporada, setRTemporada] = useState('')
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [confirmar, setConfirmar] = useState(false)

  const cargar = useCallback(async () => {
    const { data, error: e } = await createClient().rpc('fn_agm_ic_config')
    if (e) { setError(e.message); return }
    setVersiones(normalizarVersiones(data))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => { cargar() }, 0)   // fuera del cuerpo del efecto (regla set-state-in-effect)
    return () => clearTimeout(t)
  }, [cargar])

  const vigente = useMemo(() => versionVigente(versiones, hoyIso()), [versiones])

  const cargarEnFormulario = (v: VersionFormula | null, nueva: boolean) => {
    setEditando(nueva ? null : v?.id ?? null)
    setDesde(nueva ? hoyIso() : v?.vigente_desde ?? hoyIso())
    setDivisor(String(v?.divisor ?? 10))
    setExponente(String(v?.exponente_ddt ?? 1))
    setNotas(nueva ? '' : v?.notas ?? '')
    setPlan(filasDe(v))
    setProblemas({}); setError(null); setOk(null)
  }

  async function guardar() {
    setError(null); setOk(null)
    const lista = validarFormula({ vigente_desde: desde, divisor, exponente_ddt: exponente, plan })
    setProblemas(Object.fromEntries(lista.map((p) => [p.campo, p.mensaje])))
    if (lista.length) { setError('Revisa los campos marcados.'); return }
    setCargando(true)
    const { error: e } = await createClient().rpc('fn_agm_ic_guardar_formula', {
      p: { vigente_desde: desde, divisor: Number(divisor.replace(',', '.')), exponente_ddt: Number(exponente.replace(',', '.')), notas: notas.trim() || null, plan: planParaGuardar(plan) },
    })
    setCargando(false)
    if (e) { setError(e.message); return }
    setOk('Fórmula guardada. Los registros ya guardados no cambian hasta que uses «Recalcular».')
    setEditando(null)
    setPrevia(null); setConfirmar(false)
    await cargar()
  }

  const paramsRecalculo = (previsualizar: boolean) => ({
    previsualizar,
    ...(rDesde ? { desde: rDesde } : {}), ...(rHasta ? { hasta: rHasta } : {}), ...(rTemporada.trim() ? { temporada: rTemporada.trim() } : {}),
  })

  async function verCambios() {
    setError(null); setOk(null); setConfirmar(false); setCargando(true)
    const { data, error: e } = await createClient().rpc('fn_agm_ic_recalcular', { p: paramsRecalculo(true) })
    setCargando(false)
    if (e) { setError(e.message); return }
    setPrevia(data as Previa)
  }

  async function aplicar() {
    if (!confirmar) return
    setError(null); setOk(null); setCargando(true)
    const { data, error: e } = await createClient().rpc('fn_agm_ic_recalcular', { p: paramsRecalculo(false) })
    setCargando(false)
    if (e) { setError(e.message); return }
    setOk(`Recalculado: ${(data as { actualizados: number }).actualizados} registros actualizados.`)
    setPrevia(null); setConfirmar(false)
  }

  const ponerPlan = (i: number, campo: keyof FilaPlan, v: string) => setPlan((p) => p.map((f, j) => (j === i ? { ...f, [campo]: v } : f)))

  return (
    <div className="flex flex-col gap-4" data-formula-ic>
      {error && <Alerta tono="rojo">{error}</Alerta>}
      {ok && <Alerta tono="azul">{ok}</Alerta>}

      <Tarjeta>
        <TarjetaEncabezado titulo="Versiones de la fórmula" contador={versiones?.length}
          accion={<Boton type="button" tamano="sm" variante="secundario" onClick={() => cargarEnFormulario(vigente, true)} data-nueva-version>Nueva versión</Boton>} />
        <div className="flex flex-col divide-y divide-slate-100">
          {versiones == null && <p className="p-4 text-sm text-slate-500">Cargando…</p>}
          {versiones?.length === 0 && <p className="p-4 text-sm text-slate-500">Aún no hay versiones. La 127 siembra la inicial (hojas ÷ DDT ÷ 10).</p>}
          {versiones?.slice().reverse().map((v) => (
            <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-4" data-version={v.vigente_desde}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  Desde {v.vigente_desde} · hojas ÷ DDT{v.exponente_ddt !== 1 ? `^${v.exponente_ddt}` : ''} ÷ {v.divisor}
                </p>
                <p className="text-xs text-slate-500">
                  Plan de {v.plan.length} DDT{v.plan.length ? ` (${v.plan[0].ddt} a ${v.plan[v.plan.length - 1].ddt})` : ''}{v.notas ? ` · ${v.notas}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {vigente?.id === v.id && <Insignia tono="verde">Vigente hoy</Insignia>}
                <Boton type="button" tamano="sm" variante="secundario" onClick={() => cargarEnFormulario(v, false)}>Editar</Boton>
              </div>
            </div>
          ))}
        </div>
      </Tarjeta>

      <Tarjeta>
        <TarjetaEncabezado titulo={editando ? 'Editar versión' : 'Nueva versión'} />
        <div className="flex flex-col gap-3 p-4" data-form-formula>
          <p className="text-sm text-slate-600">
            Una versión rige desde su fecha de vigencia: un registro usa la más reciente que no pase de SU fecha. Si ya hay una
            versión con esa fecha, se reemplaza. Guardar no cambia lo ya registrado.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Campo etiqueta="Rige desde" requerido error={problemas.vigente_desde}>
              <Entrada type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={`h-12 text-base ${bordeError(Boolean(problemas.vigente_desde))}`} data-campo="vigente_desde" />
            </Campo>
            <Campo etiqueta="Divisor" requerido error={problemas.divisor}>
              <Entrada inputMode="decimal" value={divisor} onChange={(e) => setDivisor(e.target.value)} className={`h-12 text-base tabular-nums ${bordeError(Boolean(problemas.divisor))}`} data-campo="divisor" />
            </Campo>
            <Campo etiqueta="Exponente del DDT" requerido error={problemas.exponente_ddt} ayuda="1 = hojas ÷ DDT ÷ divisor. 0 = sin dividir por el DDT.">
              <Entrada inputMode="decimal" value={exponente} onChange={(e) => setExponente(e.target.value)} className={`h-12 text-base tabular-nums ${bordeError(Boolean(problemas.exponente_ddt))}`} data-campo="exponente_ddt" />
            </Campo>
          </div>
          <Campo etiqueta="Notas">
            <AreaTexto rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Por qué cambia la fórmula" />
          </Campo>

          <div>
            <p className="mb-1 text-sm font-semibold text-slate-900">Plan de IC por DDT (igual para todas las variedades)</p>
            <div className="flex flex-col gap-2">
              {plan.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2" data-fila-plan>
                  <Entrada inputMode="numeric" aria-label="DDT" placeholder="DDT" value={f.ddt} onChange={(e) => ponerPlan(i, 'ddt', e.target.value)}
                    className={`h-11 tabular-nums ${bordeError(Boolean(problemas[`plan.${i}.ddt`]))}`} title={problemas[`plan.${i}.ddt`]} />
                  <Entrada inputMode="decimal" aria-label="IC del plan" placeholder="IC plan" value={f.ic_plan} onChange={(e) => ponerPlan(i, 'ic_plan', e.target.value)}
                    className={`h-11 tabular-nums ${bordeError(Boolean(problemas[`plan.${i}.ic_plan`]))}`} title={problemas[`plan.${i}.ic_plan`]} />
                  <Boton type="button" tamano="md" variante="fantasma" onClick={() => setPlan((p) => p.filter((_, j) => j !== i))} aria-label={`Quitar la fila ${i + 1}`}>Quitar</Boton>
                </div>
              ))}
              {Object.entries(problemas).filter(([k]) => k.startsWith('plan.')).map(([k, m]) => <p key={k} className="text-sm text-red-700">{m}</p>)}
              <Boton type="button" tamano="md" variante="secundario" className="self-start" onClick={() => setPlan((p) => [...p, { ddt: '', ic_plan: '' }])}>Agregar fila</Boton>
            </div>
          </div>
          <Boton type="button" tamano="lg" disabled={cargando} onClick={guardar} data-guardar-formula>Guardar</Boton>
        </div>
      </Tarjeta>

      <Tarjeta>
        <TarjetaEncabezado titulo="Recalcular lo ya registrado" />
        <div className="flex flex-col gap-3 p-4" data-recalcular>
          <p className="text-sm text-slate-600">
            Vuelve a calcular el IC y el plan de los registros con la fórmula que rige en la fecha de cada uno. Primero se muestra qué
            cambiaría; nada se escribe hasta que lo confirmes. Sin filtros se revisan todos los registros.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Campo etiqueta="Desde"><Entrada type="date" value={rDesde} onChange={(e) => { setRDesde(e.target.value); setPrevia(null) }} className="h-12 text-base" /></Campo>
            <Campo etiqueta="Hasta"><Entrada type="date" value={rHasta} onChange={(e) => { setRHasta(e.target.value); setPrevia(null) }} className="h-12 text-base" /></Campo>
            <Campo etiqueta="Temporada"><Entrada value={rTemporada} placeholder="2026-2027" onChange={(e) => { setRTemporada(e.target.value); setPrevia(null) }} className="h-12 text-base" /></Campo>
          </div>
          <Boton type="button" tamano="md" variante="secundario" className="self-start" disabled={cargando} onClick={verCambios} data-ver-cambios>Ver qué cambiaría</Boton>

          {previa && (
            <div className="flex flex-col gap-3" data-previa>
              <Alerta tono={previa.cambian ? 'ambar' : 'azul'}>
                {previa.cambian
                  ? `${previa.cambian} de ${previa.total} registros cambiarían${previa.cambian > previa.muestra.length ? ` (se muestran los ${previa.muestra.length} más recientes)` : ''}.`
                  : `Nada cambiaría: los ${previa.total} registros ya están con la fórmula vigente.`}
              </Alerta>
              {previa.muestra.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr><th className="py-1 pr-3">Fecha</th><th className="pr-3">Turno</th><th className="pr-3">DDT</th><th className="pr-3">Hojas</th><th className="pr-3">IC antes</th><th className="pr-3">IC después</th><th className="pr-3">Plan antes</th><th>Plan después</th></tr>
                    </thead>
                    <tbody>
                      {previa.muestra.map((m) => (
                        <tr key={m.id} className="border-t border-slate-100 tabular-nums">
                          <td className="py-1 pr-3">{m.fecha}</td><td className="pr-3">{m.turno}</td><td className="pr-3">{aTexto(m.ddt)}</td><td className="pr-3">{aTexto(m.hojas)}</td>
                          <td className="pr-3">{aTexto(m.ic_real_antes)}</td><td className="pr-3 font-semibold">{aTexto(m.ic_real_despues)}</td>
                          <td className="pr-3">{aTexto(m.ic_plan_antes)}</td><td className="font-semibold">{aTexto(m.ic_plan_despues)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {previa.cambian > 0 && (
                <>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-900">
                    <input type="checkbox" className="h-5 w-5" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} data-confirmar-recalculo />
                    Confirmo reemplazar el IC y el plan de {previa.cambian} registros
                  </label>
                  <Boton type="button" tamano="md" variante="alerta" className="self-start" disabled={!confirmar || cargando} onClick={aplicar} data-aplicar-recalculo>Recalcular</Boton>
                </>
              )}
            </div>
          )}
        </div>
      </Tarjeta>
    </div>
  )
}
