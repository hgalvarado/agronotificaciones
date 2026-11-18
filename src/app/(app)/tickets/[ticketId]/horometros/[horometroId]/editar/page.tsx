import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { HorometroForm } from '@/components/horometro/HorometroForm'
import { VolverAlTicket } from '@/components/ticket/VolverAlTicket'
import { Alerta } from '@/components/ui/Primitivos'

export default async function EditarHorometroPage({
  params,
}: {
  params: Promise<{ ticketId: string; horometroId: string }>
}) {
  const { ticketId, horometroId } = await params
  const supabase = await createClient()

  const [{ data: horometro }, { data: equipos }, { data: operadores }] = await Promise.all([
    supabase.from('horometros').select('*').eq('id', horometroId).single(),
    supabase.from('equipos').select('*').eq('activo', true).eq('visible_app', true).order('codigo'),
    // Sólo quien MANEJA. `tipo_perfil` es un array y se pregunta
    // «contiene OPERADOR», así que quien lleva los dos perfiles sigue
    // saliendo; el puramente administrativo —que recibe un teléfono
    // pero no se sube a un tractor— se queda fuera.
    supabase
      .from('operadores')
      .select('*')
      .eq('activo', true)
      .contains('tipo_perfil', ['OPERADOR'])
      .order('nombre'),
  ])

  if (!horometro) notFound()

  // Un horómetro recién duplicado llega con lecturas en 0: es la señal de
  // que hay que capturar las reales del equipo nuevo.
  const esClon = horometro.horometro_inicial === 0 && horometro.horometro_final === 0

  return (
    <div className="anim-aparecer flex flex-col gap-4 p-4 lg:p-6">
      <VolverAlTicket ticketId={ticketId} />

      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          {esClon ? 'Completar horómetro duplicado' : 'Editar horómetro'}
        </h1>
        <p className="text-sm text-slate-400">
          {esClon
            ? 'Se copiaron fecha, turno y operador. Confirma el equipo y captura las lecturas reales.'
            : 'Modifica los datos del horómetro.'}
        </p>
      </div>

      {esClon && (
        <Alerta tono="azul">
          Las lecturas quedaron en 0 a propósito: nunca se copian los horómetros de otro equipo.
        </Alerta>
      )}

      <HorometroForm
        ticketId={ticketId}
        equipos={equipos ?? []}
        operadores={operadores ?? []}
        fechaTicket={horometro.fecha}
        horometroBase={{
          id: horometro.id,
          equipo_id: horometro.equipo_id,
          operador_id: horometro.operador_id,
          turno: horometro.turno,
          horometro_inicial: esClon ? undefined : horometro.horometro_inicial,
          horometro_final: esClon ? undefined : horometro.horometro_final,
          horas_hombre: horometro.horas_hombre,
          comentario: horometro.comentario,
        }}
      />
    </div>
  )
}
