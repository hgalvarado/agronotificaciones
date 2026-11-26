# Alertas y avisos push (sql/154)

Las alertas de Campo llegan al teléfono como **notificación push** (Web Push / VAPID), aunque la app esté cerrada. Sin WhatsApp ni Telegram.

## Cómo funciona
1. Nace una alerta: AGL la publica con `fn_alerta_publicar(jsonb)` (cuadre de combustible, etc.) o la base la crea sola
   (saldo negativo y capacidad llena desde `fert_operaciones.observaciones`; mantenimiento próximo/vencido desde `mot_motores`).
   Es **idempotente por `clave`**: si ya está abierta no se repite; si estaba atendida/resuelta y reaparece, se reabre y se avisa de nuevo.
2. Se arma el **enlace profundo** (`destino` → URL, p. ej. `/motores?pestana=historial&estacion=<id>&tanque=<id>&fecha=2026-11-17&registro=<id>`).
   El catálogo de tipos y destinos es uno solo: `src/lib/alertas/destinos.ts` (la base arma la misma URL en `_alerta_armar_url`).
3. Despacho: `POST /api/push/despachar` (cabecera `x-despacho-secreto`). Reserva las alertas pendientes, calcula destinatarios
   (permiso **Alertas · ver** y su alcance), respeta preferencias y silencios, no repite a la misma persona en 24 h,
   envía, registra cada resultado (`alertas_envios`) y desactiva suscripciones 404/410. Tope: 20 alertas y 200 envíos por llamada.
4. El teléfono muestra el aviso (`public/sw.js`, eventos `push` y `notificationclick`). Al tocarlo abre/enfoca la app **en el registro exacto**:
   selecciona la estación, abre la pestaña, desplaza y resalta el registro, tanque, motor o día. Si ya no existe: «Ese registro ya no existe».
   Sin sesión, el login devuelve a esa URL (`?next=`).

## Qué debe configurar el usuario (una sola vez)
1. **Llaves VAPID**: ya se generaron en `.env.local` (no se suben a git). Para producción usa las mismas, o genera otras con
   `npx web-push generate-vapid-keys`. **Pon en Vercel** (Settings › Environment Variables, Production):
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (pública)
   - `VAPID_PRIVATE_KEY` (secreta)
   - `VAPID_SUBJECT` (un `mailto:` real del administrador; en `.env.local` está como `CAMBIAR…`: cámbialo)
   - `PUSH_DESPACHO_SECRETO` (secreta; cualquier texto largo)
   - `SUPABASE_SERVICE_ROLE_KEY` ya existe (la ruta de despacho la usa **solo en el servidor**).
   Si cambias la llave pública, los teléfonos deben volver a activar los avisos.
2. **Correr `sql/154_alertas_push.sql`** (primero desarrollo, luego producción, **después** de que Vercel publique el código).
3. **Disparo automático (opcional pero recomendado)**: en el SQL Editor, con la extensión `pg_net` activa (Database › Extensions):
   ```sql
   update public.alertas_config
      set despacho_url = 'https://<tu-dominio>/api/push/despachar',
          despacho_secreto = '<el mismo PUSH_DESPACHO_SECRETO>'
    where id;
   ```
   Con eso cada alerta nueva llama a la ruta apenas se guarda. Alternativa sin `pg_net`: un Database Webhook (INSERT en `alertas`,
   POST a esa URL con la cabecera `x-despacho-secreto`) o que AGL llame a la ruta tras publicar. La ruta es segura de llamar varias veces.
4. **Permiso**: Permisos › pantalla **Alertas** › «Ver» por rol, con el alcance que corresponda:
   *Todas las alertas y Control* (administración), *Alertas de sus zonas* (jefe de zona), *Alertas de sus estaciones*.
   No se concede a ningún rol por defecto. Quien tenga «todas las zonas» en su perfil recibe todo.
5. **Cada persona**: Alertas › «Mi teléfono» › «Activar avisos» (y «Enviar aviso de prueba»).

## Android / iPhone
- **Android (Chrome)**: abrir la app, Alertas › Mi teléfono › Activar avisos › Permitir. Funciona en el navegador o instalada.
- **iPhone/iPad (iOS 16.4 o más)**: primero **instalar la app** (Compartir › «Agregar a pantalla de inicio»), abrirla desde ese ícono y activar los avisos allí.
  En el navegador normal de iPhone el push no existe.
- Activar los avisos registra el service worker en todo el sitio: sin señal, abrir otra pantalla lleva a Fertirriego guardado (comportamiento ya existente de `sw.js`).
- En desarrollo (localhost) el service worker no se registra; para probar push local: `NEXT_PUBLIC_PUSH_DEV=1` en `.env.local`.

## Centro de alertas (`/alertas`)
- **Alertas**: las que te tocan por permiso y zona, no leídas resaltadas; filtros (estado, tipo, gravedad, estación, fechas),
  selección múltiple para «Marcar leídas» / «Atender» (nota corta; queda quién y cuándo y AGL la ve atendida), «Ir al registro».
- **Control** (solo alcance «Todas»): a quién llegó cada alerta y si se entregó, teléfonos activos por persona, quién tiene el permiso y **no** tiene teléfono,
  reenviar, silenciar un tipo por un tiempo, y preferencias apagadas.
- **Mi teléfono**: activar/desactivar, aviso de prueba, qué tipos quiero.
- La campana del encabezado suma las alertas sin leer (consulta cada 2 min, con el freno de siempre).

## Contrato con AGL
`public.fn_alerta_publicar(p jsonb) returns {nuevo, id}` con `p = {clave, tipo (cuadre_combustible|mantenimiento_vencido|saldo_negativo|capacidad_llena|otro), gravedad (alta|media|baja), zona, estacion, titulo ≤60, cuerpo ≤140, url, destino {pantalla, pestana, estacion_id|estacion, tanque_id, motor_id, registro_id|documento_id, fecha}, valida_hasta}`
y `fn_alerta_resolver(p_clave text)`. Requiere el permiso de integración (Conexión AGL · publicar) o administrador.

## Límites
- iPhone: app instalada e iOS ≥ 16.4. Si el usuario bloquea los permisos hay que activarlos en los ajustes del navegador.
- El aviso es «mejor esfuerzo» (el sistema operativo puede retrasarlo en ahorro de batería); la lista de `/alertas` es la fuente de verdad.
- Alertas internas: saldo negativo y capacidad (EXCEDE_CAPACIDAD) salen del registro; no se alerta por «saldo ≥ capacidad» aparte. Las estaciones de práctica no avisan.
- El cuadre de combustible lo calcula AGL y lo publica por el contrato.
