'use client'

/**
 * Las tres cargas masivas del módulo: líneas, equipos y entregas.
 *
 * Toda la mecánica —plantilla, archivo o pegado, vista previa fila por
 * fila, agregar o actualizar— es la estándar (`ImportarHoja`). Aquí sólo
 * se declara qué columnas tiene cada hoja, cómo se entiende una celda y
 * qué se escribe al confirmar.
 *
 * Las plantillas llevan DESPLEGABLES de los catálogos (`listas`): sin
 * ellos, quien llena el archivo tiene que adivinar cómo se escribe «Plan
 * Empresarial 5GB» y el importador rebota la fila por una tilde. Con
 * ellos Excel sólo deja elegir de la lista.
 *
 * Las entregas son el caso delicado: cada fila es una asignación
 * VIGENTE, así que una línea o un equipo que ya estén entregados hacen
 * fallar la fila —el índice de la base no admite dos— y eso se avisa en
 * la vista previa en vez de dejarlo reventar al guardar.
 */

import { ImportarHoja, type Preparada } from '@/components/ui/ImportarHoja'
import { aFecha, resolver } from '@/lib/importacion'
import { hoyIso } from '@/lib/fechas'
import { createClient } from '@/lib/supabase/client'
import type {
  FilaEquipo,
  FilaLinea,
  Persona,
  PlanTelecom,
} from '@/lib/telecom/tipos'

const cliente = () => createClient()

/* ================================================================== */
/* Líneas                                                              */
/* ================================================================== */

type LineaCarga = {
  numero: string
  proveedor: string | null
  plan_id: string | null
  observaciones: string | null
}

export function ImportarLineas({
  abierto,
  onCerrar,
  planes,
  existentes,
}: {
  abierto: boolean
  onCerrar: () => void
  planes: PlanTelecom[]
  existentes: Set<string>
}) {
  return (
    <ImportarHoja<LineaCarga>
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Líneas"
      ayuda="Una fila por número. El plan se elige del desplegable de la plantilla. Un número que ya exista se actualiza; no se duplica nunca."
      columnas={[
        { clave: 'numero', alias: ['Número', 'Numero', 'Línea', 'Teléfono'] },
        { clave: 'proveedor', alias: ['Proveedor', 'Operador'] },
        { clave: 'plan', alias: ['Plan'] },
        { clave: 'observaciones', alias: ['Observaciones', 'Notas'] },
      ]}
      cabecerasResumen={['Número', 'Proveedor', 'Plan']}
      ejemplo={['9999-9999', 'Tigo', planes[0]?.nombre ?? 'Plan $1', '']}
      listas={[{ columna: 2, titulo: 'Plan', valores: planes.map((p) => p.nombre) }]}
      interpretar={(c, numero) => {
        const linea = (c[0] ?? '').trim()
        const plan = resolver(c[2] ?? '', planes, (p) => [p.nombre])

        const valores: LineaCarga = {
          numero: linea,
          proveedor: (c[1] ?? '').trim() || null,
          plan_id: plan?.id ?? null,
          observaciones: (c[3] ?? '').trim() || null,
        }

        const salida: Preparada<LineaCarga> = {
          numero,
          accion: existentes.has(linea) ? 'actualizar' : 'insertar',
          resumen: [linea || '—', valores.proveedor ?? '—', plan?.nombre ?? '—'],
          valores,
        }
        if (!linea) {
          salida.accion = 'omitir'
          salida.error = 'Falta el número'
        } else if ((c[2] ?? '').trim() && !plan) {
          salida.accion = 'omitir'
          salida.error = 'Ese plan no está en el catálogo'
        }
        return salida
      }}
      guardar={async (filas) => {
        const { error } = await cliente()
          .from('telecom_lineas')
          .upsert(filas, { onConflict: 'numero' })
        return {
          error: error?.message ?? null,
          mensaje: `${filas.length} ${filas.length === 1 ? 'línea guardada' : 'líneas guardadas'}.`,
        }
      }}
    />
  )
}

/* ================================================================== */
/* Equipos                                                             */
/* ================================================================== */

type EquipoCarga = {
  imei: string
  marca_modelo: string
  ram: string | null
  almacenamiento: string | null
  fecha_compra: string | null
  observaciones: string | null
}

const RAMS = ['2 GB', '3 GB', '4 GB', '6 GB', '8 GB', '12 GB']
const ALMACENAMIENTOS = ['32 GB', '64 GB', '128 GB', '256 GB', '512 GB']

export function ImportarEquipos({
  abierto,
  onCerrar,
  existentes,
}: {
  abierto: boolean
  onCerrar: () => void
  existentes: Set<string>
}) {
  return (
    <ImportarHoja<EquipoCarga>
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Equipos"
      ayuda="Una fila por equipo. La fecha de renovación NO se carga: la calcula la base como la compra más 18 meses. Un IMEI que ya exista se actualiza."
      columnas={[
        { clave: 'imei', alias: ['IMEI'] },
        { clave: 'modelo', alias: ['Marca y modelo', 'Modelo', 'Equipo'] },
        { clave: 'ram', alias: ['RAM', 'Memoria RAM'] },
        { clave: 'almacenamiento', alias: ['Almacenamiento', 'Memoria'] },
        { clave: 'compra', alias: ['Fecha de compra', 'Compra'] },
        { clave: 'observaciones', alias: ['Observaciones', 'Notas'] },
      ]}
      cabecerasResumen={['IMEI', 'Modelo', 'Compra']}
      ejemplo={['350000000000001', 'Samsung A15', '4 GB', '128 GB', '2026-01-15', '']}
      listas={[
        { columna: 2, titulo: 'RAM', valores: RAMS },
        { columna: 3, titulo: 'Almacenamiento', valores: ALMACENAMIENTOS },
      ]}
      interpretar={(c, numero) => {
        const imei = (c[0] ?? '').trim()
        const modelo = (c[1] ?? '').trim()
        const compra = aFecha(c[4] ?? '')

        const valores: EquipoCarga = {
          imei,
          marca_modelo: modelo,
          ram: (c[2] ?? '').trim() || null,
          almacenamiento: (c[3] ?? '').trim() || null,
          fecha_compra: compra,
          observaciones: (c[5] ?? '').trim() || null,
        }

        const salida: Preparada<EquipoCarga> = {
          numero,
          accion: existentes.has(imei) ? 'actualizar' : 'insertar',
          resumen: [imei || '—', modelo || '—', compra ?? '—'],
          valores,
        }
        if (!imei) {
          salida.accion = 'omitir'
          salida.error = 'Falta el IMEI'
        } else if (!modelo) {
          salida.accion = 'omitir'
          salida.error = 'Falta la marca y el modelo'
        } else if ((c[4] ?? '').trim() && !compra) {
          salida.accion = 'omitir'
          salida.error = 'No se entiende la fecha de compra'
        }
        return salida
      }}
      guardar={async (filas) => {
        const { error } = await cliente()
          .from('telecom_equipos')
          .upsert(filas, { onConflict: 'imei' })
        return {
          error: error?.message ?? null,
          mensaje: `${filas.length} ${filas.length === 1 ? 'equipo guardado' : 'equipos guardados'}.`,
        }
      }}
    />
  )
}

/* ================================================================== */
/* Asignaciones                                                        */
/* ================================================================== */

type AsignacionCarga = {
  empleado_id: string
  linea_numero: string | null
  equipo_imei: string | null
  fecha_entrega: string
  fecha_devolucion_programada: string | null
  centro_costo: string | null
  departamento: string | null
  puesto: string | null
  correo_asignado: string | null
  accesorios_entregados: string[]
  observaciones: string | null
}

export function ImportarAsignaciones({
  abierto,
  onCerrar,
  personal,
  lineas,
  equipos,
  centrosCosto,
}: {
  abierto: boolean
  onCerrar: () => void
  personal: Persona[]
  lineas: FilaLinea[]
  equipos: FilaEquipo[]
  centrosCosto: string[]
}) {
  // Sólo lo entregable entra en el desplegable: ofrecer en la plantilla
  // una línea que ya tiene dueño es invitar a que la fila reviente al
  // guardar, cuando ya no se puede corregir cómodamente.
  const libres = lineas.filter((l) => l.estado === 'DISPONIBLE' && l.activo)
  const enBodega = equipos.filter((e) => e.estado === 'EN_BODEGA' && e.activo)

  const ocupadas = new Set(
    lineas.filter((l) => l.estado === 'ASIGNADA').map((l) => l.numero)
  )
  const ocupados = new Set(
    equipos.filter((e) => e.estado === 'ASIGNADO').map((e) => e.imei)
  )

  return (
    <ImportarHoja<AsignacionCarga>
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Entregas"
      ayuda="Una fila por entrega VIGENTE. El colaborador, la línea y el equipo se eligen de los desplegables. Los accesorios van separados por coma. Una línea o un equipo ya entregados se rechazan: primero hay que finalizar su entrega anterior."
      etiquetaActualizar="Ya entregado"
      columnas={[
        { clave: 'empleado', alias: ['Colaborador', 'Empleado', 'Nombre'] },
        { clave: 'linea', alias: ['Línea', 'Numero', 'Número', 'Teléfono'] },
        { clave: 'equipo', alias: ['IMEI', 'Equipo'] },
        { clave: 'entrega', alias: ['Fecha de entrega', 'Entrega'] },
        { clave: 'devolucion', alias: ['Devolución programada', 'Devolucion', 'Devolución'] },
        { clave: 'centro', alias: ['Centro de costo', 'Centro'] },
        { clave: 'departamento', alias: ['Departamento'] },
        { clave: 'puesto', alias: ['Puesto'] },
        { clave: 'correo', alias: ['Correo asignado', 'Correo', 'Email'] },
        { clave: 'accesorios', alias: ['Accesorios', 'Accesorios entregados'] },
        { clave: 'observaciones', alias: ['Observaciones', 'Notas'] },
      ]}
      cabecerasResumen={['Colaborador', 'Línea', 'Equipo', 'Entrega']}
      ejemplo={[
        personal[0]?.nombre ?? 'Nombre del colaborador',
        libres[0]?.numero ?? '',
        enBodega[0]?.imei ?? '',
        hoyIso(),
        '',
        centrosCosto[0] ?? 'CC-100',
        'Contabilidad',
        'Contador',
        'nombre@agrolibano.com',
        'Cargador, Forro protector',
        '',
      ]}
      listas={[
        {
          columna: 0,
          titulo: 'Colaborador',
          valores: personal.map((p) => p.nombre),
        },
        { columna: 1, titulo: 'Línea', valores: libres.map((l) => l.numero) },
        { columna: 2, titulo: 'IMEI', valores: enBodega.map((e) => e.imei) },
        { columna: 5, titulo: 'Centro de costo', valores: centrosCosto },
      ]}
      interpretar={(c, numero) => {
        const persona = resolver(c[0] ?? '', personal, (p) => [p.nombre, p.codigo ?? ''])
        const linea = resolver(c[1] ?? '', lineas, (l) => [l.numero])
        const equipo = resolver(c[2] ?? '', equipos, (e) => [e.imei, e.marca_modelo])
        const entrega = aFecha(c[3] ?? '') ?? hoyIso()
        const devolucion = aFecha(c[4] ?? '')

        const valores: AsignacionCarga = {
          empleado_id: persona?.id ?? '',
          linea_numero: linea?.numero ?? null,
          equipo_imei: equipo?.imei ?? null,
          fecha_entrega: entrega,
          fecha_devolucion_programada: devolucion,
          centro_costo: (c[5] ?? '').trim() || null,
          departamento: (c[6] ?? '').trim() || null,
          puesto: (c[7] ?? '').trim() || null,
          correo_asignado: (c[8] ?? '').trim() || null,
          accesorios_entregados: (c[9] ?? '')
            .split(/[,;]/)
            .map((x) => x.trim())
            .filter(Boolean),
          observaciones: (c[10] ?? '').trim() || null,
        }

        const salida: Preparada<AsignacionCarga> = {
          numero,
          accion: 'insertar',
          resumen: [
            persona?.nombre ?? (c[0] ?? '—'),
            linea?.numero ?? '—',
            equipo?.marca_modelo ?? '—',
            entrega,
          ],
          valores,
        }

        if (!persona) {
          salida.accion = 'omitir'
          salida.error = 'Ese colaborador no está en el catálogo de personal'
        } else if (!linea && !equipo) {
          salida.accion = 'omitir'
          salida.error = 'La fila no entrega ni línea ni equipo'
        } else if (linea && ocupadas.has(linea.numero)) {
          salida.accion = 'omitir'
          salida.error = 'Esa línea ya está entregada: finaliza su entrega anterior'
        } else if (equipo && ocupados.has(equipo.imei)) {
          salida.accion = 'omitir'
          salida.error = 'Ese equipo ya está entregado: finaliza su entrega anterior'
        } else if (devolucion && devolucion < entrega) {
          salida.accion = 'omitir'
          salida.error = 'La devolución es anterior a la entrega'
        }
        return salida
      }}
      guardar={async (filas) => {
        const supabase = cliente()
        const { data: sesion } = await supabase.auth.getUser()
        const usuarioId = sesion.user?.id
        if (!usuarioId) {
          return { error: 'La sesión expiró. Vuelve a entrar para importar.', mensaje: '' }
        }

        const { error } = await supabase
          .from('telecom_asignaciones')
          .insert(filas.map((f) => ({ ...f, usuario_id: usuarioId })))
        return {
          error: error?.message ?? null,
          mensaje: `${filas.length} ${filas.length === 1 ? 'entrega registrada' : 'entregas registradas'}.`,
        }
      }}
    />
  )
}

