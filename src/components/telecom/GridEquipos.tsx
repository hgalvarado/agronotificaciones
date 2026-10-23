'use client'

/**
 * Los equipos: qué teléfonos compró la empresa y cuáles ya toca renovar.
 *
 * La fecha de renovación NO se edita: es la compra más dieciocho meses y
 * la calcula la base como columna generada. Tenerla escribible sería
 * tener dos fechas que discrepan y una política de renovación que
 * depende de a quién le tocó teclear.
 *
 * Las filas cuya renovación ya venció salen en rojo: es la misma alerta
 * del tablero, aquí dentro de la lista donde se decide qué comprar.
 *
 * 77 · La celda no edita: se corrige con «Editar», que abre el mismo
 * formulario del alta con el estado FÍSICO (Activo, Dañado, Reparación,
 * Devuelto), la fecha de devolución y su nota.
 */

import { useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Alerta, Boton, Campo, Entrada, Insignia, Selector } from '@/components/ui/Primitivos'
import { BotonFila } from '@/components/ui/BotonFila'
import { DataGrid } from '@/components/ui/DataGrid'
import { Modal } from '@/components/ui/Modal'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { mensajeDeError } from '@/lib/errores'
import {
  borrarEquipos,
  crearEquipo,
  guardarEquipo,
  type CamposEquipo,
} from '@/lib/telecom/repositorioCliente'
import { ESTADOS_EQUIPO, ESTADOS_FISICOS, textoPlazo, type FilaEquipo } from '@/lib/telecom/tipos'
import { ImportarEquipos } from './Importadores'
import type { Consulta } from './HistorialModal'
import { armarReglas, canExecuteAction, type ReglasPlanas } from '@/lib/permisos/clientABAC'

type Fila = FilaEquipo & { id: string }

export function GridEquipos({
  filas,
  onHistorial,
  reglas: reglasPlanas,
  usuarioId,
  zonas,
}: {
  filas: FilaEquipo[]
  /**
   * Las reglas del usuario con sus tres ejes.
   *
   * Antes llegaban booleanos para la pantalla entera, y con ABAC eso ya
   * no alcanza: el mismo usuario puede tocar la fila que capturó él y no
   * la de al lado. La decisión es POR FILA, así que lo que hace falta
   * aquí es la regla, no su resultado.
   */
  reglas: ReglasPlanas
  /** Quién está mirando. Lo necesita el eje «propietario». */
  usuarioId: string | null
  /** Sus zonas asignadas. Vacío quiere decir «sin recorte zonal». */
  zonas?: string[]
  onHistorial: (c: Consulta) => void
}) {
  const reglas = useMemo(() => armarReglas(reglasPlanas), [reglasPlanas])
  const zonasDelPerfil = useMemo(() => new Set(zonas ?? []), [zonas])

  // A nivel de PANTALLA: ¿podría llegar a hacerlo? Es lo que decide si se
  // dibuja la barra de herramientas. Sin fila, alcance y condición no
  // recortan.
  // Esta pantalla no guarda quién capturó cada fila, así que el
  // eje «propietario» no tiene con qué recortar y la respuesta por
  // fila coincide con la de pantalla. Se pregunta igual con el
  // helper para que el día que la fila gane un dueño o un estado
  // no haya que acordarse de cambiarlo aquí.
  const puedeEditar = canExecuteAction(reglas, 'telecom', 'editar')
  const puedeEliminar = canExecuteAction(reglas, 'telecom', 'eliminar')

  // Y a nivel de FILA, que es lo que decide cada botón.
  const ctxAbac = useMemo(
    () => ({ usuarioId, zonas: zonasDelPerfil }),
    [usuarioId, zonasDelPerfil]
  )
  const puedeEditarFila = useCallback(
    (_f: Fila) => canExecuteAction(reglas, 'telecom', 'editar', { duenoId: null }, ctxAbac),
    [reglas, ctxAbac]
  )
  const puedeEliminarFila = useCallback(
    (_f: Fila) => canExecuteAction(reglas, 'telecom', 'eliminar', { duenoId: null }, ctxAbac),
    [reglas, ctxAbac]
  )

  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<Fila | null>(null)
  const [importando, setImportando] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const lista = useMemo<Fila[]>(() => filas.map((f) => ({ ...f, id: f.imei })), [filas])

  const columnas = useMemo<ColumnaGrid<Fila>[]>(
    () => [
      {
        campo: 'imei',
        label: 'IMEI',
        tipo: 'texto',
        ancho: '11rem',
        valor: (f) => f.imei,
        render: (f) => (
          <button
            type="button"
            onClick={() => onHistorial({ tipo: 'EQUIPO', llave: f.imei, titulo: f.marca_modelo })}
            title="Ver por cuántas manos ha pasado"
            className="font-mono text-xs font-semibold text-brand-700 hover:underline"
          >
            {f.imei}
          </button>
        ),
      },
      {
        campo: 'marca_modelo',
        label: 'Marca y modelo',
        tipo: 'seleccion',
        ancho: '12rem',
        valor: (f) => f.marca_modelo,
      },
      {
        campo: 'ram',
        label: 'RAM',
        tipo: 'seleccion',
        valor: (f) => f.ram,
      },
      {
        campo: 'almacenamiento',
        label: 'Almacenamiento',
        tipo: 'seleccion',
        valor: (f) => f.almacenamiento,
      },
      {
        campo: 'fecha_compra',
        label: 'Compra',
        tipo: 'fecha',
        valor: (f) => f.fecha_compra,
      },
      // Calculada por la base: compra + 18 meses. Sin editor a propósito.
      {
        campo: 'fecha_renovacion',
        label: 'Renovación',
        tipo: 'fecha',
        valor: (f) => f.fecha_renovacion,
        render: (f) =>
          f.fecha_renovacion ? (
            <span className="flex flex-col">
              <span>{f.fecha_renovacion}</span>
              {f.dias_para_renovacion !== null && (
                <span
                  className={`text-[11px] font-semibold ${
                    f.dias_para_renovacion <= 0
                      ? 'text-red-600'
                      : f.dias_para_renovacion <= 30
                        ? 'text-amber-700'
                        : 'text-slate-400'
                  }`}
                >
                  {textoPlazo(f.dias_para_renovacion)}
                </span>
              )}
            </span>
          ) : (
            <span className="text-xs text-slate-300">Sin fecha de compra</span>
          ),
      },
      {
        campo: 'estado',
        label: 'Estado',
        tipo: 'seleccion',
        valor: (f) => f.estado,
        etiqueta: (f) => ESTADOS_EQUIPO.find((e) => e.valor === f.estado)?.etiqueta ?? f.estado,
        render: (f) => {
          const e = ESTADOS_EQUIPO.find((x) => x.valor === f.estado)
          return <Insignia tono={e?.tono ?? 'gris'}>{e?.etiqueta ?? f.estado}</Insignia>
        },
      },
      {
        campo: 'estado_fisico',
        label: 'Estado físico',
        tipo: 'seleccion',
        valor: (f) => f.estado_fisico ?? 'Activo',
        render: (f) => {
          const e = ESTADOS_FISICOS.find((x) => x.valor === (f.estado_fisico ?? 'Activo'))
          return (
            <span className="flex flex-col gap-0.5" title={f.notas_estado ?? undefined}>
              <Insignia tono={e?.tono ?? 'gris'}>{e?.etiqueta ?? f.estado_fisico}</Insignia>
              {f.notas_estado && (
                <span className="max-w-[11rem] truncate text-[11px] text-slate-400">{f.notas_estado}</span>
              )}
            </span>
          )
        },
      },
      {
        campo: 'fecha_devolucion',
        label: 'Devolución',
        tipo: 'fecha',
        valor: (f) => f.fecha_devolucion ?? null,
      },
      {
        campo: 'asignado_a',
        label: 'Asignado a',
        tipo: 'seleccion',
        ancho: '12rem',
        valor: (f) => f.asignado_a,
        render: (f) =>
          f.asignado_a ? (
            <span className="block truncate">{f.asignado_a}</span>
          ) : (
            <span className="text-xs text-slate-300">En bodega</span>
          ),
      },
      {
        campo: 'observaciones',
        label: 'Observaciones',
        tipo: 'texto',
        ancho: '14rem',
        valor: (f) => f.observaciones,
      },
    ],
    [onHistorial]
  )

  async function eliminar(imeis: string[], limpiar: () => void) {
    if (imeis.length === 0) return
    if (
      !confirm(
        `Se van a eliminar ${imeis.length} ${imeis.length === 1 ? 'equipo' : 'equipos'}. ` +
          'Su historial de asignaciones se va con ellos. Esto no se puede deshacer. ¿Continuar?'
      )
    ) {
      return
    }
    setOcupado(true)
    const { error: e } = await borrarEquipos(imeis)
    setOcupado(false)
    if (e) {
      return setError(
        mensajeDeError(
          e,
          'No se pudieron eliminar. Un equipo con asignaciones registradas no se borra: finalízalas primero.'
        )
      )
    }
    limpiar()
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alerta>{error}</Alerta>}

      <DataGrid<Fila>
        filas={lista}
        columnas={columnas}
        titulo="Equipos"
        nombreArchivo="telecom-equipos"
        ordenInicial={{ campo: 'fecha_renovacion', direccion: 'asc' }}
        minAncho="1600px"
        vacio={{
          titulo: 'Sin equipos',
          descripcion: 'Agrega los teléfonos comprados para poder asignarlos y renovarlos a tiempo.',
        }}
        // Lo vencido, en rojo, dentro de la lista donde se decide qué
        // comprar: la alerta de arriba no sirve si al bajar desaparece.
        resaltar={(f) =>
          f.dias_para_renovacion !== null && f.dias_para_renovacion <= 0 ? 'bg-red-50/60' : null
        }
        resumen={(visibles) => {
          const bodega = visibles.filter((f) => f.estado === 'EN_BODEGA').length
          const renovar = visibles.filter(
            (f) => f.dias_para_renovacion !== null && f.dias_para_renovacion <= 0
          ).length
          return (
            <>
              <strong className="text-slate-900">{visibles.length}</strong>{' '}
              {visibles.length === 1 ? 'equipo' : 'equipos'} · {bodega} en bodega
              {renovar > 0 && (
                <span className="ml-1 font-semibold text-red-600">· {renovar} por renovar</span>
              )}
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
                Nuevo equipo
              </Boton>
            </>
          )
        }
        accionesSeleccion={(marcadas, limpiar) => {
          const borrables = marcadas.filter((id) =>
            lista.some((f) => f.id === id && puedeEliminarFila(f))
          )
          return puedeEliminar && borrables.length > 0 ? (
            <Boton
              variante="peligro"
              tamano="sm"
              disabled={ocupado}
              onClick={() => eliminar(borrables, limpiar)}
            >
              Eliminar {borrables.length}
            </Boton>
          ) : null
        }}
        accionFila={(f) =>
          puedeEditarFila(f) ? <BotonFila onClick={() => setEditando(f)}>Editar</BotonFila> : null
        }
      />

      {(creando || editando) && (
        <ModalEquipo
          key={editando?.imei ?? 'nuevo'}
          edicion={editando}
          onCerrar={() => {
            setCreando(false)
            setEditando(null)
          }}
          onGuardado={() => router.refresh()}
        />
      )}

      <ImportarEquipos
        abierto={importando}
        onCerrar={() => setImportando(false)}
        existentes={new Set(filas.map((f) => f.imei))}
      />

      <p className="px-1 text-xs text-slate-400">
        Toca el IMEI para ver por cuántas manos ha pasado. La{' '}
        <strong>fecha de renovación</strong> es la compra más 18 meses y la calcula la base: se
        corrige moviendo la fecha de compra, no escribiéndola.
      </p>
    </div>
  )
}

function ModalEquipo({
  edicion,
  onCerrar,
  onGuardado,
}: {
  /** Nulo: alta. Con fila: corrección del equipo. */
  edicion: Fila | null
  onCerrar: () => void
  onGuardado: () => void
}) {
  const e0 = edicion
  const [form, setForm] = useState({
    imei: e0?.imei ?? '',
    marca_modelo: e0?.marca_modelo ?? '',
    ram: e0?.ram ?? '',
    almacenamiento: e0?.almacenamiento ?? '',
    fecha_compra: e0?.fecha_compra ?? '',
    observaciones: e0?.observaciones ?? '',
    estado: (e0?.estado ?? 'EN_BODEGA') as string,
    estado_fisico: (e0?.estado_fisico ?? 'Activo') as string,
    fecha_devolucion: e0?.fecha_devolucion ?? '',
    notas_estado: e0?.notas_estado ?? '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cambiar = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value })

  async function guardar() {
    if (!form.imei.trim()) return setError('El IMEI es obligatorio: es la llave del equipo.')
    if (!form.marca_modelo.trim()) return setError('Falta la marca y el modelo.')
    if (form.fecha_devolucion && form.fecha_compra && form.fecha_devolucion < form.fecha_compra) {
      return setError('La devolución no puede ser anterior a la compra.')
    }
    if (form.estado_fisico === 'Devuelto' && !form.fecha_devolucion) {
      return setError('Un equipo devuelto lleva su fecha de devolución.')
    }
    setError(null)
    setGuardando(true)
    const comunes = {
      marca_modelo: form.marca_modelo.trim(),
      ram: form.ram.trim() || null,
      almacenamiento: form.almacenamiento.trim() || null,
      fecha_compra: form.fecha_compra || null,
      observaciones: form.observaciones.trim() || null,
      estado_fisico: form.estado_fisico,
      fecha_devolucion: form.fecha_devolucion || null,
      notas_estado: form.notas_estado.trim() || null,
    }
    const { error: e } = e0
      ? await guardarEquipo(e0.imei, {
          ...comunes,
          // «Asignado» lo pone la base: no se toca desde aquí.
          ...(e0.estado !== 'ASIGNADO' ? { estado: form.estado } : {}),
        } as CamposEquipo)
      : await crearEquipo({ imei: form.imei.trim(), ...comunes })
    setGuardando(false)
    if (e) {
      return setError(
        mensajeDeError(
          e,
          e0 ? 'No se pudo guardar el equipo.' : 'No se pudo crear. Si dice que ya existe, ese IMEI ya está registrado.'
        )
      )
    }
    onGuardado()
    onCerrar()
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={e0 ? `Editar equipo · ${e0.marca_modelo}` : 'Nuevo equipo'}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : e0 ? 'Guardar cambios' : 'Crear'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta>{error}</Alerta>}

        <Campo
          etiqueta="IMEI"
          requerido
          ayuda={e0 ? 'Es la llave del equipo y no se cambia.' : 'Es la llave del equipo: identifica ese aparato y ningún otro.'}
        >
          <Entrada
            value={form.imei}
            onChange={cambiar('imei')}
            placeholder="350000000000001"
            inputMode="numeric"
            disabled={Boolean(e0)}
            autoFocus={!e0}
          />
        </Campo>

        <Campo etiqueta="Marca y modelo" requerido>
          <Entrada value={form.marca_modelo} onChange={cambiar('marca_modelo')} placeholder="Samsung A15" />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="RAM">
            <Selector value={form.ram} onChange={cambiar('ram')}>
              <option value="">Sin dato</option>
              {conActual(['2 GB', '3 GB', '4 GB', '6 GB', '8 GB', '12 GB'], form.ram).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Almacenamiento">
            <Selector value={form.almacenamiento} onChange={cambiar('almacenamiento')}>
              <option value="">Sin dato</option>
              {conActual(['32 GB', '64 GB', '128 GB', '256 GB', '512 GB'], form.almacenamiento).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Selector>
          </Campo>
        </div>

        <Campo
          etiqueta="Fecha de compra"
          ayuda="De aquí sale la renovación: 18 meses después, calculados por la base."
        >
          <Entrada type="date" value={form.fecha_compra} onChange={cambiar('fecha_compra')} />
        </Campo>

        {/* ------------------------ Estado (77) ------------------------ */}
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Estado físico" ayuda="Cómo está el aparato.">
            <Selector value={form.estado_fisico} onChange={cambiar('estado_fisico')}>
              {ESTADOS_FISICOS.map((x) => (
                <option key={x.valor} value={x.valor}>
                  {x.etiqueta}
                </option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Fecha de devolución">
            <Entrada type="date" value={form.fecha_devolucion} onChange={cambiar('fecha_devolucion')} />
          </Campo>
        </div>

        {e0 && e0.estado !== 'ASIGNADO' && (
          <Campo etiqueta="Ubicación" ayuda="«Asignado» lo pone la base al entregarlo.">
            <Selector value={form.estado} onChange={cambiar('estado')}>
              {ESTADOS_EQUIPO.filter((x) => x.valor !== 'ASIGNADO').map((x) => (
                <option key={x.valor} value={x.valor}>
                  {x.etiqueta}
                </option>
              ))}
            </Selector>
          </Campo>
        )}

        <Campo etiqueta="Notas del estado">
          <Entrada
            value={form.notas_estado}
            onChange={cambiar('notas_estado')}
            placeholder="Pantalla rota, en taller desde…"
          />
        </Campo>

        <Campo etiqueta="Observaciones">
          <Entrada
            value={form.observaciones}
            onChange={cambiar('observaciones')}
            placeholder="Factura, garantía…"
          />
        </Campo>
      </div>
    </Modal>
  )
}

/** La lista fija más el valor que ya traiga el equipo, para no perderlo al editar. */
function conActual(lista: string[], actual: string): string[] {
  return actual && !lista.includes(actual) ? [...lista, actual] : lista
}
