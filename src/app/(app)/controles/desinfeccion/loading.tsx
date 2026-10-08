import { Esqueleto, TablaEsqueleto } from '@/components/ui/Primitivos'

/**
 * Lo que se ve mientras el servidor arma el módulo de desinfección.
 *
 * Next lo enseña EN CUANTO se toca el enlace, sin esperar a los diez
 * catálogos. Sin este archivo la pantalla anterior se quedaba quieta todo
 * lo que durase la consulta y parecía que el toque no había entrado.
 */
export default function CargandoDesinfeccion() {
  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <div>
        <Esqueleto className="h-6 w-56" />
        <Esqueleto className="mt-2 h-3 w-80" />
      </div>
      <Esqueleto className="h-20 w-full rounded-2xl" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Esqueleto key={i} className="h-9 w-32 rounded-full" />
        ))}
      </div>
      <TablaEsqueleto />
    </div>
  )
}
