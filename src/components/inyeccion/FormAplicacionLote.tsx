'use client'

/**
 * Aplicar por lote (Inyección / Drench / Aseguramiento de calidad): la persona con la estación a cargo registra un
 * lote completo (o una parte: área editable) con sus productos. Descuenta de la bodega de la estación. Sin señal:
 * se guarda en el teléfono y se envía solo (operación `aplicacion_lote`, sql/129).
 *
 * Sin plan también se puede registrar: queda «Sin plan» y la base lo anota (SIN_PLAN).
 */

import { useMemo, useState } from 'react'
import { Alerta, AreaTexto, Campo, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { aEntradaLocal, ahoraIso, deEntradaLocal, ayerIso, hoyIso } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { cantidad } from '@/lib/fertirriego/calculos'
import { crearOperacion, nuevoId } from '@/lib/fertirriego/operaciones'
import type { Estacion, Material, Operacion, Persona } from '@/lib/fertirriego/tipos'
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
  /** Ids de los objetivos elegidos (un borrador anterior a la 132 trae textos como PLAGA: se mapean por nombre). */
  objetivos: string[]
  comentario: string
  editadas: LineaEditable[] | null
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
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const borrador = useBorrador<Datos>(claveBorrador('aplicacion_lote', yo.id, estacion.id, [loteInicial, categoriaInicial].filter(Boolean).join('@')))
  const b = borrador.inicial
  const categorias = inyeccion.categorias
  // El lote es SOLO del catálogo de lotes (lotes + lotes_temporada): no se escribe ni se crea uno
  const catalogoLotes = useMemo(() => inyeccion.lotes ?? [], [inyeccion.lotes])
  const [lote, setLote] = useState(() => loteCanonico(catalogoLotes, b?.lote ?? loteInicial ?? '') ?? '')
  const [categoria, setCategoria] = useState(b?.categoria ?? categoriaInicial ?? (categorias.length === 1 ? categorias[0].clave : ''))
  const [fechaHora, setFechaHora] = useState(b?.fechaHora ?? aEntradaLocal(ahoraIso()))
  const [area, setArea] = useState<string | null>(b?.area ?? null)
  const catalogoObjetivos = useMemo(() => inyeccion.objetivos ?? [], [inyeccion.objetivos])
  const [objetivosNuevos, setObjetivosNuevos] = useState<ObjetivoCatalogo[]>(b?.objetivosNuevos ?? [])
  const [objetivos, setObjetivos] = useState<string[]>(() => {
    const todos = [...catalogoObjetivos, ...(b?.objetivosNuevos ?? [])]
    const ids = (b?.objetivos ?? []).map((x) => todos.find((o) => o.id === x)?.id ?? todos.find((o) => normalizarObjetivo(o.nombre) === normalizarObjetivo(x))?.id)
    return [...new Set(ids.filter((x): x is string => Boolean(x)))]
  })
  const [comentario, setComentario] = useState(b?.comentario ?? '')
  const [editadas, setEditadas] = useState<LineaEditable[] | null>(b?.editadas ?? null)
  const [aceptada, setAceptada] = useState<string | null>(null)
  const [ficha, setFicha] = useState<string | null>(null)
  useAutoguardado(borrador, { lote, categoria, fechaHora, area, objetivos, comentario, editadas, objetivosNuevos })

  const planEstacion = useMemo(() => inyeccion.plan.filter((p) => p.estacion_id === null || p.estacion_id === estacion.id), [inyeccion.plan, estacion.id])
  // Los lotes con plan en la estación salen primero y marcados; se puede elegir cualquier lote del catálogo (sin plan = «sin plan»)
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
  const propuestas = useMemo<LineaEditable[]>(
    () =>
      grupo.length
        ? grupo.map((g) => ({ clave: nuevoId(), material_id: g.material_id, cantidad: String(Math.round(g.cantidad_plan * 100) / 100) }))
        : [{ clave: nuevoId(), material_id: '', cantidad: '' }],
    [grupo]
  )
  const lineas = editadas ?? propuestas

  const faltante = lineas.filter((l) => l.material_id && num(l.cantidad || '0') > (saldos.get(l.material_id) ?? 0))
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
      construir={({ ubicacion, enNombreDe }) => {
        const fh = deEntradaLocal(fechaHora)
        if (!fh) return 'Indica la fecha y hora de la aplicación.'
        if (Date.parse(fh) > Date.now() + 5 * 60_000) return 'La aplicación no puede ser en el futuro.'
        const r = leerLineas(lineas.map((l) => ({ ...l, cantidad: l.cantidad })))
        // Sin productos o con error de formato: el mismo texto que da la base
        if ('error' in r) return r.error.startsWith('Agrega') ? 'Indica al menos un producto.' : r.error
        if (faltante.length && !aceptaNegativo) {
          return 'No hay inventario suficiente para algún producto. Marca la casilla roja de abajo (sobre el botón Guardar) para confirmar que de verdad se aplicó, o corrige la cantidad.'
        }
        // La base vuelve a validar; aquí se evita mandar algo que no es del catálogo
        const canonico = loteCanonico(catalogoLotes, lote)
        if (!canonico) return 'Elige el lote de la lista del catálogo de lotes.'
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
          objetivos: objetivosParaEnviar(objetivos, [...catalogoObjetivos, ...objetivosNuevos]),
          comentario,
          sinInventario: faltante.length > 0,
          lineas: r.lineas,
          fechaHora: fh,
        })
        if ('error' in a) return a.error === 'Indica el área cubierta' ? 'Indica el área cubierta.' : a.error
        return [
          crearOperacion('aplicacion_lote', a.datos, {
            ubicacion,
            enNombreDe,
            resumen: `Inyección por lote · ${lote} · ${r.lineas.length} producto(s)${sinPlan ? ' · sin plan' : ''}`,
          }),
        ]
      }}
    >
      {ficha && tecnico(ficha) && <FichaProducto producto={tecnico(ficha)!} onCerrar={() => setFicha(null)} />}

      <Campo etiqueta="Lote" requerido>
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
          <p className="mt-1.5 text-xs font-semibold text-amber-700" data-sin-catalogo-lotes>
            No hay lotes del catálogo en el teléfono todavía. Conéctate y actualiza para poder elegir el lote.
          </p>
        )}
        {sinPlan && (
          <p className="mt-1.5 text-xs font-semibold text-amber-700" data-sin-plan>
            Sin plan: se puede registrar igual, pero queda marcado «sin plan».
          </p>
        )}
        {grupo[0] && (
          <p className="mt-1.5 text-xs text-slate-600" data-plan-lote>
            Plan: DDT <strong>{grupo[0].ddt ?? '—'}</strong>
            {grupo[0].fecha_plan ? ` · ${grupo[0].fecha_plan}` : ''}
            {areaLote !== null ? ` · lote ${cantidad(areaLote)} mz` : ''}
          </p>
        )}
      </Campo>

      {categorias.length > 0 && (
        <Campo etiqueta="Categoría">
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
        </Campo>
      )}

      <Campo etiqueta="Fecha y hora" requerido>
        <div className="flex flex-wrap items-center gap-2">
          <Entrada type="datetime-local" value={fechaHora} onChange={(e) => { setFechaHora(e.target.value); if (area === null) setEditadas(null) }} className="w-60" data-fecha-hora />
          {[['Hoy', hoyIso()], ['Ayer', ayerIso()]].map(([txt, v]) => (
            <button
              key={txt}
              type="button"
              onClick={() => setFechaHora(`${v}T${fechaHora.split('T')[1] ?? '08:00'}`)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${fechaHora.startsWith(v) ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200'}`}
            >
              {txt}
            </button>
          ))}
        </div>
      </Campo>

      <Campo etiqueta="Área cubierta (mz)" requerido>
        <div className="flex flex-wrap items-center gap-2">
          <input
            inputMode="decimal"
            value={areaTexto}
            onChange={(e) => setArea(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="0"
            data-area-cubierta
            className="w-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base font-semibold tabular-nums focus:border-brand-600 focus:outline-none"
          />
          {propuesta !== null && area !== null && (
            <button type="button" onClick={() => setArea(null)} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-brand-700 hover:bg-brand-50" data-area-propuesta>
              Usar el área del lote ({cantidad(propuesta)})
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">Si cubres solo una parte del lote, escribe esa área.</p>
        {avisoArea && (
          <p className="mt-1 text-xs font-semibold text-amber-700" data-aviso-area>
            El área es mayor que la del lote ({cantidad(areaLote!)} mz): la base puede rechazarla.
          </p>
        )}
      </Campo>

      <Campo etiqueta="Objetivo (elige al menos uno)" requerido>
        <SelectorObjetivos
          catalogo={catalogoObjetivos}
          locales={objetivosNuevos}
          seleccion={objetivos}
          onCambiar={setObjetivos}
          onAgregado={(o) => setObjetivosNuevos((x) => (x.some((y) => y.id === o.id) || catalogoObjetivos.some((y) => y.id === o.id) ? x : [...x, o]))}
        />
      </Campo>

      <Campo etiqueta="Productos" requerido>
        {grupo.length > 0 && <p className="mb-2 text-xs text-slate-500">Vienen las cantidades del plan. Corrige lo que cambió y deja vacío lo que no se aplicó.</p>}
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
            return (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                <span data-ingrediente-activo>
                  Ingrediente activo: <strong>{textoDato(t?.ingrediente_activo)}</strong>
                </span>
                {dosis !== null && (
                  <span data-dosis-mz>
                    Dosis: <strong>{cantidad(dosis)}</strong> {t?.unidad ?? ''}/mz
                  </span>
                )}
                {grupo.length > 0 && !plan.has(l.material_id) && <span className="font-semibold text-amber-700">fuera del plan</span>}
                <button type="button" onClick={() => setFicha(l.material_id)} className="min-h-11 rounded-lg px-2 font-semibold text-brand-700 underline" data-abrir-ficha>
                  Ver ficha
                </button>
              </div>
            )
          }}
        />
      </Campo>

      <Campo etiqueta="Observaciones">
        <AreaTexto value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} placeholder="Opcional" data-comentario />
      </Campo>
    </MarcoRegistro>
  )
}
