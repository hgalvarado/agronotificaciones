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

## 3. Estado actual (2026-11-12)

- `desarrollo` adelante de `main` con Permisos v2 (92, 93) y Fertirriego A–D. SQL 91–96 corridas en desarrollo
  (la 96 el 2026-11-12; QA relevo/traslado 27/27). Nada pasa a producción hasta que el usuario lo diga (decisión 2026-11-11).

### Estado anterior (2026-11-11)

- **Producción al día**: `main` = `7ed69a6` (todo lo de `desarrollo`). `sql/83`–`90` corridas
  en desarrollo y producción. El usuario dio «Mover proceso» a Torre de Control en producción.
- Supabase: Telecom retirado en ambas bases (`sql/83`, respaldo en esquema `respaldo`).
- **Dato del usuario**: los capturadores registran la jornada de AYER o días anteriores (cuando el trabajo ya
  se hizo). Nunca asumir «hoy»; la continuidad se calcula contra la lectura anterior a la fecha del ticket.

## 4. Pendientes (borrar al completar)

- [ ] **Pasar Permisos v2 a producción** (cuando el usuario diga): 1) publicar el código (funciona sin la 92);
      2) correr `sql/92` en producción; 3) verificar que se entra y que Permisos/Usuarios abren. Antes de correrla,
      la prueba `pruebas/sql/92_equivalencia.sql` sobre un clon fresco de producción (91+92+93). Decisión del usuario
      (2026-11-11): NADA a producción hasta tener todos los módulos nuevos listos y probados en desarrollo.

- [ ] **Fertirriego** (diseño aprobado 2026-11-11, `docs/fertirriego-diseno.md`): bodega por estación,
      aplicación por turno, custodia/relevo con código TOTP verificado sin internet, traslados, kardex; captura
      sin señal; AGL publica y analiza. **Etapa A hecha** (`sql/91` corrida en desarrollo; AGL
      `fertirriego_campo.py` + botón «Publicar a campo» en /CF07). El usuario ya creó el rol «Integración AGL»;
      falta que guarde la conexión en AGL **/SE03 Conexiones** (cifrada y compartida, 2026-11-12). **Etapa B hecha** (2026-11-11, `sql/94` y `sql/95` corridas en
      desarrollo): app de campo sin señal en `/fertirriego`. **Etapa C hecha** (2026-11-12, `496e911`; 96 corrida en
      desarrollo, QA `pruebas/qa/fertirriego_relevo_traslado.ps1` 27/27). **Etapa D hecha** en AGL
      (`6c74e71`, `03b55ea`). Manuales en `docs/manuales/` (+ «¿Cómo se usa?» en la app). Siguiente: **Etapa E**
      (alertas, sugerencia de envío, cierre mensual).
      Guías de Next 16 a leer antes de construir: `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md` y
      `offline-support.md`, `use-offline.md`.

- [ ] **AGL única fuente de catálogos** (pedido y aprobado por el usuario 2026-11-11): inventario y propuesta en
      `docs/agl-fuente-unica.md`. Esperando decisiones de reconciliación (zonas 2B/2C/3C, sub-turnos, temporada 2025-26).
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

- **2026-11-12 (noche, trabajo autónomo; bitácora en `reporte7am.md`)**: Etapa C (relevo con código TOTP sin internet,
  traslados con autorización, exportación a AGL — `sql/96`, UI en `components/fertirriego/*Relevo*`, `*Traslado*`,
  `PantallaCodigo`, `lib/fertirriego/codigo.ts`), Etapa D en AGL (`fertirriego_analisis.py`, pestaña Campo en /CF07),
  manuales (`docs/manuales/`, `AGLGestion_App/docs/manual_fertirriego_AGL.md`), ayuda en la app
  (`lib/manual/markdown.tsx` sin librerías; `next.config` `outputFileTracingIncludes` para que el .md viaje a Vercel).
  QA: B 27/27 (sin 96), ayuda 12/12, AGL 13/13 + unitaria 14/14; regresiones tickets 15/15, lotes 9/9, permisos 33/33
  y 18/18 (primera corrida tras recompilar falla por arranque en frío; repetir).
- **2026-11-12 (mañana) · AGL /SE03 Conexiones cifradas** (pedido del usuario: su asistente sincroniza cuando él no
  está; AGL se comparte por OneDrive). `backend/conexiones.py`: archivo `data/sistema/conexiones_<ENTORNO>.cifrado.json`,
  clave maestra elegida por el usuario (opción «clave maestra», no llave fija en el código), recordada por PC con
  DPAPI (ctypes). Unitaria 37/37, clics 28/28. Ojos: (1) `data-resumen` ya existe en otras vistas de AGL: usar
  atributos con prefijo propio en QA; (2) una vista cuya acción escribe en una carpeta de sus `canales` se remonta
  sola y corta el paso: /SE03 va con `canales: []`; (3) en PowerShell `"$VAR?.x"` toma `?` como parte del nombre de
  la variable: usar `${VAR}?.x`; y `$est1`/`$EST1` son la MISMA variable.
- **2026-11-12 (tarde) · Recibir con plan, borradores, /FR01** (`a449a3c` AgroNoti, `22f378b` AGL): recibir sin
  «¿Dónde?» y con los productos del plan de la estación; borradores (`lib/fertirriego/borrador.ts`); AGL /FR01 una
  sola pantalla (Sincronizar todo, vista previa, comparativo, consignación, relevos). Defectos hallados: GPS sin
  límite dejaba «Guardando…» para siempre (ubicacion.ts); lo guardado durante una sincronización esperaba ≥1 min
  (sincronizador: una vuelta más). QA: campo 37/37, relevo/traslado 27/27, ayuda 12/12, FR01 19/19, conexiones 28/28.
  **Lección de proceso (el usuario se quejó, con razón, de 2 h perdidas)**: no relanzar la prueba lenta a ciegas;
  analizar el código/prueba primero, una corrida para confirmar, tope de 30 min y avisar. En QA de campo, tras abrir
  la pantalla esperar a que `[data-actualizar]` deje de estar deshabilitado (la base de desarrollo tarda >10 s).
  En desarrollo el rol Torre de Control quedó sin permisos de Fertirriego (lo cambió el usuario o alguien; avisado).
- **2026-11-12 · AGL: otra base = borrar lo anterior** (`0188018`, pedido del usuario: probará desde AGL de
  PRODUCCIÓN contra la base de DESARROLLO). `fertirriego_campo.limpiar_otra_base`: lo bajado/publicado de otra base
  se borra al cambiar la dirección (/SE03, bajar, publicar, abrir Campo). Unitaria 17/17, clics 4/4.
  Revisión del usuario técnico en desarrollo (rol 8 «Integración AGL»): le falta `fertirriego_agl · publicar`; le
  sobran permisos de fertirriego (ver/recibir/aplicar/contar) y de tickets (incl. eliminar/notificar); además
  Gustavo Betancourth tiene el rol 8 como único rol. Se informó al usuario; no se cambió nada en la base.
- **2026-11-12 · Filtro «Horómetro malo»** (`e3910ab`): tarjeta/filtro rápido en /horometros con las lecturas cuyo
  comentario trae `[Horómetro malo]` y cuántos equipos. QA `horometro_malo_filtro.ps1` 9/9.
- Ojo AGL: `notificar()` va a la barra de estado (un solo mensaje): un aviso posterior pisa al anterior. No notificar
  avisos al repintar; ponerlos en un `title` o en la vista.
- Ojo: el clasificador bloquea leer secretos (llaves `fert_llaves`) en consola: en QA, leer el código de la pantalla.

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
- **2026-11-11 · Cerrar ticket** (`sql/89`): los capturadores no podían cerrar su ticket. La RLS de UPDATE de
  `tickets` no tiene WITH CHECK, así que su USING se aplica a la fila NUEVA; la condición
  «solo abiertos y en Registrando» falla con el ticket ya cerrado. Era un error viejo; se notó al quitar
  «Enviar a revisión». cerrar/reabrir pasan a `security definer` y validan el permiso sobre el ticket ANTES del
  cambio. Ojo con cualquier otra escritura «invoker» que cambie `estado`: le pasaría lo mismo.
- **2026-11-11 · Eliminar solo vacío** (`sql/90`, publicado `ddf6b7e`; 90 corrida en ambas): casilla
  «Eliminar con registros»; sin ella un ticket con horómetros no se elimina (trigger). QA 7/7.
- **2026-11-11 · Mi trabajo = sin cerrar**: el capturador termina su parte CERRANDO el ticket (el paso a
  Revisando es de Torre de Control). «Pendientes» pasa a «Sin cerrar» (solo tickets ABIERTOS en Registrando);
  la jornada cerrada muestra «Ya cerraste esta jornada». QA `mi_trabajo_cerrados.ps1` 7/7.
- **2026-11-11 · Permisos v2** (`sql/92`, corrida en desarrollo; producción pendiente): varios roles por persona
  (`seguridad.perfiles_roles`, unión: alcance más amplio; `perfiles.rol_id` = principal), «Todas las zonas»
  explícito (`perfiles.todas_las_zonas`; las vistas ESTRICTAS no cambian), `pantallas.modulo/usa_condicion/
  etiquetas_alcance`, `acciones.nivel`. Pantallas nuevas: Permisos por módulo con niveles rápidos
  (`PermisosPantallas` + `TarjetaPermisosPantalla`, `lib/permisos/niveles.ts`) y ficha de Usuarios (roles,
  zonas, estaciones, «Qué puede hacer»). Pruebas: `pruebas/sql/92_permisos.sql` 38/38,
  `92_equivalencia.sql` (antes/después: 0 diferencias para usuarios existentes), QA `permisos_v2.ps1` 33/33.
  **Lección**: una tabla en `public` con FK a perfiles y a roles vuelve ambiguo `perfiles?select=*,roles(*)` en
  PostgREST y NADIE entra (pasó en desarrollo). Tablas puente de seguridad van fuera de `public`; los embeds de
  roles se nombran (`roles!perfiles_rol_id_fkey`).
- **2026-11-11 · Fertirriego Etapa B** (`sql/94` fn_fert_estado_campo + menú; `sql/95` la custodia se mira al REGISTRAR
  —creado_en—, no a la hora del hecho: lo encontró la QA). Código: `lib/fertirriego/*` (IndexedDB por usuario, cola con
  UUID, sincronizador, cálculos puros de saldo/kardex/plan), `components/fertirriego/*` (Estación, Por turno, Bitácora,
  Envíos; formularios Recibir/Aplicar/Contar/Horas; anular/devolver; asignar custodia), `public/sw.js` (solo se instala
  al abrir /fertirriego; guarda esa pantalla y /_next/static; lo demás va a la red igual), `app/manifest.ts`. QA
  `fertirriego_campo.ps1` 27/27 (sin señal = Supabase bloqueado + servidor apagado; estación de prueba que se borra) y
  regresión tickets_movil 15/15, revision_lotes 9/9, permisos_v2 33/33, permisos_delegacion 18/18.
- Ojo QA: la primera corrida tras `next start` falla por arranque en frío (páginas lentas); repetir. Y toda prueba que
  cambie configuración debe devolver el valor ORIGINAL (permisos_delegacion dejó Fertirriego fuera del menú; corregido).
- **2026-11-11 · Permisos P3-P5** (`sql/93`, corrida en desarrollo): historial de accesos (`seguridad.bitacora_accesos`,
  `fn_historial_accesos`, componente `HistorialAccesos`), menú desde la base para pantallas nuevas (`pantallas.en_menu/icono`,
  `lib/navegacion/menuBase.ts`; el menú escrito no se toca), delegación a jefes de zona (`roles.delegable`,
  `fn_guardar_accesos_persona` con la sesión de quien edita; la API de Usuarios ya no escribe accesos con la llave de
  servicio). Pruebas `pruebas/sql/93_permisos.sql` 21/21, QA `permisos_delegacion.ps1` 18/18 y `permisos_v2.ps1` 33/33.
- Ojo QA: un clic antes de que React tome la página se PIERDE y el siguiente cae en otro lado (marcó «Torre de Control»
  como delegable; se revirtió). Repetir el clic hasta ver el efecto (aria-selected) y abortar si no. Y verificar al final
  que el usuario QA quedó como estaba (`permisos_delegacion.ps1` lo hace).
- **2026-11-11 · Fertirriego Etapa A** (`sql/91`, pruebas `pruebas/sql/91_fertirriego.sql` 57/57): tablas,
  libro inalterable, saldos, custodia, llaves TOTP, `fn_fert_sincronizar` (idempotente por UUID del teléfono,
  cada registro por separado, lo dudoso se marca y no se pierde), `fn_fert_publicar` para AGL. Réplica de
  pruebas: base `fert_qa` = copia de `qa` + la 91; ahí `auth.uid()` lee `request.jwt.claim.sub`.
- Ojo QA: los avisos de la base (Realtime) tardan ~3-4 s en conectarse al abrir una pantalla; en pruebas,
  esperar antes de cambiar datos «desde fuera».
- Ojo QA: copiar archivos de rutas con `[ticketId]` con `Copy-Item -LiteralPath` (los corchetes son comodín).
