'use client'

/**
 * Administración › Choferes y catálogos de campo (sql/99). Pedido del usuario tras la prueba piloto: «no sé dónde
 * puedo modificar los choferes ni los camiones». Lo que se crea en el campo sin señal queda «por validar»; aquí
 * quien tiene «Gestionar choferes» lo corrige, lo valida, lo quita de las listas o une dos repetidos.
 * También los tipos de envase y los productos de campo (los que no están en MARA).
 * Las correcciones viajan por fn_fert_sincronizar (las mismas reglas que el campo); unir usa fn_fert_unir_*.
 */

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Entrada, Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { mensajeDeError } from '@/lib/errores'
import { crearOperacion } from '@/lib/fertirriego/operaciones'

type Chofer = { id: string; nombre: string; identidad: string | null; telefono: string | null; validado: boolean; activo: boolean; recepciones: number; ultima_vez: string | null }
type Vehiculo = { id: string; placa: string; tipo: string | null; marca: string | null; color: string | null; validado: boolean; activo: boolean; recepciones: number; ultima_vez: string | null }
type Envase = { id: string; nombre: string; validado: boolean; activo: boolean; usos: number }
type Producto = { id: string; codigo: string; descripcion: string | null; unidad: string | null; grupo: string | null; validado: boolean; activo: boolean; movimientos: number; saldo: number }
type Catalogos = { choferes: Chofer[]; vehiculos: Vehiculo[]; envases: Envase[]; productos: Producto[]; clases: string[] }

type Pestana = 'choferes' | 'vehiculos' | 'envases' | 'productos'
const PESTANAS: { id: Pestana; nombre: string }[] = [
  { id: 'choferes', nombre: 'Choferes' },
  { id: 'vehiculos', nombre: 'Vehículos' },
  { id: 'envases', nombre: 'Envases' },
  { id: 'productos', nombre: 'Productos de campo' },
]

/** Un campo editable de la fila. */
type CampoEdit = { key: string; label: string; requerido?: boolean }
const CAMPOS: Record<Pestana, CampoEdit[]> = {
  choferes: [
    { key: 'nombre', label: 'Nombre', requerido: true },
    { key: 'identidad', label: 'Identidad' },
    { key: 'telefono', label: 'Teléfono' },
  ],
  vehiculos: [
    { key: 'placa', label: 'Placa', requerido: true },
    { key: 'tipo', label: 'Tipo' },
    { key: 'marca', label: 'Marca' },
    { key: 'color', label: 'Color' },
  ],
  envases: [{ key: 'nombre', label: 'Nombre', requerido: true }],
  productos: [
    { key: 'descripcion', label: 'Nombre', requerido: true },
    { key: 'unidad', label: 'Unidad' },
    { key: 'grupo', label: 'Clase' },
  ],
}
const TIPO_OP = { choferes: 'chofer', vehiculos: 'vehiculo', envases: 'envase_tipo', productos: 'producto' } as const
const LLAVE_ID = { choferes: 'chofer_id', vehiculos: 'vehiculo_id', envases: 'envase_id', productos: 'material_id' } as const
const UNIR = { choferes: 'fn_fert_unir_chofer', vehiculos: 'fn_fert_unir_vehiculo', envases: 'fn_fert_unir_envase' } as const

type Fila = { id: string; titulo: string; detalle: string; validado: boolean; activo: boolean; valores: Record<string, string> }

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'medium' }) : 'nunca'

function filas(c: Catalogos, p: Pestana): Fila[] {
  switch (p) {
    case 'choferes':
      return c.choferes.map((x) => ({
        id: x.id,
        titulo: x.nombre,
        detalle: [x.telefono, `${x.recepciones} entrega(s)`, `última: ${fecha(x.ultima_vez)}`].filter(Boolean).join(' · '),
        validado: x.validado,
        activo: x.activo,
        valores: { nombre: x.nombre, identidad: x.identidad ?? '', telefono: x.telefono ?? '' },
      }))
    case 'vehiculos':
      return c.vehiculos.map((x) => ({
        id: x.id,
        titulo: x.placa,
        detalle: [x.tipo, x.marca, x.color, `${x.recepciones} entrega(s)`, `última: ${fecha(x.ultima_vez)}`].filter(Boolean).join(' · '),
        validado: x.validado,
        activo: x.activo,
        valores: { placa: x.placa, tipo: x.tipo ?? '', marca: x.marca ?? '', color: x.color ?? '' },
      }))
    case 'envases':
      return c.envases.map((x) => ({
        id: x.id,
        titulo: x.nombre,
        detalle: `${x.usos} movimiento(s)`,
        validado: x.validado,
        activo: x.activo,
        valores: { nombre: x.nombre },
      }))
    case 'productos':
      return c.productos.map((x) => ({
        id: x.id,
        titulo: x.descripcion ?? x.codigo,
        detalle: [x.grupo, x.unidad, x.codigo, `${x.movimientos} movimiento(s)`, x.saldo ? `saldo ${x.saldo}` : null].filter(Boolean).join(' · '),
        validado: x.validado,
        activo: x.activo,
        valores: { descripcion: x.descripcion ?? '', unidad: x.unidad ?? '', grupo: x.grupo ?? '' },
      }))
  }
}

export function CatalogosCampo() {
  const [datos, setDatos] = useState<Catalogos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pestana, setPestana] = useState<Pestana>('choferes')
  const [buscar, setBuscar] = useState('')
  const [soloPorValidar, setSoloPorValidar] = useState(false)
  const [verInactivos, setVerInactivos] = useState(false)
  const [editando, setEditando] = useState<{ id: string; valores: Record<string, string> } | null>(null)
  const [uniendo, setUniendo] = useState<{ id: string; dejar: string } | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  async function cargar() {
    const { data, error: e } = await createClient().rpc('fn_fert_catalogos_campo')
    if (e) return setError(mensajeDeError(e, 'No se pudieron leer los catálogos de campo.'))
    setError(null)
    setDatos(data as Catalogos)
  }

  useEffect(() => {
    let vivo = true
    createClient()
      .rpc('fn_fert_catalogos_campo')
      .then(({ data, error: e }) => {
        if (!vivo) return
        if (e) return setError(mensajeDeError(e, 'No se pudieron leer los catálogos de campo. ¿Falta correr la migración 99?'))
        setDatos(data as Catalogos)
      })
    return () => {
      vivo = false
    }
  }, [])

  /** Manda una corrección por la misma vía que el campo y vuelve a leer. */
  async function guardar(id: string, cambios: Record<string, unknown>, mensaje: string) {
    setTrabajando(true)
    setAviso(null)
    setError(null)
    const op = crearOperacion(TIPO_OP[pestana], { [LLAVE_ID[pestana]]: id, ...cambios }, { ubicacion: null, resumen: mensaje })
    const { estado_local: _e, intentos: _i, resumen: _r, ...sobre } = op
    const { data, error: e } = await createClient().rpc('fn_fert_sincronizar', {
      p_ops: [{ ...sobre, enviado_en: op.creado_en, inmediato: true }],
    })
    setTrabajando(false)
    const r = (data as { estado: string; mensaje: string | null }[] | null)?.[0]
    if (e || !r || r.estado === 'RECHAZADO') return setError(e ? mensajeDeError(e, 'No se pudo guardar.') : (r?.mensaje ?? 'No se pudo guardar.'))
    setAviso(mensaje)
    setEditando(null)
    await cargar()
  }

  async function unir(quitar: string, dejar: string) {
    if (pestana === 'productos') return
    setTrabajando(true)
    setError(null)
    const { data, error: e } = await createClient().rpc(UNIR[pestana], { p_quitar: quitar, p_dejar: dejar })
    setTrabajando(false)
    if (e) return setError(mensajeDeError(e, 'No se pudo unir.'))
    const n = (data as { recepciones?: number; movimientos?: number }) ?? {}
    setAviso(`Unidos: ${n.recepciones ?? n.movimientos ?? 0} registro(s) pasaron al que se queda; el repetido ya no aparece en las listas.`)
    setUniendo(null)
    await cargar()
  }

  const lista = useMemo(() => {
    if (!datos) return []
    const q = buscar.trim().toLowerCase()
    return filas(datos, pestana).filter(
      (f) =>
        (verInactivos || f.activo) &&
        (!soloPorValidar || !f.validado) &&
        (!q || `${f.titulo} ${f.detalle}`.toLowerCase().includes(q))
    )
  }, [datos, pestana, buscar, soloPorValidar, verInactivos])

  if (!datos) return error ? <Alerta>{error}</Alerta> : <p className="text-sm text-slate-400">Cargando…</p>

  const porValidar = (p: Pestana) => filas(datos, p).filter((f) => f.activo && !f.validado).length
  const todas = filas(datos, pestana).filter((f) => f.activo)

  return (
    <div className="flex flex-col gap-3" data-catalogos-campo>
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={pestana === p.id}
            data-pestana-catalogo={p.id}
            onClick={() => {
              setPestana(p.id)
              setEditando(null)
              setUniendo(null)
            }}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset ${pestana === p.id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200'}`}
          >
            {p.nombre}
            {porValidar(p.id) > 0 && <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-xs text-amber-950">{porValidar(p.id)}</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Entrada value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar…" className="w-56" data-buscar-catalogo />
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={soloPorValidar} onChange={(e) => setSoloPorValidar(e.target.checked)} data-solo-por-validar />
          Solo por validar
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
          Ver quitados
        </label>
      </div>

      {pestana === 'productos' && (
        <p className="text-xs text-slate-500">
          Productos que los estacioneros agregaron porque no están en MARA (radios, herramientas…). Son solo para control de
          inventario: nunca van a MARA ni entran al análisis de fertilizantes. Los de MARA se clasifican en AGL › /FR01.
        </p>
      )}

      {aviso && <Alerta tono="azul">{aviso}</Alerta>}
      {error && <Alerta>{error}</Alerta>}

      {lista.length === 0 && <p className="text-sm text-slate-400">No hay nada que mostrar.</p>}
      {lista.map((f) => (
        <Tarjeta key={f.id} className="flex flex-col gap-2 p-3" data-fila-catalogo={f.titulo}>
          {editando?.id === f.id ? (
            <div className="flex flex-col gap-2">
              {CAMPOS[pestana].map((c) => (
                <label key={c.key} className="flex flex-col gap-0.5 text-xs font-semibold text-slate-600">
                  {c.label}
                  <Entrada
                    value={editando.valores[c.key] ?? ''}
                    onChange={(e) => setEditando({ ...editando, valores: { ...editando.valores, [c.key]: e.target.value } })}
                    list={pestana === 'productos' && c.key === 'grupo' ? 'clases-campo' : undefined}
                    data-editar-campo={c.key}
                  />
                </label>
              ))}
              <datalist id="clases-campo">
                {[...new Set(['Otros insumos', 'Otros objetos', ...datos.clases])].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <div className="flex gap-2">
                <Boton
                  disabled={trabajando}
                  data-guardar-edicion
                  onClick={() => {
                    const falta = CAMPOS[pestana].find((c) => c.requerido && !editando.valores[c.key]?.trim())
                    if (falta) return setError(`Escribe ${falta.label.toLowerCase()}.`)
                    void guardar(f.id, { ...editando.valores, validado: true }, `Guardado: ${editando.valores[CAMPOS[pestana][0].key]}.`)
                  }}
                >
                  Guardar
                </Boton>
                <Boton variante="secundario" onClick={() => setEditando(null)}>
                  Cancelar
                </Boton>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800">{f.titulo}</p>
                <p className="text-xs text-slate-500">{f.detalle}</p>
              </div>
              {!f.activo ? (
                <Insignia tono="gris">Quitado</Insignia>
              ) : f.validado ? (
                <Insignia tono="verde">Validado</Insignia>
              ) : (
                <Insignia tono="ambar">Por validar</Insignia>
              )}
            </div>
          )}

          {editando?.id !== f.id && (
            <div className="flex flex-wrap gap-2">
              <Boton variante="secundario" onClick={() => setEditando({ id: f.id, valores: f.valores })} data-editar-fila>
                Editar
              </Boton>
              {f.activo && !f.validado && (
                <Boton
                  variante="secundario"
                  disabled={trabajando}
                  data-validar-fila
                  onClick={() => void guardar(f.id, { ...f.valores, validado: true }, `Validado: ${f.titulo}.`)}
                >
                  Validar
                </Boton>
              )}
              {pestana !== 'productos' && f.activo && (
                <Boton variante="secundario" onClick={() => setUniendo({ id: f.id, dejar: '' })} data-unir-fila>
                  Es repetido de…
                </Boton>
              )}
              <Boton
                variante="secundario"
                disabled={trabajando}
                data-activo-fila
                onClick={() =>
                  void guardar(f.id, { ...f.valores, activo: !f.activo }, f.activo ? `Quitado de las listas: ${f.titulo}.` : `De vuelta en las listas: ${f.titulo}.`)
                }
              >
                {f.activo ? 'Quitar de las listas' : 'Volver a poner'}
              </Boton>
            </div>
          )}

          {uniendo?.id === f.id && (
            <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
              <p className="text-xs text-slate-600">
                Elige el que se queda. Todo lo de «{f.titulo}» pasa a ese y «{f.titulo}» ya no aparece en las listas.
              </p>
              <div data-unir-con>
                <SelectorBuscable
                  valor={uniendo.dejar}
                  opciones={todas.filter((x) => x.id !== f.id).map((x) => ({ id: x.id, titulo: x.titulo, subtitulo: x.detalle }))}
                  onCambiar={(v) => setUniendo({ id: f.id, dejar: v })}
                  placeholder="El que se queda…"
                  etiquetaBusqueda="Buscar"
                />
              </div>
              <div className="flex gap-2">
                <Boton disabled={!uniendo.dejar || trabajando} onClick={() => void unir(f.id, uniendo.dejar)} data-confirmar-unir>
                  Unir
                </Boton>
                <Boton variante="secundario" onClick={() => setUniendo(null)}>
                  Cancelar
                </Boton>
              </div>
            </div>
          )}
        </Tarjeta>
      ))}
    </div>
  )
}
