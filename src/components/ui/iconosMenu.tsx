import {
  IconCalendar,
  IconCampana,
  IconChart,
  IconClock,
  IconDinero,
  IconGauge,
  IconGota,
  IconInbox,
  IconLock,
  IconMapPin,
  IconPlan,
  IconSettings,
  IconTicket,
  IconTractor,
  IconUser,
} from './Icons'

/**
 * Los íconos que puede llevar una entrada del menú, por nombre. Lo usan el menú (AppShell), el Diseñador de menú
 * y `pantallas.icono` (93). Un nombre que no esté aquí se dibuja como «plan».
 */
export const ICONOS_MENU: Record<string, { etiqueta: string; dibujo: (className?: string) => React.ReactNode }> = {
  ticket: { etiqueta: 'Ticket', dibujo: (c) => <IconTicket className={c} /> },
  gauge: { etiqueta: 'Horómetro', dibujo: (c) => <IconGauge className={c} /> },
  mappin: { etiqueta: 'Ubicación', dibujo: (c) => <IconMapPin className={c} /> },
  chart: { etiqueta: 'Gráfico', dibujo: (c) => <IconChart className={c} /> },
  plan: { etiqueta: 'Plan', dibujo: (c) => <IconPlan className={c} /> },
  gota: { etiqueta: 'Gota', dibujo: (c) => <IconGota className={c} /> },
  dinero: { etiqueta: 'Dinero', dibujo: (c) => <IconDinero className={c} /> },
  ajustes: { etiqueta: 'Ajustes', dibujo: (c) => <IconSettings className={c} /> },
  usuario: { etiqueta: 'Persona', dibujo: (c) => <IconUser className={c} /> },
  tractor: { etiqueta: 'Tractor', dibujo: (c) => <IconTractor className={c} /> },
  calendario: { etiqueta: 'Calendario', dibujo: (c) => <IconCalendar className={c} /> },
  reloj: { etiqueta: 'Reloj', dibujo: (c) => <IconClock className={c} /> },
  bandeja: { etiqueta: 'Bandeja', dibujo: (c) => <IconInbox className={c} /> },
  campana: { etiqueta: 'Campana', dibujo: (c) => <IconCampana className={c} /> },
  candado: { etiqueta: 'Candado', dibujo: (c) => <IconLock className={c} /> },
}

export function IconoMenu({ nombre, className }: { nombre: string | null | undefined; className?: string }) {
  return <>{(ICONOS_MENU[nombre ?? ''] ?? ICONOS_MENU.plan).dibujo(className)}</>
}
