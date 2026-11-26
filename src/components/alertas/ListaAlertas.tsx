'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Alerta, AreaTexto, Boton, EstadoVacio, Entrada, Insignia, ListaEsqueleto, type Tono } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { AvisoFlotante, useAvisoFlotante } from '@/components/ui/AvisoFlotante'
import { GRAVEDADES, TIPOS_ALERTA, haceCuanto, nombreTipo, urlDeAlerta, type DestinoAlerta } from '@/lib/alertas/destinos'

type EstadoUsuario = 'nueva' | 'leida' | 'atendida'
export type AlertaFila = {
  id: string
  tipo: string
  gravedad: string
  titulo: string
  cuerpo: string
  url: string
  destino: DestinoAlerta | null
  creada_at: string
  zona: string | null
  estacion: string | null
  estado_usuario: EstadoUsuario
  nota: string | null
  atendida_por_nombre: string | null
}

const ESTADOS: { valor: EstadoUsuario; etiqueta: string }[] = [
  { valor: 'nueva', etiqueta: 'Nueva' },
  { valor: 'leida', etiqueta: 'Leída' },
  { valor: 'atendida', etiqueta: 'Atendida' },
]
const BORDE: Record<string, string> = { alta: 'border-l-red-500', media: 'border-l-amber-500', baja: 'border-l-slate-300' }
const TONO_ESTADO: Record<EstadoUsuario, Tono> = { nueva: 'rojo', leida: 'gris', atendida: 'verde' }
const INTERVALO_MIN_MS = 15_000

/** Lista de alertas que le tocan a la persona: filtros compactos, selección múltiple y «Ir al registro». */
export function ListaAlertas() {
  const supabase = useMemo(() => createClient(), [])
  const [filas, setFilas] = useState<AlertaFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filtros, setFiltros] = useState(false)
  const [fEstado, setFEstado] = useState<string[]>([])
  const [fTipo, setFTipo] = useState<string[]>([])
  const [fGrav, setFGrav] = useState<string[]>([])
  const [fEst, setFEst] = useState<string[]>([])
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [atender, setAtender] = useState(false)
  const [nota, setNota] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const { aviso, mostrar } = useAvisoFlotante()
  const ultima = useRef(0)

  const cargar = useCallback(
    async (forzar = false) => {
      if (!forzar && Date.now() - ultima.current < INTERVALO_MIN_MS) return
      ultima.current = Date.now()
      const { data, error: e } = await supabase.rpc('fn_alertas_listar', { p: { limite: 300 } })
      if (e) {
        setError('No se pudieron cargar las alertas. Revisa la señal.')
        return
      }
      setError(null)
      setFilas((data as AlertaFila[]) ?? [])
    },
    [supabase]
  )

  // bucle-ok: una carga al abrir y otra al volver a la pestaña, con mínimo de 15 s entre consultas
  useEffect(() => {
    const t = setTimeout(() => void cargar(true), 0) // bucle-ok: una carga al abrir; el foco tiene mínimo de 15 s
    const alVolver = () => document.visibilityState === 'visible' && void cargar()
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [cargar])

  const estaciones = useMemo(
    () => [...new Set((filas ?? []).map((f) => f.estacion).filter((x): x is string => Boolean(x)))].sort().map((x) => ({ valor: x, etiqueta: x })),
    [filas]
  )

  const visibles = useMemo(
    () =>
      (filas ?? []).filter((f) => {
        const dia = f.creada_at.slice(0, 10)
        return (
          (fEstado.length === 0 || fEstado.includes(f.estado_usuario)) &&
          (fTipo.length === 0 || fTipo.includes(f.tipo)) &&
          (fGrav.length === 0 || fGrav.includes(f.gravedad)) &&
          (fEst.length === 0 || (f.estacion != null && fEst.includes(f.estacion))) &&
          (!desde || dia >= desde) &&
          (!hasta || dia <= hasta)
        )
      }),
    [filas, fEstado, fTipo, fGrav, fEst, desde, hasta]
  )
  const activos = [fEstado, fTipo, fGrav, fEst].filter((x) => x.length).length + (desde ? 1 : 0) + (hasta ? 1 : 0)
  const ids = [...sel].filter((id) => visibles.some((v) => v.id === id))

  async function marcar(lista: string[], accion: 'leida' | 'atendida', texto?: string) {
    if (lista.length === 0 || ocupado) return
    setOcupado(true)
    const { error: e } = await supabase.rpc('fn_alertas_marcar', { p_ids: lista, p_accion: accion, p_nota: texto ?? null })
    setOcupado(false)
    if (e) return mostrar('No se pudo guardar. Intenta de nuevo.', 'error')
    setSel(new Set())
    setAtender(false)
    setNota('')
    mostrar(accion === 'leida' ? 'Marcadas como leídas.' : 'Atendidas.')
    await cargar(true)
  }

  if (filas === null && !error) return <ListaEsqueleto filas={4} />

  return (
    <div className="flex flex-col gap-3" data-lista-alertas>
      {error && <Alerta tono="ambar">{error}</Alerta>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Boton variante="secundario" tamano="sm" className="min-h-11" onClick={() => setFiltros((v) => !v)} aria-expanded={filtros} data-filtros-alternar>
          Filtros{activos > 0 ? ` · ${activos}` : ''}
        </Boton>
        <Boton variante="fantasma" tamano="sm" className="min-h-11" onClick={() => void cargar(true)}>
          Actualizar
        </Boton>
      </div>

      {filtros && (
        <div className="grid grid-cols-1 gap-2 rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200 sm:grid-cols-2" data-filtros>
          <SelectorMultiple etiqueta="Estado" opciones={ESTADOS.map((e) => ({ valor: e.valor, etiqueta: e.etiqueta }))} valores={fEstado} onCambiar={setFEstado} />
          <SelectorMultiple etiqueta="Tipo" opciones={TIPOS_ALERTA.map((t) => ({ valor: t.id, etiqueta: t.nombre }))} valores={fTipo} onCambiar={setFTipo} />
          <SelectorMultiple etiqueta="Gravedad" opciones={GRAVEDADES.map((g) => ({ valor: g.id, etiqueta: g.nombre }))} valores={fGrav} onCambiar={setFGrav} />
          <SelectorMultiple etiqueta="Estación" opciones={estaciones} valores={fEst} onCambiar={setFEst} />
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Desde
            <Entrada type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Hasta
            <Entrada type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
          {activos > 0 && (
            <Boton
              variante="fantasma"
              tamano="sm"
              className="min-h-11 sm:col-span-2"
              onClick={() => {
                setFEstado([])
                setFTipo([])
                setFGrav([])
                setFEst([])
                setDesde('')
                setHasta('')
              }}
            >
              Quitar filtros
            </Boton>
          )}
        </div>
      )}

      {ids.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-white p-2 shadow-[var(--shadow-card)] ring-1 ring-inset ring-slate-200" data-barra-lote>
          <span className="px-1 text-sm font-semibold text-slate-700">{ids.length} elegidas</span>
          <Boton tamano="sm" variante="secundario" className="min-h-11" disabled={ocupado} onClick={() => void marcar(ids, 'leida')}>
            Marcar leídas
          </Boton>
          <Boton tamano="sm" className="min-h-11" disabled={ocupado} onClick={() => setAtender(true)}>
            Atender
          </Boton>
          <Boton tamano="sm" variante="fantasma" className="min-h-11" onClick={() => setSel(new Set())}>
            Quitar selección
          </Boton>
        </div>
      )}

      {visibles.length === 0 ? (
        <EstadoVacio titulo={activos > 0 ? 'Nada con esos filtros' : 'Sin alertas'} descripcion={activos > 0 ? 'Quita algún filtro.' : 'Aquí caen los avisos de Campo.'} />
      ) : (
        <ul className="flex flex-col gap-2">
          {visibles.length > 1 && (
            <li className="px-1">
              <label className="flex min-h-11 items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={ids.length === visibles.length}
                  onChange={(e) => setSel(e.target.checked ? new Set(visibles.map((v) => v.id)) : new Set())}
                />
                Elegir todas
              </label>
            </li>
          )}
          {visibles.map((f) => (
            <li
              key={f.id}
              data-alerta={f.id}
              data-estado={f.estado_usuario}
              className={`flex gap-2 rounded-xl border-l-4 bg-white p-3 ring-1 ring-inset ring-slate-200 ${BORDE[f.gravedad] ?? BORDE.baja} ${f.estado_usuario === 'nueva' ? 'shadow-[var(--shadow-card)]' : 'opacity-80'}`}
            >
              <label className="flex min-h-11 shrink-0 items-start pt-1">
                <input
                  type="checkbox" // ui-ok: selección múltiple para atender en lote (pedido del usuario)
                  className="h-5 w-5"
                  aria-label={`Elegir: ${f.titulo}`}
                  checked={sel.has(f.id)}
                  onChange={(e) =>
                    setSel((s) => {
                      const n = new Set(s)
                      if (e.target.checked) n.add(f.id)
                      else n.delete(f.id)
                      return n
                    })
                  }
                />
              </label>
              <div className="min-w-0 flex-1">
                <p className={`text-sm leading-snug text-slate-900 ${f.estado_usuario === 'nueva' ? 'font-bold' : 'font-semibold'}`}>{f.titulo}</p>
                {f.cuerpo && <p className="mt-0.5 text-sm text-slate-600">{f.cuerpo}</p>}
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <Insignia tono={TONO_ESTADO[f.estado_usuario]}>{ESTADOS.find((e) => e.valor === f.estado_usuario)?.etiqueta}</Insignia>
                  <span>{nombreTipo(f.tipo)}</span>
                  {(f.estacion || f.zona) && <span>· {f.estacion ?? f.zona}</span>}
                  <span>· {haceCuanto(f.creada_at)}</span>
                </p>
                {f.estado_usuario === 'atendida' && (f.nota || f.atendida_por_nombre) && (
                  <p className="mt-1 text-xs text-slate-500">
                    {f.atendida_por_nombre ? `${f.atendida_por_nombre}: ` : ''}
                    {f.nota ?? ''}
                  </p>
                )}
              </div>
              <Link
                href={urlDeAlerta(f)}
                onClick={() => f.estado_usuario === 'nueva' && void supabase.rpc('fn_alertas_marcar', { p_ids: [f.id], p_accion: 'leida', p_nota: null })}
                data-ir-registro
                className="inline-flex min-h-11 shrink-0 items-center self-start rounded-xl bg-brand-50 px-3 text-sm font-bold text-brand-800 hover:bg-brand-100"
              >
                Ir al registro
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Modal
        abierto={atender}
        onCerrar={() => setAtender(false)}
        titulo="Atender alertas"
        pie={
          <div className="flex w-full justify-end gap-2">
            <Boton variante="fantasma" onClick={() => setAtender(false)}>
              Cancelar
            </Boton>
            <Boton disabled={ocupado} onClick={() => void marcar(ids, 'atendida', nota)} data-confirmar-atender>
              Guardar
            </Boton>
          </div>
        }
      >
        <p className="mb-2 text-sm text-slate-600">{ids.length} alertas. Queda quién y cuándo.</p>
        <AreaTexto value={nota} maxLength={200} rows={3} placeholder="Nota corta (opcional)" onChange={(e) => setNota(e.target.value)} />
      </Modal>
      <AvisoFlotante aviso={aviso} />
    </div>
  )
}
