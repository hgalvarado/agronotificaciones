'use client'

/**
 * Las líneas: qué números paga la empresa y quién los tiene.
 *
 * Se escribe sobre la tabla, como el resto del sistema. El ESTADO no se
 * edita a mano —lo mantiene la base a partir de las asignaciones
 * vigentes— salvo «Suspendida», que sí es una decisión de una persona y
 * que la base respeta sin pisarla.
 *
 * El número abre el historial: es el gesto natural —«¿de quién era esto
 * antes?»— y no merece un botón más en una fila que ya tiene dos.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alerta, Boton, Insignia } from '@/components/ui/Primitivos'
import { DataGrid } from '@/components/ui/DataGrid'
import { BotonFila } from '@/components/ui/BotonFila'
import { Modal } from '@/components/ui/Modal'
import { Campo, Entrada } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { ImportarLineas } from './Importadores'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { mensajeDeError } from '@/lib/errores'
import {
  borrarLineas,
  crearLinea,
  crearPlan,
  guardarLinea,
  pasarARetencion,
  type CamposLinea,
} from '@/lib/telecom/repositorioCliente'
import {
  compararLineas,
  ESTADOS_LINEA,
  type FilaLinea,
  type PlanTelecom,
} from '@/lib/telecom/tipos'
import type { Consulta } from './HistorialModal'
import { Seccion } from './Seccion'
import { TarjetasLineas } from './Resumenes'
import { BitacoraModal, RegistrarSolicitudModal } from './BitacoraModales'

type Fila = FilaLinea & { id: string }

const CAMPOS: Record<string, keyof CamposLinea> = {
  proveedor: 'proveedor',
  plan_nombre: 'plan_id',
  estado: 'estado',
  observaciones: 'observaciones',
  activo: 'activo',
}

export function GridLineas({
  filas,
  planes,
  puedeEditar,
  puedeEliminar,
  onHistorial,
}: {
  filas: FilaLinea[]
  planes: PlanTelecom[]
  puedeEditar: boolean
  puedeEliminar: boolean
  onHistorial: (c: Consulta) => void
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [importando, setImportando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [solicitando, setSolicitando] = useState<string | null>(null)
  const [viendoBitacora, setViendoBitacora] = useState<string | null>(null)

  // El orden de lectura: primero por estado —las asignadas arriba, que es
  // lo que se consulta— y dentro, por número.
  const lista = useMemo<Fila[]>(
    () => [...filas].sort(compararLineas).map((f) => ({ ...f, id: f.numero })),
    [filas]
  )

  // Las suspendidas son la mayor parte de las filas viejas y casi nunca
  // son lo que se viene a mirar; van detrás de su propio título, que
  // dice cuántas hay, y desde ahí se pueden revivir.
  const activas = useMemo(() => lista.filter((f) => f.estado !== 'SUSPENDIDA'), [lista])
  const suspendidas = useMemo(() => lista.filter((f) => f.estado === 'SUSPENDIDA'), [lista])

  const planRetencion = planes.find((p) => p.es_retencion)

  const columnas = useMemo<ColumnaGrid<Fila>[]>(
    () => [
      {
        campo: 'numero',
        label: 'Número',
        tipo: 'texto',
        ancho: '9rem',
        valor: (f) => f.numero,
        render: (f) => (
          <button
            type="button"
            onClick={() => onHistorial({ tipo: 'LINEA', llave: f.numero, titulo: f.numero })}
            title="Ver por cuántas manos ha pasado"
            className="font-semibold text-brand-700 hover:underline"
          >
            {f.numero}
          </button>
        ),
      },
      {
        campo: 'proveedor',
        label: 'Proveedor',
        tipo: 'seleccion',
        valor: (f) => f.proveedor,
        editable: puedeEditar,
        editor: 'texto',
      },
      {
        campo: 'plan_nombre',
        label: 'Plan',
        tipo: 'seleccion',
        ancho: '12rem',
        valor: (f) => f.plan_nombre,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.plan_id ?? '',
        opciones: [
          { value: '', label: 'Sin plan' },
          ...planes.map((p) => ({
            value: p.id,
            label: p.es_retencion ? `${p.nombre} · retención` : p.nombre,
          })),
        ],
      },
      {
        campo: 'plan_costo',
        label: 'Costo',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.plan_costo === null ? null : Number(f.plan_costo)),
        etiqueta: (f) => (f.plan_costo === null ? '' : `L ${Number(f.plan_costo).toFixed(2)}`),
      },
      {
        campo: 'estado',
        label: 'Estado',
        tipo: 'seleccion',
        valor: (f) => f.estado,
        etiqueta: (f) => ESTADOS_LINEA.find((e) => e.valor === f.estado)?.etiqueta ?? f.estado,
        // Se pone y se quita «Suspendida» —revivir una suspendida es
        // justo lo que hay que poder hacer desde aquí—. «Asignada» no
        // está en la lista: la deduce la base de las entregas abiertas, y
        // dejarla escribir sería poder mentir sobre quién tiene qué.
        editable: (f) => puedeEditar && f.estado !== 'ASIGNADA',
        editor: 'seleccion',
        opciones: ESTADOS_LINEA.filter((e) => e.valor !== 'ASIGNADA').map((e) => ({
          value: e.valor,
          label: e.etiqueta,
        })),
        render: (f) => {
          const e = ESTADOS_LINEA.find((x) => x.valor === f.estado)
          return <Insignia tono={e?.tono ?? 'gris'}>{e?.etiqueta ?? f.estado}</Insignia>
        },
      },
      {
        campo: 'asignada_a',
        label: 'Asignada a',
        tipo: 'seleccion',
        ancho: '12rem',
        valor: (f) => f.asignada_a,
        render: (f) =>
          f.asignada_a ? (
            <span className="block truncate">
              {f.asignada_a}
              {f.codigo_empleado && (
                <span className="ml-1 text-xs text-slate-400">{f.codigo_empleado}</span>
              )}
            </span>
          ) : (
            <span className="text-xs text-slate-300">Libre</span>
          ),
      },
      { campo: 'fecha_entrega', label: 'Entregada', tipo: 'fecha', valor: (f) => f.fecha_entrega },
      {
        campo: 'observaciones',
        label: 'Observaciones',
        tipo: 'texto',
        ancho: '14rem',
        valor: (f) => f.observaciones,
        editable: puedeEditar,
        editor: 'texto',
      },
      {
        campo: 'solicitudes',
        label: 'Solicitudes',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.solicitudes ?? 0),
        render: (f) =>
          Number(f.solicitudes ?? 0) === 0 ? (
            <span className="text-xs text-slate-300">—</span>
          ) : (
            <button
              type="button"
              onClick={() => setViendoBitacora(f.numero)}
              title={`Última: ${f.ultima_solicitud ?? '—'}`}
              className="text-xs font-semibold text-brand-700 hover:underline"
            >
              {f.solicitudes} · {f.ultima_solicitud ?? ''}
            </button>
          ),
      },
      {
        campo: 'activo',
        label: 'Activa',
        tipo: 'seleccion',
        valor: (f) => (f.activo ? 'Sí' : 'No'),
      },
    ],
    [planes, puedeEditar, onHistorial]
  )

  async function editarCelda(fila: Fila, campo: string, valor: unknown) {
    const cual = CAMPOS[campo]
    if (!cual) return
    setError(null)
    const { error: e } = await guardarLinea(fila.numero, {
      [cual]: valor === '' ? null : valor,
    } as CamposLinea)
    if (e) return setError(mensajeDeError(e, 'No se pudo guardar el cambio.'))
    router.refresh()
  }

  async function retencion(numeros: string[], limpiar?: () => void) {
    if (numeros.length === 0) return
    setOcupado(true)
    setError(null)
    for (const n of numeros) {
      const { error: e } = await pasarARetencion(n)
      if (e) {
        setOcupado(false)
        return setError(
          mensajeDeError(
            e,
            'No se pudo cambiar el plan. Si dice que no hay plan de retención, marca el Plan $1 en el catálogo de planes.'
          )
        )
      }
    }
    setOcupado(false)
    limpiar?.()
    setAviso(
      `${numeros.length} ${numeros.length === 1 ? 'línea pasó' : 'líneas pasaron'} a ${
        planRetencion?.nombre ?? 'el plan de retención'
      }: el número se conserva.`
    )
    router.refresh()
  }

  async function eliminar(numeros: string[], limpiar: () => void) {
    if (numeros.length === 0) return
    if (
      !confirm(
        `Se van a eliminar ${numeros.length} ${numeros.length === 1 ? 'línea' : 'líneas'}. ` +
          'Su historial de asignaciones se va con ellas. Esto no se puede deshacer. ¿Continuar?'
      )
    ) {
      return
    }
    setOcupado(true)
    const { error: e } = await borrarLineas(numeros)
    setOcupado(false)
    if (e) {
      return setError(
        mensajeDeError(
          e,
          'No se pudieron eliminar. Una línea con asignaciones registradas no se borra: finalízalas primero.'
        )
      )
    }
    limpiar()
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alerta>{error}</Alerta>}
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}

      <TarjetasLineas filas={filas} />

      {/* Activas arriba y abierto; suspendidas detrás de su título. Lo
          cerrado ni se monta: con años de historial, pintar la tabla de
          suspendidas cada vez que se abre la pantalla cuesta lo mismo que
          pintarla cuando alguien la pide, y casi nadie la pide. */}
      <Seccion
        titulo="Líneas activas"
        descripcion="Disponibles y asignadas"
        cuantos={activas.length}
      >
      <DataGrid<Fila>
        filas={activas}
        columnas={columnas}
        titulo="Líneas"
        nombreArchivo="telecom-lineas"
        // Sin orden inicial: la lista ya llega ordenada por estado y
        // número, que es el orden en que se lee. Tocar un encabezado
        // sigue reordenando.
        ordenInicial={undefined}
        minAncho="1200px"
        puedeEditarCelda={puedeEditar}
        onEditarCelda={editarCelda}
        vacio={{
          titulo: 'Sin líneas',
          descripcion: 'Agrega los números que paga la empresa para poder asignarlos.',
        }}
        resumen={(visibles) => {
          const libres = visibles.filter((f) => f.estado === 'DISPONIBLE').length
          const costo = visibles.reduce((a, f) => a + Number(f.plan_costo ?? 0), 0)
          return (
            <>
              <strong className="text-slate-900">{visibles.length}</strong>{' '}
              {visibles.length === 1 ? 'línea' : 'líneas'} · {libres} libre{libres === 1 ? '' : 's'}{' '}
              · L {costo.toFixed(2)} al mes
            </>
          )
        }}
        acciones={
          puedeEditar && (
            <>
              <Boton variante="secundario" tamano="sm" onClick={() => setImportando(true)}>
                Importar
              </Boton>
              <Boton variante="secundario" tamano="sm" onClick={() => setCreando(true)}>
                Nueva línea
              </Boton>
            </>
          )
        }
        accionesSeleccion={(ids, limpiar) => (
          <>
            {puedeEditar && (
              <Boton
                variante="secundario"
                tamano="sm"
                disabled={ocupado}
                onClick={() => retencion(ids, limpiar)}
              >
                Pasar a {planRetencion?.nombre ?? 'Plan $1'}
              </Boton>
            )}
            {puedeEliminar && (
              <Boton
                variante="peligro"
                tamano="sm"
                disabled={ocupado}
                onClick={() => eliminar(ids, limpiar)}
              >
                Eliminar {ids.length}
              </Boton>
            )}
          </>
        )}
        accionFila={(f) => (
          <span className="flex justify-end gap-1">
            <BotonFila onClick={() => setViendoBitacora(f.numero)}>Historial</BotonFila>
            {puedeEditar && (
              <BotonFila onClick={() => setSolicitando(f.numero)}>Solicitud</BotonFila>
            )}
            {puedeEditar && !f.plan_es_retencion && (
              <BotonFila onClick={() => retencion([f.numero])}>
                Pasar a {planRetencion?.nombre ?? 'Plan $1'}
              </BotonFila>
            )}
          </span>
        )}
      />
      </Seccion>

      <Seccion
        titulo="Líneas suspendidas"
        descripcion="Sin servicio. Se reviven cambiándoles el estado en la celda."
        cuantos={suspendidas.length}
        abiertoInicial={false}
        tono="apagado"
      >
        <DataGrid<Fila>
          filas={suspendidas}
          columnas={columnas}
          titulo="Líneas suspendidas"
          nombreArchivo="telecom-lineas-suspendidas"
          minAncho="1200px"
          puedeEditarCelda={puedeEditar}
          onEditarCelda={editarCelda}
          vacio={{ titulo: 'Ninguna suspendida', descripcion: 'Todas las líneas tienen servicio.' }}
          accionesSeleccion={(ids, limpiar) =>
            puedeEliminar ? (
              <Boton
                variante="peligro"
                tamano="sm"
                disabled={ocupado}
                onClick={() => eliminar(ids, limpiar)}
              >
                Eliminar {ids.length}
              </Boton>
            ) : null
          }
          accionFila={(f) => (
            <span className="flex justify-end gap-1">
              <BotonFila onClick={() => setViendoBitacora(f.numero)}>Historial</BotonFila>
              {puedeEditar && (
                <BotonFila onClick={() => setSolicitando(f.numero)}>Solicitud</BotonFila>
              )}
            </span>
          )}
        />
      </Seccion>

      <RegistrarSolicitudModal
        numero={solicitando}
        onCerrar={() => setSolicitando(null)}
        onGuardado={() => router.refresh()}
      />

      <BitacoraModal numero={viendoBitacora} onCerrar={() => setViendoBitacora(null)} />

      <ModalNuevaLinea
        abierto={creando}
        planes={planes}
        onCerrar={() => setCreando(false)}
        onGuardado={() => router.refresh()}
      />

      <ImportarLineas
        abierto={importando}
        onCerrar={() => setImportando(false)}
        planes={planes}
        existentes={new Set(filas.map((f) => f.numero))}
      />

      <p className="px-1 text-xs text-slate-400">
        Toca el número para ver por cuántas manos ha pasado, y <strong>Solicitud</strong> para
        dejar constancia de lo que se le pidió al proveedor. El estado <strong>Asignada</strong> lo
        pone la base sola cuando hay una entrega abierta: no se teclea, y por eso no puede decir
        «Disponible» algo que alguien tiene en el bolsillo.
      </p>
    </div>
  )
}

function ModalNuevaLinea({
  abierto,
  planes,
  onCerrar,
  onGuardado,
}: {
  abierto: boolean
  planes: PlanTelecom[]
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [numero, setNumero] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [planId, setPlanId] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Los planes que se den de alta desde el propio selector: la lista que
  // llegó por props es de la carga del servidor y no los trae todavía.
  const [extraPlanes, setExtraPlanes] = useState<PlanTelecom[]>([])
  const todos = [...planes, ...extraPlanes]

  async function guardar() {
    if (!numero.trim()) return setError('El número es obligatorio.')
    setError(null)
    setGuardando(true)
    const { error: e } = await crearLinea({
      numero: numero.trim(),
      proveedor: proveedor.trim() || null,
      plan_id: planId || null,
      observaciones: observaciones.trim() || null,
    })
    setGuardando(false)
    if (e) {
      return setError(
        mensajeDeError(e, 'No se pudo crear. Si dice que ya existe, ese número ya está registrado.')
      )
    }
    setNumero('')
    setProveedor('')
    setPlanId('')
    setObservaciones('')
    onGuardado()
    onCerrar()
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Nueva línea"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Crear'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta>{error}</Alerta>}
        <Campo etiqueta="Número" requerido ayuda="Es la llave: se conserva aunque cambie de persona.">
          <Entrada
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="9999-9999"
            inputMode="tel"
            autoFocus
          />
        </Campo>
        <Campo etiqueta="Proveedor">
          <Entrada
            value={proveedor}
            onChange={(e) => setProveedor(e.target.value)}
            placeholder="Tigo"
          />
        </Campo>
        <Campo etiqueta="Plan" ayuda="Si el plan no está en la lista, se crea desde aquí mismo.">
          <SelectorBuscable
            valor={planId}
            opciones={todos.map((p) => ({
              id: p.id,
              titulo: p.nombre,
              subtitulo: [
                p.costo_mensual === null ? null : `L ${Number(p.costo_mensual).toFixed(2)}`,
                p.es_retencion ? 'retención' : null,
              ]
                .filter(Boolean)
                .join(' · '),
            }))}
            onCambiar={setPlanId}
            placeholder="Sin plan"
            etiquetaBusqueda="Buscar plan…"
            textoVacio="Sin plan"
            creacionRapida={{
              etiqueta: 'Nuevo plan',
              campos: [
                { key: 'nombre', label: 'Nombre del plan', requerido: true },
                { key: 'costo', label: 'Costo mensual' },
              ],
              onCrear: async (v) => {
                const { plan, error: e } = await crearPlan(v.nombre, v.costo ?? '')
                if (e || !plan) throw new Error(e ?? 'No se pudo crear.')
                setExtraPlanes((a) => [...a, plan])
                return {
                  id: plan.id,
                  titulo: plan.nombre,
                  subtitulo:
                    plan.costo_mensual === null ? '' : `L ${Number(plan.costo_mensual).toFixed(2)}`,
                }
              },
            }}
          />
        </Campo>
        <Campo etiqueta="Observaciones">
          <Entrada
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Contrato, fecha de portabilidad…"
          />
        </Campo>
      </div>
    </Modal>
  )
}
