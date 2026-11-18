'use client'

/**
 * Bitácora de relevos de la estación: quién entregó a quién y cuándo, con sus novedades y las diferencias
 * (marcadas para revisar). Así nadie se perjudica entre turnos: queda escrito cómo se recibió la estación.
 */

import { Boton, Insignia } from '@/components/ui/Primitivos'
import { formatearFechaHora } from '@/lib/estados'
import { cantidad } from '@/lib/fertirriego/calculos'
import type { EstadoCampo, Estacion, Operacion, Persona, Relevo } from '@/lib/fertirriego/tipos'
import { ESTADOS_NOVEDAD } from './FormEntregarRelevo'

const NOMBRE_ESTADO: Record<Relevo['estado'], string> = {
  EN_ENTREGA: 'Esperando que la reciban',
  RECIBIDO: 'Recibida',
  RECHAZADO: 'No la recibieron',
  CANCELADO: 'Entrega cancelada',
  ASIGNADO: 'Asignada por el jefe',
}

export function VistaRelevos({
  estado,
  cola,
  estacion,
  yo,
  onRecibir,
  onRechazar,
  onMostrarCodigo,
  onAnularDiferencia,
}: {
  estado: EstadoCampo
  cola: Operacion[]
  estacion: Estacion
  yo: Persona
  onRecibir: (r: Relevo) => void
  onRechazar: (r: Relevo) => void
  onMostrarCodigo: () => void
  /** 115: anular la diferencia de un producto (solo con «Anular» en la estación) */
  onAnularDiferencia: (r: Relevo, materialId: string) => void
}) {
  const relevos = (estado.relevos ?? []).filter((r) => r.estacion_id === estacion.id)
  const pendientesLocales = cola.filter((o) => o.estado_local === 'PENDIENTE' && o.tipo.startsWith('relevo_') && o.datos.estacion_id === estacion.id)
  const material = (id: string) => estado.materiales.find((m) => m.id === id)
  const pendientesAnulacion = cola.filter(
    (o) => o.estado_local === 'PENDIENTE' && o.tipo === 'anulacion' && o.datos.documento_tipo === 'relevo' && o.datos.estacion_id === estacion.id
  )

  return (
    <div className="flex flex-col gap-3">
      {pendientesLocales.map((o) => (
        <div key={o.id} className="rounded-xl bg-amber-50 p-3 text-sm ring-1 ring-inset ring-amber-200">
          <p className="font-semibold text-amber-800">{o.resumen}</p>
          <p className="text-xs text-slate-500">{formatearFechaHora(o.creado_en)} · guardado en el teléfono, por enviar</p>
          {o.tipo === 'relevo_entregar' && (
            <button type="button" onClick={onMostrarCodigo} className="mt-1 text-xs font-bold text-brand-700 underline" data-mostrar-codigo>
              Mostrar mi código
            </button>
          )}
        </div>
      ))}
      {relevos.length === 0 && pendientesLocales.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-400">Todavía no hay relevos en esta estación.</p>
      )}
      {relevos.map((r) => (
        <div key={r.id} className={`rounded-xl bg-white p-3 ring-1 ring-inset ${r.revisar ? 'ring-amber-300' : 'ring-slate-200'}`} data-relevo={r.estado}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-800">
              {r.entrega ?? '—'} → {r.recibe ?? '…'}
            </p>
            <span className="flex gap-1">
              <Insignia tono={r.estado === 'RECIBIDO' || r.estado === 'ASIGNADO' ? 'verde' : r.estado === 'EN_ENTREGA' ? 'ambar' : 'gris'}>
                {NOMBRE_ESTADO[r.estado]}
              </Insignia>
              {r.revisar && <Insignia tono="ambar">Revisar</Insignia>}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {r.entregado_at ? `Entregó ${formatearFechaHora(r.entregado_at)}` : ''}
            {r.recibido_at ? ` · recibió ${formatearFechaHora(r.recibido_at)}` : ''}
            {r.metodo === 'CODIGO' ? ' · con código' : r.metodo === 'SESION' ? ' · con sesión' : ''}
          </p>
          {r.novedades.length > 0 && (
            <ul className="mt-1 text-xs text-slate-600">
              {r.novedades.map((n, i) => (
                <li key={i}>
                  <strong>{estado.turnos.find((t) => t.id === n.turno_ciclo_id)?.turno ?? 'Estación'}</strong>: {ESTADOS_NOVEDAD.find((e) => e.valor === n.estado)?.nombre}
                  {n.nota ? ` — ${n.nota}` : ''}
                </li>
              ))}
            </ul>
          )}
          {r.nota_entrega && <p className="mt-1 text-xs text-slate-600">Entrega: {r.nota_entrega}</p>}
          {r.nota_recibe && <p className="text-xs text-slate-600">Recibe: {r.nota_recibe}</p>}
          {r.motivo && <p className="text-xs text-slate-600">Motivo: {r.motivo}</p>}
          {r.diferencias.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1.5 text-xs" data-diferencias>
              {r.diferencias.map((d) => {
                const anulada = Boolean(d.anulado_at)
                const porEnviar = pendientesAnulacion.some((o) => o.datos.documento_id === r.id && o.datos.material_id === d.material_id)
                return (
                  <li key={d.material_id} data-diferencia-material={d.material_id} data-diferencia-anulada={anulada ? 'si' : 'no'}>
                    <p className={anulada ? 'text-slate-400 line-through' : 'text-red-700'}>
                      {material(d.material_id)?.descripcion}: sistema {cantidad(d.saldo_sistema)}, había {cantidad(d.cantidad_real)} ({d.diferencia > 0 ? '+' : ''}
                      {cantidad(d.diferencia)})
                    </p>
                    {anulada && (
                      <p className="mt-0.5 text-slate-600" data-diferencia-motivo>
                        <Insignia tono="gris">Anulada</Insignia> {d.anulado_por_nombre ? `por ${d.anulado_por_nombre}` : ''}
                        {d.anulado_at ? ` · ${formatearFechaHora(d.anulado_at)}` : ''}
                        {d.motivo_anulacion ? ` — ${d.motivo_anulacion}` : ''}
                      </p>
                    )}
                    {!anulada && porEnviar && (
                      <p className="mt-0.5 text-amber-800" data-diferencia-por-enviar>
                        Anulación guardada en el teléfono, por enviar.
                      </p>
                    )}
                    {!anulada && !porEnviar && estacion.permisos.anular && r.estado === 'RECIBIDO' && d.diferencia !== 0 && (
                      <Boton variante="peligro" className="mt-1" onClick={() => onAnularDiferencia(r, d.material_id)} data-anular-diferencia>
                        Anular esta diferencia
                      </Boton>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {r.estado === 'EN_ENTREGA' && r.entrega_id !== yo.id && estacion.permisos.relevo && (
            <div className="mt-2 flex gap-3">
              <button type="button" onClick={() => onRecibir(r)} className="text-xs font-bold text-brand-700 underline" data-recibir-relevo>
                Recibir
              </button>
              <button type="button" onClick={() => onRechazar(r)} className="text-xs font-bold text-red-700 underline" data-rechazar-relevo>
                No la recibo
              </button>
            </div>
          )}
          {r.estado === 'EN_ENTREGA' && r.entrega_id === yo.id && (
            <button type="button" onClick={onMostrarCodigo} className="mt-2 text-xs font-bold text-brand-700 underline" data-mostrar-codigo>
              Mostrar mi código
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
