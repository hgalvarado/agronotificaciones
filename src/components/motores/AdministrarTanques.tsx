'use client'

/**
 * Administración de tanques (solo con «Configurar»; necesita señal): crear o editar un tanque (nombre, zona, capacidad, activo) y
 * asignarlo a una estación (sql/147: fn_mot_tanque_guardar / fn_mot_tanque_asignar / fn_mot_tanques_listar). El nombre es único
 * (la base lo comprueba, sin importar mayúsculas). Un tanque con diésel o con motor no se desactiva ni cambia de estación.
 */

import { useMemo, useState } from 'react'
import { Alerta, Boton, Campo } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { mensajeDeError } from '@/lib/errores'
import { cantidad } from '@/lib/fertirriego/calculos'
import type { Estacion } from '@/lib/fertirriego/tipos'
import { createClient } from '@/lib/supabase/client'
import { useLlamadaRpc } from '@/lib/motores/useLlamadaRpc'
import { semaforoTanque } from '@/lib/motores/senales'
import { EstadoConsulta, FilaToque } from './ElementosMotor'

type FilaTanque = {
  id: string
  nombre: string
  zona_id: string | null
  zona: string | null
  estacion_id: string | null
  estacion: string | null
  capacidad_gal: number | null
  activo: boolean
  motor_equipo_id: string | null
  motor: string | null
  saldo_gal: number
}

type Edicion = { id: string | null; nombre: string; zonaId: string; capacidad: string; estacionId: string; activo: boolean; estacionAntes: string }

export function AdministrarTanques({ estaciones, onCambio, onCerrar }: { estaciones: Estacion[]; onCambio: () => void; onCerrar: () => void }) {
  const { datos, cargando, error, recargar } = useLlamadaRpc<FilaTanque[]>('fn_mot_tanques_listar', undefined)
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const zonas = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of estaciones) if (e.zona_id && e.zona) m.set(e.zona_id, e.zona)
    for (const t of datos ?? []) if (t.zona_id && t.zona) m.set(t.zona_id, t.zona)
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
  }, [estaciones, datos])

  const lista = datos ?? []
  const abrir = (t: FilaTanque | null) => {
    setFallo(null)
    setEdicion(
      t
        ? { id: t.id, nombre: t.nombre, zonaId: t.zona_id ?? '', capacidad: t.capacidad_gal ? String(t.capacidad_gal) : '', estacionId: t.estacion_id ?? '', activo: t.activo, estacionAntes: t.estacion_id ?? '' }
        : { id: null, nombre: '', zonaId: '', capacidad: '', estacionId: '', activo: true, estacionAntes: '' }
    )
  }

  async function guardar() {
    if (!edicion) return
    setFallo(null)
    if (!edicion.nombre.trim()) return setFallo('Escribe el nombre del tanque.')
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return setFallo('Necesitas señal para guardar.')
    setGuardando(true)
    try {
      const supabase = createClient()
      const { data, error: e } = await supabase.rpc('fn_mot_tanque_guardar', {
        p: { id: edicion.id ?? undefined, nombre: edicion.nombre.trim(), zona_id: edicion.zonaId || undefined, capacidad_gal: edicion.capacidad.trim() ? edicion.capacidad.replace(',', '.') : undefined, activo: edicion.activo },
      })
      if (e) throw new Error(e.message)
      const id = (data as { id: string }).id
      if (edicion.estacionId !== edicion.estacionAntes) {
        const { error: e2 } = await supabase.rpc('fn_mot_tanque_asignar', { p_tanque: id, p_estacion: edicion.estacionId || null, p_motivo: null })
        if (e2) throw new Error(`Se guardó el tanque, pero no se pudo asignar: ${e2.message}`)
      }
      setEdicion(null)
      setMensaje('Tanque guardado.')
      recargar()
      onCambio()
    } catch (e) {
      setFallo(mensajeDeError(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal abierto titulo={edicion ? (edicion.id ? 'Editar tanque' : 'Nuevo tanque') : 'Administrar tanques'} onCerrar={edicion ? () => setEdicion(null) : onCerrar}>
      {edicion ? (
        <div className="flex flex-col gap-3" data-editar-tanque>
          {fallo && <Alerta>{fallo}</Alerta>}
          <Campo etiqueta="Nombre" requerido>
            <input
              value={edicion.nombre}
              onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })}
              aria-label="Nombre del tanque"
              data-tanque-nombre
              className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base focus:border-brand-600 focus:outline-none"
            />
          </Campo>
          <Campo etiqueta="Capacidad (gal)">
            <input
              inputMode="decimal"
              value={edicion.capacidad}
              onChange={(e) => setEdicion({ ...edicion, capacidad: e.target.value.replace(/[^\d.,]/g, '') })}
              aria-label="Capacidad en galones"
              data-tanque-capacidad
              className="min-h-11 w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base tabular-nums focus:border-brand-600 focus:outline-none"
            />
          </Campo>
          <Campo etiqueta="Zona">
            <SelectorBuscable
              valor={edicion.zonaId}
              opciones={zonas.map((z) => ({ id: z.id, titulo: z.nombre }))}
              onCambiar={(v) => setEdicion({ ...edicion, zonaId: v })}
              placeholder="Elegir zona…"
              etiquetaBusqueda="Buscar zona"
              textoVacio="Sin zona"
            />
          </Campo>
          <Campo etiqueta="Estación asignada">
            <SelectorBuscable
              valor={edicion.estacionId}
              opciones={estaciones.map((e) => ({ id: e.id, titulo: e.nombre, subtitulo: e.zona ?? undefined }))}
              onCambiar={(v) => setEdicion({ ...edicion, estacionId: v })}
              placeholder="Elegir estación…"
              etiquetaBusqueda="Buscar estación"
              textoVacio="Sin estación"
            />
          </Campo>
          <label className="flex min-h-11 items-center gap-3 text-sm text-slate-800">
            <input type="checkbox" checked={edicion.activo} onChange={(e) => setEdicion({ ...edicion, activo: e.target.checked })} className="h-6 w-6" data-tanque-activo />
            Activo
          </label>
          <div className="flex flex-wrap gap-2">
            <Boton className="min-h-12 flex-1" onClick={() => void guardar()} disabled={guardando} data-guardar-tanque>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Boton>
            <Boton variante="fantasma" className="min-h-12" onClick={() => setEdicion(null)}>
              Regresar
            </Boton>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2" data-administrar-tanques-vista>
          {mensaje && <p role="status" className="rounded-xl bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800">{mensaje}</p>}
          <Boton className="min-h-14 w-full text-base" onClick={() => abrir(null)} data-nuevo-tanque>
            Nuevo tanque
          </Boton>
          <EstadoConsulta cargando={cargando} error={error} vacio={lista.length === 0} textoVacio="Todavía no hay tanques." />
          {lista.map((t) => {
            const sem = semaforoTanque(t.saldo_gal, t.capacidad_gal)
            return (
              <FilaToque
                key={t.id}
                atributos={{ 'data-tanque-admin': t.nombre }}
                nivel={t.activo ? sem.nivel : 'gris'}
                titulo={<span className={t.activo ? '' : 'opacity-60'}>{t.nombre}</span>}
                derecha={<span>{cantidad(t.saldo_gal)} <span className="text-[11px] font-normal text-slate-500">gal</span></span>}
                linea2={`${t.estacion ?? 'Sin estación'}${t.zona ? ` · ${t.zona}` : ''}`}
                linea3={`${t.capacidad_gal ? `Capacidad ${cantidad(t.capacidad_gal)} gal` : 'Sin capacidad'}${t.motor ? ` · motor ${t.motor}` : ''}${t.activo ? '' : ' · inactivo'}`}
                onToque={() => abrir(t)}
              />
            )
          })}
          <Boton variante="fantasma" className="min-h-11" onClick={onCerrar}>
            Regresar
          </Boton>
        </div>
      )}
    </Modal>
  )
}
