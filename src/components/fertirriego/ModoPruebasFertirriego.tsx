'use client'

/**
 * Modo de pruebas de Fertirriego (migración 98). Pedido del usuario (2026-11-12): probar en producción con algunos
 * usuarios sin ensuciar los registros reales.
 *   - Activar: elige estaciones reales y participantes; se crean «PRUEBA · <estación>» y los participantes trabajan
 *     solo ahí (los demás siguen normal). AGL no ve nada de prueba.
 *   - Desactivar sin borrar: se conserva 30 días; si no se reactiva, se borra solo.
 *   - Borrar ya: se va todo lo de prueba.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { mensajeDeError } from '@/lib/errores'
import { ListaCasillasBuscable } from '@/components/admin/ListaCasillasBuscable'

type Estado = {
  activo: boolean
  activado_en: string | null
  desactivado_en: string | null
  se_borra_el: string | null
  participantes: { id: string; nombre: string }[]
  estaciones: { id: string; nombre: string; real_id: string; real: string }[]
  movimientos: number
  registros: number
}

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'medium', timeStyle: 'short' }) : '—'

export function ModoPruebasFertirriego({
  estaciones,
  personas,
  sinMigracion,
}: {
  estaciones: { id: string; nombre: string }[]
  personas: { id: string; nombre: string }[]
  sinMigracion: boolean
}) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [elegidasEst, setElegidasEst] = useState<string[]>([])
  const [elegidasPer, setElegidasPer] = useState<string[]>([])
  const [trabajando, setTrabajando] = useState(false)
  const [confirmarBorrar, setConfirmarBorrar] = useState(false)

  async function llamar(fn: string, args?: Record<string, unknown>) {
    setTrabajando(true)
    setError(null)
    const { data, error: e } = await createClient().rpc(fn, args ?? {})
    setTrabajando(false)
    if (e) {
      setError(mensajeDeError(e, 'No se pudo.'))
      return null
    }
    return data
  }

  async function cargar() {
    const e = (await llamar('fn_fert_pruebas_estado')) as Estado | null
    if (!e) return
    setEstado(e)
    setElegidasEst(e.estaciones.map((x) => x.real_id))
    setElegidasPer(e.participantes.map((x) => x.id))
  }

  useEffect(() => {
    if (sinMigracion) return
    let vivo = true
    createClient()
      .rpc('fn_fert_pruebas_estado')
      .then(({ data, error: e }) => {
        if (!vivo) return
        if (e) return setError(mensajeDeError(e, 'No se pudo leer el modo de pruebas.'))
        const est = data as Estado
        setEstado(est)
        setElegidasEst(est.estaciones.map((x) => x.real_id))
        setElegidasPer(est.participantes.map((x) => x.id))
      })
    return () => {
      vivo = false
    }
  }, [sinMigracion])

  if (sinMigracion) return <Alerta>Falta correr la migración 98 (modo de pruebas) en esta base.</Alerta>
  if (!estado) return error ? <Alerta>{error}</Alerta> : <p className="text-sm text-slate-400">Cargando…</p>

  const hayDatos = estado.estaciones.length > 0

  return (
    <div className="flex flex-col gap-4" data-modo-pruebas>
      <Tarjeta className="flex flex-col gap-2 p-4" data-estado-pruebas={estado.activo ? 'activo' : 'inactivo'}>
        <div className="flex flex-wrap items-center gap-2">
          {estado.activo ? (
            <Insignia tono="ambar" punto>
              Modo de pruebas ACTIVO
            </Insignia>
          ) : (
            <Insignia tono="gris" punto>
              Modo de pruebas apagado
            </Insignia>
          )}
          {estado.activo && <span className="text-xs text-slate-500">desde {fecha(estado.activado_en)}</span>}
        </div>
        <p className="text-sm text-slate-600">
          {hayDatos
            ? `Lo de prueba: ${estado.estaciones.length} estación(es), ${estado.registros} registro(s), ${estado.movimientos} movimiento(s) de bodega.`
            : 'No hay nada de prueba guardado.'}
        </p>
        {!estado.activo && estado.se_borra_el && (
          <p className="text-sm font-semibold text-amber-800" data-se-borra>
            Apagado sin borrar: si no lo reactivas, se borra solo el {fecha(estado.se_borra_el)}.
          </p>
        )}
      </Tarjeta>

      <Tarjeta className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-bold text-slate-800">1 · Estaciones donde se prueba</h2>
        <p className="text-xs text-slate-500">
          Por cada una se crea «PRUEBA · nombre», con los mismos turnos y plan, pero bodega, encargado, relevos y
          traslados propios.
        </p>
        <ListaCasillasBuscable
          nombre="estaciones-prueba"
          opciones={estaciones.map((e) => ({ valor: e.id, etiqueta: e.nombre }))}
          marcados={elegidasEst}
          onCambiar={setElegidasEst}
          vacio="No hay estaciones."
        />
        <h2 className="mt-2 text-sm font-bold text-slate-800">2 · Participantes</h2>
        <p className="text-xs text-slate-500">
          Mientras el modo esté activo, ellos SOLO registran en las estaciones de prueba. Los demás siguen normal y no
          ven nada de prueba.
        </p>
        <ListaCasillasBuscable
          nombre="participantes-prueba"
          opciones={personas.map((p) => ({ valor: p.id, etiqueta: p.nombre }))}
          marcados={elegidasPer}
          onCambiar={setElegidasPer}
          vacio="No hay personas activas."
        />
        <div className="flex flex-wrap gap-2">
          <Boton
            onClick={async () => {
              const e = (await llamar('fn_fert_pruebas_activar', { p_estaciones: elegidasEst, p_participantes: elegidasPer })) as Estado | null
              if (e) {
                setEstado(e)
                setAviso('Modo de pruebas activo. Los participantes deben tocar «Actualizar» en Fertirriego (con señal).')
              }
            }}
            disabled={trabajando}
            data-activar-pruebas
          >
            {estado.activo ? 'Guardar cambios' : 'Activar modo de pruebas'}
          </Boton>
          {estado.activo && (
            <Boton
              variante="secundario"
              onClick={async () => {
                const e = (await llamar('fn_fert_pruebas_desactivar')) as Estado | null
                if (e) {
                  setEstado(e)
                  setAviso('Apagado sin borrar. Lo de prueba se conserva 30 días.')
                }
              }}
              disabled={trabajando}
              data-desactivar-pruebas
            >
              Apagar (sin borrar)
            </Boton>
          )}
        </div>
      </Tarjeta>

      {hayDatos && (
        <Tarjeta className="flex flex-col gap-2 p-4">
          <h2 className="text-sm font-bold text-red-700">Borrar lo de prueba</h2>
          <p className="text-xs text-slate-500">
            Borra ya las estaciones «PRUEBA» con todo lo registrado en ellas y apaga el modo. No toca nada real. No se
            puede deshacer.
          </p>
          {confirmarBorrar ? (
            <div className="flex flex-wrap gap-2">
              <Boton
                variante="peligro"
                onClick={async () => {
                  const r = (await llamar('fn_fert_pruebas_borrar')) as { estaciones: number; movimientos: number; registros: number } | null
                  setConfirmarBorrar(false)
                  if (r) {
                    setAviso(`Borrado: ${r.estaciones} estación(es), ${r.registros} registro(s) y ${r.movimientos} movimiento(s) de prueba.`)
                    await cargar()
                  }
                }}
                disabled={trabajando}
                data-confirmar-borrar-pruebas
              >
                Sí, borrar todo lo de prueba
              </Boton>
              <Boton variante="secundario" onClick={() => setConfirmarBorrar(false)}>
                Cancelar
              </Boton>
            </div>
          ) : (
            <Boton variante="secundario" onClick={() => setConfirmarBorrar(true)} className="w-fit" data-borrar-pruebas>
              Borrar lo de prueba…
            </Boton>
          )}
        </Tarjeta>
      )}

      {aviso && <Alerta tono="azul">{aviso}</Alerta>}
      {error && <Alerta>{error}</Alerta>}
    </div>
  )
}
