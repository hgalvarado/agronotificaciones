import { createClient } from '@/lib/supabase/server'
import { getPerfilActual, getPermisos, puede } from '@/lib/auth'
import { TicketsSplit } from '@/components/ticket/TicketsSplit'
import { ListaTickets } from '@/components/ticket/ListaTickets'
import type { BloqueTickets, Capturador } from '@/lib/tickets/tipos'

// La lista vive en el LAYOUT (no en la página) para que Next.js la
// conserve entre navegaciones: al tocar otro ticket sólo se vuelve a
// renderizar el panel de detalle.
export default async function TicketsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const [{ perfil }, permisos] = await Promise.all([getPerfilActual(), getPermisos()])

  // RLS decide el alcance: sin «Ver todo» en Tickets se reciben sólo los
  // propios, así que aquí no hay ni un filtro por usuario.
  const veTodo = puede(permisos, 'tickets', 'ver_todo')

  // El ÍNDICE del historial, no los tickets. Antes esto traía las últimas
  // cien filas y con eso marzo desaparecía; ahora trae una consulta
  // agregada —un renglón por mes y proceso, unas cien en dos años de
  // operación— y los tickets de cada bloque se bajan al abrirlo. El
  // historial es infinito hacia atrás y la primera pantalla cuesta lo
  // mismo el primer día que el último.
  const [
    { data: resumen },
    { data: capturadores },
    { data: temporadaActiva },
    { data: usuarios },
    { data: temporadas },
  ] = await Promise.all([
    supabase.rpc('fn_tickets_resumen'),
    supabase.rpc('fn_tickets_capturadores'),
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
          resumenInicial={(resumen as BloqueTickets[] | null) ?? []}
          capturadoresIniciales={(capturadores as Capturador[] | null) ?? []}
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
