'use client'

/**
 * Aplicar por lote (Inyección / Drench / Aseguramiento de calidad): la persona con la estación a cargo registra un
 * lote completo (o una parte: área editable) con sus productos. El producto se elige del catálogo AUNQUE la estación no lo
 * tenga en bodega (no se exige saldo ni recepción). Si la estación sí tiene saldo de ese producto, se pregunta si se tomó de
 * la bodega de la estación (descuenta) o vino aparte (no descuenta). Sin señal:
 * se guarda en el teléfono y se envía solo (operación `aplicacion_lote`, sql/129).
 *
 * Sin plan también se puede registrar: queda «Sin plan» y la base lo anota (SIN_PLAN).
 *
 * Pantalla compacta (sql/141): lote → fecha y área → UNA fila por producto con su cantidad y SU objetivo (el objetivo se
 * elige por producto, no por registro) → Guardar fijo abajo. Las observaciones solo si se piden. El lote es solo de las
 * zonas de la persona (la base entrega solo esos y vuelve a validar).
 */

import { useMemo, useState } from 'react'
import { Alerta, AreaTexto, Campo, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { aEntradaLocal, ahoraIso, deEntradaLocal, ayerIso, hoyIso } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { cantidad } from '@/lib/fertirriego/calculos'
import { crearOperacion, nuevoId } from '@/lib/fertirriego/operaciones'
import type { Estacion, Material, Operacion, Persona, PermisoHistorico } from '@/lib/fertirriego/tipos'
import { areaPropuesta, armarAplicacionLote, dosisPorMz, lineasDelPlan } from '@/lib/inyeccion/aplicarLote'
import { textoDato, type EstadoInyeccion } from '@/lib/inyeccion/estado'
import { loteCanonico, normLote, opcionesDeLotes, temporadaDeLote } from '@/lib/inyeccion/lotes'
import { normalizarObjetivo, objetivosParaEnviar, type ObjetivoCatalogo } from '@/lib/inyeccion/objetivos'
import { EditorLineas, leerLineas, type LineaEditable } from '@/components/fertirriego/EditorLineas'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'
import { FichaProducto } from './FichaProducto'
import { SelectorObjetivos } from './SelectorObjetivos'

type Datos = {
  lote: string
  categoria: string
  fechaHora: string
  area: string | null
  /** Borradores anteriores a la 141: un solo objetivo para todo el registro (ids, o textos como PLAGA: se mapean por nombre). */
  objetivos?: string[]
  /** 141: ids de los objetivos de CADA producto (material_id → ids). */
  objetivosPorProducto?: Record<string, string[]>
  comentario: string
  editadas: LineaEditable[] | null
  /** Por producto con saldo en la estación: true = lo tomé de la bodega, false = vino aparte (139). */
  deBodega?: Record<string, boolean>
  /** Objetivos creados en este teléfono (sin señal) que aún no bajan con el catálogo. */
  objetivosNuevos?: ObjetivoCatalogo[]
}

const num = (t: string) => Number(t.replace(',', '.'))

export function FormAplicacionLote({
  inyeccion,
  estacion,
  yo,
  saldos,
  loteInicial,
  categoriaInicial,
  historico,
  registrar,
  onCerrar,
  onGuardado,
}: {
  inyeccion: EstadoInyeccion
  estacion: Estacion
  yo: Persona
  /** Saldo por producto de la estación (con lo pendiente de enviar). */
  saldos: Map<string, number>
  loteInicial?: string
  categoriaInicial?: string
  /** sql/140: permiso temporal «Registro histórico» de esta estación (si lo tiene, se ofrece la casilla). */
  historico?: PermisoHistorico | null
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const borrador = useBorrador<Datos>(claveBorrador('aplicacion_lote', yo.id, estacion.id, [loteInicial, categoriaInicial].filter(Boolean).join('@')))
  const b = borrador.inicial
  const categorias = inyeccion.categorias
  // El lote es SOLO del catálogo de lotes (lotes + lotes_temporada) y de las zonas de la persona: no se escribe ni se crea uno
  const catalogoLotes = useMemo(() => inyeccion.lotes ?? [], [inyeccion.lotes])
  const [lote, setLote] = useState(() => loteCanonico(catalogoLotes, b?.lote ?? loteInicial ?? '') ?? '')
  const [categoria, setCategoria] = useState(b?.categoria ?? categoriaInicial ?? (categorias.length === 1 ? categorias[0].clave : ''))
  const [fechaHora, setFechaHora] = useState(b?.fechaHora ?? aEntradaLocal(ahoraIso()))
  const [area, setArea] = useState<string | null>(b?.area ?? null)
  const catalogoObjetivos = useMemo(() => inyeccion.objetivos ?? [], [inyeccion.objetivos])
  const [objetivosNuevos, setObjetivosNuevos] = useState<ObjetivoCatalogo[]>(b?.objetivosNuevos ?? [])
  const todosObjetivos = useMemo(() => [...catalogoObjetivos, ...objetivosNuevos], [catalogoObjetivos, objetivosNuevos])
  // Objetivo POR PRODUCTO. El de un borrador viejo (uno para todo el registro) vale para los productos sin objetivo propio.
  const [objetivosBase] = useState<string[]>(() => {
    const todos = [...catalogoObjetivos, ...(b?.objetivosNuevos ?? [])]
    const ids = (b?.objetivos ?? []).map((x) => todos.find((o) => o.id === x)?.id ?? todos.find((o) => normalizarObjetivo(o.nombre) === normalizarObjetivo(x))?.id)
    return [...new Set(ids.filter((x): x is string => Boolean(x)))]
  })
  const [objProducto, setObjProducto] = useState<Record<string, string[]>>(b?.objetivosPorProducto ?? {})
  const objetivosDe = (materialId: string) => objProducto[materialId] ?? objetivosBase
  const [comentario, setComentario] = useState(b?.comentario ?? '')
  const [verObservaciones, setVerObservaciones] = useState(Boolean(b?.comentario))
  const [editadas, setEditadas] = useState<LineaEditable[] | null>(b?.editadas ?? null)
  const [deBodega, setDeBodega] = useState<Record<string, boolean>>(b?.deBodega ?? {})
  const [aceptada, setAceptada] = useState<string | null>(null)
  // sql/140 · Registro histórico: día pasado, sin custodia y SIN descontar la bodega (la base lo vuelve a validar)
  const [esHistorico, setEsHistorico] = useState(false)
  const [ficha, setFicha] = useState<string | null>(null)
  useAutoguardado(borrador, { lote, categoria, fechaHora, area, objetivosPorProducto: objProducto, comentario, editadas, deBodega, objetivosNuevos })

  const planEstacion = useMemo(() => inyeccion.plan.filter((p) => p.estacion_id === null || p.estacion_id === estacion.id), [inyeccion.plan, estacion.id])
  // Los lotes con plan en la estación salen primero y marcados; se puede elegir cualquier lote de SUS zonas (sin plan = «sin plan»)
  const opcionesLote = useMemo(() => opcionesDeLotes(catalogoLotes, planEstacion.map((p) => p.lote)), [catalogoLotes, planEstacion])

  // La fecha de la aplicación es la que se escribió (hora de Honduras): no se pasa por UTC
  const dia = fechaHora.slice(0, 10) || hoyIso()
  const grupo = useMemo(
    () => (lote ? lineasDelPlan(planEstacion, { lote, categoriaClave: categoria || null, fecha: dia }) : []),
    [planEstacion, lote, categoria, dia]
  )
  const sinPlan = Boolean(lote) && grupo.length === 0
  // Área del lote (todas las cohortes del plan): solo para avisar; la base decide
  const areaLote = useMemo(() => {
    const porTurno = new Map<string, number>()
    for (const p of planEstacion) if (normLote(p.lote) === normLote(lote)) porTurno.set(p.turno_agl_id, Math.max(porTurno.get(p.turno_agl_id) ?? 0, Number(p.area_mz ?? 0)))
    const t = [...porTurno.values()].reduce((x, y) => x + y, 0)
    return t > 0 ? t : null
  }, [planEstacion, lote])

  const propuesta = areaPropuesta({ areaPlan: grupo[0]?.area_mz ?? null, areaLote })
  const areaTexto = area ?? (propuesta !== null ? String(propuesta) : '')
  const areaNum = areaTexto.trim() ? num(areaTexto) : NaN

  const productos = useMemo<Material[]>(
    () =>
      inyeccion.materiales.map((m) => ({ id: m.id, codigo: m.codigo, descripcion: m.descripcion, unidad: m.unidad, grupo: m.grupo, origen: 'MARA', validado: true, analisis: false })),
    [inyeccion.materiales]
  )
  const tecnico = (id: string) => inyeccion.materiales.find((m) => m.id === id)
  const plan = useMemo(() => new Map(grupo.map((g) => [g.material_id, g.cantidad_plan])), [grupo])
  const datosPlan = useMemo(() => new Map(grupo.map((g) => [g.material_id, g])), [grupo])
  const propuestas = useMemo<LineaEditable[]>(
    () =>
      grupo.length
        ? grupo.map((g) => ({ clave: nuevoId(), material_id: g.material_id, cantidad: String(Math.round(g.cantidad_plan * 100) / 100) }))
        : [{ clave: nuevoId(), material_id: '', cantidad: '' }],
    [grupo]
  )
  const lineas = editadas ?? propuestas

  // 139: solo se pregunta por los productos que la estación SÍ tiene en bodega; el resto no toca el inventario
  const tieneSaldo = (id: string) => !esHistorico && (saldos.get(id) ?? 0) > 0
  const usaLinea = (l: LineaEditable) => Boolean(l.material_id) && num(l.cantidad || '0') > 0
  const deLaBodega = (l: LineaEditable) => tieneSaldo(l.material_id) && deBodega[l.material_id] === true
  const sinResponder = lineas.filter((l) => usaLinea(l) && tieneSaldo(l.material_id) && deBodega[l.material_id] === undefined)
  // Falta inventario solo cuando dijo «lo tomé de la bodega» y no alcanza
  const faltante = lineas.filter((l) => usaLinea(l) && deLaBodega(l) && num(l.cantidad) > (saldos.get(l.material_id) ?? 0))
  const firmaFaltante = faltante.map((l) => `${l.material_id}:${l.cantidad.trim()}`).join('|')
  const aceptaNegativo = faltante.length > 0 && aceptada === firmaFaltante
  const nombre = (id: string) => tecnico(id)?.descripcion ?? 'producto'

  const avisoArea = areaLote !== null && Number.isFinite(areaNum) && areaNum > areaLote + 0.0001
  const avisoPie =
    faltante.length > 0 ? (
      <label className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-900 ring-1 ring-inset ring-red-300" role="alert" data-alerta-sin-inventario>
        <input type="checkbox" checked={aceptaNegativo} onChange={(e) => setAceptada(e.target.checked ? firmaFaltante : null)} className="h-6 w-6 shrink-0" data-acepta-negativo />
        <span className="min-w-0 flex-1 break-words leading-snug" title={faltante.map((l) => `${nombre(l.material_id)}: hay ${cantidad(saldos.get(l.material_id) ?? 0)}, aplicas ${l.cantidad}`).join(' · ')}>
          <strong>Sin inventario</strong> en {faltante.length === 1 ? '1 producto' : `${faltante.length} productos`} (mira «En bodega» en cada fila).{' '}
          <span className="font-semibold">Marca para confirmar que sí se aplicó.</span>
        </span>
      </label>
    ) : null

  return (
    <MarcoRegistro
      titulo="Aplicar por lote"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      rapido
      avisoPie={avisoPie}
      permisoHistorico={esHistorico}
      construir={({ ubicacion, enNombreDe }) => {
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Indica la fecha y hora de la aplicación.'
        if (Date.parse(fh) > Date.now() + 5 * 60_000) return 'La aplicación no puede ser en el futuro.'
        if (esHistorico && dia >= hoyIso()) return 'El registro histórico es solo de días pasados: elige un día anterior a hoy.'
        const r = leerLineas(lineas.map((l) => ({ ...l, cantidad: l.cantidad })))
        // Sin productos o con error de formato: el mismo texto que da la base
        if ('error' in r) return r.error.startsWith('Agrega') ? 'Indica al menos un producto.' : r.error
        // El objetivo es de CADA producto
        const sinObjetivo = r.lineas.filter((l) => objetivosDe(l.material_id).length === 0)
        if (sinObjetivo.length) return `Elige el objetivo de: ${[...new Set(sinObjetivo.map((l) => nombre(l.material_id)))].join(', ')}.`
        if (sinResponder.length) {
          return `Responde si lo tomaste de la bodega de la estación: ${[...new Set(sinResponder.map((l) => nombre(l.material_id)))].join(', ')}.`
        }
        if (faltante.length && !aceptaNegativo) {
          return 'No hay inventario suficiente para algún producto. Marca la casilla roja de abajo (sobre el botón Guardar) para confirmar que de verdad se aplicó, o corrige la cantidad.'
        }
        // La base vuelve a validar; aquí se evita mandar algo que no es del catálogo
        const canonico = loteCanonico(catalogoLotes, lote)
        if (!canonico) return 'Elige el lote de la lista (solo salen los lotes de tu zona).'
        const temporadaPlan = grupo[0]?.temporada ?? planEstacion.find((p) => normLote(p.lote) === normLote(canonico))?.temporada ?? null
        const a = armarAplicacionLote({
          estacionId: estacion.id,
          lote: canonico,
          categoriaClave: categoria || null,
          temporada: temporadaDeLote(catalogoLotes, canonico, temporadaPlan) ?? '',
          ciclo: grupo[0]?.ciclo ?? null,
          turnoAglId: grupo[0]?.turno_agl_id ?? null,
          areaMz: areaNum,
          areaLote,
          comentario,
          sinInventario: faltante.length > 0,
          lineas: r.lineas.map((l) => ({
            ...l,
            de_bodega: tieneSaldo(l.material_id) && deBodega[l.material_id] === true,
            objetivos: objetivosParaEnviar(objetivosDe(l.material_id), todosObjetivos),
          })),
          fechaHora: fh,
        })
        if ('error' in a) return a.error === 'Indica el área cubierta' ? 'Indica el área cubierta.' : a.error
        return [
          crearOperacion('aplicacion_lote', esHistorico ? { ...a.datos, historica: true } : a.datos, {
            ubicacion,
            enNombreDe,
            resumen: `${esHistorico ? 'Inyección HISTÓRICA' : 'Inyección'} por lote · ${lote} · ${r.lineas.length} producto(s)${sinPlan ? ' · sin plan' : ''}`,
          }),
        ]
      }}
    >
      {ficha && tecnico(ficha) && <FichaProducto producto={tecnico(ficha)!} onCerrar={() => setFicha(null)} />}

      <div data-selector-lote>
        <SelectorBuscable
          valor={lote}
          opciones={opcionesLote}
          onCambiar={(v) => {
            setLote(v)
            setEditadas(null)
            setArea(null)
          }}
          placeholder="Elegir lote…"
          etiquetaBusqueda="Buscar lote"
          permitirVacio={false}
        />
      </div>
      {catalogoLotes.length === 0 && (
        <p className="-mt-2 text-xs font-semibold text-amber-700" data-sin-catalogo-lotes>
          No hay lotes de tu zona en el teléfono todavía. Conéctate y actualiza para poder elegir el lote.
        </p>
      )}
      {sinPlan && (
        <p className="-mt-2 text-xs font-semibold text-amber-700" data-sin-plan>
          Sin plan: se puede registrar igual, pero queda marcado «sin plan».
        </p>
      )}
      {grupo[0] && (
        <p className="-mt-2 text-xs text-slate-600" data-plan-lote>
          Plan: DDT <strong>{grupo[0].ddt ?? '—'}</strong>
          {grupo[0].fecha_plan ? ` · ${grupo[0].fecha_estimada ? '≈ ' : ''}${grupo[0].fecha_plan}` : ''}
          {areaLote !== null ? ` · lote ${cantidad(areaLote)} mz` : ''}
        </p>
      )}

      {categorias.length > 1 && (
        <div className="flex flex-wrap gap-2" data-selector-categoria role="group" aria-label="Categoría">
          {categorias.map((c) => {
            const marcado = categoria === c.clave
            return (
              <button
                key={c.clave}
                type="button"
                aria-pressed={marcado}
                data-categoria={c.clave}
                onClick={() => {
                  setCategoria(marcado ? '' : c.clave)
                  setEditadas(null)
                }}
                className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-inset transition-colors ${
                  marcado ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'
                }`}
              >
                {marcado ? '✓ ' : ''}
                {c.etiqueta ?? c.categoria ?? c.clave}
              </button>
            )
          })}
        </div>
      )}

      {historico && (
        <label className="flex items-start gap-2 rounded-xl bg-sky-50 p-3 text-xs leading-snug text-slate-700 ring-1 ring-inset ring-sky-200" data-registro-historico-iny>
          <input
            type="checkbox"
            className="mt-0.5 h-6 w-6 shrink-0"
            checked={esHistorico}
            onChange={(e) => {
              setEsHistorico(e.target.checked)
              if (e.target.checked && fechaHora.slice(0, 10) >= hoyIso()) setFechaHora(`${ayerIso()}T${fechaHora.split('T')[1] ?? '08:00'}`)
            }}
            data-casilla-historico
          />
          <span className="min-w-0 flex-1">
            <strong>Registro histórico</strong> (lo que ya se aplicó antes de usar el sistema): día pasado y NO descuenta el inventario de la
            estación. Permiso hasta el {historico.hasta}
            {historico.dias_restantes <= 0 ? ' (vence hoy)' : ` · te quedan ${historico.dias_restantes} día(s)`}.
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Entrada
          type="datetime-local"
          aria-label="Fecha y hora de la aplicación"
          value={fechaHora}
          onChange={(e) => {
            setFechaHora(e.target.value)
            if (area === null) setEditadas(null)
          }}
          className="w-56 max-w-full"
          data-fecha-hora
        />
        {[['Hoy', hoyIso()], ['Ayer', ayerIso()]].map(([txt, v]) => (
          <button
            key={txt}
            type="button"
            onClick={() => setFechaHora(`${v}T${fechaHora.split('T')[1] ?? '08:00'}`)}
            className={`min-h-11 rounded-full px-3.5 text-sm font-semibold ring-1 ring-inset ${fechaHora.startsWith(v) ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200'}`}
          >
            {txt}
          </button>
        ))}
      </div>

      <Campo etiqueta="Área cubierta (mz)" requerido>
        <div className="flex flex-wrap items-center gap-2">
          <input
            inputMode="decimal"
            value={areaTexto}
            onChange={(e) => setArea(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="0"
            aria-label="Área cubierta en manzanas (si cubres solo una parte del lote, escribe esa área)"
            data-area-cubierta
            className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base font-semibold tabular-nums focus:border-brand-600 focus:outline-none"
          />
          {propuesta !== null && area !== null && (
            <button type="button" onClick={() => setArea(null)} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-brand-700 hover:bg-brand-50" data-area-propuesta>
              Usar el área del lote ({cantidad(propuesta)})
            </button>
          )}
          {avisoArea && (
            <span className="text-xs font-semibold text-amber-700" data-aviso-area>
              Es mayor que el lote ({cantidad(areaLote!)} mz): la base puede rechazarla.
            </span>
          )}
        </div>
      </Campo>

      <div className="flex flex-col gap-2" data-productos-aplicacion>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Productos y su objetivo</p>
        {inyeccion.materiales.length === 0 && <Alerta tono="ambar">No hay productos de inyección publicados desde AGL todavía.</Alerta>}
        <EditorLineas
          materiales={productos}
          lineas={lineas}
          onCambiar={setEditadas}
          saldos={saldos}
          plan={grupo.length ? plan : undefined}
          etiquetaCantidad="Aplicado"
          pie={(l) => {
            if (!l.material_id) return null
            const t = tecnico(l.material_id)
            const dosis = l.cantidad.trim() ? dosisPorMz(num(l.cantidad), areaNum) : null
            const pregunta = tieneSaldo(l.material_id) && num(l.cantidad || '0') > 0
            const respuesta = deBodega[l.material_id]
            const propios = objetivosDe(l.material_id)
            const otrosSinObjetivo = lineas.filter((x) => x.material_id && x.material_id !== l.material_id && objetivosDe(x.material_id).length === 0).length
            const delPlan = datosPlan.get(l.material_id)
            const controla = delPlan?.controla ?? t?.plagas_controla ?? null
            return (
              <>
                <div className="mt-2" data-objetivo-producto={l.material_id}>
                  <SelectorObjetivos
                    compacto
                    titulo={`Objetivo de ${nombre(l.material_id)}`}
                    catalogo={catalogoObjetivos}
                    locales={objetivosNuevos}
                    seleccion={propios}
                    onCambiar={(ids) => setObjProducto((x) => ({ ...x, [l.material_id]: ids }))}
                    onAgregado={(o) => setObjetivosNuevos((x) => (x.some((y) => y.id === o.id) || catalogoObjetivos.some((y) => y.id === o.id) ? x : [...x, o]))}
                  />
                  {propios.length > 0 && otrosSinObjetivo > 0 && (
                    <button
                      type="button"
                      onClick={() => setObjProducto((x) => Object.fromEntries([...Object.entries(x), ...lineas.filter((y) => y.material_id && objetivosDe(y.material_id).length === 0).map((y) => [y.material_id, propios])]))}
                      className="min-h-11 text-xs font-semibold text-brand-700 underline"
                      data-objetivo-igual-en-todos
                    >
                      Usar este objetivo en los otros {otrosSinObjetivo} producto(s)
                    </button>
                  )}
                </div>
                {pregunta && (
                  <div className="mt-2 rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200" role="group" aria-label="¿De dónde salió el producto?" data-pregunta-bodega={l.material_id}>
                    <p className="mb-1.5 text-xs font-semibold text-slate-700">
                      Hay {cantidad(saldos.get(l.material_id) ?? 0)} {t?.unidad ?? ''} en la estación. ¿Lo tomaste de ahí?
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {([[true, 'Sí, de la bodega', 'si'], [false, 'No, vino aparte', 'no']] as const).map(([valor, texto, clave]) => (
                        <button
                          key={clave}
                          type="button"
                          aria-pressed={respuesta === valor}
                          data-de-bodega={clave}
                          onClick={() => setDeBodega((x) => ({ ...x, [l.material_id]: valor }))}
                          className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold leading-tight ring-1 ring-inset transition-colors ${
                            respuesta === valor ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300'
                          }`}
                        >
                          {respuesta === valor ? '✓ ' : ''}
                          {texto}
                        </button>
                      ))}
                    </div>
                    {respuesta === undefined && <p className="mt-1.5 text-xs font-semibold text-amber-700">Elige una respuesta para poder guardar.</p>}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
                  {dosis !== null && (
                    <span data-dosis-mz>
                      Dosis: <strong>{cantidad(dosis)}</strong> {t?.unidad ?? ''}/mz
                    </span>
                  )}
                  <span data-ingrediente-activo>
                    I.A.: <strong>{textoDato(t?.ingrediente_activo)}</strong>
                  </span>
                  {grupo.length > 0 && !plan.has(l.material_id) && <span className="font-semibold text-amber-700">fuera del plan</span>}
                  <button type="button" onClick={() => setFicha(l.material_id)} className="min-h-11 rounded-lg px-1 font-semibold text-brand-700 underline" data-abrir-ficha>
                    Ver ficha
                  </button>
                </div>
                {(controla || delPlan?.observaciones) && (
                  <p className="text-xs text-slate-500" data-plan-controla>
                    {controla ? `Controla: ${controla}` : ''}
                    {controla && delPlan?.observaciones ? ' · ' : ''}
                    {delPlan?.observaciones ? `Plan: ${delPlan.observaciones}` : ''}
                  </p>
                )}
              </>
            )
          }}
        />
      </div>

      {verObservaciones ? (
        <AreaTexto value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} placeholder="Observaciones (opcional)" aria-label="Observaciones" data-comentario />
      ) : (
        <button type="button" onClick={() => setVerObservaciones(true)} className="min-h-11 w-fit rounded-lg px-1 text-sm font-semibold text-brand-700" data-agregar-observacion>
          ＋ Agregar observaciones
        </button>
      )}
    </MarcoRegistro>
  )
}
