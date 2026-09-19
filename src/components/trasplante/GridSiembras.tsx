'use client'

/**
 * Cuadrícula de siembra diaria.
 *
 * Es una TABLA analítica y no una lista agrupada por fecha: el cuadre se
 * hace ordenando y filtrando por lote, variedad o cumplimiento, y una
 * agrupación fija impide justamente eso.
 *
 * Se escribe SOBRE la tabla. El modal de «Editar» abría un formulario de
 * nueve campos para corregir una manzana mal tecleada; ahora se corrige
 * en su sitio y se guarda con Enter, como en una hoja de cálculo. El
 * modal sigue existiendo sólo para el cambio EN MASA, que es otra cosa:
 * ahí lo que se deja en blanco no se toca.
 *
 * Los productos aplicados también se editan aquí (`ProductosCelda`): son
 * una lista dentro de la fila y tienen su propio panel anclado a la
 * celda, porque un select y dos números por renglón no caben en una
 * celda de tabla.
 *
 * Toda la mecánica de la tabla es la estándar (`DataGrid`). Aquí sólo se
 * declara qué columnas tiene una siembra y qué se puede hacer con ella.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alerta, Boton } from '@/components/ui/Primitivos'
import { DataGrid } from '@/components/ui/DataGrid'
import { BotonFila } from '@/components/ui/BotonFila'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { mensajeDeError } from '@/lib/errores'
import {
  borrarSiembras,
  guardarProductosSiembra,
  guardarSiembra,
  type CamposSiembra,
  type ProductoParaGuardar,
} from '@/lib/trasplante/repositorioCliente'
import { cumplimiento } from '@/lib/trasplante/tabla'
import { n0, n2, pct } from '@/lib/trasplante/formato'
import {
  CICLOS_SIEMBRA,
  textoProductos,
  type FilaSiembra,
  type LoteOpcion,
  type Material,
  type Variedad,
} from '@/lib/trasplante/tipos'
import { EditarSiembraModal } from './EditarSiembraModal'
import { ImportarSiembras } from './ImportarSiembras'
import { ProductosCelda } from './ProductosCelda'

/** Qué columna de la tabla escribe qué campo de `siembras`. */
const CAMPOS: Record<string, keyof CamposSiembra> = {
  fecha_siembra: 'fecha_siembra',
  ut: 'lote_temporada_id',
  ciclo: 'ciclo',
  variedad: 'variedad_id',
  lote_variedad: 'lote_variedad',
  avance_mz: 'avance_mz',
  plantas_reportadas: 'plantas_reportadas',
  observaciones: 'observaciones',
}

/** Los campos que la base guarda como número. */
const NUMEROS = new Set<keyof CamposSiembra>(['ciclo', 'avance_mz', 'plantas_reportadas'])

export function GridSiembras({
  temporadaId,
  filas,
  lotes,
  variedades,
  materiales,
  puedeEditar,
  puedeEliminar,
}: {
  temporadaId: string
  filas: FilaSiembra[]
  lotes: LoteOpcion[]
  variedades: Variedad[]
  materiales: Material[]
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  const router = useRouter()
  const [enMasa, setEnMasa] = useState<string[] | null>(null)
  const [importar, setImportar] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const columnas = useMemo<ColumnaGrid<FilaSiembra>[]>(
    () => [
      {
        campo: 'fecha_siembra',
        label: 'Fecha',
        tipo: 'fecha',
        valor: (f) => f.fecha_siembra,
        editable: puedeEditar,
        editor: 'fecha',
      },
      { campo: 'semana', label: 'Semana', tipo: 'seleccion', valor: (f) => f.semana },
      {
        campo: 'ut',
        label: 'UT',
        tipo: 'seleccion',
        // La ubicación técnica es la clave con la que se habla en campo:
        // cortada a «1001…» no sirve para nada.
        ancho: '11rem',
        valor: (f) => f.ut,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.lote_temporada_id,
        opciones: lotes.map((l) => ({ value: l.lote_temporada_id, label: l.nomenclatura })),
        render: (f) => <span className="font-semibold text-slate-800">{f.ut}</span>,
      },
      // El nombre del lote faltaba: en campo nadie dice «1001-010», dicen
      // «Carretillo». Sale de `lotes` y por eso no se edita aquí.
      { campo: 'lote_nombre', label: 'Lote', tipo: 'seleccion', valor: (f) => f.lote_nombre },
      { campo: 'zona', label: 'Zona', tipo: 'seleccion', valor: (f) => f.zona },
      {
        campo: 'ciclo',
        label: 'Ciclo',
        tipo: 'seleccion',
        numero: true,
        valor: (f) => f.ciclo,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => String(f.ciclo),
        opciones: CICLOS_SIEMBRA.map((c) => ({ value: String(c), label: String(c) })),
      },
      {
        campo: 'variedad',
        label: 'Variedad',
        tipo: 'seleccion',
        ancho: '10rem',
        valor: (f) => f.variedad,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.variedad_id,
        opciones: variedades.map((v) => ({ value: v.id, label: v.nombre })),
      },
      { campo: 'cultivo', label: 'Cultivo', tipo: 'seleccion', valor: (f) => f.cultivo },
      {
        campo: 'lote_variedad',
        label: 'Lote variedad',
        tipo: 'texto',
        valor: (f) => f.lote_variedad,
        editable: puedeEditar,
        editor: 'texto',
      },
      {
        campo: 'avance_mz',
        label: 'Avance mz',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.avance_mz),
        etiqueta: (f) => n2(f.avance_mz),
        editable: puedeEditar,
        editor: 'numero',
        render: (f) => <span className="font-bold text-slate-900">{n2(f.avance_mz)}</span>,
      },
      {
        campo: 'acumulado_lote',
        label: 'Acum. lote',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.acumulado_lote === null ? null : Number(f.acumulado_lote)),
        etiqueta: (f) => n2(f.acumulado_lote),
      },
      {
        campo: 'plan_lote',
        label: 'Plan lote',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.plan_lote === null ? null : Number(f.plan_lote)),
        etiqueta: (f) => n2(f.plan_lote),
      },
      {
        campo: 'cumplimiento',
        label: '% Cumpl.',
        tipo: 'numero',
        numero: true,
        valor: cumplimiento,
        etiqueta: (f) => pct(cumplimiento(f)),
        render: (f) => <Cumplimiento valor={cumplimiento(f)} />,
      },
      {
        campo: 'plantas_reportadas',
        label: 'Plantas',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.plantas_reportadas === null ? null : Number(f.plantas_reportadas)),
        etiqueta: (f) => n0(f.plantas_reportadas),
        editable: puedeEditar,
        editor: 'numero',
      },
      {
        campo: 'plantas_mz',
        label: 'Plantas/mz',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.plantas_mz === null ? null : Number(f.plantas_mz)),
        etiqueta: (f) => n2(f.plantas_mz),
      },
      // --------------------------------------------------------------
      // Los productos. La celda se dibuja siempre con `render` —no con
      // el editor estándar— porque una lista de tres materiales con su
      // cantidad no es un valor que quepa en un campo de texto.
      // --------------------------------------------------------------
      {
        campo: 'productos',
        label: 'Productos aplicados',
        tipo: 'texto',
        ancho: '14rem',
        valor: (f) => textoProductos(f.productos),
        render: (f) => (
          <ProductosCelda
            productos={f.productos}
            materiales={materiales}
            editable={puedeEditar}
            onGuardar={(lista) => guardarProductos(f.id, lista)}
          />
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
        render: (f) => (
          <span
            className="block max-w-[220px] truncate text-xs"
            title={f.observaciones ?? undefined}
          >
            {f.observaciones ?? '—'}
          </span>
        ),
      },
      {
        campo: 'usuario_nombre',
        label: 'Capturó',
        tipo: 'seleccion',
        valor: (f) => f.usuario_nombre,
        render: (f) => (
          <span className="block max-w-[130px] truncate text-xs text-slate-400">
            {f.usuario_nombre ?? '—'}
          </span>
        ),
      },
    ],
    // `guardarProductos` es estable dentro del render de este componente
    // y no cambia lo que dibuja la columna.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lotes, variedades, materiales, puedeEditar]
  )

  /* ------------------------------ Escritura ---------------------------- */

  async function editarCelda(fila: FilaSiembra, campo: string, valor: unknown) {
    const cual = CAMPOS[campo]
    if (!cual) return

    setError(null)
    const limpio =
      valor === null || valor === ''
        ? null
        : NUMEROS.has(cual)
          ? Number(valor)
          : valor

    // El área y el ciclo son obligatorios en la base: vaciarlos haría
    // fallar el `update` con un mensaje de Postgres. Se avisa antes.
    if (limpio === null && (cual === 'avance_mz' || cual === 'ciclo' || cual === 'fecha_siembra')) {
      return setError('El área, el ciclo y la fecha no se pueden dejar en blanco.')
    }

    const { error: e } = await guardarSiembra(fila.id, { [cual]: limpio } as CamposSiembra)
    if (e) return setError(mensajeDeError(e, 'No se pudo guardar el cambio.'))
    router.refresh()
  }

  async function guardarProductos(siembraId: string, lista: ProductoParaGuardar[]) {
    setError(null)
    const { error: e } = await guardarProductosSiembra(siembraId, lista)
    if (e) {
      return setError(
        mensajeDeError(
          e,
          'No se pudieron guardar los productos. Si dice que no existe «fn_guardar_productos_siembra», falta correr la migración 46.'
        )
      )
    }
    router.refresh()
  }

  async function eliminar(ids: string[], limpiar: () => void) {
    if (ids.length === 0) return
    if (
      !confirm(
        `Se van a eliminar ${ids.length} ${
          ids.length === 1 ? 'registro' : 'registros'
        } de siembra. Esto no se puede deshacer. ¿Continuar?`
      )
    ) {
      return
    }
    setOcupado(true)
    const { error: e } = await borrarSiembras(ids)
    setOcupado(false)
    if (e) return setError(mensajeDeError(e, 'No se pudieron eliminar los registros.'))
    limpiar()
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alerta>{error}</Alerta>}

      <DataGrid<FilaSiembra>
        filas={filas}
        columnas={columnas}
        titulo="Siembra diaria"
        nombreArchivo={`siembra-diaria-${temporadaId.slice(0, 8)}`}
        ordenInicial={{ campo: 'fecha_siembra', direccion: 'desc' }}
        minAncho="1900px"
        puedeEditarCelda={puedeEditar}
        onEditarCelda={editarCelda}
        vacio={{
          titulo: 'No hay siembras capturadas',
          descripcion: 'Elige otra temporada o registra una siembra nueva.',
        }}
        // El resumen se calcula sobre LO QUE SE VE: filtrar por un lote
        // y leer los totales de la temporada entera es justo el error
        // que hace que alguien reporte mal las manzanas de un lote.
        resumen={(visibles) => <ResumenPorVariedad visibles={visibles} />}
        acciones={
          puedeEditar && (
            <Boton variante="secundario" tamano="sm" onClick={() => setImportar(true)}>
              Importar
            </Boton>
          )
        }
        accionesSeleccion={(ids, limpiar) => (
          <>
            {puedeEditar && (
              <Boton variante="secundario" tamano="sm" onClick={() => setEnMasa(ids)}>
                Editar {ids.length}
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
        accionFila={
          puedeEliminar
            ? (f) => (
                <BotonFila peligro onClick={() => eliminar([f.id], () => {})}>
                  Eliminar
                </BotonFila>
              )
            : undefined
        }
      />

      <EditarSiembraModal
        fila={null}
        enMasa={enMasa}
        lotes={lotes}
        variedades={variedades}
        onCerrar={() => setEnMasa(null)}
        onGuardado={() => router.refresh()}
      />

      <ImportarSiembras
        abierto={importar}
        onCerrar={() => setImportar(false)}
        temporadaId={temporadaId}
        lotes={lotes}
        variedades={variedades}
      />

      <p className="px-1 text-xs text-slate-400">
        Escribe sobre cualquier celda para corregirla; se guarda con Enter o al salir. Los
        productos aplicados se editan en su propia celda. La semana, el acumulado y las plantas por
        manzana los calcula la base y por eso no se tocan.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Resumen dinámico: manzanas y plántulas por variedad                 */
/* ------------------------------------------------------------------ */

/**
 * Los totales de lo que está a la vista, desglosados por variedad.
 *
 * Es la cuenta que se hacía a mano después de filtrar por un lote:
 * cuántas manzanas y cuántas plántulas llevaba cada variedad ahí. Se
 * recalcula con cada filtro porque está hecha sobre las filas visibles,
 * no sobre la consulta.
 */
function ResumenPorVariedad({ visibles }: { visibles: FilaSiembra[] }) {
  const porVariedad = useMemo(() => {
    const mapa = new Map<string, { variedad: string; mz: number; plantas: number }>()
    for (const f of visibles) {
      const x = mapa.get(f.variedad) ?? { variedad: f.variedad, mz: 0, plantas: 0 }
      x.mz += Number(f.avance_mz)
      x.plantas += Number(f.plantas_reportadas ?? 0)
      mapa.set(f.variedad, x)
    }
    return [...mapa.values()].sort((a, b) => b.mz - a.mz)
  }, [visibles])

  const mz = porVariedad.reduce((a, v) => a + v.mz, 0)
  const plantas = porVariedad.reduce((a, v) => a + v.plantas, 0)
  const lotesVistos = new Set(visibles.map((f) => f.ut)).size

  return (
    <div className="flex flex-col gap-1">
      <p>
        <strong className="text-slate-900">{n2(mz)} mz</strong> · {visibles.length}{' '}
        {visibles.length === 1 ? 'registro' : 'registros'} · {lotesVistos}{' '}
        {lotesVistos === 1 ? 'lote' : 'lotes'} · {n0(plantas)} plántulas
      </p>
      {porVariedad.length > 0 && (
        <p className="flex flex-wrap gap-1.5">
          {porVariedad.map((v) => (
            <span
              key={v.variedad}
              title={`${v.variedad}: ${n2(v.mz)} mz y ${n0(v.plantas)} plántulas`}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600"
            >
              {v.variedad} <span className="text-brand-700">{n2(v.mz)} mz</span>
              <span className="ml-1 font-normal text-slate-400">{n0(v.plantas)} pl.</span>
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

function Cumplimiento({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-slate-300">—</span>
  const tono =
    valor >= 99
      ? 'bg-emerald-100 text-emerald-800'
      : valor >= 50
        ? 'bg-brand-50 text-brand-800'
        : 'bg-amber-100 text-amber-800'
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${tono}`}>
      {pct(valor)}
    </span>
  )
}
