'use client'

/**
 * Ficha técnica de un producto de inyección (datos opcionales de MARA). Cada dato vacío muestra «Sin dato»: nunca un
 * error por nulo.
 */

import { Modal } from '@/components/ui/Modal'
import { Boton } from '@/components/ui/Primitivos'
import { textoCarencia, textoDato, type ProductoInyeccion } from '@/lib/inyeccion/estado'

function Fila({ etiqueta, valor, dato }: { etiqueta: string; valor: string; dato: string }) {
  const vacio = valor === 'Sin dato'
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">{etiqueta}</dt>
      <dd className={`text-sm ${vacio ? 'text-slate-400' : 'text-slate-800'}`} data-ficha-dato={dato}>
        {valor}
      </dd>
    </div>
  )
}

export function FichaProducto({ producto, onCerrar }: { producto: ProductoInyeccion; onCerrar: () => void }) {
  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={producto.descripcion ?? producto.codigo}
      pie={
        <Boton className="w-full" onClick={onCerrar} data-cerrar-ficha-producto>
          Listo
        </Boton>
      }
    >
      <dl className="divide-y divide-slate-100" data-ficha-producto={producto.codigo}>
        <Fila etiqueta="Código" valor={textoDato(producto.codigo)} dato="codigo" />
        <Fila etiqueta="Ingrediente activo" valor={textoDato(producto.ingrediente_activo)} dato="ingrediente_activo" />
        <Fila etiqueta="Concentración" valor={textoDato(producto.concentracion)} dato="concentracion" />
        <Fila etiqueta="Plagas que controla" valor={textoDato(producto.plagas_controla)} dato="plagas_controla" />
        <Fila etiqueta="Carencia (PPU)" valor={textoCarencia(producto.carencia_dias)} dato="carencia_dias" />
        <Fila etiqueta="Restricciones" valor={textoDato(producto.restricciones)} dato="restricciones" />
        <Fila etiqueta="Notas técnicas" valor={textoDato(producto.notas_tecnicas)} dato="notas_tecnicas" />
      </dl>
    </Modal>
  )
}
