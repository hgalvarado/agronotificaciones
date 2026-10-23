'use client'

/**
 * El botón «Exportar para SAP» y su engranaje.
 *
 * Existe aparte del Excel normal a propósito: el Excel completo es para
 * revisar y el de SAP es para cargar en el sistema. Tienen columnas
 * distintas y confundirlos cuesta una notificación rechazada.
 *
 * 78 · UN archivo con todas sus hojas (`hojas`), no un archivo por hoja.
 * El engranaje abre la configuración de columnas —activar, apagar,
 * reordenar— por hoja, guardada en `localStorage` de este navegador.
 *
 * No sabe qué columnas lleva cada hoja: recibe funciones que se las dan ya
 * armadas. El formato vive en `lib/sap/exportacion`, la preferencia en
 * `lib/sap/columnas`.
 */

import { useState } from 'react'
import { Alerta, Boton } from './Primitivos'
import { Modal } from './Modal'
import { IconSend, IconSettings } from './Icons'
import { construirXlsxHojas, descargar, type CeldaHoja } from '@/lib/hojas'
import {
  aplicarConfig,
  conciliar,
  guardarConfig,
  leerConfig,
  mover,
  type ConfigSap,
} from '@/lib/sap/columnas'

export type HojaSap = { nombre: string; filas: CeldaHoja[][] }

export function BotonExportarSap({
  nombreArchivo,
  hojas,
  columnas,
  clave,
  hoja,
  filas,
  deshabilitado = false,
}: {
  nombreArchivo: string
  /**
   * Todas las hojas del libro. Se llama al pulsar, no antes: armar miles
   * de filas en cada render dejaría la tabla pegada. Puede ser asíncrona
   * (una hoja que hay que consultar).
   */
  hojas?: () => HojaSap[] | Promise<HojaSap[]>
  /** Encabezados por hoja, para configurar sin tener que armar las filas. */
  columnas?: Record<string, readonly string[]>
  /** Llave de la preferencia. Por omisión, los nombres de las hojas. */
  clave?: string
  /** Forma de una sola hoja (compatibilidad con Labores). */
  hoja?: string
  filas?: () => CeldaHoja[][]
  deshabilitado?: boolean
}) {
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configurando, setConfigurando] = useState(false)

  const armar = async (): Promise<HojaSap[]> =>
    hojas ? await hojas() : hoja && filas ? [{ nombre: hoja, filas: filas() }] : []

  const nombresHojas = columnas ? Object.keys(columnas) : hoja ? [hoja] : []
  const llave = clave ?? nombresHojas.join('+')

  async function exportar() {
    setOcupado(true)
    setError(null)
    try {
      const libro = await armar()
      const config = leerConfig(llave)
      const recortado = libro.map((h) => {
        const actuales = (h.filas[0] ?? []).map((c) => String(c ?? ''))
        return { nombre: h.nombre, filas: aplicarConfig(h.filas, conciliar(config[h.nombre], actuales)) }
      })
      if (recortado.length === 0) return
      descargar(construirXlsxHojas(recortado), `${nombreArchivo}.xlsx`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo armar el archivo.')
    } finally {
      setOcupado(false)
    }
  }

  // Los encabezados para el modal: los declarados, o los de la primera
  // fila de la forma de una sola hoja.
  function encabezados(): Record<string, readonly string[]> {
    if (columnas) return columnas
    if (hoja && filas) return { [hoja]: (filas()[0] ?? []).map((c) => String(c ?? '')) }
    return {}
  }

  return (
    <>
      <span className="inline-flex items-center gap-1">
        <Boton variante="suave" tamano="sm" onClick={exportar} disabled={deshabilitado || ocupado}>
          <IconSend className="h-4 w-4" />
          {ocupado ? 'Armando…' : 'Exportar para SAP'}
        </Boton>
        <Boton
          variante="suave"
          tamano="sm"
          onClick={() => setConfigurando(true)}
          aria-label="Configurar columnas SAP"
          title="Configurar columnas SAP"
        >
          <IconSettings className="h-4 w-4" />
        </Boton>
      </span>
      {error && (
        <span className="basis-full">
          <Alerta>{error}</Alerta>
        </span>
      )}
      {configurando && (
        <ConfigColumnasSap
          llave={llave}
          columnas={encabezados()}
          onCerrar={() => setConfigurando(false)}
        />
      )}
    </>
  )
}

function ConfigColumnasSap({
  llave,
  columnas,
  onCerrar,
}: {
  llave: string
  columnas: Record<string, readonly string[]>
  onCerrar: () => void
}) {
  const nombres = Object.keys(columnas)
  const [config, setConfig] = useState<ConfigSap>(() => {
    const guardada = leerConfig(llave)
    return Object.fromEntries(nombres.map((n) => [n, conciliar(guardada[n], columnas[n])]))
  })
  const [pestana, setPestana] = useState(nombres[0] ?? '')
  const lista = config[pestana] ?? []

  const cambiar = (n: string, f: (l: ConfigSap[string]) => ConfigSap[string]) =>
    setConfig((c) => ({ ...c, [n]: f(c[n] ?? []) }))

  function guardar() {
    guardarConfig(llave, config)
    onCerrar()
  }

  function restablecer() {
    setConfig(Object.fromEntries(nombres.map((n) => [n, conciliar(null, columnas[n])])))
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo="Columnas para SAP"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={restablecer}>
            Restablecer
          </Boton>
          <Boton className="flex-1" onClick={guardar}>
            Guardar
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-500">
          Se guarda en este navegador. Las columnas apagadas no salen en el archivo; el orden de
          arriba abajo es el orden de izquierda a derecha.
        </p>

        {nombres.length > 1 && (
          <div className="flex gap-1.5">
            {nombres.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPestana(n)}
                className={`min-h-9 rounded-full px-3.5 text-sm font-semibold ${
                  pestana === n
                    ? 'bg-brand-700 text-white'
                    : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        <ul className="flex flex-col divide-y divide-slate-100 rounded-xl ring-1 ring-inset ring-slate-200">
          {lista.map((c, i) => (
            <li key={c.nombre} className="flex min-h-11 items-center gap-2 px-3 py-1.5">
              <label className="flex min-w-0 flex-1 items-center gap-2.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={c.activa}
                  onChange={(e) =>
                    cambiar(pestana, (l) =>
                      l.map((x, j) => (j === i ? { ...x, activa: e.target.checked } : x))
                    )
                  }
                  className="h-5 w-5 shrink-0 rounded border-slate-300"
                />
                <span className={`truncate ${c.activa ? '' : 'text-slate-400 line-through'}`}>
                  {c.nombre}
                </span>
              </label>
              <button
                type="button"
                aria-label={`Subir ${c.nombre}`}
                disabled={i === 0}
                onClick={() => cambiar(pestana, (l) => mover(l, i, i - 1))}
                className="h-9 w-9 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Bajar ${c.nombre}`}
                disabled={i === lista.length - 1}
                onClick={() => cambiar(pestana, (l) => mover(l, i, i + 1))}
                className="h-9 w-9 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              >
                ↓
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
