# Bitácora de errores por usuario (sql/118)

Pedido del usuario (2026-11-18): «quiero ver una bitácora particular de todos los problemas que tengan los usuarios
(no sincronizó, registró pero no se guardó bien…), un log por usuario, con un informe súper detallado del error, la
causa, el porqué y cómo solucionarlo; que el sistema esté blindado ante cualquier error».

## Qué se captura

| Fuente | Dónde vive | Cómo llega a la pantalla |
|---|---|---|
| Operaciones de Fertirriego **rechazadas** o **aceptadas con observaciones** por el servidor | `fert_operaciones` (ya existía; es la verdad) | `fn_errores_operaciones_fallidas` las lee, sin duplicarlas |
| Errores de JavaScript (`window.onerror`, `unhandledrejection`) | `registro_errores` (origen `navegador`) | `registrador.ts` |
| Pantallas que se caen (ErrorBoundary por pantalla, `error.tsx`, `global-error.tsx`) | `registro_errores` (origen `pantalla`) | `LimiteError.tsx` |
| Fallas al guardar en el teléfono (IndexedDB, guardado en segundo plano) | `registro_errores` (origen `guardado`, gravedad **crítico**) | `useCampo.ts`, `guardadoFondo.ts` |
| Fallas de sincronización (sin red, sesión vencida, permiso, 40001, timeout, 5xx, versión vieja) | `registro_errores` (origen `sincronizacion`) | `sincronizador.ts` |
| Todo error que la app le muestra a alguien al guardar (tickets, horómetros, labores, catálogos…) | `registro_errores` (origen `guardado`) | gancho en `mensajeDeError` (`src/lib/errores.ts`) |
| **Latido de salud** por usuario | `registro_salud` (una fila por usuario) | `enviarLatido` |

Adaptación frente al diseño pedido: «envuelve los guardados principales con un helper». Los ~100 guardados de la app ya
pasan por `mensajeDeError(...)` cuando fallan; se le puso un gancho (`alMostrarError`) en vez de tocar cada sitio, así
queda cubierto TODO guardado con error y el comportamiento visible no cambia. Para guardados que *lanzan* se agregó
`conRegistro(ctx, fn)` (registra y vuelve a lanzar). Los textos sueltos (validaciones de la propia pantalla) NO se anotan.

### Latido de salud
Se envía al abrir la app, al volver a la pantalla, al volver la señal, después de cada sincronización y cada 5 minutos
(como mucho uno cada 2 minutos): versión de la app, navegador/pantalla/zona, en línea, **pendientes locales de
Fertirriego**, **edad en horas del pendiente más viejo**, intentos máximos, **última sincronización buena**, espacio de
almacenamiento, permiso de ubicación, hora del teléfono (el servidor calcula el **desfase del reloj**). Con eso se detecta
«no sincronizó» aun sin ningún error.

## Entrega sin perder nada
- Cola local (`localStorage`, `agn-errores-cola-v1`): máximo 100 elementos; los repetidos se suman en uno solo; al pasar
  del límite sale primero lo menos grave y más viejo; si el almacenamiento se llena se recorta, nunca se rompe.
- Envío a `fn_errores_registrar(p_lote)` (lotes de 50) con reintento y **backoff** 5 s, 10 s, 20 s … tope 5 min; al volver
  la señal se reintenta de inmediato. Sin sesión o sin red, queda en la cola y se manda al volver. Solo se envía con la
  **misma persona** que lo generó. El botón «Avisar al administrador» fuerza el envío.
- **Anti-bucle**: el mismo error más de 20 veces por minuto se ignora (un bucle de renders no llena la cola).
- **Si la base aún no tiene la 118**, el registrador se pausa una hora (la cola conserva lo importante) y la app sigue
  igual: nada se rompe y no se llama a la base cada minuto.
- El registrador **nunca lanza**: cada función pública es un try/catch absoluto y no es recursiva.

## Privacidad y saneamiento (dos capas)
En el teléfono (`saneo.ts`) y otra vez en la base (`_err_sanear`, `_err_sanear_texto`): se ocultan claves tipo
password/token/cookie/authorization/llave/jwt/sesión (también anidadas), JWT y `Bearer …` dentro de textos, profundidad
máxima 4, 40 claves, 30 elementos por lista, mensaje 1000 caracteres, detalle 8000 (si pasa, se resume). No se guardan
cuerpos de formularios: solo el contexto técnico que se pasa explícitamente.

## Base de datos (sql/118)
- `registro_errores`: deduplicada por `(usuario_id, huella)`. **La huella se calcula en la base** (md5 de origen, módulo,
  ruta y código y mensaje normalizados: números y UUID → `#`), no se confía en el cliente. Contador `repeticiones`,
  `creado_en` (primera vez), `ultima_vez`, `estado` nuevo|visto|atendido, `nota_admin`, `atendido_por/at`. Si un error
  atendido vuelve a ocurrir, regresa a «nuevo» (la nota se conserva).
- `registro_salud`: último latido por usuario.
- RLS: solo `select` y solo con el permiso (`fn_es_admin()` o `fn_tiene_permiso('errores','ver')`); **ni siquiera el propio
  usuario** ve su fila. Escritura solo por funciones `security definer`.
- Límites: 50 elementos por envío; 200 filas **distintas** por hora por usuario (lo ya conocido solo suma).
- Retención **90 días**: purga oportunista (2 % de los envíos) + `fn_errores_purgar()` manual.
- Permiso nuevo: pantalla `errores` con acciones `ver`, `atender`, `exportar`. **No se otorga a ningún rol** (solo acceso total
  por `fn_es_admin()` o quien se lo den en Permisos); `public.permisos` no cambia (probado antes/después). La acción
  `atender` se agrega al catálogo de acciones.
- Funciones: `fn_errores_registrar`, `fn_errores_listar(filtros)`, `fn_errores_marcar(ids, estado, nota)`,
  `fn_errores_resumen_por_usuario()`, `fn_errores_operaciones_fallidas(desde,hasta,usuario,solo_rechazadas)`,
  `fn_errores_graves_nuevos()` (da 0 sin permiso, para el indicador), `fn_errores_purgar()`.

## Diagnóstico («informe súper detallado»)
`src/lib/errores/diagnostico.ts` (puro): `diagnosticar(error|operación)` devuelve título, qué pasó, causa probable, por qué
ocurre, qué le toca al usuario, qué le toca al administrador, gravedad, ¿se perdió algo? (sí/no/por verificar) y cómo
verificar. Casos: turno archivado, saldo insuficiente, custodia, duplicado, versión vieja, sesión vencida, permiso
(42501/RLS), 40001, timeout, 5xx, sin red, almacenamiento lleno/IndexedDB bloqueado, reloj desfasado, ubicación
(informativa), turno/producto/estación inexistente, cantidad inválida, cola atascada, error de pantalla, guardado de
fondo, y «desconocido» (muestra todos los datos técnicos y qué recoger). `diagnosticarLatido` detecta, sin que haya error:
pendiente de más de 6 h (error) o 24 h (crítico), sin sincronizar hace más de un día con pendientes, reloj desfasado
(5 min aviso, 1 h error), versión distinta de la actual, sin latido en 3 días. `semaforo` resume la salud (verde/ámbar/rojo/gris).

## Pantalla `/admin/errores` (Administración › Bitácora de errores)
Tarjetas (usuarios con problemas hoy, operaciones que NO se registraron, pendientes viejos, graves nuevos) · «Lo que NO se
registró» (rechazos del servidor + pendientes que no han llegado) · salud por usuario con semáforo y orden · línea de tiempo
(errores + rechazos + señales de salud) con filtros de fecha (UTC-6), usuario, gravedad, módulo y estado · informe con datos
técnicos copiables, operación afectada y «Marcar atendido» con nota · «Exportar» a Excel (3 hojas) · se actualiza sola cada
minuto. El menú de Administración muestra «Bitácora de errores (N)» con los graves nuevos, solo a quien tiene el permiso.
Los selectores usan `SelectorBuscable` (con búsqueda), como el resto de las pantallas de Administración.

## Blindaje en la app de campo
`LimiteError` rodea Fertirriego y Tickets: «Algo falló en esta pantalla. Lo que ya guardaste está a salvo.» con
«Reintentar» y «Avisar al administrador» (envía el reporte en el acto) y un código de soporte. «Envíos» muestra al propio
usuario sus rechazos con el «Qué hacer» del diagnóstico y avisa si un pendiente lleva 5 intentos o más.

## Qué correr
1. `sql/118_bitacora_errores.sql` en **desarrollo**; probar la pantalla (`pruebas/qa/errores_bitacora.ps1 -Con118`).
2. En **producción**, DESPUÉS de publicar el código. Sin la 118 la app funciona igual (el registrador se pausa).
3. Para que alguien vea la bitácora: Permisos › pantalla «Administración · Bitácora de errores» (Ver / Atender / Exportar).
   El Administrador (acceso total) la tiene sin hacer nada.

## Pruebas
- `pruebas/sql/118_bitacora_errores.sql` (réplica con 91–117; incluye 118>118 y equivalencia de permisos).
- `node --test pruebas/unit/errores_diagnostico.test.mjs errores_saneo.test.mjs errores_cola.test.mjs`.
- `pruebas/qa/errores_bitacora.ps1` (clics reales).
