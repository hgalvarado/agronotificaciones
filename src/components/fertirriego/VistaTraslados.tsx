'use client'

/**
 * Traslados: lo que toca autorizar, lo que viene en camino a esta estación, lo enviado y el historial.
 */

import { Boton, Insignia } from '@/components/ui/Primitivos'
import { formatearFechaHora } from '@/lib/estados'
import { cantidad } from '@/lib/fertirriego/calculos'
import type { EstadoCampo, Estacion, Operacion, Persona, Traslado } from '@/lib/fertirriego/tipos'
import type { AccionTraslado } from './ResolverTraslado'

const NOMBRE: Record<Traslado['estado'], string> = {
  POR_AUTORIZAR: 'Por autorizar',
  EN_TRANSITO: 'En camino',
  ACEPTADO: 'Recibido',
  RECHAZADO: 'Rechazado (volvió)',
  ANULADO: 'Cancelado / no autorizado',
}

export function VistaTraslados({
  estado,
  cola,
  estacion,
  yo,
  puedeRegistrar,
  onNuevo,
  onAccion,
}: {
  estado: EstadoCampo
  cola: Operacion[]
  estacion: Estacion
  yo: Persona
  puedeRegistrar: boolean
  onNuevo: () => void
  onAccion: (t: Traslado, a: AccionTraslado) => void
}) {
  const todos = estado.traslados ?? []
  const pendientesLocales = cola.filter((o) => o.estado_local === 'PENDIENTE' && o.tipo.startsWith('traslado_'))
  const enCola = new Set(pendientesLocales.map((o) => String(o.datos.traslado_id ?? '')))
  const material = (id: string) => estado.materiales.find((m) => m.id === id)

  const porAutorizar = todos.filter((t) => t.estado === 'POR_AUTORIZAR' && t.creado_por !== yo.id && (t.autorizador_id === yo.id || (t.origen_id === estacion.id && estacion.permisos.autorizar_traslado)))
  const llegando = todos.filter((t) => t.estado === 'EN_TRANSITO' && t.destino_id === estacion.id)
  const resto = todos.filter((t) => !porAutorizar.includes(t) && !llegando.includes(t) && (t.origen_id === estacion.id || t.destino_id === estacion.id))

  const tarjeta = (t: Traslado, acciones: { a: AccionTraslado; texto: string; tono?: string }[]) => (
    <div key={t.id} className="rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200" data-traslado={t.estado}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-800">
          {t.origen} → {t.destino}
        </p>
        <Insignia tono={t.estado === 'ACEPTADO' ? 'verde' : t.estado === 'EN_TRANSITO' || t.estado === 'POR_AUTORIZAR' ? 'ambar' : 'gris'}>{NOMBRE[t.estado]}</Insignia>
      </div>
      <p className="text-xs text-slate-600">{t.motivo}</p>
      <ul className="mt-1 text-xs text-slate-700">
        {(t.lineas ?? []).map((l) => (
          <li key={l.material_id}>
            {material(l.material_id)?.descripcion ?? 'Producto'}: {cantidad(l.cantidad_enviada)}
            {l.cantidad_recibida !== null && l.cantidad_recibida !== undefined ? ` · llegó ${cantidad(l.cantidad_recibida)}` : ''}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-slate-500">
        {formatearFechaHora(t.creado_at)} · pidió {t.creador ?? '—'} · autoriza {t.autorizador ?? '—'}
        {t.nota_autorizacion ? ` · «${t.nota_autorizacion}»` : ''}
        {t.nota_resolucion ? ` · «${t.nota_resolucion}»` : ''}
      </p>
      {enCola.has(t.id) ? (
        <p className="mt-1 text-xs font-semibold text-amber-800">Tu respuesta está guardada en el teléfono, por enviar.</p>
      ) : (
        acciones.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-3">
            {acciones.map((x) => (
              <button key={x.a} type="button" onClick={() => onAccion(t, x.a)} className={`text-xs font-bold underline ${x.tono ?? 'text-brand-700'}`} data-accion-traslado={x.a}>
                {x.texto}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {estacion.permisos.trasladar && (
        <Boton onClick={onNuevo} disabled={!puedeRegistrar} className="self-start" data-nuevo-traslado>
          Nuevo traslado
        </Boton>
      )}
      {pendientesLocales.filter((o) => o.tipo === 'traslado_crear').map((o) => (
        <div key={o.id} className="rounded-xl bg-amber-50 p-3 text-sm ring-1 ring-inset ring-amber-200">
          <p className="font-semibold text-amber-800">{o.resumen}</p>
          <p className="text-xs text-slate-500">Guardado en el teléfono, por enviar.</p>
        </div>
      ))}
      {porAutorizar.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Te toca autorizar</p>
          <div className="flex flex-col gap-2" data-por-autorizar>
            {porAutorizar.map((t) => tarjeta(t, [{ a: 'autorizar', texto: 'Autorizar' }, { a: 'no_autorizar', texto: 'No autorizar', tono: 'text-red-700' }]))}
          </div>
        </div>
      )}
      {llegando.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Viene en camino a esta estación</p>
          <div className="flex flex-col gap-2" data-llegando>
            {llegando.map((t) => tarjeta(t, estacion.permisos.trasladar ? [{ a: 'aceptar', texto: 'Recibir' }, { a: 'rechazar', texto: 'Rechazar', tono: 'text-red-700' }] : []))}
          </div>
        </div>
      )}
      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Historial</p>
        {resto.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">Sin traslados.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {resto.map((t) => tarjeta(t, t.estado === 'POR_AUTORIZAR' && t.creado_por === yo.id ? [{ a: 'cancelar', texto: 'Cancelar', tono: 'text-red-700' }] : []))}
          </div>
        )}
      </div>
    </div>
  )
}
