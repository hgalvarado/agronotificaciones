'use client'

/**
 * Historial de contadores: qué horómetro físico llevaba cada equipo y
 * desde cuándo.
 *
 * Existe por una sola razón: cuando se avería un tablero, el contador
 * nuevo arranca de cero y ese salto aparecería en el control de
 * horómetros como un desfase de miles de horas. Registrar el cambio le
 * dice al comparativo dónde romper la cadena.
 *
 * Es sólo pantalla. No valida (`lib/contadores/validacion`), no guarda
 * (`lib/contadores/repositorio`) y no decide a qué contador pertenece una
 * jornada: eso lo deduce la base contra estas fechas.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alerta, Boton, Campo, Entrada, Esqueleto, Insignia, Selector, Tarjeta } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { DataGrid } from '@/components/ui/DataGrid'
import { IconPlus } from '@/components/ui/Icons'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { aEntradaLocal } from '@/lib/fechas'
import { formatearFechaHora } from '@/lib/estados'
import {
  AVISO_SIN_MIGRACION,
  eliminarPeriodos,
  faltaMigracion,
  guardarPeriodo,
  leerContadores,
  registrarCambio,
} from '@/lib/contadores/repositorio'
import { validarCambio, validarPeriodo } from '@/lib/contadores/validacion'
import { CAMBIO_VACIO, type EntradaCambio, type EntradaPeriodo, type FilaContador } from '@/lib/contadores/tipos'

export type EquipoOpcion = { id: string; codigo: string; contador_sap: string | null }

export function GestionContadores({
  equipos,
  puedeEditar,
  puedeEliminar,
}: {
  equipos: EquipoOpcion[]
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  const [filas, setFilas] = useState<FilaContador[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [sinMigracion, setSinMigracion] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const [nuevo, setNuevo] = useState<EntradaCambio | null>(null)
  const [editando, setEditando] = useState<FilaContador | null>(null)

  const recargar = useCallback(async () => {
    const { datos, error: e } = await leerContadores()
    if (e) {
      setSinMigracion(faltaMigracion(e))
      setError(faltaMigracion(e) ? null : e)
      setFilas([])
      return
    }
    setSinMigracion(false)
    setError(null)
    setFilas(datos)
  }, [])

  useEffect(() => {
    let vivo = true
    void (async () => {
      await recargar()
      if (!vivo) return
    })()
    return () => {
      vivo = false
    }
  }, [recargar])

  /* ------------------------------ Columnas ----------------------------- */

  const columnas = useMemo<ColumnaGrid<FilaContador>[]>(
    () => [
      {
        campo: 'equipo_codigo',
        label: 'Equipo',
        tipo: 'seleccion',
        valor: (f) => f.equipo_codigo,
        render: (f) => <span className="font-bold text-slate-900">{f.equipo_codigo}</span>,
      },
      {
        campo: 'contador',
        label: 'Contador',
        tipo: 'texto',
        valor: (f) => f.contador,
        render: (f) => <span className="font-mono text-sm text-slate-900">{f.contador}</span>,
      },
      {
        campo: 'contador_anterior',
        label: 'Contador anterior',
        tipo: 'texto',
        valor: (f) => f.contador_anterior,
        render: (f) => (
          <span className="font-mono text-xs text-slate-400">{f.contador_anterior ?? '—'}</span>
        ),
      },
      {
        campo: 'vigente_desde',
        label: 'Desde',
        tipo: 'fecha',
        valor: (f) => f.vigente_desde,
        etiqueta: (f) => formatearFechaHora(f.vigente_desde),
        render: (f) => <span className="text-xs">{formatearFechaHora(f.vigente_desde)}</span>,
      },
      {
        campo: 'vigente_hasta',
        label: 'Hasta',
        tipo: 'fecha',
        valor: (f) => f.vigente_hasta,
        etiqueta: (f) => (f.vigente_hasta ? formatearFechaHora(f.vigente_hasta) : 'Sigue puesto'),
        render: (f) =>
          f.vigente_hasta ? (
            <span className="text-xs">{formatearFechaHora(f.vigente_hasta)}</span>
          ) : (
            <Insignia tono="verde">Sigue puesto</Insignia>
          ),
      },
      {
        campo: 'jornadas',
        label: 'Jornadas',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.jornadas),
        render: (f) => (
          <span className="font-bold text-brand-700 tabular-nums">{f.jornadas}</span>
        ),
      },
      {
        campo: 'motivo',
        label: 'Motivo',
        tipo: 'texto',
        valor: (f) => f.motivo,
        render: (f) => (
          <span className="block max-w-[260px] truncate text-xs text-slate-500">
            {f.motivo ?? '—'}
          </span>
        ),
      },
      {
        campo: 'usuario_nombre',
        label: 'Registró',
        tipo: 'seleccion',
        valor: (f) => f.usuario_nombre,
        render: (f) => (
          <span className="block max-w-[150px] truncate text-xs text-slate-400">
            {f.usuario_nombre ?? '—'}
          </span>
        ),
      },
    ],
    []
  )

  /* ------------------------------ Escritura ---------------------------- */

  async function crear(entrada: EntradaCambio) {
    const problema = validarCambio(entrada)
    if (problema) return setError(problema)

    setOcupado(true)
    setError(null)
    const r = await registrarCambio(entrada)
    setOcupado(false)

    if (!r.ok) return setError(r.mensaje)
    setNuevo(null)
    setAviso(r.mensaje)
    await recargar()
  }

  async function editar(fila: FilaContador, entrada: EntradaPeriodo) {
    const problema = validarPeriodo(entrada)
    if (problema) return setError(problema)

    setOcupado(true)
    setError(null)
    const r = await guardarPeriodo(fila.id, entrada)
    setOcupado(false)

    if (!r.ok) return setError(r.mensaje)
    setEditando(null)
    setAviso(r.mensaje)
    await recargar()
  }

  async function eliminar(ids: string[], limpiar?: () => void) {
    setOcupado(true)
    setError(null)
    const r = await eliminarPeriodos(ids)
    setOcupado(false)

    if (!r.ok) return setError(r.mensaje)
    limpiar?.()
    setAviso(r.mensaje)
    await recargar()
  }

  /* -------------------------------- Vista ------------------------------ */

  if (sinMigracion) return <Alerta tono="ambar">{AVISO_SIN_MIGRACION}</Alerta>

  return (
    <div className="flex flex-col gap-4">
      {error && <Alerta>{error}</Alerta>}
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}

      {filas === null ? (
        <Tarjeta className="flex flex-col gap-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Esqueleto key={i} className="h-8 w-full" />
          ))}
        </Tarjeta>
      ) : (
        <DataGrid<FilaContador>
          filas={filas}
          columnas={columnas}
          titulo="Contadores"
          nombreArchivo="contadores-de-horometro"
          ordenInicial={{ campo: 'vigente_desde', direccion: 'desc' }}
          minAncho="1200px"
          seleccionable={puedeEliminar}
          vacio={{
            titulo: 'Sin cambios de tablero registrados',
            descripcion:
              'Mientras un equipo no cambie de contador no hace falta registrar nada: el comparativo encadena solo.',
          }}
          resaltar={(f) =>
            f.vigente ? 'bg-brand-50/70 shadow-[inset_4px_0_0_0_var(--color-brand-600)]' : null
          }
          acciones={
            puedeEditar ? (
              <Boton onClick={() => setNuevo({ ...CAMBIO_VACIO })}>
                <IconPlus className="h-4 w-4" />
                Registrar cambio
              </Boton>
            ) : null
          }
          accionFila={(f) => (
            <div className="flex gap-1">
              {puedeEditar && (
                <Boton variante="secundario" onClick={() => setEditando(f)}>
                  Editar
                </Boton>
              )}
              {puedeEliminar && (
                <Boton
                  variante="secundario"
                  disabled={ocupado}
                  onClick={() => void eliminar([f.id])}
                >
                  Eliminar
                </Boton>
              )}
            </div>
          )}
          accionesSeleccion={(ids, limpiar) =>
            puedeEliminar ? (
              <Boton variante="secundario" disabled={ocupado} onClick={() => void eliminar(ids, limpiar)}>
                Eliminar {ids.length}
              </Boton>
            ) : null
          }
        />
      )}

      {nuevo && (
        <ModalCambio
          equipos={equipos}
          entrada={nuevo}
          onCambiar={setNuevo}
          onGuardar={() => void crear(nuevo)}
          onCerrar={() => {
            setNuevo(null)
            setError(null)
          }}
          ocupado={ocupado}
        />
      )}

      {editando && (
        <ModalPeriodo
          fila={editando}
          onGuardar={(e) => void editar(editando, e)}
          onCerrar={() => {
            setEditando(null)
            setError(null)
          }}
          ocupado={ocupado}
        />
      )}
    </div>
  )
}

/* ==================================================================== */
/* Registrar un cambio de tablero                                       */
/* ==================================================================== */
/* Los modales van a nivel de módulo, no dentro del componente de
   arriba: definidos dentro, React los remonta en cada render del padre y
   el formulario perdería lo escrito a cada tecla. */

function ModalCambio({
  equipos,
  entrada,
  onCambiar,
  onGuardar,
  onCerrar,
  ocupado,
}: {
  equipos: EquipoOpcion[]
  entrada: EntradaCambio
  onCambiar: (e: EntradaCambio) => void
  onGuardar: () => void
  onCerrar: () => void
  ocupado: boolean
}) {
  const equipo = equipos.find((e) => e.id === entrada.equipoId)

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo="Registrar cambio de tablero"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={ocupado}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={onGuardar} disabled={ocupado}>
            {ocupado ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">
          A partir del momento que elijas, las jornadas de este equipo pasan al contador nuevo y el
          comparativo arranca de cero. Lo capturado antes se queda con el contador anterior.
        </p>

        <Campo etiqueta="Equipo" requerido>
          <Selector
            value={entrada.equipoId}
            onChange={(e) => {
              const elegido = equipos.find((x) => x.id === e.target.value)
              onCambiar({
                ...entrada,
                equipoId: e.target.value,
                // El contador que sale se propone solo: es el que el
                // catálogo tiene puesto, y teclearlo a mano es la forma
                // más fácil de equivocarse.
                contadorViejo: elegido?.contador_sap ?? '',
              })
            }}
          >
            <option value="">Elige el equipo…</option>
            {equipos.map((e) => (
              <option key={e.id} value={e.id}>
                {e.codigo}
                {e.contador_sap ? ` · contador ${e.contador_sap}` : ''}
              </option>
            ))}
          </Selector>
        </Campo>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo
            etiqueta="Contador anterior"
            ayuda={equipo?.contador_sap ? 'Viene del catálogo de equipos.' : 'Opcional si nunca se registró.'}
          >
            <Entrada
              value={entrada.contadorViejo}
              onChange={(e) => onCambiar({ ...entrada, contadorViejo: e.target.value })}
              placeholder="El que se retira"
            />
          </Campo>

          <Campo etiqueta="Contador nuevo" requerido>
            <Entrada
              value={entrada.contadorNuevo}
              onChange={(e) => onCambiar({ ...entrada, contadorNuevo: e.target.value })}
              placeholder="Número de contador SAP"
            />
          </Campo>
        </div>

        <Campo
          etiqueta="Desde"
          ayuda="Fecha y hora en que empezó a usarse el contador nuevo. Hora de Honduras."
          requerido
        >
          <Entrada
            type="datetime-local"
            value={entrada.desde}
            onChange={(e) => onCambiar({ ...entrada, desde: e.target.value })}
          />
        </Campo>

        <Campo etiqueta="Motivo del cambio">
          <Entrada
            value={entrada.motivo}
            onChange={(e) => onCambiar({ ...entrada, motivo: e.target.value })}
            placeholder="Se quemó el tablero, se cambió la cabina…"
          />
        </Campo>
      </div>
    </Modal>
  )
}

/* ==================================================================== */
/* Corregir un periodo ya registrado                                    */
/* ==================================================================== */

function ModalPeriodo({
  fila,
  onGuardar,
  onCerrar,
  ocupado,
}: {
  fila: FilaContador
  onGuardar: (e: EntradaPeriodo) => void
  onCerrar: () => void
  ocupado: boolean
}) {
  const [entrada, setEntrada] = useState<EntradaPeriodo>({
    contador: fila.contador,
    contadorAnterior: fila.contador_anterior ?? '',
    motivo: fila.motivo ?? '',
    desde: aEntradaLocal(fila.vigente_desde),
    hasta: aEntradaLocal(fila.vigente_hasta),
  })

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`Editar contador de ${fila.equipo_codigo}`}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={ocupado}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={() => onGuardar(entrada)} disabled={ocupado}>
            {ocupado ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">
          Mover estas fechas recoloca solo las jornadas: ahora mismo este periodo cubre{' '}
          <strong>{fila.jornadas}</strong>. No hay que corregir ningún horómetro a mano.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Contador" requerido>
            <Entrada
              value={entrada.contador}
              onChange={(e) => setEntrada({ ...entrada, contador: e.target.value })}
            />
          </Campo>
          <Campo etiqueta="Contador anterior">
            <Entrada
              value={entrada.contadorAnterior}
              onChange={(e) => setEntrada({ ...entrada, contadorAnterior: e.target.value })}
            />
          </Campo>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Desde" requerido>
            <Entrada
              type="datetime-local"
              value={entrada.desde}
              onChange={(e) => setEntrada({ ...entrada, desde: e.target.value })}
            />
          </Campo>
          <Campo etiqueta="Hasta" ayuda="Vacío significa que es el contador puesto hoy.">
            <Entrada
              type="datetime-local"
              value={entrada.hasta}
              onChange={(e) => setEntrada({ ...entrada, hasta: e.target.value })}
            />
          </Campo>
        </div>

        <Campo etiqueta="Motivo del cambio">
          <Entrada
            value={entrada.motivo}
            onChange={(e) => setEntrada({ ...entrada, motivo: e.target.value })}
          />
        </Campo>
      </div>
    </Modal>
  )
}
