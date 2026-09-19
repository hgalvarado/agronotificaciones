/**
 * Leer TODO lo que pide un rango, sin límite escrito a mano.
 *
 * El problema que resuelve: un `.limit(5000)` en una consulta por fechas
 * es un tope arbitrario que un día se cruza en silencio. Enero a
 * septiembre son más de cinco mil líneas de labores y la pantalla se
 * quedaba enseñando las primeras, sin decirlo.
 *
 * Pero quitarlo tampoco basta. PostgREST —la capa por la que habla
 * Supabase— tiene su propio tope por respuesta (`max-rows`, mil por
 * defecto), y una consulta sin `.limit()` no devuelve más filas: devuelve
 * las que quepan y se calla igual. La única forma de traerlo todo es
 * pedirlo por tramos con `.range()` hasta que un tramo venga corto.
 *
 * Eso es lo que hay aquí, en un solo sitio. No sabe de labores ni de
 * siembras: recibe una consulta ya armada y la va pidiendo por partes.
 *
 * Quien lo use tiene que ORDENAR la consulta por algo estable —una fecha
 * más el id, no la fecha sola—: con dos filas empatadas, el tramo
 * siguiente puede repetir una y saltarse otra.
 */

/**
 * Lo que devuelve cualquier consulta de Supabase, reducido a lo que
 * importa.
 *
 * `data` va como `unknown` a propósito: con relaciones incrustadas
 * —`lotes!inner(...)`— el tipo que deduce supabase-js no coincide con el
 * de la pantalla y obligaría a un `as` en cada llamada. El tipo bueno lo
 * pone quien llama, en `leerTodo<Fila>`, que es donde se sabe.
 */
export type Tramo = { data: unknown; error: { message: string } | null }

/** Filas por viaje. Mil es el tope por defecto de PostgREST. */
export const POR_TRAMO = 1000

/**
 * Freno de mano, no un límite de datos.
 *
 * Con doscientos tramos son doscientas mil filas: muchísimo más de lo que
 * un año de operación produce, y muchísimo menos de lo que haría falta
 * para colgar el navegador sin darse cuenta. Si alguna vez se alcanza,
 * `completo` viene en `false` y la pantalla lo puede decir en vez de
 * mentir con una lista a medias.
 */
const TRAMOS_MAXIMOS = 200

export type Todo<T> = {
  datos: T[]
  error: string | null
  /** `false` sólo si se alcanzó el freno: lo que se ve está incompleto. */
  completo: boolean
}

/**
 * Pide la consulta por tramos hasta agotarla.
 *
 * @param tramo Arma la consulta para el rango [desde, hasta] pedido.
 */
export async function leerTodo<T>(
  tramo: (desde: number, hasta: number) => PromiseLike<Tramo>,
  tamano: number = POR_TRAMO
): Promise<Todo<T>> {
  const todas: T[] = []

  for (let vuelta = 0; vuelta < TRAMOS_MAXIMOS; vuelta++) {
    const desde = vuelta * tamano
    const { data, error } = await tramo(desde, desde + tamano - 1)
    if (error) return { datos: todas, error: error.message, completo: false }

    const lote = (data as T[] | null) ?? []
    todas.push(...lote)

    // Un tramo corto es el final. Un tramo VACÍO también, y hay que
    // tratarlo aparte: sin esto, una consulta que devolviera siempre
    // cero filas daría vueltas hasta el freno.
    if (lote.length < tamano) return { datos: todas, error: null, completo: true }
  }

  return { datos: todas, error: null, completo: false }
}
