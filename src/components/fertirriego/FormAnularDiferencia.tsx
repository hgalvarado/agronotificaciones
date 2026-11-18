'use client'

/**
 * Anular la diferencia de UN producto en un relevo (115). Caso: quien recibió la estación contó de menos porque no
 * se había registrado una aplicación que sí se hizo. Al anular, el producto vuelve al inventario y queda escrito
 * quién lo anuló y por qué; después se registra la aplicación olvidada.
 * Solo quien tiene «Anular» en la estación (la base lo exige también: el autor del relevo no basta).
 */

import { Alerta, AreaTexto, Campo } from '@/components/ui/Primitivos'
import { useState } from 'react'
import { cantidad } from '@/lib/fertirriego/calculos'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { EstadoCampo, Estacion, Operacion, Persona, Relevo } from '@/lib/fertirriego/tipos'
import { MarcoRegistro } from './MarcoRegistro'

/** Mínimo de letras del motivo (la misma regla que la base). */
export const MINIMO_MOTIVO_DIFERENCIA = 25

export function FormAnularDiferencia({
  estado,
  estacion,
  yo,
  relevo,
  materialId,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  relevo: Relevo
  materialId: string
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const [motivo, setMotivo] = useState('')
  const material = estado.materiales.find((m) => m.id === materialId)
  const dif = relevo.diferencias.find((d) => d.material_id === materialId)
  const letras = motivo.trim().length
  const falta = MINIMO_MOTIVO_DIFERENCIA - letras

  return (
    <MarcoRegistro
      titulo="Anular diferencia"
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      textoGuardar="Anular"
      sinCustodia
      permiso="anular"
      construir={({ ubicacion, enNombreDe }) => {
        if (letras < MINIMO_MOTIVO_DIFERENCIA) {
          return `Explica con detalle por qué se anula (mínimo ${MINIMO_MOTIVO_DIFERENCIA} letras): qué producto se aplicó, cuándo y quién no lo registró.`
        }
        return [
          crearOperacion(
            'anulacion',
            { estacion_id: estacion.id, documento_tipo: 'relevo', documento_id: relevo.id, material_id: materialId, motivo: motivo.trim() },
            { ubicacion, enNombreDe, resumen: `Anular diferencia del relevo · ${material?.descripcion ?? 'producto'}` }
          ),
        ]
      }}
    >
      <div data-form-anular-diferencia className="flex flex-col gap-4">
        <Alerta tono="ambar">
          El producto volverá al inventario y quedará registrado quién lo anuló y por qué. Después registra la aplicación olvidada.
        </Alerta>
        <div className="rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200">
          <p className="font-semibold text-slate-800">{material?.descripcion ?? 'Producto'}</p>
          {dif && (
            <p className="text-xs text-slate-600">
              En el relevo: sistema {cantidad(dif.saldo_sistema)}, había {cantidad(dif.cantidad_real)} ({dif.diferencia > 0 ? '+' : ''}
              {cantidad(dif.diferencia)} {material?.unidad ?? ''}). Al anular, la bodega {dif.diferencia < 0 ? 'recupera' : 'descuenta'}{' '}
              {cantidad(Math.abs(dif.diferencia))} {material?.unidad ?? ''}.
            </p>
          )}
        </div>
        <Campo
          etiqueta="Motivo de la anulación"
          requerido
          ayuda={falta > 0 ? `${letras} de ${MINIMO_MOTIVO_DIFERENCIA} letras como mínimo` : `${letras} letras`}
          ayudaVisible
        >
          <AreaTexto
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={4}
            placeholder="Qué producto se aplicó, cuándo y quién no lo registró"
            data-motivo-diferencia
          />
        </Campo>
      </div>
    </MarcoRegistro>
  )
}
