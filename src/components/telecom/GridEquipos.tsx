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
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alerta, Boton, Campo, Entrada, Insignia, Selector } from '@/components/ui/Primitivos'
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
import { ESTADOS_EQUIPO, textoPlazo, type FilaEquipo } from '@/lib/telecom/tipos'
import { ImportarEquipos } from './Importadores'
import type { Consulta } from './HistorialModal'

type Fila = FilaEquipo & { id: string }

const CAMPOS: Record<string, keyof CamposEquipo> = {
  marca_modelo: 'marca_modelo',
  ram: 'ram',
  almacenamiento: 'almacenamiento',
  fecha_compra: 'fecha_compra',
  estado: 'estado',
  observaciones: 'observaciones',
}

export function GridEquipos({
  filas,
  puedeEditar,
  puedeEliminar,
  onHistorial,
}: {
  filas: FilaEquipo[]
  puedeEditar: boolean
  puedeEliminar: boolean
  onHistorial: (c: Consulta) => void
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
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
        editable: puedeEditar,
        editor: 'texto',
      },
      {
        campo: 'ram',
        label: 'RAM',
        tipo: 'seleccion',
        valor: (f) => f.ram,
        editable: puedeEditar,
        editor: 'texto',
      },
      {
        campo: 'almacenamiento',
        label: 'Almacenamiento',
        tipo: 'seleccion',
        valor: (f) => f.almacenamiento,
        editable: puedeEditar,
        editor: 'texto',
      },
      {
        campo: 'fecha_compra',
        label: 'Compra',
        tipo: 'fecha',
        valor: (f) => f.fecha_compra,
        editable: puedeEditar,
        editor: 'fecha',
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
        // «Dañado» sí es una decisión humana; «Asignado» lo pone la base.
        editable: (f) => puedeEditar && f.estado !== 'ASIGNADO',
        editor: 'seleccion',
        opciones: [
          { value: 'EN_BODEGA', label: 'En bodega' },
          { value: 'DANADO', label: 'Dañado' },
        ],
        render: (f) => {
          const e = ESTADOS_EQUIPO.find((x) => x.valor === f.estado)
          return <Insignia tono={e?.tono ?? 'gris'}>{e?.etiqueta ?? f.estado}</Insignia>
        },
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
        editable: puedeEditar,
        editor: 'texto',
      },
    ],
    [puedeEditar, onHistorial]
  )

  async function editarCelda(fila: Fila, campo: string, valor: unknown) {
    const cual = CAMPOS[campo]
    if (!cual) return
    setError(null)
    const { error: e } = await guardarEquipo(fila.imei, {
      [cual]: valor === '' ? null : valor,
    } as CamposEquipo)
    if (e) return setError(mensajeDeError(e, 'No se pudo guardar el cambio.'))
    router.refresh()
  }

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
        minAncho="1400px"
        puedeEditarCelda={puedeEditar}
        onEditarCelda={editarCelda}
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
      />

      <ModalNuevoEquipo
        abierto={creando}
        onCerrar={() => setCreando(false)}
        onGuardado={() => router.refresh()}
      />

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

function ModalNuevoEquipo({
  abierto,
  onCerrar,
  onGuardado,
}: {
  abierto: boolean
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [form, setForm] = useState({
    imei: '',
    marca_modelo: '',
    ram: '',
    almacenamiento: '',
    fecha_compra: '',
    observaciones: '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cambiar = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value })

  async function guardar() {
    if (!form.imei.trim()) return setError('El IMEI es obligatorio: es la llave del equipo.')
    if (!form.marca_modelo.trim()) return setError('Falta la marca y el modelo.')
    setError(null)
    setGuardando(true)
    const { error: e } = await crearEquipo({
      imei: form.imei.trim(),
      marca_modelo: form.marca_modelo.trim(),
      ram: form.ram.trim() || null,
      almacenamiento: form.almacenamiento.trim() || null,
      fecha_compra: form.fecha_compra || null,
      observaciones: form.observaciones.trim() || null,
    })
    setGuardando(false)
    if (e) {
      return setError(
        mensajeDeError(e, 'No se pudo crear. Si dice que ya existe, ese IMEI ya está registrado.')
      )
    }
    setForm({ imei: '', marca_modelo: '', ram: '', almacenamiento: '', fecha_compra: '', observaciones: '' })
    onGuardado()
    onCerrar()
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Nuevo equipo"
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

        <Campo etiqueta="IMEI" requerido ayuda="Es la llave del equipo: identifica ese aparato y ningún otro.">
          <Entrada
            value={form.imei}
            onChange={cambiar('imei')}
            placeholder="350000000000001"
            inputMode="numeric"
            autoFocus
          />
        </Campo>

        <Campo etiqueta="Marca y modelo" requerido>
          <Entrada value={form.marca_modelo} onChange={cambiar('marca_modelo')} placeholder="Samsung A15" />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="RAM">
            <Selector value={form.ram} onChange={cambiar('ram')}>
              <option value="">Sin dato</option>
              {['2 GB', '3 GB', '4 GB', '6 GB', '8 GB', '12 GB'].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Almacenamiento">
            <Selector value={form.almacenamiento} onChange={cambiar('almacenamiento')}>
              <option value="">Sin dato</option>
              {['32 GB', '64 GB', '128 GB', '256 GB', '512 GB'].map((v) => (
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
