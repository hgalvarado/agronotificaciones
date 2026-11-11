# Memoria de trabajo de Claude · AgroNotificaciones

> Lo escribe y mantiene Claude para retomar el hilo en conversaciones nuevas. Pedido del usuario (2026-11-10):
> «deja siempre un .md con lo que haces y por qué, y los pendientes; cuando completes uno, bórralo».
> Regla: **actualizar este archivo al terminar cada bloque de trabajo**. Lo hecho se resume en «Historial»;
> los pendientes se borran al completarse.

## 1. Contexto en 30 segundos

- **AgroNotificaciones** (este repo): Next.js 16 + Supabase, publicado en Vercel desde `main`.
  Los **capturadores trabajan en campo desde el teléfono** (PWA instalada, señal intermitente). El usuario
  (Torre de Control) y su asistente **revisan por lotes** desde `/horometros` y `/labores`, no ticket por ticket.
- **Flujo del ticket (procesos)**: 0 Registrando (campo captura) → 1 Revisando (Torre Control revisa; campo ya no
  toca) → 2 Pendiente aprobación (lo revisó otro; el encargado verifica) → Notificado en SAP (solo Administrador).
- **Continuidad de horómetros**: por equipo, la lectura inicial de hoy debe seguir donde terminó la final
  anterior. Es lo que el usuario cuadra al revisar (columnas «comparativo» / desfase en `/horometros`).
- **AGL Gestión** (`C:\HENRYALVARADO2022\AGLGestion_App`, Python + JSON en OneDrive) es el otro proyecto del
  usuario. Ahí viven ahora Trasplante, Turnos de Riego y Líneas Telefónicas (/LN01-03). Su publicación
  (`Publicar_Produccion.bat` → `arranque.py`) **nunca debe modificar** `data/sistema/menu_schema.json`.

## 2. Reglas de trabajo (acordadas con el usuario)

- Ramas: commits en `desarrollo`. **Nunca** push ni merge a `main` sin que el usuario diga «pasa a producción».
- Bases Supabase: producción `ooxoqopaiavfhfxxtzgh` (Vercel, `.env.produccion.local`) y desarrollo
  `ifzwqdstpoyoidsflvuo` (`.env.local`). Claude **no ejecuta SQL de DDL**: entrega `sql/NN_*.sql`, los prueba en
  una réplica local (ver §5) y el usuario los corre en el SQL Editor (primero desarrollo, luego producción,
  y en producción DESPUÉS de que Vercel publique el código que los necesita).
- Borrados de tablas: respaldo previo en el esquema `respaldo` dentro de la misma migración, sin CASCADE.
- **QA obligatoria con clics reales** antes de entregar (ver §5). Todo campo que registra datos debe funcionar.
- Mobile-first (capturadores en el teléfono). Funciones homogéneas en todos los módulos. Operable con teclado.
- Respuestas al usuario en español, claras, sin jerga innecesaria.

## 3. Estado actual (2026-11-10, noche)

- `main` en producción: commit `40dacd3` (sin Telecom, Trasplante ni Turnos de riego en la UI).
- `desarrollo` adelante de `main` (sin push): Fase 1 (`7ff21ec`), tickets en el celular (`9c94457`),
  continuidad al capturar (`e4ea6a4`), revisión por lotes (`ebd9f39`).
- SQL: `sql/84` corrida en desarrollo (falta producción). `sql/85` (última lectura) **sin correr en ninguna
  base** — el código funciona sin ella (respaldo con RLS), pero el capturador solo verá sus propias lecturas.
- Supabase: Telecom retirado en ambas bases (`sql/83`, respaldo en esquema `respaldo`).
- **Dato del usuario**: los capturadores registran la jornada de AYER o días anteriores (cuando el trabajo ya
  se hizo). Nunca asumir «hoy»; la continuidad se calcula contra la lectura anterior a la fecha del ticket.

## 4. Pendientes (borrar al completar)

- [ ] **Usuario corre en PRODUCCIÓN** `sql/84` → `85` → `86` → `87` → `88` (código ya publicado el 2026-11-11,
      `main` = `4580222`). Hasta correr la 86 nadie puede mover procesos en producción.
- [ ] **Filtro «Horómetro malo» en /horometros** (aprobado por el usuario 2026-11-11): tarjeta/filtro rápido
      para las filas cuyo comentario trae «[Horómetro malo]» (`MARCA_HOROMETRO_MALO` en `lib/horometro/repetido.ts`).
- [ ] Duplicados viejos: en desarrollo hay capturadores con varios tickets «Registrado» del mismo día (hasta
      8). La 86 no los toca; la consulta para verlos está al final de `sql/86`. Decidir con el usuario.
- [ ] **Velocidad de Labores**: medido. La consulta en la base es rápida (~10 ms en réplica; ~300 ms ida y
      vuelta pidiendo solo `detalle_id`). Lo lento es la transferencia: `select *` = ~300 KB/mes, 64 columnas,
      0.9–3 s según la red. Siguiente paso: en `ControlLabores` pedir solo las columnas que usan la tabla, los
      filtros y la exportación SAP (revisar cada uso antes de quitar una).
- [ ] (Opcional, Fase 2) marca «revisado» por línea, si el usuario la quiere además de los procesos.
- [ ] **Fase 3 · Captura sin señal** (PWA): guardar local y enviar al volver la conexión. Diseñar con cuidado
      (duplicados, conflicto con revisión, reglas de fecha); proponerlo al usuario antes de construir.
- [ ] DDT de Desinfección: hoy lee `siembras`/`planes_siembra` (Trasplante ya no se captura aquí). Decidir fuente.
- [ ] Borrar tablas de Trasplante y Riego (con respaldo) cuando se resuelva el DDT. Mantener `turnos` y
      `estaciones_riego` (los usa Desinfección).
- [ ] Al terminar las fases: borrar el usuario QA de desarrollo (`qa.rendimiento@desarrollo.local`).

## 5. Cómo hacer QA (receta)

1. Copia del repo para no tocar el servidor local del usuario (puerto 3000):
   `git worktree add --detach <scratch>\qa_prod desarrollo` → `npm ci` → copiar `.env.local` → `npx next build`
   → `npx next start -p 3100` (en segundo plano). Para probar cambios sin commit, copiar los archivos cambiados.
2. Pruebas en `pruebas/qa/*.ps1` (arnés `comun.ps1`: Edge headless + CDP, sesión del usuario QA).
   Ej.: `powershell -ExecutionPolicy Bypass -File pruebas/qa/tiempo_real.ps1`. Escribir con `Teclear` (teclado
   real); asignar `.value` a mano no dispara todos los `onChange` de React.
3. Usuario QA: solo en desarrollo, rol Torre de Control (id 2) + todas las zonas. Credenciales en
   `pruebas/qa/qa_usuario.local.json` (ignorado por git). Si falta: crear con `POST /auth/v1/admin/users` +
   fila en `perfiles` + `perfiles_zonas`.
4. SQL: réplica local con `initdb` en `<scratch>\pg_qa` (puerto 5499, `-A trust`), roles/esquemas stub de Supabase,
   y `respaldos/<fecha>/esquema_desa.sql` + `datos.sql` (del script `scripts/clonar-bd-desarrollo.ps1`).
5. No usar `npm run build` en la carpeta del usuario (el `prebuild` borra `.next` de su servidor de desarrollo).

## 6. Historial (lo hecho y por qué)

- **2026-11-10 · Limpieza**: retiradas de la UI Trasplante y Turnos de riego (se migraron a AGL), imágenes de
  ejemplo de Next, BITACORA.md. Telecom migrado a AGL (Líneas Telefónicas) y retirado (código + `sql/83`).
- **2026-11-10 · Base de desarrollo**: proyecto Supabase separado + `scripts/clonar-bd-desarrollo.ps1`.
- **2026-11-10 · Fase 1** (`7ff21ec`): `lib/memoria` (useMemoria: filtros por usuario y pantalla, seguro con la
  hidratación), `lib/datos/useConsultaViva` (caché + actualización silenciosa), `lib/datos/useAvisosCambios`
  (foco + Realtime, no interrumpe al que escribe), `DataGrid` prop `memoria`, precarga completa de
  /tickets, /horometros, /labores en el menú (`AppShell`), `sql/84` (Realtime). QA: volver a Horómetros
  1.3 s → 0.13 s; cambio de otro usuario visible en ~1.5 s sin tocar nada.
- **2026-11-10 · Tickets en el celular** (`9c94457`): panel «Mi trabajo» (jornada a registrar = hoy o ayer,
  pendientes en Registrando), detalle con la fecha como título, botón fijo «Agregar equipo». QA
  `tickets_movil.ps1` 15/15. Los formularios de horómetro y labor ya eran buenos en celular (capturas con
  `capturas_captura.ps1`); no se tocaron.
- **2026-11-10 · Continuidad al capturar** (`e4ea6a4`): al elegir el equipo se propone el horómetro inicial
  desde la última lectura final anterior a la jornada y se avisa (sin bloquear) si no sigue la secuencia.
  Por qué: el usuario cuadra eso al revisar; mejor evitar el desfase en origen. `sql/85` +
  `lib/horometro/repositorioLectura.ts`. QA `continuidad_captura.ps1` 9/9.
- **2026-11-10 · Fase 2 revisión por lotes** (`ebd9f39`): en /horometros y /labores, al marcar líneas aparece
  «Pasar sus N tickets a…» (`components/ticket/ProcesoEnLote.tsx`, usa `actualizar_tickets_masivo`; destinos
  según la matriz de permisos). La continuidad por equipo ya existía (comparativo, filtro «Con desfase»).
  QA `revision_lotes.ps1` 9/9.
- **2026-11-11 · Comparativo** (`b992290`, `sql/87`): con dos lecturas del mismo turno en un día la ventana
  cruzaba la secuencia (T6603-A79 04-nov: +6/−10/+4). Ahora dentro del día encadena por lectura (HI, HF) y el
  turno es desempate. Réplica: 0 desfases nuevos; solo desaparecen los falsos.
- **2026-11-11 · Tickets v2** (`5752097`, `sql/86`), pedidos del usuario:
  recientes por día (mes en curso; en cambio de mes, mínimo 10 días) en vez del acordeón mes→proceso;
  un ticket «Registrando» por persona y día (la ventana lleva al existente + trigger); el capturador ya no
  tiene «Enviar a revisión»: el proceso lo mueve quien tenga la casilla **«Mover proceso»** (acción
  `mover_proceso` en la matriz, concedida a roles con Aprobar/Notificar: 2 Torre de Control y 6 Digitador
  Análisis); botones de un toque (`BotonesProceso`): barra de 4 pasos en el detalle, «→ siguiente» en cada
  fila, selección por día o por paso. Lógica en `lib/tickets/proceso.ts`. QA `tickets_v2.ps1` 15/15.
  86 y 87 corridas en desarrollo (2026-11-11); QA con la 86: tickets_v2 18/18, revision_lotes 9/9.
- **2026-11-11 · Equipo registrado dos veces** (`sql/88`, `lib/horometro/repetido.ts`): si el equipo ya tiene
  ese día las MISMAS lecturas, el formulario lo avisa (y quita el botón fijo de guardar) con dos salidas:
  «Agregar labores a ese registro» o «Reportar horómetro malo y guardar» (marca `[Horómetro malo]` en el
  comentario). Traslape = solo aviso. Por qué: capturadores volvían a registrar el equipo en vez de agregarle
  labores. QA `horometro_repetido.ps1` 11/11.
- Ojo QA: copiar archivos de rutas con `[ticketId]` con `Copy-Item -LiteralPath` (los corchetes son comodín).
