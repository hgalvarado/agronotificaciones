'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { construirXlsxPlantilla, descargar, leerArchivoTabular } from '@/lib/hojas'
import { Alerta, Boton, Campo, Insignia, Selector } from '@/components/ui/Primitivos'
import { TIPOS_LOTE, type TipoLote, type Zona } from '@/lib/types'
import { mensajeDeError } from '@/lib/errores'

const ENCABEZADOS = ['Nomenclatura', 'Nombre', 'Tipo', 'Área bruta', 'Área neta', 'Zona']

/**
 * De la etiqueta que se escribe en Excel al valor que guarda la base.
 *
 * En la plantilla se elige «Departamento administrativo» de un
 * desplegable; en la base es 'ADMINISTRATIVO'. Se acepta también el valor
 * crudo por si alguien reutiliza un archivo viejo.
 */
function aTipo(bruto: string | undefined): TipoLote {
  const t = (bruto ?? '').trim().toLowerCase()
  if (!t) return 'AGRICOLA'
  const porEtiqueta = TIPOS_LOTE.find(
    (x) => x.etiqueta.toLowerCase() === t || x.valor.toLowerCase() === t
  )
  // «administrativo», «depto administrativo», «admin»: lo que la gente
  // escribe cuando no usa el desplegable.
  if (!porEtiqueta) return t.includes('admin') ? 'ADMINISTRATIVO' : 'AGRICOLA'
  return porEtiqueta.valor
}

type FilaPegada = {
  nomenclatura: string
  nombre: string | null
  tipo: TipoLote
  areaBruta: number | null
  areaNeta: number | null
  zonaNombre: string | null
  error?: string
}

// Convierte lo pegado desde Excel en filas. Excel copia con TABULADOR entre
// columnas y salto de línea entre filas, así que ese es el separador que se
// asume (también se acepta ; y , por si alguien pega desde un CSV).
function parsear(texto: string): FilaPegada[] {
  return texto
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map((linea) => {
      const cols = linea.split(/\t|;|,(?=\s*\S)/).map((c) => c.trim())
      const [nomenclatura, nombre, tipo, areaBruta, areaNeta, zonaNombre] = cols

      const numero = (v: string | undefined) => {
        if (!v) return null
        // Acepta coma decimal (formato de Excel en español).
        const n = Number(v.replace(/\s/g, '').replace(',', '.'))
        return Number.isNaN(n) ? null : n
      }

      const cual = aTipo(tipo)
      const fila: FilaPegada = {
        nomenclatura: nomenclatura ?? '',
        nombre: nombre || null,
        tipo: cual,
        // Un departamento administrativo no tiene área ni zona aunque el
        // archivo las traiga: la base se las quitaría igual, y enseñarlas
        // en la vista previa haría creer que se van a guardar.
        areaBruta: cual === 'AGRICOLA' ? numero(areaBruta) : null,
        areaNeta: cual === 'AGRICOLA' ? numero(areaNeta) : null,
        zonaNombre: cual === 'AGRICOLA' ? zonaNombre || null : null,
      }

      if (!fila.nomenclatura) fila.error = 'Falta la nomenclatura'
      return fila
    })
}

export function ImportarLotes({
  abierto,
  onCerrar,
  temporadaId,
  zonas,
  nomenclaturasExistentes,
}: {
  abierto: boolean
  onCerrar: () => void
  temporadaId: string
  zonas: Zona[]
  nomenclaturasExistentes: Set<string>
}) {
  const supabase = createClient()
  const router = useRouter()
  const [texto, setTexto] = useState('')
  const [zonaPorDefecto, setZonaPorDefecto] = useState('')
  const [importando, setImportando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)

  const filas = useMemo(() => parsear(texto), [texto])
  const validas = filas.filter((f) => !f.error)
  const nuevas = validas.filter((f) => !nomenclaturasExistentes.has(f.nomenclatura))
  const yaExisten = validas.length - nuevas.length

  async function importar() {
    setError(null)
    setResultado(null)

    if (nuevas.length === 0) {
      setError('No hay lotes nuevos para importar.')
      return
    }

    setImportando(true)
    try {
      // 1) Crear los lotes que no existen en el catálogo.
      const { data: lotesCreados, error: e1 } = await supabase
        .from('lotes')
        .insert(
          nuevas.map((f) => ({
            nomenclatura: f.nomenclatura,
            nombre: f.nombre,
            tipo: f.tipo,
          }))
        )
        .select('id, nomenclatura')
      if (e1) throw e1

      // 2) Asignarlos a la temporada activa con su área y zona.
      //    La zona se resuelve por nombre (columna 5); si no viene o no
      //    coincide, se usa la zona por defecto elegida arriba.
      const zonaPorNombre = new Map(zonas.map((z) => [z.nombre.toLowerCase(), z.id]))
      const porNomenclatura = new Map(nuevas.map((f) => [f.nomenclatura, f]))

      const asignaciones = (lotesCreados ?? []).map((l) => {
        const f = porNomenclatura.get(l.nomenclatura)
        const zonaId =
          (f?.zonaNombre ? zonaPorNombre.get(f.zonaNombre.toLowerCase()) : undefined) ??
          (zonaPorDefecto || null)
        return {
          lote_id: l.id,
          temporada_id: temporadaId,
          zona_id: zonaId,
          area_bruta: f?.areaBruta ?? null,
          area_neta: f?.areaNeta ?? 0,
          activo: true,
        }
      })

      const { error: e2 } = await supabase.from('lotes_temporada').insert(asignaciones)
      if (e2) throw e2

      setImportando(false)
      setResultado(`Se importaron ${asignaciones.length} lotes.`)
      setTexto('')
      router.refresh()
    } catch (e) {
      setImportando(false)
      setError(mensajeDeError(e, 'No se pudo importar.'))
    }
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Importar lotes desde Excel"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={importando}>
            Cerrar
          </Boton>
          <Boton className="flex-1" onClick={importar} disabled={importando || nuevas.length === 0}>
            {importando ? 'Importando…' : `Importar ${nuevas.length || ''}`}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-inset ring-slate-200/70">
          <p className="font-semibold text-slate-700">Cómo usarlo</p>
          <p className="mt-1">
            En Excel selecciona las columnas en este orden y pégalas abajo (Ctrl+V):
          </p>
          <p className="mt-1.5 font-mono text-[11px] text-slate-500">
            {ENCABEZADOS.join(' · ')}
          </p>
          <p className="mt-1.5">
            Sólo la nomenclatura es obligatoria. Si omites la zona, se usa la que elijas aquí abajo.
            En un <strong>departamento administrativo</strong> el área y la zona se ignoran.
          </p>
          <Boton
            variante="secundario"
            tamano="sm"
            className="mt-2"
            onClick={() =>
              descargar(
                construirXlsxPlantilla('Lotes', ENCABEZADOS, [
                  {
                    columna: 2,
                    titulo: 'Tipo',
                    valores: TIPOS_LOTE.map((t) => t.etiqueta),
                  },
                  { columna: 5, titulo: 'Zona', valores: zonas.map((z) => z.nombre) },
                ]),
                'plantilla-lotes.xlsx'
              )
            }
          >
            Descargar plantilla
          </Boton>
        </div>

        <Campo etiqueta="Zona por defecto" ayuda="Se aplica a los lotes que no traigan zona en la columna 5.">
          <Selector value={zonaPorDefecto} onChange={(e) => setZonaPorDefecto(e.target.value)}>
            <option value="">Sin zona</option>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>
                {z.nombre}
              </option>
            ))}
          </Selector>
        </Campo>

        <Campo etiqueta="Pega aquí los datos">
          <input
            type="file"
            accept=".xlsx,.csv,.txt"
            onChange={async (e) => {
              const archivo = e.target.files?.[0]
              if (!archivo) return
              try {
                // Se reconstruye el texto tabulado que ya sabe leer el
                // pegado de siempre, así hay un solo camino de parseo.
                const matriz = await leerArchivoTabular(archivo)
                setTexto(matriz.map((f) => f.join('\t')).join('\n'))
              } catch (err) {
                setTexto('')
                alert(mensajeDeError(err, 'No se pudo leer el archivo.'))
              }
            }}
            className="mb-2 w-full rounded-xl border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
          />

          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={6}
            placeholder={
              '1001-010\tCarretillo\tLote agrícola\t29.84\t24.95\tZona 1\n' +
              'OFI-001\tOficinas centrales\tDepartamento administrativo\t\t\t'
            }
            className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-3 font-mono text-xs text-slate-900 placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </Campo>

        {filas.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Insignia tono="verde">{nuevas.length} nuevos</Insignia>
              {yaExisten > 0 && <Insignia tono="ambar">{yaExisten} ya existen</Insignia>}
              {filas.length - validas.length > 0 && (
                <Insignia tono="rojo">{filas.length - validas.length} con error</Insignia>
              )}
            </div>

            <div className="scroll-suave max-h-52 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[420px] text-xs">
                <thead>
                  <tr className="bg-slate-50 text-left text-[10px] font-bold uppercase text-slate-400">
                    <th className="px-2 py-1.5">Lote</th>
                    <th className="px-2 py-1.5">Nombre</th>
                    <th className="px-2 py-1.5">Tipo</th>
                    <th className="px-2 py-1.5 text-right">Bruta</th>
                    <th className="px-2 py-1.5 text-right">Neta</th>
                    <th className="px-2 py-1.5">Zona</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => {
                    const duplicado = !f.error && nomenclaturasExistentes.has(f.nomenclatura)
                    return (
                      <tr
                        key={i}
                        className={`border-t border-slate-50 ${
                          f.error ? 'bg-red-50/60' : duplicado ? 'bg-amber-50/60' : ''
                        }`}
                      >
                        <td className="px-2 py-1.5 font-semibold text-slate-700">
                          {f.nomenclatura || '—'}
                          {f.error && <span className="ml-1 text-red-600">({f.error})</span>}
                          {duplicado && <span className="ml-1 text-amber-700">(ya existe)</span>}
                        </td>
                        <td className="px-2 py-1.5 text-slate-500">{f.nombre ?? '—'}</td>
                        <td className="px-2 py-1.5 text-slate-500">
                          {f.tipo === 'AGRICOLA' ? 'Agrícola' : 'Administrativo'}
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-500">{f.areaBruta ?? '—'}</td>
                        <td className="px-2 py-1.5 text-right text-slate-500">{f.areaNeta ?? '—'}</td>
                        <td className="px-2 py-1.5 text-slate-500">{f.zonaNombre ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {yaExisten > 0 && (
              <p className="text-xs text-slate-400">
                Los lotes que ya existen se omiten: la importación nunca duplica.
              </p>
            )}
          </div>
        )}

        {error && <Alerta>{error}</Alerta>}
        {resultado && <Alerta tono="azul">{resultado}</Alerta>}
      </div>
    </Modal>
  )
}
