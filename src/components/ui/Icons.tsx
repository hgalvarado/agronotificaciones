// Iconos SVG propios (estilo línea, 24x24). Se escriben a mano para no
// agregar una dependencia de librería de iconos al proyecto.

type IconProps = { className?: string }

const base = 'shrink-0'

function Svg({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${base} ${className ?? 'h-5 w-5'}`}
    >
      {children}
    </svg>
  )
}

export const IconTicket = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4V9Z" />
    <path d="M13 7v10" strokeDasharray="2 3" />
  </Svg>
)

export const IconGauge = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    <path d="m14.1 10.9 3.4-3.4" />
    <path d="M4.5 19a9 9 0 1 1 15 0" />
  </Svg>
)

export const IconChart = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="M7 15l3.5-4 3 2.5L18 8" />
  </Svg>
)

/** La gota del riego. */
export const IconGota = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M12 2.7 6.9 8.9a7 7 0 1 0 10.2 0L12 2.7Z" />
  </Svg>
)

export const IconSettings = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </Svg>
)

export const IconPlus = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconCopy = ({ className }: IconProps) => (
  <Svg className={className}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2" />
  </Svg>
)

export const IconPencil = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />
  </Svg>
)

export const IconLock = ({ className }: IconProps) => (
  <Svg className={className}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Svg>
)

export const IconUnlock = ({ className }: IconProps) => (
  <Svg className={className}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </Svg>
)

export const IconSend = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
  </Svg>
)

export const IconChevronRight = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
)

export const IconChevronLeft = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
)

export const IconChevronDown = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)

export const IconX = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
)

export const IconCheck = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
)

export const IconTractor = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M4 4h5l1 5" />
    <path d="M10 9h7l1 4" />
    <circle cx="7" cy="16" r="4" />
    <circle cx="18" cy="17" r="3" />
    <path d="M11 16h4" />
  </Svg>
)

export const IconMapPin = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </Svg>
)

export const IconUser = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Svg>
)

export const IconCalendar = ({ className }: IconProps) => (
  <Svg className={className}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </Svg>
)

export const IconLogout = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </Svg>
)

export const IconInbox = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
  </Svg>
)

export const IconSearch = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
)

export const IconClock = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </Svg>
)

export const IconMoon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Svg>
)

export const IconSun = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
)

export const IconTrash = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </Svg>
)

export const IconCampana = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M18 8a6 6 0 1 0-12 0c0 4.5-1.5 6-2 6.5h16c-.5-.5-2-2-2-6.5" />
    <path d="M10.3 19a2 2 0 0 0 3.4 0" />
  </Svg>
)

export const IconDinero = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M12 2v20" />
    <path d="M16.5 7.5A3.5 3.5 0 0 0 13 5h-1.5a3 3 0 0 0 0 6h1.5a3 3 0 0 1 0 6H11a3.5 3.5 0 0 1-3.5-2.5" />
  </Svg>
)

export const IconMas = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </Svg>
)

export const IconPlan = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
    <path d="M8 13h3M8 16h6" />
  </Svg>
)
