/**
 * Entradas del menú que vienen de la base (migración 93: `pantallas.en_menu`).
 *
 * El menú de siempre sigue escrito en AppShell (no se arriesga la navegación de nadie). Esto solo AGREGA las
 * pantallas nuevas que el usuario puede ver y que el menú escrito todavía no tiene. Si un módulo trae varias,
 * van juntas en un grupo con el nombre del módulo.
 *
 * Puro: ni React ni Supabase.
 */

export type PantallaDeMenu = { codigo: string; nombre: string; ruta: string; icono: string | null; modulo: string | null }

export type EntradaMenuBase = {
  href: string
  pantalla: string
  etiqueta: string
  icono: string
  hijos?: EntradaMenuBase[]
}

export function entradasDeLaBase(
  pantallas: PantallaDeMenu[],
  ve: (codigo: string) => boolean,
  yaEnMenu: { codigos: Set<string>; hrefs: Set<string> }
): EntradaMenuBase[] {
  const nuevas = pantallas.filter(
    (p) => p.ruta && ve(p.codigo) && !yaEnMenu.codigos.has(p.codigo) && !yaEnMenu.hrefs.has(p.ruta)
  )
  const porModulo = new Map<string, PantallaDeMenu[]>()
  for (const p of nuevas) {
    const m = p.modulo || p.nombre
    porModulo.set(m, [...(porModulo.get(m) ?? []), p])
  }

  const entrada = (p: PantallaDeMenu): EntradaMenuBase => ({
    href: p.ruta,
    pantalla: p.codigo,
    etiqueta: p.nombre,
    icono: p.icono || 'plan',
  })

  return [...porModulo.entries()].map(([modulo, lista]) =>
    lista.length === 1
      ? entrada(lista[0])
      : {
          href: lista[0].ruta,
          pantalla: lista[0].codigo,
          etiqueta: modulo,
          icono: lista[0].icono || 'plan',
          // En un grupo, la etiqueta del hijo deja de repetir el módulo («Fertirriego · Estaciones» → «Estaciones»)
          hijos: lista.map((p) => ({ ...entrada(p), etiqueta: p.nombre.replace(new RegExp(`^${modulo}\\s*·\\s*`), '') })),
        }
  )
}
