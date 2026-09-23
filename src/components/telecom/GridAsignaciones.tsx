'use client'

/**
 * Quién tiene qué, y quién lo tuvo.
 *
 * Es la tabla que sostiene el módulo: el estado de las líneas y de los
 * equipos sale de aquí. Por eso una entrega no se «corrige» al pasarla a
 * otra persona: se FINALIZA y se abre otra. Lo que se corrige en la
 * celda son los datos administrativos —centro de costo, puesto, correo—,
 * que sí son del papel y no del hecho.
 *
 * Cada asignación vigente lleva su acta en PDF. El acta se arma con lo
 * que la fila trae, sin volver a consultar: la de una entrega finalizada
 * tiene que salir dentro de dos años exactamente igual que el día que se
 * firmó.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alerta, Boton, Insignia } from '@/components/ui/Primitivos'
import { DataGrid } from '@/components/ui/DataGrid'
import { BotonFila } from '@/components/ui/BotonFila'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { hoyIso } from '@/lib/fechas'
import { mensajeDeError } from '@/lib/errores'
import {
  borrarAsignaciones,
  finalizarAsignacion,
  guardarAsignacion,
  type CamposAsignacion,
} from '@/lib/telecom/repositorioCliente'
import {
  accesorios,
  estaAbierta,
  etiquetaCentro,
  ESTADOS_ASIGNACION,
  textoPlazo,
  type CentroCosto,
  type FilaAsignacion,
  type FilaEquipo,
  type FilaLinea,
  type Persona,
} from '@/lib/telecom/tipos'
import { ActaPreview } from './ActaPreview'
import { ImportarAsignaciones } from './Importadores'
import { ResumenAsignaciones } from './Resumenes'
import { Seccion } from './Seccion'

const CAMPOS: Record<string, keyof CamposAsignacion> = {
  fecha_devolucion_programada: 'fecha_devolucion_programada',
  centro_costo_etiqueta: 'centro_costo',
  departamento: 'departamento',
  puesto: 'puesto',
  correo_asignado: 'correo_asignado',
  observaciones: 'observaciones',
  estado: 'estado',
}

export function GridAsignaciones({
  filas,
  personal,
  lineas,
  equipos,
  centrosCosto,
  departamentos,
  puestos,
  puedeEditar,
  puedeEliminar,
  onNueva,
}: {
  filas: FilaAsignacion[]
  personal: Persona[]
  lineas: FilaLinea[]
  equipos: FilaEquipo[]
  centrosCosto: CentroCosto[]
  departamentos: string[]
  puestos: string[]
  puedeEditar: boolean
  puedeEliminar: boolean
  onNueva: () => void
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [importando, setImportando] = useState(false)
  // El acta se VE antes de decidir qué hacer con ella: imprimirla o
  // bajarla. Bajarla de golpe obligaba a abrir la descarga para
  // comprobar que no faltaba el correo, cerrar, corregir y repetir.
  const [acta, setActa] = useState<FilaAsignacion | null>(null)

  // Abiertas arriba —vigentes y en revisión, que son las que tienen algo
  // fuera— y finalizadas detrás de su título: con años de historial son
  // la mayor parte de las filas y casi nunca son lo que se viene a ver.
  const abiertas = useMemo(() => filas.filter(estaAbierta), [filas])
  const finalizadas = useMemo(() => filas.filter((f) => !estaAbierta(f)), [filas])

  // Las opciones de los campos de catálogo. Se añaden los valores que ya
  // están escritos en las filas aunque no estén en el catálogo: si no, al
  // abrir la celda de una entrega vieja el valor desaparecería.
  const conLosUsados = (delCatalogo: string[], enFilas: (string | null)[]) =>
    [...new Set([...delCatalogo, ...enFilas.filter((x): x is string => Boolean(x && x.trim()))])]
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
      .map((v) => ({ value: v, label: v }))

  const columnas = useMemo<ColumnaGrid<FilaAsignacion>[]>(
    () => [
      {
        campo: 'empleado',
        label: 'Colaborador',
        tipo: 'seleccion',
        ancho: '13rem',
        valor: (f) => f.empleado,
        render: (f) => (
          <span className="block min-w-0">
            <span className="block truncate font-semibold text-slate-800">{f.empleado}</span>
            {f.codigo_empleado && (
              <span className="block truncate text-xs text-slate-400">{f.codigo_empleado}</span>
            )}
          </span>
        ),
      },
      {
        campo: 'linea_numero',
        label: 'Línea',
        tipo: 'seleccion',
        valor: (f) => f.linea_numero,
        render: (f) =>
          f.linea_numero ? (
            <span className="flex flex-col">
              <span className="font-semibold">{f.linea_numero}</span>
              {f.plan_nombre && (
                <span
                  className={`text-[11px] ${
                    f.plan_es_retencion ? 'font-semibold text-amber-700' : 'text-slate-400'
                  }`}
                >
                  {f.plan_nombre}
                </span>
              )}
            </span>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          ),
      },
      {
        campo: 'marca_modelo',
        label: 'Equipo',
        tipo: 'seleccion',
        ancho: '12rem',
        valor: (f) => f.marca_modelo,
        render: (f) =>
          f.equipo_imei ? (
            <span className="flex flex-col">
              <span>{f.marca_modelo}</span>
              <span className="font-mono text-[11px] text-slate-400">{f.equipo_imei}</span>
            </span>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          ),
      },
      { campo: 'fecha_entrega', label: 'Entrega', tipo: 'fecha', valor: (f) => f.fecha_entrega },
      {
        campo: 'fecha_devolucion_programada',
        label: 'Devolución pactada',
        tipo: 'fecha',
        valor: (f) => f.fecha_devolucion_programada,
        editable: (f) => puedeEditar && f.estado === 'VIGENTE',
        editor: 'fecha',
        render: (f) =>
          f.fecha_devolucion_programada ? (
            <span className="flex flex-col">
              <span>{f.fecha_devolucion_programada}</span>
              {f.dias_para_devolucion !== null && f.dias_para_devolucion !== undefined && (
                <span
                  className={`text-[11px] font-semibold ${
                    f.dias_para_devolucion <= 0
                      ? 'text-red-600'
                      : f.dias_para_devolucion <= 7
                        ? 'text-amber-700'
                        : 'text-slate-400'
                  }`}
                >
                  {textoPlazo(f.dias_para_devolucion)}
                </span>
              )}
            </span>
          ) : (
            <span className="text-xs text-slate-300">Indefinida</span>
          ),
      },
      {
        campo: 'fecha_devolucion_real',
        label: 'Devuelto',
        tipo: 'fecha',
        valor: (f) => f.fecha_devolucion_real,
      },
      // Los tres salen de catálogos: en la celda son listas y no texto
      // libre, que es lo que hacía convivir «Contabilidad» con
      // «contabilidad» en el mismo reporte.
      {
        campo: 'departamento',
        label: 'Departamento',
        tipo: 'seleccion',
        ancho: '11rem',
        valor: (f) => f.departamento,
        editable: puedeEditar,
        editor: 'seleccion',
        opciones: [
          { value: '', label: 'Sin departamento' },
          ...conLosUsados(departamentos, filas.map((f) => f.departamento)),
        ],
      },
      {
        campo: 'puesto',
        label: 'Puesto',
        tipo: 'seleccion',
        ancho: '11rem',
        valor: (f) => f.puesto,
        editable: puedeEditar,
        editor: 'seleccion',
        opciones: [
          { value: '', label: 'Sin puesto' },
          ...conLosUsados(puestos, filas.map((f) => f.puesto)),
        ],
      },
      {
        // Se enseña «1020 - Agrícola» y se guarda el código: la etiqueta
        // la arma la base desde el catálogo, así que corregir el nombre
        // del centro corrige todas las entregas viejas de una vez.
        campo: 'centro_costo_etiqueta',
        label: 'Centro de costo',
        tipo: 'seleccion',
        ancho: '12rem',
        valor: (f) => f.centro_costo_etiqueta ?? etiquetaCentro(f.centro_costo, f.centro_costo_nombre),
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.centro_costo ?? '',
        opciones: [
          { value: '', label: 'Sin centro de costo' },
          ...centrosCosto.map((c) => ({
            value: c.codigo,
            label: etiquetaCentro(c.codigo, c.nombre),
          })),
        ],
      },
      {
        campo: 'correo_asignado',
        label: 'Correo',
        tipo: 'texto',
        ancho: '14rem',
        valor: (f) => f.correo_asignado,
        editable: puedeEditar,
        editor: 'texto',
      },
      {
        campo: 'accesorios_entregados',
        label: 'Accesorios',
        tipo: 'texto',
        ancho: '13rem',
        valor: (f) => accesorios(f.accesorios_entregados).join(', '),
        render: (f) => {
          const lista = accesorios(f.accesorios_entregados)
          if (lista.length === 0) return <span className="text-xs text-slate-300">Ninguno</span>
          return (
            <span className="flex flex-wrap gap-1">
              {lista.map((a) => (
                <span
                  key={a}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600"
                >
                  {a}
                </span>
              ))}
            </span>
          )
        },
      },
      {
        campo: 'estado',
        label: 'Estado',
        tipo: 'seleccion',
        valor: (f) => f.estado,
        etiqueta: (f) => ESTADOS_ASIGNACION.find((e) => e.valor === f.estado)?.etiqueta ?? f.estado,
        // Se puede mover entre Vigente y Revisar en la celda. Finalizar
        // NO: cierra la entrega y libera la línea, y eso lo hace su
        // función para que la fecha real de devolución no quede vacía.
        editable: (f) => puedeEditar && f.estado !== 'FINALIZADA',
        editor: 'seleccion',
        opciones: ESTADOS_ASIGNACION.filter((e) => e.valor !== 'FINALIZADA').map((e) => ({
          value: e.valor,
          label: e.etiqueta,
        })),
        render: (f) => {
          const e = ESTADOS_ASIGNACION.find((x) => x.valor === f.estado)
          return <Insignia tono={e?.tono ?? 'gris'}>{e?.etiqueta ?? f.estado}</Insignia>
        },
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
      { campo: 'capturo', label: 'Registró', tipo: 'seleccion', valor: (f) => f.capturo },
    ],
    [puedeEditar, centrosCosto, departamentos, puestos, filas]
  )

  async function editarCelda(fila: FilaAsignacion, campo: string, valor: unknown) {
    const cual = CAMPOS[campo]
    if (!cual) return
    setError(null)
    const { error: e } = await guardarAsignacion(fila.id, {
      [cual]: valor === '' ? null : valor,
    } as CamposAsignacion)
    if (e) return setError(mensajeDeError(e, 'No se pudo guardar el cambio.'))
    router.refresh()
  }

  async function finalizar(ids: string[], limpiar?: () => void) {
    // Cualquiera que siga abierta: una en revisión también se finaliza
    // —de hecho es lo normal, se revisa y se cierra—.
    const vigentes = filas.filter((f) => ids.includes(f.id) && estaAbierta(f))
    if (vigentes.length === 0) return
    if (
      !confirm(
        `Se van a finalizar ${vigentes.length} ${
          vigentes.length === 1 ? 'asignación' : 'asignaciones'
        } con fecha de hoy. La línea y el equipo vuelven a quedar disponibles y la entrega se queda en el historial. ¿Continuar?`
      )
    ) {
      return
    }

    setOcupado(true)
    setError(null)
    for (const f of vigentes) {
      const { error: e } = await finalizarAsignacion(f.id, hoyIso())
      if (e) {
        setOcupado(false)
        return setError(
          mensajeDeError(
            e,
            'No se pudo finalizar. Si dice que no existe «fn_telecom_finalizar_asignacion», falta correr la migración 47.'
          )
        )
      }
    }
    setOcupado(false)
    limpiar?.()
    setAviso(
      `${vigentes.length} ${vigentes.length === 1 ? 'asignación finalizada' : 'asignaciones finalizadas'}. Lo entregado volvió a quedar disponible.`
    )
    router.refresh()
  }

  async function eliminar(ids: string[], limpiar: () => void) {
    if (ids.length === 0) return
    if (
      !confirm(
        `Se van a eliminar ${ids.length} ${ids.length === 1 ? 'registro' : 'registros'} del historial. ` +
          'Para cerrar una entrega usa «Finalizar»: eliminar borra el rastro de que existió. ¿Continuar?'
      )
    ) {
      return
    }
    setOcupado(true)
    const { error: e } = await borrarAsignaciones(ids)
    setOcupado(false)
    if (e) return setError(mensajeDeError(e, 'No se pudieron eliminar.'))
    limpiar()
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alerta>{error}</Alerta>}
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}

      <ResumenAsignaciones filas={filas} />

      <Seccion
        titulo="Asignaciones vigentes y en revisión"
        descripcion="Lo que está fuera ahora mismo"
        cuantos={abiertas.length}
      >
      <DataGrid<FilaAsignacion>
        filas={abiertas}
        columnas={columnas}
        titulo="Asignaciones"
        nombreArchivo="telecom-asignaciones"
        ordenInicial={{ campo: 'fecha_entrega', direccion: 'desc' }}
        minAncho="2100px"
        puedeEditarCelda={puedeEditar}
        onEditarCelda={editarCelda}
        vacio={{
          titulo: 'Sin entregas registradas',
          descripcion: 'Registra una entrega para saber quién tiene cada línea y cada equipo.',
        }}
        // Ámbar lo que está EN REVISIÓN —pide una decisión— y rojo lo que
        // ya debería estar devuelto. El rojo gana: una entrega en revisión
        // y además vencida es primero un problema de devolución.
        resaltar={(f) => {
          const vencida =
            estaAbierta(f) &&
            f.dias_para_devolucion !== null &&
            f.dias_para_devolucion !== undefined &&
            f.dias_para_devolucion <= 0
          if (vencida) return 'bg-red-50/60'
          return f.estado === 'REVISAR' ? 'bg-amber-50/70' : null
        }}
        resumen={(visibles) => {
          const vigentes = visibles.filter((f) => f.estado === 'VIGENTE').length
          const revisar = visibles.filter((f) => f.estado === 'REVISAR').length
          const vencidas = visibles.filter(
            (f) =>
              estaAbierta(f) &&
              f.dias_para_devolucion !== null &&
              f.dias_para_devolucion !== undefined &&
              f.dias_para_devolucion <= 0
          ).length
          return (
            <>
              <strong className="text-slate-900">{vigentes}</strong> vigente
              {vigentes === 1 ? '' : 's'} de {visibles.length}
              {revisar > 0 && (
                <span className="ml-1 font-semibold text-amber-700">· {revisar} por revisar</span>
              )}
              {vencidas > 0 && (
                <span className="ml-1 font-semibold text-red-600">· {vencidas} por recoger</span>
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
              <Boton variante="secundario" tamano="sm" onClick={onNueva}>
                Entregar
              </Boton>
            </>
          )
        }
        accionesSeleccion={(ids, limpiar) => {
          const vigentes = ids.filter((id) =>
            filas.some((f) => f.id === id && estaAbierta(f))
          )
          return (
            <>
              {puedeEditar && vigentes.length > 0 && (
                <Boton
                  variante="secundario"
                  tamano="sm"
                  disabled={ocupado}
                  onClick={() => finalizar(vigentes, limpiar)}
                >
                  Finalizar {vigentes.length}
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
          )
        }}
        accionFila={(f) => (
          <span className="flex justify-end gap-1">
            <BotonFila onClick={() => setActa(f)}>Acta</BotonFila>
            {puedeEditar && estaAbierta(f) && (
              <BotonFila onClick={() => finalizar([f.id])}>Finalizar</BotonFila>
            )}
          </span>
        )}
      />

      </Seccion>

      <Seccion
        titulo="Asignaciones finalizadas"
        descripcion="Ya devueltas. Se quedan aquí porque son el historial de cada línea y cada equipo."
        cuantos={finalizadas.length}
        abiertoInicial={false}
        tono="apagado"
      >
        <DataGrid<FilaAsignacion>
          filas={finalizadas}
          columnas={columnas}
          titulo="Asignaciones finalizadas"
          nombreArchivo="telecom-asignaciones-finalizadas"
          ordenInicial={{ campo: 'fecha_devolucion_real', direccion: 'desc' }}
          minAncho="2100px"
          puedeEditarCelda={puedeEditar}
          onEditarCelda={editarCelda}
          vacio={{
            titulo: 'Ninguna finalizada',
            descripcion: 'Todo lo entregado sigue fuera.',
          }}
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
          accionFila={(f) => <BotonFila onClick={() => setActa(f)}>Acta</BotonFila>}
        />
      </Seccion>

      <ActaPreview asignacion={acta} onCerrar={() => setActa(null)} />

      <ImportarAsignaciones
        abierto={importando}
        onCerrar={() => setImportando(false)}
        personal={personal}
        lineas={lineas}
        equipos={equipos}
        centrosCosto={centrosCosto.map((c) => c.codigo)}
      />

      <p className="px-1 text-xs text-slate-400">
        <strong>Finalizar</strong> cierra la entrega con la fecha de hoy y devuelve la línea y el
        equipo a disponibles; el registro se queda en el historial. Para pasarle algo a otra persona
        se finaliza y se entrega de nuevo: así queda por cuántas manos pasó. El estado{' '}
        <strong>Revisar</strong> es para lo que está en duda —el equipo no aparece, el colaborador
        se fue sin devolverlo—: sigue contando como entregado y la fila se pinta de ámbar.
      </p>
    </div>
  )
}
