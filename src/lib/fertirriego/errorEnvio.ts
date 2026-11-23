/**
 * Explica un envío rechazado en lenguaje llano (puro, sin red ni React): qué pasó, por qué, qué hacer, y qué botones
 * tienen sentido. Primero reconoce los casos de Campo (diésel, motores, inyección, catálogos…) y, si no coincide,
 * usa el catálogo general de `lib/errores/diagnostico` (una sola fuente de textos).
 */

import { diagnosticar } from '@/lib/errores/diagnostico'

/** Qué botones ofrecer: reintentar tal cual, corregir (abrir el formulario), descartar, pedir ayuda al administrador. */
export type AccionEnvio = 'reintentar' | 'corregir' | 'descartar' | 'ayuda'

export type ExplicacionEnvio = {
  titulo: string
  quePaso: string
  porQue: string
  queHacer: string
  /** Acciones, la primera es la recomendada. «descartar» y «ayuda» siempre están: nunca queda guindado. */
  acciones: AccionEnvio[]
}

type Entrada = { mensaje?: string | null; tipo?: string | null; observaciones?: string[] | null }

const m = (e: Entrada) => (e.mensaje ?? '').toLowerCase()

const REGLAS: { cuando: (e: Entrada) => boolean; caso: ExplicacionEnvio }[] = [
  {
    cuando: (e) => /todav[ií]a no publica el producto di[eé]sel/.test(m(e)),
    caso: {
      titulo: 'El diésel todavía no está publicado',
      quePaso: 'El sistema no sabe aún cuál es el producto «diésel», así que no pudo asentar el combustible.',
      porQue: 'La Torre de Control debe publicar el diésel desde AGL. No es un error tuyo ni de lo que escribiste.',
      queHacer: 'Toca «Pedir ayuda»: el administrador lo ve en su computadora, publica el diésel y lo acepta. Si ya lo publicaron, toca «Reintentar».',
      acciones: ['ayuda', 'reintentar', 'descartar'],
    },
  },
  {
    cuando: (e) => /motor no estaba instalado|motor est[aá] en el taller|motor estaba retirado/.test(m(e)),
    caso: {
      titulo: 'El motor no estaba asignado en esa fecha',
      quePaso: 'El historial del motor no lo tenía en esta estación ese día.',
      porQue: 'Falta registrar cuándo se instaló o movió el motor. Un registro de un día pasado debe poder guardarse igual.',
      queHacer: 'Toca «Reintentar»: ahora el sistema lo acepta y lo marca para revisar. Si sigue igual, «Pedir ayuda».',
      acciones: ['reintentar', 'ayuda', 'descartar'],
    },
  },
  {
    cuando: (e) => /no est[aá] instalado en ninguna estaci[oó]n/.test(m(e)),
    caso: {
      titulo: 'El motor no está instalado en ninguna estación',
      quePaso: 'No hay a qué estación ni tanque asentar el diésel de este motor.',
      porQue: 'El motor nunca se instaló (o se retiró) en el sistema.',
      queHacer: 'Pide a quien configura que lo instale en «Mover motor»; después toca «Reintentar». También puedes «Pedir ayuda».',
      acciones: ['ayuda', 'reintentar', 'descartar'],
    },
  },
  {
    cuando: (e) => /ya hay un registro de ese d[ií]a/.test(m(e)),
    caso: {
      titulo: 'Ya existe un registro de ese día',
      quePaso: 'Ese motor ya tiene su registro diario de esa fecha.',
      porQue: 'Solo se permite uno por día; si estaba mal hay que anularlo primero.',
      queHacer: 'Si el que ya existe está bien, «Descartar» este. Si estaba mal, anula el otro desde el historial del motor y registra de nuevo.',
      acciones: ['descartar', 'ayuda'],
    },
  },
  {
    cuando: (e) => /visor final .* mayor que el inicial/.test(m(e)),
    caso: {
      titulo: 'El visor subió y no hay diésel recibido',
      quePaso: 'El visor final es mayor que el inicial y ese día no se registró ninguna recepción de diésel.',
      porQue: 'El diésel que sube en el tanque tiene que venir de una recepción.',
      queHacer: 'Registra primero el diésel recibido (o corrige la lectura del visor) y vuelve a enviar; o toca «Pedir ayuda».',
      acciones: ['corregir', 'ayuda', 'descartar'],
    },
  },
  {
    cuando: (e) => /explica el cambio|horómetro final es menor|escribe n[uú]meros v[aá]lidos|revoluciones deben|fecha no puede ser posterior|indica la fecha|movimiento no puede ser en el futuro|no puede ser en el futuro/.test(m(e)),
    caso: {
      titulo: 'Hay un dato mal escrito',
      quePaso: 'Una lectura, una fecha o una explicación no pasó la revisión del servidor.',
      porQue: 'El servidor revisa que los números y fechas tengan sentido para no ensuciar el inventario.',
      queHacer: 'Toca «Corregir y reenviar», arregla el dato y guarda. El mensaje de abajo dice cuál es.',
      acciones: ['corregir', 'ayuda', 'descartar'],
    },
  },
  {
    cuando: (e) => /no est[aá] en el cat[aá]logo|no existe o ya no est[aá] activo|ese tanque no|actualiza la aplicaci[oó]n/.test(m(e)),
    caso: {
      titulo: 'Tu teléfono tiene una lista vieja',
      quePaso: 'Elegiste algo (motor, tanque, chofer, vehículo…) que el servidor ya no tiene igual.',
      porQue: 'El catálogo cambió desde la última vez que el teléfono se actualizó.',
      queHacer: 'Toca «Actualizar» con señal, y después «Corregir y reenviar» eligiendo de nuevo. Si no se arregla, «Pedir ayuda».',
      acciones: ['corregir', 'ayuda', 'descartar'],
    },
  },
  {
    cuando: (e) => /no tienes acceso a esa estaci[oó]n|tu rol no tiene|no puedes|no tiene permiso/.test(m(e)),
    caso: {
      titulo: 'No tienes permiso para esto',
      quePaso: 'Tu usuario no puede hacer esta acción en esta estación.',
      porQue: 'Los permisos los define el administrador en la matriz de permisos.',
      queHacer: 'Toca «Pedir ayuda»: el administrador puede darte el permiso o aceptar el registro por ti.',
      acciones: ['ayuda', 'descartar'],
    },
  },
  {
    cuando: (e) => /Registro histórico.*vigente/i.test(e.mensaje ?? ''),
    caso: {
      titulo: 'Permiso de registro histórico vencido',
      quePaso: 'El servidor no aceptó el registro de un día anterior.',
      porQue: 'El permiso temporal para registrar días anteriores ya venció o no existe.',
      queHacer: 'Pide al administrador que lo renueve y vuelve a intentar.',
      acciones: ['ayuda', 'descartar'],
    },
  },
]

export function explicarEnvio(e: Entrada): ExplicacionEnvio {
  for (const r of REGLAS) {
    try {
      if (r.cuando(e)) return { ...r.caso, acciones: asegurar(r.caso.acciones) }
    } catch {
      /* una regla rota no impide las demás */
    }
  }
  const d = diagnosticar({ mensaje: e.mensaje, resultado: 'RECHAZADO', tipoOperacion: e.tipo, observaciones: e.observaciones })
  const acciones: AccionEnvio[] = d.clave === 'duplicado' ? ['descartar', 'ayuda'] : d.clave === 'saldo_insuficiente' ? ['corregir', 'ayuda', 'descartar'] : ['reintentar', 'ayuda', 'descartar']
  return { titulo: d.titulo, quePaso: d.quePaso, porQue: d.porQue, queHacer: d.alUsuario, acciones: asegurar(acciones) }
}

/** «Descartar» y «Pedir ayuda» siempre existen: ningún error deja el registro sin salida. */
function asegurar(a: AccionEnvio[]): AccionEnvio[] {
  const s = [...a]
  if (!s.includes('ayuda')) s.push('ayuda')
  if (!s.includes('descartar')) s.push('descartar')
  return s
}
