'use client'

/**
 * Las tres vistas del módulo en una pantalla, con las alertas arriba.
 *
 * Este componente sólo enruta entre ellas y lleva el historial, que es lo
 * único compartido: se abre desde las líneas y desde los equipos, y
 * tenerlo montado dos veces sería tener dos modales que se comportan
 * distinto.
 *
 * Al tocar una alerta se salta a su pestaña. Una alerta que sólo informa
 * obliga a buscar a mano la fila que denuncia, y eso es justo lo que
 * hace que se dejen de mirar.
 */

import { useState } from 'react'
import { PanelAlertas } from './PanelAlertas'
import { GridAsignaciones } from './GridAsignaciones'
import { GridEquipos } from './GridEquipos'
import { GridLineas } from './GridLineas'
import { AsignacionModal } from './AsignacionModal'
import { HistorialModal, type Consulta } from './HistorialModal'
import { useRouter } from 'next/navigation'
import { CatalogoTable } from '@/components/catalogos/CatalogoTable'
import type {
  Alerta,
  CentroCosto,
  FilaAsignacion,
  FilaEquipo,
  FilaLinea,
  Persona,
  PlanTelecom,
} from '@/lib/telecom/tipos'

type Pestana = 'asignaciones' | 'lineas' | 'equipos' | 'catalogos'

export function TelecomTabs({
  alertas,
  lineas,
  equipos,
  asignaciones,
  planes,
  personal,
  centrosCosto,
  departamentos,
  puestos,
  puedeEditar,
  puedeEliminar,
}: {
  alertas: Alerta[]
  lineas: FilaLinea[]
  equipos: FilaEquipo[]
  asignaciones: FilaAsignacion[]
  planes: PlanTelecom[]
  personal: Persona[]
  centrosCosto: CentroCosto[]
  departamentos: { id: string; nombre: string }[]
  puestos: string[]
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  const router = useRouter()
  const [pestana, setPestana] = useState<Pestana>('asignaciones')
  const [historial, setHistorial] = useState<Consulta | null>(null)
  const [entregando, setEntregando] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <PanelAlertas
        alertas={alertas}
        onAbrir={(tipo, llave) => {
          if (tipo === 'RENOVACION') {
            setHistorial({
              tipo: 'EQUIPO',
              llave,
              titulo: equipos.find((e) => e.imei === llave)?.marca_modelo ?? llave,
            })
          } else {
            setPestana('asignaciones')
          }
        }}
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(
          [
            ['asignaciones', 'Asignaciones'],
            ['lineas', 'Líneas'],
            ['equipos', 'Equipos'],
            ['catalogos', 'Planes y centros'],
          ] as const
        ).map(([valor, etiqueta]) => (
          <button
            key={valor}
            onClick={() => setPestana(valor)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold transition-all ${
              pestana === valor
                ? 'bg-brand-700 text-white shadow-[var(--shadow-raised)]'
                : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:text-slate-900'
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {pestana === 'asignaciones' && (
        <GridAsignaciones
          filas={asignaciones}
          personal={personal}
          lineas={lineas}
          equipos={equipos}
          centrosCosto={centrosCosto}
          departamentos={departamentos.map((d) => d.nombre)}
          puestos={puestos}
          puedeEditar={puedeEditar}
          puedeEliminar={puedeEliminar}
          onNueva={() => setEntregando(true)}
        />
      )}

      {pestana === 'lineas' && (
        <GridLineas
          filas={lineas}
          planes={planes}
          puedeEditar={puedeEditar}
          puedeEliminar={puedeEliminar}
          onHistorial={setHistorial}
        />
      )}

      {pestana === 'equipos' && (
        <GridEquipos
          filas={equipos}
          puedeEditar={puedeEditar}
          puedeEliminar={puedeEliminar}
          onHistorial={setHistorial}
        />
      )}

      {/* Los dos catálogos del módulo, con la cuadrícula estándar de
          catálogos: edición en la celda, importación, exportación y
          borrado en masa salen de ahí sin escribir nada. */}
      {pestana === 'catalogos' && (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-bold text-slate-900">Planes</h2>
            <p className="text-xs text-slate-400">
              Lo que cuesta cada línea al mes. Es lo que ofrece el selector al dar de alta o
              corregir una línea.
            </p>
          </section>
          <CatalogoTable
            tabla="telecom_planes"
            titulo="Planes"
            clave="nombre"
            soloLectura={!puedeEditar}
            permisos={{ editar: puedeEditar, eliminar: puedeEliminar }}
            campos={[
              { key: 'nombre', label: 'Plan', tipo: 'text', requerido: true },
              { key: 'costo_mensual', label: 'Costo mensual', tipo: 'number' },
              { key: 'proveedor', label: 'Proveedor', tipo: 'text' },
              { key: 'es_retencion', label: 'Es Plan $1', tipo: 'checkbox' },
              { key: 'activo', label: 'Activo', tipo: 'checkbox' },
            ]}
            filas={planes as unknown as Record<string, string | number | boolean | null>[]}
          />

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-bold text-slate-900">Centros de costo</h2>
            <p className="text-xs text-slate-400">
              A qué centro se carga cada entrega. Catálogo y no texto libre: escrito a mano, el
              mismo centro sale de tres formas distintas en el mismo reporte.
            </p>
          </section>
          <CatalogoTable
            tabla="telecom_centros_costo"
            titulo="Centros de costo"
            clave="codigo"
            soloLectura={!puedeEditar}
            permisos={{ editar: puedeEditar, eliminar: puedeEliminar }}
            campos={[
              { key: 'codigo', label: 'Código', tipo: 'text', requerido: true },
              { key: 'nombre', label: 'Nombre', tipo: 'text' },
              { key: 'activo', label: 'Activo', tipo: 'checkbox' },
            ]}
            filas={centrosCosto as unknown as Record<string, string | number | boolean | null>[]}
          />

          <p className="px-1 text-xs text-slate-400">
            Sólo un plan puede estar marcado como <strong>Plan $1</strong>: es el que usa el botón
            «Pasar a Plan $1» para conservar un número sin pagar el plan completo. La base rechaza
            el segundo.
          </p>
        </div>
      )}

      <AsignacionModal
        abierto={entregando}
        onCerrar={() => setEntregando(false)}
        onGuardado={() => router.refresh()}
        personal={personal}
        lineas={lineas}
        equipos={equipos}
        centrosCosto={centrosCosto}
        departamentos={departamentos}
      />

      <HistorialModal consulta={historial} onCerrar={() => setHistorial(null)} />
    </div>
  )
}
