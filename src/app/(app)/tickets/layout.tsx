import { createClient } from '@/lib/supabase/server'
import { getPerfilActual, getPermisos, puede } from '@/lib/auth'
import { TicketsSplit } from '@/components/ticket/TicketsSplit'
import { ListaTickets } from '@/components/ticket/ListaTickets'
import type { Ticket } from '@/lib/types'

// La lista vive en el LAYOUT (no en la página) para que Next.js la
// conserve entre navegaciones: al tocar otro ticket sólo se vuelve a
// renderizar el panel de detalle.
export default async function TicketsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const [{ perfil }, permisos] = await Promise.all([getPerfilActual(), getPermisos()])

  // RLS decide el alcance: sin «Ver todo» en Tickets se reciben sólo los
  // propios. Se piden SÓLO las columnas que la lista dibuja, y las dos
  // consultas van en paralelo. Antes traía todas las columnas de 200
  // tickets en cada navegación, que es la mayor parte de lo que se sentía
  // lento.
  //
  // Antes esto era `rol?.codigo === 'ADMIN' || rol?.codigo === 'TORRE_CONTROL'`.
  const veTodo = puede(permisos, 'tickets', 'ver_todo')

  const [{ data: tickets }, { data: temporadaActiva }, { data: usuarios }, { data: temporadas }] =
    await Promise.all([
    supabase
      .from('tickets')
      .select('id, codigo, fecha, estado, proceso, departamento, usuario_id')
      .order('fecha', { ascending: false })
      .limit(100),
    supabase.from('temporadas').select('id').eq('activa', true).maybeSingle(),
    // Para el ticket histórico: sólo hace falta la lista si esta persona
    // puede crear a nombre de otro.
    veTodo
      ? supabase
          .from('perfiles')
          .select('id, nombre, departamento')
          .eq('activo', true)
          .order('nombre')
      : Promise.resolve({ data: [] }),
    supabase
      .from('temporadas')
      .select('id, nombre, activa')
      .order('fecha_inicio', { ascending: false }),
  ])

  return (
    <TicketsSplit
      lista={
        <ListaTickets
          tickets={(tickets as Ticket[] | null) ?? []}
          usuarioId={perfil?.id ?? ''}
          nombreUsuario={perfil?.nombre ?? ''}
          departamento={perfil?.departamento ?? null}
          temporadaActivaId={temporadaActiva?.id ?? null}
          usuarios={
            (usuarios as { id: string; nombre: string; departamento: string | null }[] | null) ?? []
          }
          temporadas={
            (temporadas as { id: string; nombre: string; activa: boolean }[] | null) ?? []
          }
          puedeLotes={veTodo}
        />
      }
    >
      {children}
    </TicketsSplit>
  )
}
