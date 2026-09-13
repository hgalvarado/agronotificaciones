# Despliegue a producción · GitHub + Vercel

Guía para poner AgroNotificaciones en línea. Se hace una vez; después, cada `git push` publica solo.

---

## 0. Antes de empezar

Necesitas tener a mano dos cosas de Supabase (**Settings → API**):

- La **URL** del proyecto.
- Las **llaves**: `anon public` y `service_role`.

Y una cuenta de GitHub y otra de Vercel (la de Vercel se crea entrando con GitHub, no hace falta
inventar otra contraseña).

---

## 1. Auditoría: qué se revisó y cómo quedó

### `.gitignore`

`.env*` ya tapaba `.env.local`, pero también tapaba la plantilla. Ahora:

```gitignore
# Variables de entorno: NINGUNA sube al repositorio.
.env*
# …salvo la PLANTILLA, que no lleva valores.
!.env*.example
```

Así `.env.local` (con tus llaves reales) **nunca** sube, y `.env.local.example` sí, para que
cualquiera sepa qué hay que configurar.

### `package.json`

Los scripts que Vercel necesita ya estaban bien, y se le añadió la versión de Node:

```json
"engines": { "node": ">=20.9.0" },
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "prebuild": "node -e \"require('fs').rmSync('.next',{recursive:true,force:true})\""
}
```

Next 16 necesita Node 20 o más nuevo; sin `engines`, Vercel elige la versión que le parezca y un día
cambia sola.

### Lo que NO sube

`node_modules`, `.next`, `tsconfig.tsbuildinfo`, `next-env.d.ts` y cualquier `.env`. Comprobado: el
repositorio no tiene ni un archivo con credenciales.

---

## 2. Subir el código a GitHub

Abre **PowerShell** en la carpeta del proyecto:

```powershell
cd C:\HENRYALVARADO2022\PROYECTOS\AgroNotificaciones\agronotificaciones-app
```

### 2.1 Comprobación de seguridad (hazla siempre antes del primer push)

```powershell
git ls-files | Select-String -Pattern "\.env"
```

- **No devuelve nada** → perfecto, sigue.
- **Devuelve `.env.local`** → ya estaba dentro del repositorio. Sácalo antes de subir nada:

```powershell
git rm --cached .env.local
git commit -m "Saca .env.local del repositorio"
```

> Si `.env.local` llegó a subirse a GitHub aunque sea una vez, la llave `service_role` **hay que
> rotarla** en Supabase → Settings → API → Reset. Borrarla del repositorio no la borra del historial.

### 2.2 Conectar y subir

```powershell
git add -A
git commit -m "Version inicial para produccion"

git branch -M main
git remote add origin https://github.com/hgalvarado/agronotificaciones.git
git push -u origin main
```

Si `git remote add` responde `remote origin already exists`, es que ya había uno apuntando a otro
lado. Cámbialo en vez de añadirlo:

```powershell
git remote set-url origin https://github.com/hgalvarado/agronotificaciones.git
git push -u origin main
```

GitHub te pedirá usuario y contraseña: **la contraseña no es la de tu cuenta**, es un *Personal
Access Token*. Si no tienes uno: GitHub → foto de perfil → Settings → Developer settings → Personal
access tokens → Tokens (classic) → Generate new token → marca el permiso `repo` → cópialo y pégalo
como contraseña. (En Windows, Git suele abrir una ventana del navegador y esto se resuelve solo.)

---

## 3. Variables de entorno en Vercel

Son **exactamente estas tres**. El nombre tiene que escribirse igual, mayúsculas incluidas:

| Nombre | De dónde sale | Entornos |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → **Project URL** | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → **anon public** | Production, Preview, Development |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **service_role** (botón *Reveal*) | Production, Preview, Development |

Dos reglas que no se rompen:

- **`SUPABASE_SERVICE_ROLE_KEY` jamás lleva el prefijo `NEXT_PUBLIC_`.** Ese prefijo mete la variable
  dentro del JavaScript que descarga el navegador, y esa llave se salta TODAS las reglas de
  seguridad de la base. Con ella, cualquiera lee y borra lo que quiera.
- Las otras dos sí lo llevan, y eso está bien: la `anon` está pensada para ser pública y quien manda
  es la RLS de Supabase.

---

## 4. Desplegar en Vercel, paso a paso

1. Entra a **vercel.com** y elige *Continue with GitHub*.
2. **Add New… → Project**.
3. En la lista de repositorios busca **agronotificaciones** y pulsa **Import**. La primera vez Vercel
   pide permiso para ver tus repositorios: dáselo (puedes limitarlo sólo a éste).
4. Vercel detecta **Next.js** solo. No toques *Build Command*, *Output Directory* ni *Install
   Command*: los valores por omisión son los correctos.
5. Abre **Environment Variables** y pega las tres de la tabla de arriba, una por una, marcando los
   tres entornos.
6. **Deploy**. Tarda entre dos y cuatro minutos.
7. Cuando termine te da una dirección tipo `agronotificaciones.vercel.app`. Ábrela.

---

## 5. Después del primer despliegue

### 5.1 Autorizar la dirección en Supabase

Sin esto el login no funciona: Supabase rechaza los correos de confirmación y las redirecciones que
vengan de una dirección que no conoce.

Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://agronotificaciones.vercel.app` (o tu dominio propio).
- **Redirect URLs**: añade `https://agronotificaciones.vercel.app/**`.

Si más adelante pones un dominio de Agrolíbano, añádelo aquí también.

### 5.2 Comprobar que todo respondió

- Entra con tu usuario.
- Abre Tickets, Horómetros, Labores, Avances → Emplasticado y Avances → Trasplante.
- Si una pantalla se queja de que falta una migración, corre en el **SQL Editor de Supabase** los
  archivos de `sql/` que falten, **en orden numérico**. El repositorio los lleva todos.

### 5.3 A partir de ahora

Cada vez que haya cambios:

```powershell
git add -A
git commit -m "Describe el cambio"
git push
```

Vercel compila y publica solo. Si el build falla, Vercel deja la versión anterior en línea y te
manda un correo con el error; nadie se queda sin sistema.

---

## 6. Si algo sale mal

| Síntoma | Qué pasa | Arreglo |
|---|---|---|
| El build falla con `Module not found` o falta un binario de SWC | El `package-lock.json` se generó en Windows y le faltan piezas de Linux | En tu máquina: `Remove-Item -Recurse -Force node_modules, package-lock.json; npm install`, y vuelve a subir el lock |
| La app carga pero no deja entrar | Falta la Site URL en Supabase (paso 5.1) | Configúrala y recarga |
| «Invalid API key» o pantallas vacías | Alguna variable está mal escrita o le sobran espacios | Vercel → Settings → Environment Variables, revísalas y **Redeploy** |
| Cambiaste una variable y sigue igual | Vercel sólo las lee al compilar | Deployments → los tres puntos del último → **Redeploy** |
| El repositorio salió público y no querías | — | GitHub → Settings del repositorio → Danger Zone → Change visibility → Private |

---

## 7. Qué NO hay que hacer

- No subas `.env.local` «sólo esta vez para probar».
- No pongas `NEXT_PUBLIC_` delante de `SUPABASE_SERVICE_ROLE_KEY`.
- No pegues llaves en el código ni en `next.config.ts`. Si una llave tiene que estar en el código, es
  que va en una variable de entorno.
