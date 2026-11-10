<#
  Copia la base de PRODUCCIÓN a la de DESARROLLO (Supabase).

  - Producción SOLO se lee (pg_dump). Nunca se escribe en ella.
  - Antes de copiar deja un respaldo completo en .\respaldos\ (no sube a git).
  - Desarrollo se SOBRESCRIBE: borra public e interno y los vuelve a crear.

  Uso (en una ventana de PowerShell propia, no en el chat):
    $env:BD_PROD = 'postgresql://postgres.<ref_prod>:<clave>@aws-0-<region>.pooler.supabase.com:5432/postgres'
    $env:BD_DESA = 'postgresql://postgres.<ref_desa>:<clave>@aws-0-<region>.pooler.supabase.com:5432/postgres'
    .\scripts\clonar-bd-desarrollo.ps1
#>
$ErrorActionPreference = 'Stop'

# --- Herramientas ---------------------------------------------------------
$bin = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin' -Directory -ErrorAction SilentlyContinue |
  Sort-Object { [int]($_.Parent.Name) } -Descending | Select-Object -First 1
if ($bin) { $env:Path = "$($bin.FullName);$env:Path" }
foreach ($h in 'pg_dump', 'psql') {
  if (-not (Get-Command $h -ErrorAction SilentlyContinue)) { throw "No se encontró $h. Instala PostgreSQL 17 (herramientas de línea de comandos)." }
}

# --- Validaciones de seguridad -------------------------------------------
$prod = $env:BD_PROD; $desa = $env:BD_DESA
if (-not $prod -or -not $desa) { throw 'Faltan las variables BD_PROD y/o BD_DESA.' }
function Ref($url) { if ($url -match 'postgres\.([a-z0-9]+)[:@]') { $Matches[1] } elseif ($url -match 'db\.([a-z0-9]+)\.supabase\.co') { $Matches[1] } else { $url } }
$refProd = Ref $prod; $refDesa = Ref $desa
if ($refProd -eq $refDesa) { throw "BD_PROD y BD_DESA apuntan al MISMO proyecto ($refProd). Abortado." }

Write-Host ''
Write-Host "  LEER de PRODUCCIÓN : $refProd" -ForegroundColor Green
Write-Host "  SOBRESCRIBIR DESA  : $refDesa" -ForegroundColor Yellow
Write-Host ''
$ok = Read-Host "Escribe el ref de DESARROLLO ($refDesa) para confirmar"
if ($ok -ne $refDesa) { throw 'Confirmación incorrecta. Abortado.' }

$sello = Get-Date -Format 'yyyyMMdd_HHmm'
$dir = Join-Path $PSScriptRoot "..\respaldos\$sello"
New-Item -ItemType Directory -Force $dir | Out-Null
$dir = (Resolve-Path $dir).Path

function Ejecutar($exe, [string[]]$argumentos) {
  & $exe @argumentos
  if ($LASTEXITCODE -ne 0) { throw "$exe terminó con código $LASTEXITCODE" }
}

# --- 1. Respaldo de producción (solo lectura) ----------------------------
Write-Host '1/5 Respaldo de producción...' -ForegroundColor Cyan
Ejecutar pg_dump @($prod, '-Fc', '-n', 'public', '-n', 'interno', '--no-owner', '-f', "$dir\prod_completo.dump")
Ejecutar pg_dump @($prod, '--schema-only', '-n', 'public', '-n', 'interno', '--no-owner', '-f', "$dir\esquema.sql")
Ejecutar pg_dump @($prod, '--data-only', '-n', 'public', '-n', 'interno', '-f', "$dir\datos.sql")
Ejecutar pg_dump @($prod, '--data-only', '-t', 'auth.users', '-t', 'auth.identities', '-f', "$dir\auth_datos.sql")

# Extensiones y triggers sobre auth.users que pg_dump -n no incluye.
$extSql = "select string_agg(format('create extension if not exists %I with schema %I;', e.extname, n.nspname), E'\n') from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname not in ('plpgsql');"
$trgSql = "select string_agg(pg_get_triggerdef(t.oid) || ';', E'\n') from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;"
$ext = & psql $prod -At -c $extSql
$trg = & psql $prod -At -c $trgSql
Set-Content -Encoding utf8 "$dir\extensiones.sql" $ext
Set-Content -Encoding utf8 "$dir\triggers_auth.sql" $trg
Write-Host "   Respaldo en $dir" -ForegroundColor Green

# --- 2. Limpiar desarrollo ------------------------------------------------
Write-Host '2/5 Limpiando desarrollo...' -ForegroundColor Cyan
$limpiar = @"
drop schema if exists interno cascade;
drop schema if exists public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
delete from auth.identities;
delete from auth.users;
"@
Ejecutar psql @($desa, '-v', 'ON_ERROR_STOP=1', '-c', $limpiar)

# --- 3. Extensiones -------------------------------------------------------
Write-Host '3/5 Extensiones...' -ForegroundColor Cyan
Ejecutar psql @($desa, '-v', 'ON_ERROR_STOP=0', '-f', "$dir\extensiones.sql")

# --- 4. Esquema -----------------------------------------------------------
Write-Host '4/5 Esquema (tablas, funciones, RLS)...' -ForegroundColor Cyan
# Se quitan: la creación de public (ya existe) y los privilegios por defecto
# del rol interno supabase_admin, que el usuario postgres no puede modificar
# (Supabase ya los trae configurados en un proyecto nuevo).
(Get-Content -Encoding UTF8 "$dir\esquema.sql") |
  Where-Object { $_ -notmatch '^CREATE SCHEMA public;' -and $_ -notmatch '^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ' } |
  Set-Content -Encoding utf8 "$dir\esquema_desa.sql"
Ejecutar psql @($desa, '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', "$dir\esquema_desa.sql")

# --- 5. Datos (usuarios + negocio) y triggers de auth ---------------------
Write-Host '5/5 Datos...' -ForegroundColor Cyan
Ejecutar psql @($desa, '-v', 'ON_ERROR_STOP=1', '--single-transaction',
  '-c', 'SET session_replication_role = replica;',
  '-f', "$dir\auth_datos.sql",
  '-f', "$dir\datos.sql")
if ($trg) { Ejecutar psql @($desa, '-v', 'ON_ERROR_STOP=0', '-f', "$dir\triggers_auth.sql") }

Write-Host ''
Write-Host "Listo. Desarrollo ($refDesa) es copia de producción al $sello." -ForegroundColor Green
