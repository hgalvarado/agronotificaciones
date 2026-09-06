# AgroNotificaciones — App web (Next.js + Supabase)

Plataforma de control operativo de maquinaria agrícola. Ver `../ARQUITECTURA.md` (o el documento que te entregué antes) para el diseño completo de base de datos, RLS y lógica de negocio.

## 1. Requisitos

- Node.js 20+ (este proyecto se generó con Node 22)
- Una cuenta y proyecto en [supabase.com](https://supabase.com)
- Los tres scripts SQL: `01_schema.sql`, `02_rls_policies.sql`, `03_rpc_business_logic.sql`

## 2. Preparar la base de datos en Supabase

1. Entra a tu proyecto de Supabase → **SQL Editor** → **New query**.
2. Pega el contenido completo de `01_schema.sql` → **Run**. Debe terminar sin errores (crea tablas, tipos, triggers).
3. Nueva query → pega `02_rls_policies.sql` → **Run** (activa RLS y crea las políticas).
4. Nueva query → pega `03_rpc_business_logic.sql` → **Run** (crea las funciones de negocio y el dashboard).
5. Verifica en **Table Editor** que aparezcan las tablas (`tickets`, `horometros`, `registros`, `equipos`, etc.) y que en cada una el candado de RLS esté **verde/activado**.

### 2.1 Crear tu primer usuario Administrador

1. Ve a **Authentication → Users → Add user** y créalo con tu correo y una contraseña (marca "Auto Confirm User").
2. Copia el UUID del usuario recién creado.
3. En **SQL Editor**, ejecuta (reemplazando el UUID y tu nombre):

```sql
insert into public.perfiles (id, nombre, rol_id, departamento)
values ('PEGA-AQUI-EL-UUID', 'Henry Alvarado', 1, 'Torre Control'); -- rol_id 1 = ADMIN
```

Sin esta fila, el login funciona pero la app mostrará "Cuenta pendiente de activación" (es la pantalla que armé a propósito para ese caso).

### 2.2 Crear una temporada activa

Para que el dashboard y el formulario de labores tengan lotes que mostrar, necesitas al menos una temporada marcada como activa y algunos lotes:

```sql
insert into public.temporadas (nombre, fecha_inicio, fecha_fin, activa)
values ('Temp. 25-26', '2025-08-01', '2026-07-31', true);
```

Luego, desde la app (Panel admin → Catálogos → pestaña "Lotes") puedes ir agregando lotes, y desde el SQL Editor vincularlos a la temporada:

```sql
insert into public.lotes_temporada (lote_id, temporada_id, area_neta)
select l.id, t.id, 20
from public.lotes l, public.temporadas t
where l.nomenclatura = '1001-010' and t.activa = true;
```

(Esto se puede convertir en otra pantalla de catálogo más adelante — de momento se hace por SQL para no bloquear las pruebas.)

## 3. Obtener las credenciales de la API

En el dashboard de Supabase: **Settings → API**.

- `Project URL` → va en `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` key → va en `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 4. Correr la app en local

```bash
cp .env.local.example .env.local
# edita .env.local y pega tus dos valores de Supabase

npm install
npm run dev
```

Abre http://localhost:3000 — te debe mandar a `/login`. Entra con el correo/contraseña que creaste en el paso 2.1.

Para probarlo desde tu celular en la misma red (recomendado, ya que la app es mobile-first):

```bash
npm run dev -- -H 0.0.0.0
```

y entra desde el celular a `http://<IP-de-tu-compu>:3000`.

## 5. Qué puedes probar ya mismo

1. **Generar ticket** desde la pantalla de Tickets.
2. Dentro del ticket, **Agregar horómetro** (elige un equipo — antes debes cargar equipos y operadores desde Panel admin → Catálogos si la base está vacía).
3. Dentro del horómetro, **Agregar labor** (elige labor, tarea SAP, implemento y lote(s) con avance en mz). Nota: para que aparezcan tareas/implementos debes vincularlos a la labor — de momento eso se hace por SQL insertando en `labores_tareas` / `labores_implementos` (o lo agregamos como pantalla en la siguiente iteración).
4. Botón **⧉ Duplicar** en un horómetro o una labor ya guardada.
5. **Cerrar ticket** — después de cerrado, intenta editar un horómetro: debe fallar (o no mostrar la opción) para tu usuario si no eres Admin/Torre de Control.
6. **Avance (dashboard)** — filtra por categoría de labor y toca una tarjeta de lote para ver el detalle.
7. **Panel admin → Catálogos** — agrega/edita zonas, equipos, operadores, labores, etc. **Panel admin → Permisos por rol** (sólo visible siendo Admin) — activa/desactiva permisos de Torre de Control y Digitador sin tocar código.

## 6. Siguiente paso: publicarla para que el equipo la use

Cuando quieras que quede disponible fuera de tu compu (para que el equipo de campo la use desde su celular):

1. Sube este proyecto a un repositorio de GitHub (puedo ayudarte con eso).
2. Crea una cuenta gratuita en [vercel.com](https://vercel.com) e importa el repositorio.
3. En Vercel, en **Settings → Environment Variables**, agrega las mismas dos variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. Deploy. Vercel te da una URL pública (`https://tu-app.vercel.app`) que ya es 100% usable desde cualquier celular, con HTTPS.

No lo hice en este paso porque primero quieres probarla en local — avísame cuando estés listo y lo dejamos publicado.

## 7. Pendientes conocidos (siguiente iteración)

- Pantallas de catálogo para las relaciones `labores_tareas` y `labores_implementos` (hoy se administran por SQL).
- Pantalla para vincular `lotes` a una `temporada` (hoy por SQL).
- Módulo financiero (tarifas) — el backend ya existe (`tarifas_equipo`, `tarifas_labor`, función `fn_costo_ticket`), falta la pantalla.
- Generar tipos TypeScript reales desde tu esquema con `npx supabase gen types typescript` una vez tengas la CLI de Supabase enlazada al proyecto, para reemplazar los tipos escritos a mano en `src/lib/types.ts`.
