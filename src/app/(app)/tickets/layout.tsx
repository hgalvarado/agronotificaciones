import { createClient } from '@/lib/supabase/server'
import { getPerfilActual, getPermisos, getReglas, puede } from '@/lib/auth'
import { aplanarReglas } from '@/lib/permisos/clientABAC'
import { TicketsSplit } from '@/components/ticket/TicketsSplit'
import { ListaTickets } from '@/components/ticket/ListaTickets'
import type { BloqueTickets, Capturador } from '@/lib/tickets/tipos'

// La lista vive en el LAYOUT (no en la página) para que Next.js la
// conserve entre navegaciones: al tocar otro ticket sólo se vuelve a
// renderizar el panel de detalle.
export default async function TicketsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const [{ perfil }, permisos, reglas] = await Promise.all([
    getPerfilActual(),
    getPermisos(),
    getReglas(),
  ])

  const creaPorOtros =
    puede(permisos, 'tickets', 'crear') &&
    (reglas.get('tickets:crear')?.alcance ?? 'global') !== 'propietario'

  // RLS decide el alcance: la vista ya entrega sólo lo que a esta persona
  // le toca, así que aquí no hay ni un filtro por usuario.
  //
  // Las REGLAS enteras y no un booleano: las acciones en masa se deciden
  // ticket por ticket, porque el alcance mira quién lo capturó y la
  // condición en qué paso del proceso está.
  //
  // Esto antes preguntaba por `tickets:ver_todo`, una acción que la
  // migración 53 BORRÓ al convertirla en el eje «alcance». Al no existir
  // contestaba que no siempre, así que el botón «Varios» no le salía a
  // nadie y la selección múltiple —que lleva aquí desde la 45— parecía
  // no existir.

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
    // puede crear a nombre de otro. Eso es «crear» con alcance global:
    // con alcance propietario sólo puede crearse tickets a sí misma.
    creaPorOtros
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
          reglas={aplanarReglas(reglas)}
        />
      }
    >
      {children}
    </TicketsSplit>
  )
}
