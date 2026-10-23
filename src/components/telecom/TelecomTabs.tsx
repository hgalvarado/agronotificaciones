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

import { useState, useMemo } from 'react'
import { PanelAlertas } from './PanelAlertas'
import { GridAsignaciones } from './GridAsignaciones'
import { GridEquipos } from './GridEquipos'
import { GridLineas } from './GridLineas'
import { AsignacionModal } from './AsignacionModal'
import { HistorialModal, type Consulta } from './HistorialModal'
import { useRouter } from 'next/navigation'
import { CatalogoTable } from '@/components/catalogos/CatalogoTable'
import { PanelPlanes } from './PanelPlanes'
import { useTasaHoy } from './Moneda'
import type {
  Alerta,
  CentroCosto,
  FilaAsignacion,
  FilaEquipo,
  FilaLinea,
  Moneda,
  Persona,
  PlanTelecom,
} from '@/lib/telecom/tipos'
import { armarReglas, canExecuteAction, type ReglasPlanas } from '@/lib/permisos/clientABAC'

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
  reglas,
  usuarioId,
  zonas,
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
  /** Las reglas del usuario con sus tres ejes. Los hijos deciden por fila. */
  reglas: ReglasPlanas
  usuarioId: string | null
  zonas?: string[]
}) {
  // Esta capa sólo decide pestañas y modales, que son de pantalla.
  // El recorte por fila lo hace cada cuadrícula con las mismas reglas.
  const reglasAbac = useMemo(() => armarReglas(reglas), [reglas])
  const puedeEditar = canExecuteAction(reglasAbac, 'telecom', 'editar')
  const puedeEliminar = canExecuteAction(reglasAbac, 'telecom', 'eliminar')

  const router = useRouter()
  const [pestana, setPestana] = useState<Pestana>('asignaciones')
  const [historial, setHistorial] = useState<Consulta | null>(null)
  const [entregando, setEntregando] = useState(false)
  // La entrega que se está corrigiendo. Mismo modal que «Entregar», en
  // modo edición: la celda ya no edita (77), edita el formulario completo.
  const [editando, setEditando] = useState<FilaAsignacion | null>(null)
  // Una sola moneda para todo el módulo: Líneas y Planes leen igual.
  const [moneda, setMoneda] = useState<Moneda>('HNL')
  const tasa = useTasaHoy()

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
          reglas={reglas}
          usuarioId={usuarioId}
          zonas={zonas}
          onNueva={() => setEntregando(true)}
          onEditar={setEditando}
        />
      )}

      {pestana === 'lineas' && (
        <GridLineas
          filas={lineas}
          planes={planes}
          reglas={reglas}
          usuarioId={usuarioId}
          zonas={zonas}
          onHistorial={setHistorial}
          moneda={moneda}
          onMoneda={setMoneda}
          tasa={tasa}
        />
      )}

      {pestana === 'equipos' && (
        <GridEquipos
          filas={equipos}
          reglas={reglas}
          usuarioId={usuarioId}
          zonas={zonas}
          onHistorial={setHistorial}
        />
      )}

      {/* Planes con su interruptor de moneda y centros de costo, con la
          cuadrícula estándar de catálogos. */}
      {pestana === 'catalogos' && (
        <div className="flex flex-col gap-6">
          <PanelPlanes
            planes={planes}
            moneda={moneda}
            onMoneda={setMoneda}
            tasa={tasa}
            puedeEditar={puedeEditar}
            puedeEliminar={puedeEliminar}
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
        abierto={entregando || editando !== null}
        edicion={editando}
        onCerrar={() => {
          setEntregando(false)
          setEditando(null)
        }}
        onGuardado={() => router.refresh()}
        personal={personal}
        lineas={lineas}
        equipos={equipos}
        centrosCosto={centrosCosto}
        departamentos={departamentos}
        puestos={puestos}
      />

      <HistorialModal consulta={historial} onCerrar={() => setHistorial(null)} />
    </div>
  )
}
