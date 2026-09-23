'use client'

/**
 * Entregar una línea, un equipo o los dos.
 *
 * Sólo ofrece lo que de verdad se puede entregar: una línea asignada no
 * sale en la lista. La base lo impide igualmente con un índice, pero
 * enterarse al guardar, después de llenar ocho campos, es la forma más
 * cara de enterarse.
 *
 * ALTA EN LÍNEA. Todo campo que dependa de un catálogo trae su «Crear»
 * dentro del propio selector: el colaborador, la línea, el equipo, el
 * centro de costo y el departamento. Es la regla del sistema y aquí
 * importa más que en ningún otro sitio, porque una entrega se registra
 * con la persona delante esperando el teléfono: mandarla a Catálogos a
 * dar de alta el centro de costo significa perder lo ya escrito y
 * empezar de nuevo.
 *
 * El alta se resuelve DENTRO del selector (`creacionRapida`), así que el
 * formulario de arriba no se desmonta y no pierde un solo campo; al
 * guardar, el registro nuevo queda elegido.
 */

import { useState } from 'react'
import { Alerta, AreaTexto, Boton, Campo, Entrada } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { SelectorBuscable, type OpcionBuscable } from '@/components/ui/SelectorBuscable'
import { IconCheck, IconPlus } from '@/components/ui/Icons'
import { hoyIso } from '@/lib/fechas'
import { mensajeDeError } from '@/lib/errores'
import {
  crearAsignacion,
  crearCentroCosto,
  crearDepartamento,
  crearEquipo,
  crearLinea,
  crearPersona,
} from '@/lib/telecom/repositorioCliente'
import {
  ACCESORIOS_COMUNES,
  type CentroCosto,
  type FilaEquipo,
  type FilaLinea,
  type Persona,
} from '@/lib/telecom/tipos'

export function AsignacionModal({
  abierto,
  onCerrar,
  onGuardado,
  personal,
  lineas,
  equipos,
  centrosCosto,
  departamentos,
}: {
  abierto: boolean
  onCerrar: () => void
  onGuardado: () => void
  personal: Persona[]
  lineas: FilaLinea[]
  equipos: FilaEquipo[]
  centrosCosto: CentroCosto[]
  departamentos: { id: string; nombre: string }[]
}) {
  if (!abierto) return null
  return (
    <Formulario
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      personal={personal}
      lineas={lineas}
      equipos={equipos}
      centrosCosto={centrosCosto}
      departamentos={departamentos}
    />
  )
}

function Formulario({
  onCerrar,
  onGuardado,
  personal,
  lineas,
  equipos,
  centrosCosto,
  departamentos,
}: {
  onCerrar: () => void
  onGuardado: () => void
  personal: Persona[]
  lineas: FilaLinea[]
  equipos: FilaEquipo[]
  centrosCosto: CentroCosto[]
  departamentos: { id: string; nombre: string }[]
}) {
  const [empleadoId, setEmpleadoId] = useState('')
  const [numero, setNumero] = useState('')
  const [imei, setImei] = useState('')
  const [fecha, setFecha] = useState(hoyIso())
  const [devolucion, setDevolucion] = useState('')
  const [centroCosto, setCentroCosto] = useState('')
  const [departamento, setDepartamento] = useState('')
  const [puesto, setPuesto] = useState('')
  const [correo, setCorreo] = useState('')
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [otros, setOtros] = useState<string[]>([])
  const [nuevoAccesorio, setNuevoAccesorio] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lo que se da de alta sin salir de aquí se recuerda en la pantalla: la
  // lista que llegó por props es de la carga del servidor y no la trae.
  // Al cerrar, `router.refresh()` la deja en su sitio para la próxima.
  const [extraPersonas, setExtraPersonas] = useState<Persona[]>([])
  const [extraLineas, setExtraLineas] = useState<FilaLinea[]>([])
  const [extraEquipos, setExtraEquipos] = useState<FilaEquipo[]>([])
  const [extraCentros, setExtraCentros] = useState<string[]>([])
  const [extraDeptos, setExtraDeptos] = useState<string[]>([])

  // Sólo lo entregable. Una línea suspendida tampoco se entrega: está
  // sin servicio y darla sería entregar un número que no timbra.
  const libres = [
    ...lineas.filter((l) => l.estado === 'DISPONIBLE' && l.activo),
    ...extraLineas,
  ]
  const enBodega = [
    ...equipos.filter((e) => e.estado === 'EN_BODEGA' && e.activo),
    ...extraEquipos,
  ]
  const gente = [...personal, ...extraPersonas]
  const centros = [...centrosCosto.map((c) => c.codigo), ...extraCentros]
  const deptos = [...departamentos.map((d) => d.nombre), ...extraDeptos]

  const lista = [...marcados, ...otros]

  function alternar(item: string) {
    setMarcados((antes) => {
      const copia = new Set(antes)
      if (copia.has(item)) copia.delete(item)
      else copia.add(item)
      return copia
    })
  }

  function agregarOtro() {
    const t = nuevoAccesorio.trim()
    if (!t || lista.includes(t)) return setNuevoAccesorio('')
    setOtros((antes) => [...antes, t])
    setNuevoAccesorio('')
  }

  async function guardar() {
    if (!empleadoId) return setError('Elige a quién se le entrega.')
    if (!numero && !imei) return setError('Elige al menos una línea o un equipo.')
    if (devolucion && devolucion < fecha) {
      return setError('La devolución no puede ser anterior a la entrega.')
    }

    setError(null)
    setGuardando(true)
    const { error: e } = await crearAsignacion({
      empleado_id: empleadoId,
      linea_numero: numero || null,
      equipo_imei: imei || null,
      fecha_entrega: fecha,
      fecha_devolucion_programada: devolucion || null,
      centro_costo: centroCosto || null,
      departamento: departamento || null,
      puesto: puesto.trim() || null,
      correo_asignado: correo.trim() || null,
      accesorios_entregados: lista,
      observaciones: observaciones.trim() || null,
    })
    setGuardando(false)

    if (e) {
      return setError(
        mensajeDeError(
          e,
          'No se pudo registrar la entrega. Si dice que ya existe, esa línea o ese equipo ya están entregados a otra persona.'
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
      titulo="Entregar línea o equipo"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Registrar entrega'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta>{error}</Alerta>}

        <Campo etiqueta="Colaborador" requerido>
          <SelectorBuscable
            valor={empleadoId}
            opciones={gente.map((p) => ({
              id: p.id,
              titulo: p.nombre,
              subtitulo: [p.codigo, p.es_administrativo ? 'Administrativo' : 'Operador']
                .filter(Boolean)
                .join(' · '),
            }))}
            onCambiar={setEmpleadoId}
            placeholder="¿A quién se le entrega?"
            etiquetaBusqueda="Buscar por nombre o código…"
            permitirVacio={false}
            creacionRapida={{
              etiqueta: 'Nuevo colaborador',
              campos: [
                { key: 'nombre', label: 'Nombre completo', requerido: true },
                { key: 'codigo', label: 'Código de empleado' },
              ],
              onCrear: async (v) => {
                const { persona, error: e } = await crearPersona(v.nombre, v.codigo ?? '')
                if (e || !persona) throw new Error(e ?? 'No se pudo crear.')
                setExtraPersonas((a) => [...a, persona])
                return { id: persona.id, titulo: persona.nombre, subtitulo: persona.codigo ?? '' }
              },
            }}
          />
        </Campo>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo
            etiqueta="Línea"
            ayuda={`${libres.length} disponible${libres.length === 1 ? '' : 's'}. Las asignadas no se ofrecen.`}
          >
            <SelectorBuscable
              valor={numero}
              opciones={libres.map((l) => ({
                id: l.numero,
                titulo: l.numero,
                subtitulo: [l.proveedor, l.plan_nombre].filter(Boolean).join(' · '),
              }))}
              onCambiar={setNumero}
              placeholder="Sin línea"
              etiquetaBusqueda="Buscar número…"
              textoVacio="Sin línea"
              creacionRapida={{
                etiqueta: 'Nueva línea',
                campos: [
                  { key: 'numero', label: 'Número', requerido: true },
                  { key: 'proveedor', label: 'Proveedor' },
                ],
                onCrear: async (v) => {
                  const { error: e } = await crearLinea({
                    numero: v.numero.trim(),
                    proveedor: v.proveedor?.trim() || null,
                    plan_id: null,
                    observaciones: null,
                  })
                  if (e) throw new Error(e)
                  const nueva = nuevaLinea(v.numero.trim(), v.proveedor?.trim() || null)
                  setExtraLineas((a) => [...a, nueva])
                  return { id: nueva.numero, titulo: nueva.numero, subtitulo: nueva.proveedor ?? '' }
                },
              }}
            />
          </Campo>

          <Campo
            etiqueta="Equipo"
            ayuda={`${enBodega.length} en bodega. Los dañados y los asignados no se ofrecen.`}
          >
            <SelectorBuscable
              valor={imei}
              opciones={enBodega.map((e) => ({
                id: e.imei,
                titulo: e.marca_modelo,
                subtitulo: `IMEI ${e.imei}`,
              }))}
              onCambiar={setImei}
              placeholder="Sin equipo"
              etiquetaBusqueda="Buscar modelo o IMEI…"
              textoVacio="Sin equipo"
              creacionRapida={{
                etiqueta: 'Nuevo equipo',
                campos: [
                  { key: 'imei', label: 'IMEI', requerido: true },
                  { key: 'marca_modelo', label: 'Marca y modelo', requerido: true },
                  { key: 'ram', label: 'RAM' },
                  { key: 'almacenamiento', label: 'Almacenamiento' },
                ],
                onCrear: async (v) => {
                  const { error: e } = await crearEquipo({
                    imei: v.imei.trim(),
                    marca_modelo: v.marca_modelo.trim(),
                    ram: v.ram?.trim() || null,
                    almacenamiento: v.almacenamiento?.trim() || null,
                    fecha_compra: null,
                    observaciones: null,
                  })
                  if (e) throw new Error(e)
                  const nuevo = nuevoEquipo(v)
                  setExtraEquipos((a) => [...a, nuevo])
                  return { id: nuevo.imei, titulo: nuevo.marca_modelo, subtitulo: `IMEI ${nuevo.imei}` }
                },
              }}
            />
          </Campo>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha de entrega" requerido>
            <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
          <Campo
            etiqueta="Devolución programada"
            ayuda="Sólo en entregas temporales. Es lo que dispara la alerta del tablero."
          >
            <Entrada
              type="date"
              value={devolucion}
              onChange={(e) => setDevolucion(e.target.value)}
            />
          </Campo>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Departamento">
            <SelectorBuscable
              valor={departamento}
              opciones={deptos.map(porTexto)}
              onCambiar={setDepartamento}
              placeholder="Sin departamento"
              etiquetaBusqueda="Buscar departamento…"
              textoVacio="Sin departamento"
              creacionRapida={{
                etiqueta: 'Nuevo departamento',
                campos: [{ key: 'nombre', label: 'Departamento', requerido: true }],
                onCrear: async (v) => {
                  const nombre = v.nombre.trim()
                  const { error: e } = await crearDepartamento(nombre)
                  if (e) throw new Error(e)
                  setExtraDeptos((a) => [...a, nombre])
                  return porTexto(nombre)
                },
              }}
            />
          </Campo>

          <Campo etiqueta="Centro de costo">
            <SelectorBuscable
              valor={centroCosto}
              opciones={centros.map(porTexto)}
              onCambiar={setCentroCosto}
              placeholder="Sin centro de costo"
              etiquetaBusqueda="Buscar centro…"
              textoVacio="Sin centro de costo"
              creacionRapida={{
                etiqueta: 'Nuevo centro de costo',
                campos: [
                  { key: 'codigo', label: 'Código', requerido: true },
                  { key: 'nombre', label: 'Nombre' },
                ],
                onCrear: async (v) => {
                  const codigo = v.codigo.trim()
                  const { error: e } = await crearCentroCosto(codigo, v.nombre ?? '')
                  if (e) throw new Error(e)
                  setExtraCentros((a) => [...a, codigo])
                  return porTexto(codigo)
                },
              }}
            />
          </Campo>

          <Campo etiqueta="Puesto">
            <Entrada
              value={puesto}
              onChange={(e) => setPuesto(e.target.value)}
              placeholder="Contadora general"
            />
          </Campo>
          <Campo etiqueta="Correo asignado">
            <Entrada
              type="email"
              inputMode="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              placeholder="nombre@agrolibano.com"
            />
          </Campo>
        </div>

        {/* --------------------------- Accesorios --------------------------- */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Accesorios entregados
          </span>

          <div className="flex flex-wrap gap-1.5">
            {ACCESORIOS_COMUNES.map((item) => {
              const marcado = marcados.has(item)
              return (
                <button
                  key={item}
                  type="button"
                  role="checkbox"
                  aria-checked={marcado}
                  onClick={() => alternar(item)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                    marcado
                      ? 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-300'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  <span
                    className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                      marcado ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'
                    }`}
                  >
                    {marcado && <IconCheck className="h-2.5 w-2.5" />}
                  </span>
                  {item}
                </button>
              )
            })}
            {otros.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setOtros((a) => a.filter((x) => x !== item))}
                title="Quitar"
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-800 ring-1 ring-inset ring-brand-300"
              >
                {item}
                <span className="text-brand-500">×</span>
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Entrada
              value={nuevoAccesorio}
              onChange={(e) => setNuevoAccesorio(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  agregarOtro()
                }
              }}
              placeholder="Otro accesorio…"
              className="flex-1"
            />
            <Boton variante="secundario" onClick={agregarOtro} disabled={!nuevoAccesorio.trim()}>
              <IconPlus className="h-4 w-4" />
              Agregar
            </Boton>
          </div>
        </div>

        <Campo etiqueta="Observaciones">
          <AreaTexto
            rows={3}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Estado del equipo, condiciones especiales…"
          />
        </Campo>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */

/** Un catálogo de textos sueltos —centros, departamentos— como opción. */
const porTexto = (t: string): OpcionBuscable => ({ id: t, titulo: t })

/** Lo mínimo para que la línea recién creada se pueda elegir ya. */
function nuevaLinea(numero: string, proveedor: string | null): FilaLinea {
  return {
    numero,
    proveedor,
    plan_id: null,
    plan_nombre: null,
    plan_costo: null,
    plan_es_retencion: null,
    estado: 'DISPONIBLE',
    observaciones: null,
    activo: true,
    asignacion_id: null,
    empleado_id: null,
    asignada_a: null,
    codigo_empleado: null,
    fecha_entrega: null,
    fecha_devolucion_programada: null,
  }
}

function nuevoEquipo(v: Record<string, string>): FilaEquipo {
  return {
    imei: v.imei.trim(),
    marca_modelo: v.marca_modelo.trim(),
    ram: v.ram?.trim() || null,
    almacenamiento: v.almacenamiento?.trim() || null,
    fecha_compra: null,
    fecha_renovacion: null,
    estado: 'EN_BODEGA',
    observaciones: null,
    activo: true,
    dias_para_renovacion: null,
    asignacion_id: null,
    empleado_id: null,
    asignado_a: null,
    codigo_empleado: null,
    fecha_entrega: null,
  }
}
