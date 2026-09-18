'use client'

/**
 * Panel del Administrador: las reglas del reporte público.
 *
 * Es sólo pantalla. No valida (lo hace `validacion`), no guarda (lo hace
 * `repositorioConfig`) y no redacta los mensajes (los trae
 * `notificaciones`). Todo lo que hace es recoger lo que se marca y
 * enseñar lo que el servicio responde.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Alerta, Boton, Tarjeta } from '@/components/ui/Primitivos'
import { GrupoCasillas } from '@/components/ui/GrupoCasillas'
import { guardarConfiguracion } from '@/lib/reporte-maquinaria/servicioConfig'
import {
  ESTADOS_TICKET,
  PROCESOS_TICKET,
  type EstadoTicketPublico,
  type ProcesoTicket,
} from '@/lib/reporte-maquinaria/tipos'

export type ConfigInicial = {
  activo: boolean
  procesos: ProcesoTicket[]
  estados: EstadoTicketPublico[]
  todosDepartamentos: boolean
  departamentos: string[]
}

export function ConfiguracionReportePublico({
  inicial,
  departamentosDisponibles,
  usuarioId,
  puedeEditar,
  faltaMigracion,
}: {
  inicial: ConfigInicial
  departamentosDisponibles: string[]
  usuarioId: string | null
  puedeEditar: boolean
  faltaMigracion: boolean
}) {
  const router = useRouter()
  const [activo, setActivo] = useState(inicial.activo)
  const [procesos, setProcesos] = useState<string[]>(inicial.procesos)
  const [estados, setEstados] = useState<string[]>(inicial.estados)
  const [todos, setTodos] = useState(inicial.todosDepartamentos)
  const [elegidos, setElegidos] = useState<Set<string>>(new Set(inicial.departamentos))
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; mensaje: string } | null>(null)

  function alternar(depto: string) {
    setElegidos((prev) => {
      const copia = new Set(prev)
      if (copia.has(depto)) copia.delete(depto)
      else copia.add(depto)
      return copia
    })
  }

  async function guardar() {
    setGuardando(true)
    setAviso(null)
    const resultado = await guardarConfiguracion(
      {
        activo,
        procesos,
        estados,
        todosDepartamentos: todos,
        departamentos: [...elegidos],
      },
      usuarioId
    )
    setGuardando(false)
    setAviso({ ok: resultado.ok, mensaje: resultado.mensaje })
    if (resultado.ok) router.refresh()
  }

  if (faltaMigracion) {
    return (
      <Alerta tono="ambar">
        El reporte público todavía no está al día. Corre las migraciones 23, 31 y 36 en el SQL Editor
        de Supabase y vuelve a entrar.
      </Alerta>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {aviso && <Alerta tono={aviso.ok ? 'azul' : 'rojo'}>{aviso.mensaje}</Alerta>}

      {!puedeEditar && (
        <Alerta tono="ambar">
          Tu rol no tiene «Editar» en esta pantalla, así que aquí ves las reglas pero no se
          guardan. Se concede en Permisos.
        </Alerta>
      )}

      {/* ------------------------ Publicar o no ------------------------- */}
      <Tarjeta className="p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={activo}
            disabled={!puedeEditar}
            onChange={(e) => setActivo(e.target.checked)}
            className="mt-0.5 h-4.5 w-4.5 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
          />
          <span>
            <span className="block text-sm font-semibold text-slate-900">
              Publicar el reporte de maquinaria
            </span>
            <span className="block text-xs text-slate-400">
              Cualquiera con el enlace lo ve, sin usuario ni contraseña. Desmarcado, la página
              queda en blanco con un aviso.
            </span>
          </span>
        </label>

        {activo && (
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
            Enlace público:{' '}
            <Link href="/reporte-maquinaria" className="font-semibold text-brand-700">
              /reporte-maquinaria
            </Link>
          </p>
        )}
      </Tarjeta>

      {/* ------------------------ Qué procesos -------------------------- */}
      <Tarjeta className="p-4">
        <h2 className="text-sm font-semibold text-slate-900">Procesos que se publican</h2>
        <p className="mb-3 text-xs text-slate-400">
          Un ticket se ve sólo si su proceso está marcado. Marca los que quieras, en cualquier
          combinación: no es un tope, es una lista.
        </p>

        <GrupoCasillas
          opciones={PROCESOS_TICKET.map((p) => ({ valor: p.valor, etiqueta: p.etiqueta }))}
          marcados={procesos}
          onCambiar={setProcesos}
          disabled={!puedeEditar}
        />

        {activo && procesos.length === 0 && (
          <p className="mt-3 text-xs font-semibold text-amber-700">
            Sin ningún proceso marcado el reporte no enseña un solo ticket.
          </p>
        )}
      </Tarjeta>

      {/* ------------------ Estado del ticket --------------------------- */}
      <Tarjeta className="p-4">
        <h2 className="text-sm font-semibold text-slate-900">Estado del ticket</h2>
        <p className="mb-3 text-xs text-slate-400">
          Otra cosa que el proceso: el estado dice si el ticket todavía se está capturando. Lo
          normal es publicar los dos.
        </p>

        <GrupoCasillas
          opciones={ESTADOS_TICKET.map((e) => ({ valor: e.valor, etiqueta: e.etiqueta }))}
          marcados={estados}
          onCambiar={setEstados}
          disabled={!puedeEditar}
        />

        {activo && estados.length === 0 && (
          <p className="mt-3 text-xs font-semibold text-amber-700">
            Sin ningún estado marcado el reporte no enseña un solo ticket.
          </p>
        )}
      </Tarjeta>

      {/* ------------------------ Departamentos ------------------------- */}
      <Tarjeta className="p-4">
        <h2 className="text-sm font-semibold text-slate-900">Departamentos visibles</h2>
        <p className="text-xs text-slate-400">
          Lo que no se marca aquí no sale en el reporte, ni siquiera en sus desplegables.
        </p>

        <label className="mt-3 flex items-center gap-2 border-b border-slate-100 pb-3">
          <input
            type="checkbox"
            checked={todos}
            disabled={!puedeEditar}
            onChange={(e) => setTodos(e.target.checked)}
            className="h-4.5 w-4.5 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
          />
          <span className="text-sm font-medium text-slate-700">
            Todos, incluidos los que se creen después
          </span>
        </label>

        <div
          className={`mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 ${
            todos ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          {departamentosDisponibles.length === 0 && (
            <p className="text-sm text-slate-400">
              No hay departamentos en el catálogo. Créalos en Catálogos → Departamentos.
            </p>
          )}
          {departamentosDisponibles.map((d) => (
            <label
              key={d}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"
            >
              <input
                type="checkbox"
                checked={todos || elegidos.has(d)}
                disabled={!puedeEditar || todos}
                onChange={() => alternar(d)}
                className="h-4.5 w-4.5 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              />
              <span className="truncate text-sm text-slate-700">{d}</span>
            </label>
          ))}
        </div>
      </Tarjeta>

      {puedeEditar && (
        <div className="flex justify-end">
          <Boton onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar reglas'}
          </Boton>
        </div>
      )}
    </div>
  )
}
