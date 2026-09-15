/**
 * Cómo se ordenan los catálogos en el menú.
 *
 * Dieciséis pestañas en fila no son un menú: son una fila de botones que
 * no cabe en un teléfono y en la que hay que adivinar dónde quedó
 * «Puestos de trabajo». Esta capa declara a qué bloque pertenece cada
 * catálogo y qué hace ese bloque, que es la única pregunta que se hace
 * quien entra: «¿dónde cambio esto?».
 *
 * Es una declaración pura. No sabe de React, ni de Supabase, ni de cómo
 * se dibuja el menú: sólo dice qué va con qué y en qué orden. La pantalla
 * decide el aspecto; los datos los trae la página.
 *
 * Regla importante de mantenimiento: un catálogo que se agregue mañana y
 * que nadie declare aquí NO desaparece. `organizar` lo recoge al final,
 * en «Otros catálogos», porque un dato maestro invisible es peor que uno
 * mal colocado.
 */

export type ItemDeclarado = {
  /** La misma clave que usa la pestaña. */
  key: string
  /** Qué se cambia ahí, en una línea. */
  descripcion: string
  /** Sólo para los que viven en otra ruta, como Tarifas. */
  href?: string
  /** Etiqueta propia cuando la de la pestaña no se entiende sola. */
  etiqueta?: string
}

export type GrupoDeclarado = {
  key: string
  titulo: string
  descripcion: string
  items: ItemDeclarado[]
}

export const GRUPOS: GrupoDeclarado[] = [
  {
    key: 'maquinaria',
    titulo: 'Equipos e implementos',
    descripcion: 'Aquí modificarás los estados y configuraciones de la maquinaria.',
    items: [
      { key: 'equipos', descripcion: 'Tractores y unidades, con su código, familia y estado.' },
      {
        key: 'familias',
        etiqueta: 'Familia de los equipos',
        descripcion: 'Agrupa equipos parecidos y les hereda la operación SAP.',
      },
      { key: 'implementos', descripcion: 'Los aperos que se enganchan y en qué labores se usan.' },
      {
        key: 'implementos_fisicos',
        etiqueta: 'Código de los implementos',
        descripcion: 'Cada apero real con su código; es lo que se elige al capturar.',
      },
      {
        key: 'puestos_trabajo',
        etiqueta: 'Puestos de trabajo',
        descripcion: 'La operación SAP con la que se notifica cada equipo o apero.',
      },
      {
        key: 'contadores',
        etiqueta: 'Contadores de horómetro',
        href: '/admin/contadores',
        descripcion: 'Cambios de tablero: qué contador llevaba cada equipo y desde cuándo.',
      },
      {
        key: 'tarifas',
        etiqueta: 'Tarifas',
        href: '/admin/tarifas',
        descripcion: 'El costo por hora de cada equipo y desde qué fecha rige.',
      },
    ],
  },
  {
    key: 'labores',
    titulo: 'Labores y personal',
    descripcion: 'Qué trabajo se hace en campo y quién lo ejecuta.',
    items: [
      { key: 'labores', descripcion: 'Las labores, sus tareas SAP, implementos y proveedores.' },
      { key: 'categorias_labor', descripcion: 'El grupo con el que se resumen las labores.' },
      { key: 'operadores', descripcion: 'Quién maneja el equipo, con su código de nómina.' },
    ],
  },
  {
    key: 'campo',
    titulo: 'Campo y cultivo',
    descripcion: 'El terreno, lo que se siembra en él y con qué se siembra.',
    items: [
      { key: 'zonas', descripcion: 'Las zonas de la finca y su encargado.' },
      { key: 'variedades', descripcion: 'Las variedades de melón que entran al trasplante.' },
      { key: 'materiales', descripcion: 'Plástico, manguera y demás insumos con su código.' },
      {
        key: 'planes_nutricionales',
        descripcion: 'Los planes de nutrición que se aplican en cada turno de riego.',
      },
    ],
  },
  {
    key: 'sap',
    titulo: 'Integración con SAP',
    descripcion: 'Los códigos con los que SAP recibe la notificación. Cámbialos sólo con SAP al lado.',
    items: [
      { key: 'tareas_sap', descripcion: 'La tarea que viaja en cada línea notificada.' },
      { key: 'procesos', descripcion: 'Los procesos SAP y el orden en que corren.' },
    ],
  },
  {
    key: 'organizacion',
    titulo: 'Organización',
    descripcion: 'Cómo se reparte el trabajo y en qué periodo se contabiliza.',
    items: [
      { key: 'departamentos', descripcion: 'Los departamentos a los que pertenece cada usuario.' },
      { key: 'proveedores', descripcion: 'Quién surte el plástico y la manguera.' },
      { key: 'temporadas', descripcion: 'El ciclo productivo: cuándo empieza y cuándo cierra.' },
    ],
  },
]

/** Lo mínimo que `organizar` necesita saber de una pestaña. */
export type PestanaMinima = { key: string; label: string; filas: unknown[] }

export type ItemMenu<T extends PestanaMinima> = {
  key: string
  etiqueta: string
  descripcion: string
  /** Cuántos registros tiene. Los enlaces externos no la traen. */
  cuenta: number | null
  href?: string
  pestana?: T
}

export type GrupoMenu<T extends PestanaMinima> = {
  key: string
  titulo: string
  descripcion: string
  items: ItemMenu<T>[]
}

const SIN_GRUPO = 'otros'

/**
 * Cruza lo declarado con lo que la página trajo de verdad.
 *
 * Un catálogo declarado que no llegó (migración sin correr) se calla; un
 * catálogo que llegó y nadie declaró cae en «Otros catálogos». Un bloque
 * que se queda sin ningún item no se enseña vacío.
 */
export function organizar<T extends PestanaMinima>(pestanas: T[]): GrupoMenu<T>[] {
  const porClave = new Map(pestanas.map((p) => [p.key, p]))
  const usadas = new Set<string>()

  const grupos: GrupoMenu<T>[] = []

  for (const g of GRUPOS) {
    const items: ItemMenu<T>[] = []

    for (const d of g.items) {
      if (d.href) {
        items.push({ key: d.key, etiqueta: d.etiqueta ?? d.key, descripcion: d.descripcion, cuenta: null, href: d.href })
        continue
      }
      const pestana = porClave.get(d.key)
      if (!pestana) continue
      usadas.add(d.key)
      items.push({
        key: d.key,
        etiqueta: d.etiqueta ?? pestana.label,
        descripcion: d.descripcion,
        cuenta: pestana.filas.length,
        pestana,
      })
    }

    if (items.length > 0) grupos.push({ ...g, items })
  }

  const huerfanas = pestanas.filter((p) => !usadas.has(p.key))
  if (huerfanas.length > 0) {
    grupos.push({
      key: SIN_GRUPO,
      titulo: 'Otros catálogos',
      descripcion: 'Datos maestros que todavía no tienen bloque propio.',
      items: huerfanas.map((p) => ({
        key: p.key,
        etiqueta: p.label,
        descripcion: 'Sin descripción asignada.',
        cuenta: p.filas.length,
        pestana: p,
      })),
    })
  }

  return grupos
}

/** Sin acentos y en minúsculas, para que «Códigos» se encuentre con «codigos». */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Filtra el menú por lo que se escribe en la búsqueda.
 *
 * Busca en el nombre del catálogo, en su descripción y en el título del
 * bloque: quien escribe «SAP» espera ver todo lo que tenga que ver con
 * SAP, no sólo lo que se llame así.
 */
export function filtrar<T extends PestanaMinima>(
  grupos: GrupoMenu<T>[],
  texto: string
): GrupoMenu<T>[] {
  const q = normalizar(texto)
  if (!q) return grupos

  return grupos
    .map((g) => {
      const bloque = normalizar(`${g.titulo} ${g.descripcion}`)
      const items = g.items.filter(
        (i) => bloque.includes(q) || normalizar(`${i.etiqueta} ${i.descripcion}`).includes(q)
      )
      return { ...g, items }
    })
    .filter((g) => g.items.length > 0)
}
