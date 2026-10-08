'use client'

/**
 * Un acarreo de la bolsa zonal.
 *
 * Formulario corto: la bolsa no es de ningún lote, así que no hay lote
 * que elegir. Lo que sí hay que elegir bien es la ZONA, porque es la
 * única llave con la que después se reparte — y la vista de costos no lo
 * cruza a otra zona ni aunque sobre dinero.
 */

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Alerta, Boton, Campo, Entrada, Selector } from '@/components/ui/Primitivos'
import { validarLogistica } from '@/lib/desinfeccion/calculo'
import type { CatalogosDesinfeccion, EntradaLogistica } from '@/lib/desinfeccion/tipos'

export function LogisticaModal({
  entrada,
  catalogos,
  zonasPermitidas,
  guardando,
  onCambiar,
  onGuardar,
  onCerrar,
}: {
  entrada: EntradaLogistica
  catalogos: CatalogosDesinfeccion
  /** `null` = sin recorte. Lo decide `zonasParaCrear`. */
  zonasPermitidas: Set<string> | null
  guardando: boolean
  onCambiar: (e: EntradaLogistica) => void
  onGuardar: () => void
  onCerrar: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  const zonas =
    zonasPermitidas === null
      ? catalogos.zonas
      : catalogos.zonas.filter((z) => zonasPermitidas.has(z.id))

  const cambiar = (c: Partial<EntradaLogistica>) => onCambiar({ ...entrada, ...c })

  function guardar() {
    const problema = validarLogistica(entrada)
    if (problema) return setError(problema)
    setError(null)
    onGuardar()
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={entrada.id ? 'Editar acarreo' : 'Nuevo acarreo'}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta>{error}</Alerta>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Temporada" requerido>
            <Selector
              value={entrada.temporadaId}
              onChange={(e) => cambiar({ temporadaId: e.target.value })}
            >
              <option value="">Elige la temporada…</option>
              {catalogos.temporadas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                  {t.activa ? ' (activa)' : ''}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo
            etiqueta="Zona"
            requerido
            ayuda="El acarreo se reparte entre las manzanas regadas de ESTA zona, y de ninguna otra."
          >
            <Selector value={entrada.zonaId} onChange={(e) => cambiar({ zonaId: e.target.value })}>
              <option value="">Elige la zona…</option>
              {zonas.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Fecha" requerido>
            <Entrada
              type="date"
              value={entrada.fecha}
              onChange={(e) => cambiar({ fecha: e.target.value })}
            />
          </Campo>

          <Campo etiqueta="Equipo" requerido ayuda="De aquí sale la tarifa por hora.">
            <Selector value={entrada.equipoId} onChange={(e) => cambiar({ equipoId: e.target.value })}>
              <option value="">Elige el equipo…</option>
              {catalogos.equipos.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.codigo} · {x.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo
            etiqueta="Implemento"
            ayuda="No suma costo: todavía no tiene tabla de tarifas, y cobrar un número inventado es peor."
          >
            <Selector
              value={entrada.implementoId}
              onChange={(e) => cambiar({ implementoId: e.target.value })}
            >
              <option value="">Sin implemento</option>
              {catalogos.implementos.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.codigo} · {x.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Operador">
            <Selector
              value={entrada.operadorId}
              onChange={(e) => cambiar({ operadorId: e.target.value })}
            >
              <option value="">Sin operador</option>
              {catalogos.operadores.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Horas de trabajo" requerido>
            <Entrada
              inputMode="decimal"
              value={entrada.horasTrabajo}
              onChange={(e) => cambiar({ horasTrabajo: e.target.value })}
              placeholder="0.00"
            />
          </Campo>

          <Campo
            etiqueta="Costo por hora"
            ayuda="Déjalo vacío y lo toma de la tarifa del equipo. Escribir cero diría que no costó nada."
          >
            <Entrada
              inputMode="decimal"
              value={entrada.costoHora}
              onChange={(e) => cambiar({ costoHora: e.target.value })}
              placeholder="De la tarifa del equipo"
            />
          </Campo>

          <Campo etiqueta="Comentarios" className="sm:col-span-2">
            <Entrada
              value={entrada.comentarios}
              onChange={(e) => cambiar({ comentarios: e.target.value })}
            />
          </Campo>
        </div>
      </div>
    </Modal>
  )
}
