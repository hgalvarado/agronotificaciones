/**
 * Diagnóstico de errores (puro, sin dependencias): convierte un error, una operación rechazada o un latido de salud
 * en un informe que se entiende — qué pasó, la causa probable, por qué ocurre, qué le toca al usuario, qué le toca al
 * administrador, qué tan grave es, si se perdió algo y cómo comprobarlo.
 *
 * Es la fuente única de los textos: la pantalla de la bitácora, «Envíos» del teléfono y el aviso al usuario usan este
 * catálogo. Lo que no se reconoce cae en «desconocido», que igual muestra los datos técnicos y sugiere qué recoger.
 * Sin importaciones (las pruebas lo cargan directo con node --test).
 */

export type Gravedad = 'info' | 'aviso' | 'error' | 'critico'
export type SePerdio = 'si' | 'no' | 'pendiente'

export type Diagnostico = {
  /** Identificador estable del caso (para pruebas y para agrupar). */
  clave: string
  titulo: string
  quePaso: string
  causa: string
  porQue: string
  alUsuario: string
  alAdministrador: string
  gravedad: Gravedad
  seperdio: SePerdio
  comoVerificar: string
}

export type EntradaDiagnostico = {
  /** navegador | sincronizacion | guardado | pantalla | servidor | otro */
  origen?: string | null
  /** Código técnico: de Postgres/PostgREST (42501, 40001…), HTTP (503) o del navegador (QuotaExceededError). */
  codigo?: string | null
  mensaje?: string | null
  /** Tipo de operación de Fertirriego (aplicacion, recepcion…), si la hay. */
  tipoOperacion?: string | null
  /** RECHAZADO | ACEPTADO_CON_OBSERVACIONES | ACEPTADO (operaciones del servidor). */
  resultado?: string | null
  observaciones?: string[] | null
  modulo?: string | null
  detalle?: Record<string, unknown> | null
}

type Caso = Omit<Diagnostico, 'clave'>

const t = (e: EntradaDiagnostico) => `${e.codigo ?? ''} ${e.mensaje ?? ''}`.toLowerCase()

/** Cuando el servidor rechazó una operación, lo que sigue es seguro: NO se aplicó (pero queda en el teléfono y en Envíos). */
const RECHAZO_SERVIDOR = (e: EntradaDiagnostico) => e.resultado === 'RECHAZADO'

const REGLAS: { clave: string; cuando: (e: EntradaDiagnostico) => boolean; caso: (e: EntradaDiagnostico) => Caso }[] = [
  {
    clave: 'turno_archivado',
    cuando: (e) => /ya termin[oó] su ciclo|archivado/.test(t(e)),
    caso: () => ({
      titulo: 'Registro sobre un turno que ya terminó su ciclo',
      quePaso: 'El teléfono mandó un registro de un turno que ya se cerró en AGL («Terminar ciclo»). El servidor no lo aplicó.',
      causa: 'La persona capturó (probablemente sin señal) un turno que se archivó antes de que su registro llegara.',
      porQue: 'Al terminar el ciclo, AGL baja todo el turno y lo borra de Supabase; lo que llega después ya no tiene dónde guardarse.',
      alUsuario: 'No vuelvas a mandarlo tal cual. Avisa a quien administra: si hace falta, reactivan el turno y registras de nuevo.',
      alAdministrador: 'Confirma con la persona si ese trabajo se hizo de verdad. Si sí: en AGL /TR02 reactiva el turno, pide que lo registre de nuevo y vuelve a terminar el ciclo.',
      gravedad: 'error',
      seperdio: 'si',
      comoVerificar: 'En AGL /TR02 revisa «Turnos archivados» y la fecha de cierre frente a la hora en que la persona lo capturó.',
    }),
  },
  {
    clave: 'saldo_insuficiente',
    cuando: (e) => /no alcanza el saldo|saldo insuficiente|saldo_negativo/.test(t(e)) || (e.observaciones ?? []).includes('SALDO_NEGATIVO'),
    caso: (e) => ({
      titulo: 'No alcanzaba el saldo de la bodega',
      quePaso: RECHAZO_SERVIDOR(e)
        ? 'Se intentó aplicar o trasladar más producto del que la bodega de la estación tiene registrado. El servidor lo rechazó.'
        : 'Se registró una aplicación que dejó el saldo de la bodega en negativo (el servidor la aceptó con observación).',
      causa: 'Falta registrar una recepción o un conteo anterior, o la cantidad se escribió mal (unidad o cero de más).',
      porQue: 'El saldo de cada estación se calcula con lo que se recibió menos lo que se aplicó; si falta una recepción, el sistema cree que no hay producto.',
      alUsuario: 'Revisa que la recepción de ese producto ya esté registrada y que la cantidad sea correcta. Si de verdad hay producto físico, haz un conteo y vuelve a registrar.',
      alAdministrador: 'Compara el saldo de la estación con la bodega física. Si el producto sí existía, pide un conteo de ajuste; si la cantidad estaba mal, que la persona la corrija.',
      gravedad: RECHAZO_SERVIDOR(e) ? 'error' : 'aviso',
      seperdio: RECHAZO_SERVIDOR(e) ? 'si' : 'no',
      comoVerificar: 'En Fertirriego › Estación › Kardex del producto: la suma de recepciones y aplicaciones debe cuadrar con el saldo.',
    }),
  },
  {
    clave: 'custodia',
    cuando: (e) => (/no est[aá] a tu cargo|fuera_de_custodia|custodia/.test(t(e)) || (e.observaciones ?? []).includes('FUERA_DE_CUSTODIA')) && !/relevo|entrega/.test(e.tipoOperacion ?? ''),
    caso: (e) => ({
      titulo: 'La estación no estaba a cargo de quien registró',
      quePaso: RECHAZO_SERVIDOR(e)
        ? 'La persona intentó registrar en una estación que no tenía a cargo en ese momento. El servidor lo rechazó.'
        : 'El registro se aceptó, pero la estación no estaba a cargo de esa persona cuando lo capturó (queda marcado para revisar).',
      causa: 'No se hizo el relevo (recibir la estación) o el jefe no le asignó la custodia.',
      porQue: 'Cada estación tiene una sola persona a cargo; el relevo la pasa de una a otra y solo quien la tiene puede registrar movimientos.',
      alUsuario: 'Recibe la estación con «Relevo» (con el código de quien entrega) o pide al jefe de zona que te la asigne.',
      alAdministrador: 'Revisa quién tenía la custodia en esa fecha. Si faltó el relevo, asigna la custodia en Fertirriego › Administrar estaciones y pide registrar de nuevo lo rechazado.',
      gravedad: RECHAZO_SERVIDOR(e) ? 'error' : 'aviso',
      seperdio: RECHAZO_SERVIDOR(e) ? 'si' : 'no',
      comoVerificar: 'En la ficha de la estación mira el historial de relevos y la custodia vigente en la fecha del registro.',
    }),
  },
  {
    clave: 'duplicado',
    cuando: (e) => /ya_existia|ya exist[ií]a|posible_duplicado|duplicate key|23505|ya existe/.test(t(e)) || (e.observaciones ?? []).includes('POSIBLE_DUPLICADO'),
    caso: (e) => ({
      titulo: 'Registro repetido',
      quePaso: 'El servidor ya tenía este registro (o uno igual el mismo día). No se duplicó.',
      causa: 'Se reenvió porque la señal se cortó a mitad del envío, o la persona lo capturó dos veces.',
      porQue: 'Cada registro lleva un identificador único: si llega dos veces, el segundo se ignora para no duplicar inventario.',
      alUsuario: 'No hagas nada: el primero ya está guardado. Quita el repetido de «Envíos».',
      alAdministrador: 'Solo si es POSIBLE_DUPLICADO (dos aplicaciones iguales con distinto identificador), revisa si de verdad se aplicó dos veces y anula la que sobre.',
      gravedad: 'info',
      seperdio: 'no',
      comoVerificar: 'Busca el registro en la bitácora de Fertirriego de la estación: debe aparecer una sola vez.',
    }),
  },
  {
    clave: 'version_vieja',
    cuando: (e) => /actualiza la aplicaci[oó]n|tipo de registro desconocido|schema cache|pgrst20[24]|could not find the function|pgrst202/.test(t(e)),
    caso: () => ({
      titulo: 'La aplicación del teléfono está desactualizada',
      quePaso: 'El teléfono mandó algo que la versión actual del servidor no entiende (un tipo de registro o un dato que cambió).',
      causa: 'El teléfono sigue con una versión vieja de la aplicación guardada, o el servidor aún no tiene una migración publicada.',
      porQue: 'La aplicación instalada se guarda en el teléfono para trabajar sin señal; si no se actualiza al abrirla con internet, se queda atrás.',
      alUsuario: 'Cierra la aplicación por completo, ábrela con internet y espera unos segundos; si sigue igual, desinstálala y vuelve a instalarla (lo guardado sin enviar se pierde al desinstalar: avisa antes).',
      alAdministrador: 'Compara la versión del último latido con la actual. Si todos fallan igual, falta correr una migración SQL en producción; si es una persona, es su teléfono.',
      gravedad: 'error',
      seperdio: 'pendiente',
      comoVerificar: 'En esta pantalla, columna «Versión» del usuario frente a la versión publicada; y en Supabase confirma que corrió la última migración.',
    }),
  },
  {
    clave: 'sesion_vencida',
    cuando: (e) => /jwt|sesi[oó]n (ya no|venci)|invalid refresh token|refresh_token|not authenticated|auth session missing/.test(t(e)) || e.codigo === '401',
    caso: () => ({
      titulo: 'La sesión venció',
      quePaso: 'El servidor no reconoció al usuario (la sesión del teléfono caducó) y no recibió lo pendiente.',
      causa: 'Pasaron muchos días sin conexión o se cerró la sesión; el permiso de entrada del teléfono caducó.',
      porQue: 'Por seguridad la sesión se renueva con internet; sin conexión por mucho tiempo ya no se puede renovar.',
      alUsuario: 'Abre la aplicación con internet y vuelve a entrar con tu usuario. Lo que registraste sigue guardado en el teléfono y se enviará solo.',
      alAdministrador: 'Si la persona no logra entrar, revisa que su usuario esté activo en Usuarios. No se perdió nada mientras no desinstale la aplicación.',
      gravedad: 'aviso',
      seperdio: 'pendiente',
      comoVerificar: 'Pide que abra «Envíos»: los pendientes deben bajar a cero tras entrar de nuevo.',
    }),
  },
  {
    clave: 'permiso',
    cuando: (e) => /42501|row-level security|permission denied|no tiene.*(ver|editar|recibir|aplicar|contar|relevo|anular|crear|eliminar)|tu rol no tiene/.test(t(e)),
    caso: () => ({
      titulo: 'Sin permiso para esa acción',
      quePaso: 'El servidor negó la acción porque el rol del usuario no tiene el permiso necesario.',
      causa: 'A su rol le falta la acción en la matriz de permisos, o el alcance (zona o estación) no incluye este registro.',
      porQue: 'Todos los permisos salen de la matriz de la base de datos; ninguna pantalla decide por su cuenta.',
      alUsuario: 'Avisa a quien administra el sistema qué querías hacer; no es un error tuyo.',
      alAdministrador: 'En Permisos revisa el rol de la persona (y sus zonas o estaciones asignadas). Concede solo lo necesario.',
      gravedad: 'error',
      seperdio: 'si',
      comoVerificar: 'Usuarios › ficha de la persona › «Qué puede hacer».',
    }),
  },
  {
    clave: 'serializacion',
    cuando: (e) => /40001|40p01|serializ|deadlock/.test(t(e)),
    caso: () => ({
      titulo: 'Choque momentáneo en la base de datos',
      quePaso: 'Dos operaciones tocaron lo mismo a la vez y la base pidió reintentar.',
      causa: 'Varios usuarios registrando en la misma estación al mismo tiempo.',
      porQue: 'La base protege el inventario: cuando dos cambios chocan, uno espera y se vuelve a intentar.',
      alUsuario: 'No hagas nada: el teléfono lo reintenta solo.',
      alAdministrador: 'Solo si se repite mucho en la misma estación, revisa quién más registra a la vez.',
      gravedad: 'info',
      seperdio: 'no',
      comoVerificar: 'El registro debe aparecer en la bitácora de la estación unos minutos después.',
    }),
  },
  {
    clave: 'timeout',
    cuando: (e) => /timeout|timed out|tiempo de espera|57014|statement timeout|aborterror/.test(t(e)) || e.codigo === '504',
    caso: () => ({
      titulo: 'El servidor tardó demasiado',
      quePaso: 'La petición no terminó a tiempo (señal muy lenta o servidor ocupado).',
      causa: 'Señal débil en el campo o carga alta en el servidor.',
      porQue: 'Con datos móviles inestables las respuestas se cortan; el teléfono guarda todo y vuelve a intentar.',
      alUsuario: 'Acércate a donde haya mejor señal y toca «Enviar ahora». Lo registrado no se pierde.',
      alAdministrador: 'Si afecta a muchos a la vez, revisa el estado de Supabase; si es una persona, es su señal.',
      gravedad: 'aviso',
      seperdio: 'pendiente',
      comoVerificar: 'Los pendientes del usuario en el latido deben bajar a cero en el siguiente envío.',
    }),
  },
  {
    clave: 'servidor_5xx',
    cuando: (e) => /^5\d\d$/.test(e.codigo ?? '') || /internal server error|bad gateway|service unavailable|pgrst3|xx000/.test(t(e)),
    caso: () => ({
      titulo: 'Falla del servidor',
      quePaso: 'Supabase respondió con un error interno.',
      causa: 'Falla momentánea del servicio o una función del servidor que reventó con estos datos.',
      porQue: 'No depende del teléfono: el servidor no pudo procesar la petición.',
      alUsuario: 'Espera unos minutos; el teléfono reintenta solo. Si pasa siempre con el mismo registro, avisa.',
      alAdministrador: 'Mira el estado de Supabase y los logs de Postgres de esa hora. Si es siempre el mismo registro, copia los datos técnicos de esta ficha para corregirlo.',
      gravedad: 'error',
      seperdio: 'pendiente',
      comoVerificar: 'Supabase › Logs › Postgres a la hora del error.',
    }),
  },
  {
    clave: 'sin_red',
    cuando: (e) => /failed to fetch|networkerror|network error|load failed|sin red|sin se[nñ]al|fetch failed|err_internet|offline/.test(t(e)),
    caso: () => ({
      titulo: 'Sin conexión a internet',
      quePaso: 'El teléfono no pudo comunicarse con el servidor.',
      causa: 'Sin señal o datos móviles apagados.',
      porQue: 'En el campo la señal es intermitente; por eso todo se guarda primero en el teléfono.',
      alUsuario: 'Sigue trabajando normal. Cuando vuelva la señal el teléfono envía solo; también puedes tocar «Enviar ahora» en «Envíos».',
      alAdministrador: 'No requiere acción mientras el pendiente más viejo del usuario no pase de unas horas. Si pasa de 6 h, llámalo.',
      gravedad: 'info',
      seperdio: 'no',
      comoVerificar: 'En el latido: «Pendientes» y «Pendiente más viejo» deben bajar cuando vuelve la señal.',
    }),
  },
  {
    clave: 'almacenamiento',
    cuando: (e) => /quotaexceeded|quota|storage|indexeddb|idb|no se pudo abrir el almac[eé]n|databaseclosederror|invalidstateerror|securityerror/.test(t(e)),
    caso: () => ({
      titulo: 'El teléfono no puede guardar datos',
      quePaso: 'La aplicación no pudo escribir en el almacenamiento del teléfono (donde guarda lo pendiente de enviar).',
      causa: 'Teléfono sin espacio, navegador en modo privado o con el almacenamiento bloqueado.',
      porQue: 'Sin ese almacenamiento no hay trabajo sin señal: lo que se registra podría no guardarse.',
      alUsuario: 'Libera espacio, sal del modo privado y abre la aplicación desde el icono instalado. Antes de seguir, comprueba en «Envíos» que lo nuevo aparece.',
      alAdministrador: 'Este caso es grave: la persona puede creer que registró y no es así. Llámala y verifica lo capturado el día del error.',
      gravedad: 'critico',
      seperdio: 'pendiente',
      comoVerificar: 'Compara lo que la persona dice que registró con las operaciones recibidas de ese día en «Lo que NO se registró».',
    }),
  },
  {
    clave: 'reloj_desfasado',
    cuando: (e) => /reloj|hora del tel[eé]fono|desfase/.test(t(e)) || (e.observaciones ?? []).includes('RELOJ'),
    caso: () => ({
      titulo: 'La hora del teléfono no coincide con la real',
      quePaso: 'La hora del teléfono difiere de la del servidor.',
      causa: 'Fecha y hora manuales o zona horaria distinta de Honduras.',
      porQue: 'Las fechas de los registros se toman del teléfono; con la hora mal, caen en el día equivocado.',
      alUsuario: 'En Ajustes del teléfono activa «Fecha y hora automáticas» y la zona horaria de Honduras (UTC-6).',
      alAdministrador: 'Revisa los registros de esa persona: pueden estar en otra fecha. Corrige con anulación y nuevo registro si hace falta.',
      gravedad: 'aviso',
      seperdio: 'no',
      comoVerificar: 'Latido › «Reloj»: el desfase debe quedar en pocos segundos.',
    }),
  },
  {
    clave: 'ubicacion',
    cuando: (e) => /geolocation|ubicaci[oó]n|gps|sin_ubicacion|position/.test(t(e)),
    caso: () => ({
      titulo: 'Sin ubicación (informativo)',
      quePaso: 'No se pudo tomar la ubicación del teléfono al registrar.',
      causa: 'Permiso de ubicación denegado o GPS apagado/sin señal.',
      porQue: 'La ubicación es opcional: el registro se guardó igual y queda marcado «sin ubicación».',
      alUsuario: 'Si quieres que quede la ubicación, activa el GPS y el permiso de ubicación para la aplicación. No es obligatorio.',
      alAdministrador: 'No requiere acción, salvo que sea una política exigir la ubicación.',
      gravedad: 'info',
      seperdio: 'no',
      comoVerificar: 'El registro aparece con la marca «sin ubicación».',
    }),
  },
  {
    clave: 'turno_o_producto_inexistente',
    cuando: (e) => /no existe|ya no existe|no est[aá] publicado|inexistente|23503|foreign key/.test(t(e)),
    caso: () => ({
      titulo: 'El turno, producto o estación ya no existe',
      quePaso: 'El registro apunta a algo que el servidor no encontró (turno, producto, estación, chofer o vehículo).',
      causa: 'Se eliminó o se republicó desde AGL, o el teléfono tiene un catálogo desactualizado.',
      porQue: 'El teléfono usa la copia de catálogos que bajó la última vez; si AGL cambió algo, el registro apunta a lo viejo.',
      alUsuario: 'Abre «Envíos», toca «Enviar ahora» con internet para actualizar y vuelve a registrar eligiendo de la lista nueva.',
      alAdministrador: 'Confirma en AGL que el turno/producto sigue publicado (/FR01 › Sincronizar todo).',
      gravedad: 'error',
      seperdio: 'si',
      comoVerificar: 'Busca el turno o producto por nombre en AGL y en Fertirriego › Estación.',
    }),
  },
  {
    clave: 'cantidad_invalida',
    cuando: (e) => /debe ser mayor que cero|no es un n[uú]mero v[aá]lido|demasiado grande|cantidad.*(entre|v[aá]lida)|22003|22p02|numeric/.test(t(e)),
    caso: () => ({
      titulo: 'Cantidad o número inválido',
      quePaso: 'Una cantidad llegó vacía, en cero, negativa, con letras o demasiado grande.',
      causa: 'Error al escribir la cantidad (unidad equivocada, ceros de más, coma en lugar de punto).',
      porQue: 'El servidor valida los números para proteger el inventario.',
      alUsuario: 'Corrige la cantidad y vuelve a registrar.',
      alAdministrador: 'Si se repite con la misma persona, revisa si entiende la unidad de ese producto.',
      gravedad: 'aviso',
      seperdio: 'si',
      comoVerificar: 'El registro corregido debe aparecer en la bitácora de la estación.',
    }),
  },
  {
    clave: 'cola_atascada',
    cuando: (e) => (e.detalle?.['intentos'] as number) >= 5 || /cola atascada|atascad/.test(t(e)),
    caso: () => ({
      titulo: 'Un registro lleva muchos intentos sin enviarse',
      quePaso: 'El teléfono ha intentado enviar un mismo registro varias veces sin lograrlo.',
      causa: 'Señal que se corta cada vez, o un error que no se resuelve reintentando (permiso, dato inválido, versión vieja).',
      porQue: 'Reintentar no arregla errores de datos; hace falta que alguien lo revise.',
      alUsuario: 'Abre «Envíos» y mira el motivo; si dice que no se aceptó, corrige y registra de nuevo.',
      alAdministrador: 'Pide los datos técnicos del registro (esta ficha) y llama a la persona.',
      gravedad: 'error',
      seperdio: 'pendiente',
      comoVerificar: 'Latido › «Intentos» del pendiente más viejo.',
    }),
  },
  {
    clave: 'render_js',
    cuando: (e) => e.origen === 'pantalla' || /cannot read|undefined is not|is not a function|is not defined|minified react error|hydration|typeerror|referenceerror|rangeerror/.test(t(e)),
    caso: (e) => ({
      titulo: 'Se cayó una pantalla de la aplicación',
      quePaso: 'Una pantalla tuvo un error de programación y mostró el aviso «Algo falló en esta pantalla». Lo ya guardado está a salvo.',
      causa: `Error de código (${(e.mensaje ?? 'sin mensaje').slice(0, 120)}): un dato inesperado o una situación que la pantalla no contempló.`,
      porQue: 'Es un defecto de la aplicación, no de la persona. Se corrige publicando una nueva versión.',
      alUsuario: 'Toca «Reintentar». Si vuelve a salir, toca «Avisar al administrador» y sigue con otra pantalla.',
      alAdministrador: 'Copia los datos técnicos (pila y versión) y pásalos a desarrollo. Si es la misma pantalla y muchos usuarios, es prioridad.',
      gravedad: 'error',
      seperdio: 'pendiente',
      comoVerificar: 'La pila (en datos técnicos) indica el archivo; reproducir con el mismo dispositivo y versión.',
    }),
  },
  {
    clave: 'guardado_fondo',
    cuando: (e) => e.origen === 'guardado',
    caso: () => ({
      titulo: 'Un registro no se pudo guardar en el teléfono',
      quePaso: 'La persona tocó Guardar pero el guardado en segundo plano falló: el registro puede NO existir.',
      causa: 'Falla del almacenamiento del teléfono o de la ubicación durante el guardado.',
      porQue: 'El formulario se cierra al tocar Guardar y termina de guardar por detrás; si eso falla, la pantalla avisa y devuelve el borrador.',
      alUsuario: 'Vuelve a abrir el formulario (el borrador se conserva), revisa los datos y toca Guardar otra vez.',
      alAdministrador: 'Verifica con la persona que lo repitió; busca el registro en «Lo que NO se registró».',
      gravedad: 'error',
      seperdio: 'pendiente',
      comoVerificar: 'Compara con las operaciones recibidas de esa fecha.',
    }),
  },
]

/** Datos técnicos que se muestran siempre (copiables) y qué recoger cuando no se reconoce el caso. */
export function diagnosticar(e: EntradaDiagnostico): Diagnostico {
  for (const r of REGLAS) {
    let coincide = false
    try {
      coincide = r.cuando(e)
    } catch {
      coincide = false
    }
    if (coincide) return { clave: r.clave, ...r.caso(e) }
  }
  const rechazado = e.resultado === 'RECHAZADO'
  return {
    clave: 'desconocido',
    titulo: 'Error no clasificado',
    quePaso: rechazado
      ? 'El servidor rechazó un registro por un motivo que el catálogo todavía no reconoce.'
      : 'Ocurrió un error que el sistema no sabe clasificar todavía.',
    causa: `Sin causa identificada. Mensaje: «${(e.mensaje ?? 'sin mensaje').slice(0, 200)}»${e.codigo ? ` (código ${e.codigo})` : ''}.`,
    porQue: 'No coincide con ningún caso conocido; los datos técnicos de abajo permiten investigarlo.',
    alUsuario: 'Anota qué estabas haciendo, toma una captura y avisa a quien administra. No repitas el registro hasta saber si se guardó (revisa «Envíos»).',
    alAdministrador:
      'Recoge: la hora exacta, el usuario y su dispositivo, la pantalla, qué intentaba hacer, el mensaje completo y si tenía señal. Con eso se agrega el caso al catálogo (src/lib/errores/diagnostico.ts).',
    gravedad: rechazado ? 'error' : 'aviso',
    seperdio: rechazado ? 'si' : 'pendiente',
    comoVerificar: 'Compara lo que la persona dice que hizo con las operaciones y errores de esa hora en su línea de tiempo.',
  }
}

/* ------------------------------------------------------------------ latido de salud */

export type Latido = {
  ultimo_latido?: string | null
  version_app?: string | null
  pendientes?: number | null
  pendiente_mas_viejo_h?: number | null
  ultima_sync_ok?: string | null
  en_linea?: boolean | null
  desfase_reloj_s?: number | null
  errores_7d?: number | null
  graves_nuevos?: number | null
  rechazos_7d?: number | null
}

const horas = (iso: string | null | undefined, ahora: Date) =>
  iso ? (ahora.getTime() - new Date(iso).getTime()) / 3_600_000 : null

export const UMBRALES = {
  /** Pendiente de enviar que ya preocupa / es grave (horas). */
  pendienteAviso: 6,
  pendienteGrave: 24,
  /** Sin ninguna señal de vida de la app (días). */
  sinLatidoDias: 3,
  /** Desfase del reloj (segundos). */
  relojAviso: 300,
  relojGrave: 3600,
} as const

/**
 * Problemas que se detectan SIN que haya habido ningún error: pendiente viejo, sin sincronizar, reloj desfasado,
 * versión vieja, sin latido en días. Devuelve los diagnósticos que aplican (vacío = sano).
 */
export function diagnosticarLatido(l: Latido, ahora: Date = new Date(), versionActual?: string): Diagnostico[] {
  const out: Diagnostico[] = []
  const pend = l.pendientes ?? 0
  const viejoH = l.pendiente_mas_viejo_h ?? null

  if (pend > 0 && viejoH !== null && viejoH >= UMBRALES.pendienteAviso) {
    const grave = viejoH >= UMBRALES.pendienteGrave
    out.push({
      clave: 'pendiente_viejo',
      titulo: `Hay ${pend} registro(s) sin enviar desde hace ${Math.round(viejoH)} h`,
      quePaso: 'El teléfono tiene registros guardados que todavía no llegaron al servidor.',
      causa: 'Sin señal prolongada, sesión vencida, versión vieja o un error que no se resuelve solo.',
      porQue: 'Mientras no lleguen, el inventario y los reportes NO los incluyen: para el sistema no existen.',
      alUsuario: 'Abre la aplicación con internet, entra a «Envíos» y toca «Enviar ahora». Si dice que no se aceptó, corrige.',
      alAdministrador: 'Llama a la persona. Si no logra enviar, mira sus errores de sincronización en la línea de tiempo.',
      gravedad: grave ? 'critico' : 'error',
      seperdio: 'pendiente',
      comoVerificar: 'El latido siguiente debe mostrar «Pendientes: 0».',
    })
  }
  if (pend > 0 && l.ultima_sync_ok) {
    const h = horas(l.ultima_sync_ok, ahora)
    if (h !== null && h >= UMBRALES.pendienteGrave && !(viejoH !== null && viejoH >= UMBRALES.pendienteAviso)) {
      out.push({
        clave: 'sin_sincronizar',
        titulo: `Sin sincronizar hace ${Math.round(h)} h`,
        quePaso: 'La última sincronización buena fue hace más de un día y quedan pendientes.',
        causa: 'Sin señal, sesión vencida o la aplicación no se abre.',
        porQue: 'La sincronización solo ocurre con la aplicación abierta y con internet.',
        alUsuario: 'Abre la aplicación con internet.',
        alAdministrador: 'Confirma con la persona que sigue trabajando y que tiene señal.',
        gravedad: 'aviso',
        seperdio: 'pendiente',
        comoVerificar: 'La «última sincronización buena» debe actualizarse.',
      })
    }
  }
  const desf = l.desfase_reloj_s
  if (typeof desf === 'number' && Math.abs(desf) >= UMBRALES.relojAviso) {
    const d = diagnosticar({ mensaje: 'reloj desfasado', observaciones: ['RELOJ'] })
    out.push({
      ...d,
      clave: 'reloj_desfasado',
      titulo: `Reloj del teléfono desfasado ${Math.round(Math.abs(desf) / 60)} min ${desf > 0 ? 'adelantado' : 'atrasado'}`,
      gravedad: Math.abs(desf) >= UMBRALES.relojGrave ? 'error' : 'aviso',
    })
  }
  if (versionActual && l.version_app && l.version_app !== versionActual) {
    out.push({
      clave: 'version_desactualizada',
      titulo: `Versión desactualizada (${l.version_app}; la actual es ${versionActual})`,
      quePaso: 'El teléfono corre una versión anterior de la aplicación.',
      causa: 'No se ha abierto con internet desde que se publicó la nueva versión.',
      porQue: 'La aplicación se actualiza sola al abrirla con internet.',
      alUsuario: 'Cierra la aplicación por completo y ábrela con internet.',
      alAdministrador: 'Si pasan días y no se actualiza, pide reinstalarla (después de enviar lo pendiente).',
      gravedad: 'aviso',
      seperdio: 'no',
      comoVerificar: 'El latido siguiente trae la versión nueva.',
    })
  }
  const sinLatido = horas(l.ultimo_latido, ahora)
  if (sinLatido !== null && sinLatido >= UMBRALES.sinLatidoDias * 24) {
    out.push({
      clave: 'sin_latido',
      titulo: `Sin señal de la aplicación hace ${Math.floor(sinLatido / 24)} días`,
      quePaso: 'Esta persona no ha abierto la aplicación (o no ha tenido internet) en varios días.',
      causa: 'Está de descanso, sin teléfono con señal, o dejó de usar la aplicación.',
      porQue: 'La aplicación envía un latido cada vez que se abre con internet.',
      alUsuario: 'Abre la aplicación con internet para actualizar.',
      alAdministrador: 'Si debía estar registrando, llámala: puede tener trabajo sin enviar.',
      gravedad: 'info',
      seperdio: 'pendiente',
      comoVerificar: 'Aparece un latido nuevo al abrir la aplicación.',
    })
  }
  return out
}

export type Semaforo = 'verde' | 'ambar' | 'rojo' | 'gris'

/** Verde = sano · ámbar = revisar · rojo = actuar · gris = sin datos de salud. */
export function semaforo(l: Latido, ahora: Date = new Date(), versionActual?: string): Semaforo {
  const hay = Boolean(l.ultimo_latido) || (l.errores_7d ?? 0) > 0 || (l.rechazos_7d ?? 0) > 0
  if (!hay) return 'gris'
  const gravedades = diagnosticarLatido(l, ahora, versionActual).map((d) => d.gravedad)
  if ((l.graves_nuevos ?? 0) > 0 || gravedades.includes('critico') || gravedades.includes('error')) return 'rojo'
  if ((l.errores_7d ?? 0) > 0 || (l.rechazos_7d ?? 0) > 0 || gravedades.includes('aviso')) return 'ambar'
  return 'verde'
}

/** El texto plano que se copia/comparte (para el administrador o para pegarlo en un mensaje). */
export function textoDelInforme(e: EntradaDiagnostico, d: Diagnostico, extra: Record<string, string | number | null | undefined> = {}): string {
  const lineas = [
    `INFORME DE ERROR · ${d.titulo}`,
    `Gravedad: ${d.gravedad} · ¿Se perdió algo?: ${d.seperdio === 'si' ? 'sí' : d.seperdio === 'no' ? 'no' : 'por verificar'}`,
    `Qué pasó: ${d.quePaso}`,
    `Causa probable: ${d.causa}`,
    `Por qué ocurre: ${d.porQue}`,
    `Al usuario: ${d.alUsuario}`,
    `Al administrador: ${d.alAdministrador}`,
    `Cómo verificar: ${d.comoVerificar}`,
    '--- datos técnicos ---',
    `Origen: ${e.origen ?? '-'} · Módulo: ${e.modulo ?? '-'} · Código: ${e.codigo ?? '-'} · Tipo de operación: ${e.tipoOperacion ?? '-'}`,
    `Mensaje: ${e.mensaje ?? '-'}`,
  ]
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined && v !== '') lineas.push(`${k}: ${v}`)
  if (e.detalle) lineas.push(`Detalle: ${JSON.stringify(e.detalle).slice(0, 3000)}`)
  return lineas.join('\n')
}
