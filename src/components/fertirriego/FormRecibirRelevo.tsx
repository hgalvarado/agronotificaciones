'use client'

/**
 * Recibir la estación. Quien recibe escribe el código que le muestra quien entrega; SU teléfono lo verifica sin
 * internet con la llave del compañero (un código equivocado no pasa; 5 intentos fallidos bloquean 5 minutos). La
 * base lo vuelve a verificar al llegar. Luego: «Recibo conforme» o anotar lo que no cuadra por producto.
 *
 * Con señal, si quien entrega ya registró la entrega, también se puede recibir sin código iniciando sesión en el
 * teléfono de quien entrega (método «sesión»).
 */

import { useEffect, useState } from 'react'
import { Alerta, AreaTexto, Campo, Insignia } from '@/components/ui/Primitivos'
import { ahoraIso } from '@/lib/fechas/zona'
import { cantidad } from '@/lib/fertirriego/calculos'
import { verificarCodigo, verificarCodigoLargo, type LlavePersona } from '@/lib/fertirriego/codigo'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { EstadoCampo, Estacion, Operacion, Persona, Relevo } from '@/lib/fertirriego/tipos'
import { ESTADOS_NOVEDAD } from './FormEntregarRelevo'
import { BotonCalculadora } from './Calculadora'
import { MarcoRegistro } from './MarcoRegistro'

const MAX_INTENTOS = 5
const BLOQUEO_MS = 5 * 60_000

export function FormRecibirRelevo({
  estado,
  estacion,
  yo,
  llaves,
  saldos,
  enLinea,
  pendiente,
  leerBloqueo,
  guardarBloqueo,
  registrar,
  onCerrar,
  onGuardado,
}: {
  estado: EstadoCampo
  estacion: Estacion
  yo: Persona
  llaves: LlavePersona[]
  saldos: Map<string, number>
  enLinea: boolean
  /** La entrega ya registrada en la base (si llegó): muestra sus novedades y permite el método «sesión». */
  pendiente: Relevo | null
  leerBloqueo: () => Promise<{ intentos: number; hasta: number } | null>
  guardarBloqueo: (b: { intentos: number; hasta: number }) => Promise<void>
  registrar: (...ops: Operacion[]) => Promise<void>
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const [metodo, setMetodo] = useState<'CODIGO' | 'CODIGO_LARGO' | 'SESION'>('CODIGO')
  const largo = metodo === 'CODIGO_LARGO'
  const digitos = largo ? 8 : 6
  const [codigo, setCodigo] = useState('')
  const [quien, setQuien] = useState<LlavePersona | null>(null)
  const [momento, setMomento] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [bloqueo, setBloqueo] = useState<{ intentos: number; hasta: number }>({ intentos: 0, hasta: 0 })
  const [diferencias, setDiferencias] = useState<Record<string, string>>({})
  const [nota, setNota] = useState('')

  useEffect(() => {
    void leerBloqueo().then((b) => b && setBloqueo(b))
  }, [leerBloqueo])

  // El reloj avanza en un estado (el bloqueo de 5 min se libera solo)
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const r = setInterval(() => setAhora(Date.now()), 5000)
    return () => clearInterval(r)
  }, [])
  const bloqueado = bloqueo.hasta > ahora
  const material = (id: string) => estado.materiales.find((m) => m.id === id)
  const productos = [...saldos.entries()].filter(([, v]) => v !== 0)
  const companeros = llaves.filter((l) => l.perfil_id !== yo.id)

  async function probar(valor: string) {
    setCodigo(valor)
    setQuien(null)
    setAviso(null)
    if (valor.length < digitos) return
    if (bloqueado) return setAviso('Demasiados intentos. Espera unos minutos.')
    const persona = largo ? await verificarCodigoLargo(valor, llaves, yo.id) : await verificarCodigo(valor, llaves, yo.id)
    if (persona) {
      setQuien(persona)
      setMomento(ahoraIso())
      const limpio = { intentos: 0, hasta: 0 }
      setBloqueo(limpio)
      void guardarBloqueo(limpio)
      return
    }
    const intentos = bloqueo.intentos + 1
    const nuevo = { intentos: intentos >= MAX_INTENTOS ? 0 : intentos, hasta: intentos >= MAX_INTENTOS ? Date.now() + BLOQUEO_MS : 0 }
    setBloqueo(nuevo)
    void guardarBloqueo(nuevo)
    setAviso(
      intentos >= MAX_INTENTOS
        ? 'Código equivocado 5 veces: bloqueado 5 minutos.'
        : largo
          ? `El código no corresponde a nadie de la estación o ya pasaron más de 12 horas. Intento ${intentos} de ${MAX_INTENTOS}.`
          : `El código no corresponde a nadie de la estación (o ya cambió). Intento ${intentos} de ${MAX_INTENTOS}.`
    )
  }

  return (
    <MarcoRegistro
      titulo="Recibir estación"
      estacion={estacion}
      yo={yo}
      sinCustodia
      permiso="relevo"
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      textoGuardar="Recibir la estación"
      construir={({ ubicacion }) => {
        const entrega = metodo === 'SESION' ? pendiente?.entrega_id : quien?.perfil_id
        if (!entrega) return metodo === 'SESION' ? 'No hay una entrega registrada para recibir sin código.' : 'Escribe el código que te muestra quien entrega.'
        const difs: { material_id: string; cantidad_real: number }[] = []
        for (const [id, v] of Object.entries(diferencias)) {
          if (!v.trim()) continue
          const n = Number(v.replace(',', '.'))
          if (!Number.isFinite(n) || n < 0) return `La cantidad real de ${material(id)?.descripcion ?? 'un producto'} no es válida.`
          difs.push({ material_id: id, cantidad_real: Math.round(n * 10000) / 10000 })
        }
        return [
          crearOperacion(
            'relevo_recibir',
            {
              estacion_id: estacion.id,
              entrega_id: entrega,
              metodo,
              codigo: metodo !== 'SESION' ? codigo : null,
              momento_codigo: metodo !== 'SESION' ? momento : null,
              diferencias: difs,
              nota: nota.trim() || null,
            },
            { ubicacion, resumen: `Recepción de estación · ${estacion.nombre}${difs.length ? ` · ${difs.length} diferencia(s)` : ''}` }
          ),
        ]
      }}
    >
      {pendiente && (
        <div className="rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200" data-novedades-recibidas>
          <p className="font-semibold text-slate-800">{pendiente.entrega} entregó la estación. Sus novedades:</p>
          <ul className="mt-1 text-xs text-slate-600">
            {pendiente.novedades.map((n, i) => (
              <li key={i}>
                <strong>{estado.turnos.find((t) => t.id === n.turno_ciclo_id)?.turno ?? 'Estación'}</strong>:{' '}
                {ESTADOS_NOVEDAD.find((e) => e.valor === n.estado)?.nombre}
                {n.nota ? ` — ${n.nota}` : ''}
              </li>
            ))}
            {pendiente.nota_entrega && <li>{pendiente.nota_entrega}</li>}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" role="tablist">
        {(pendiente && enLinea ? (['CODIGO', 'CODIGO_LARGO', 'SESION'] as const) : (['CODIGO', 'CODIGO_LARGO'] as const)).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={metodo === m}
            onClick={() => {
              setMetodo(m)
              setCodigo('')
              setQuien(null)
              setAviso(null)
            }}
            data-metodo={m}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${metodo === m ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200'}`}
          >
            {m === 'CODIGO' ? 'Está aquí (código de 6)' : m === 'CODIGO_LARGO' ? 'Me dejó un código (8 dígitos)' : 'Sin código (con sesión en su teléfono)'}
          </button>
        ))}
      </div>

      {metodo !== 'SESION' && (
        <Campo etiqueta={largo ? 'Código de entrega que te dejó (vale 12 horas)' : 'Código que te muestra quien entrega'} requerido>
          {companeros.length === 0 ? (
            <Alerta tono="ambar">
              Este teléfono todavía no tiene las llaves de tus compañeros. Ábrelo una vez con señal (después funciona sin señal).
            </Alerta>
          ) : (
            <div className="flex flex-col gap-2">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={digitos}
                value={codigo}
                disabled={bloqueado}
                onChange={(e) => void probar(e.target.value.replace(/\D/g, '').slice(0, digitos))}
                placeholder={largo ? '00000000' : '000000'}
                data-codigo-recibir
                className={`${largo ? 'w-60' : 'w-44'} rounded-xl border border-slate-200 bg-white px-4 py-3 text-center font-mono text-3xl tracking-[0.3em] focus:border-brand-600 focus:outline-none`}
              />
              {quien && (
                <span data-codigo-ok>
                  <Insignia tono="verde">Código correcto · te entrega {quien.nombre}</Insignia>
                </span>
              )}
              {aviso && <p className="text-sm text-red-700" data-codigo-error>{aviso}</p>}
            </div>
          )}
        </Campo>
      )}

      <Campo etiqueta="¿Lo que hay en bodega cuadra?">
        {productos.length === 0 ? (
          <p className="text-sm text-slate-500">La bodega no tiene saldo registrado.</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-xl ring-1 ring-inset ring-slate-200" data-cuadre-relevo>
            {productos.map(([id, v]) => {
              const hay = id in diferencias
              return (
                <div key={id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-cuadre-material={material(id)?.codigo}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{material(id)?.descripcion}</span>
                    <span className="text-[11px] text-slate-500">
                      Sistema: {cantidad(v)} {material(id)?.unidad}
                    </span>
                  </span>
                  {hay ? (
                    <>
                      <input
                        inputMode="decimal"
                        value={diferencias[id]}
                        onChange={(e) => setDiferencias({ ...diferencias, [id]: e.target.value.replace(/[^\d.,]/g, '') })}
                        placeholder="Lo que hay"
                        autoFocus
                        className="w-28 rounded-lg border border-red-300 bg-white px-3 py-2 text-right text-base font-semibold tabular-nums"
                      />
                      <BotonCalculadora unidad={material(id)?.unidad} onUsar={(valor) => setDiferencias((d) => ({ ...d, [id]: valor }))} />
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDiferencias({ ...diferencias, [id]: '' })}
                      data-hay-diferencia
                      className="text-xs font-semibold text-slate-500 underline"
                    >
                      No cuadra
                    </button>
                  )}
                  {!hay && <Insignia tono="verde">Conforme</Insignia>}
                </div>
              )
            })}
          </div>
        )}
      </Campo>

      <Campo etiqueta="Nota (opcional)">
        <AreaTexto value={nota} onChange={(e) => setNota(e.target.value)} rows={2} />
      </Campo>
    </MarcoRegistro>
  )
}
