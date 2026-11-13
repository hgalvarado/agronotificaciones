<#
  Respaldo A ARCHIVOS de las tablas viejas de Trasplante y Riego, ANTES de correr sql/104.

  Para qué: la 104 borra esas tablas de Supabase (ya viven en AGL). Con este respaldo en el PC se puede correr la
  104 con la bandera de respaldo en la base APAGADA (v_respaldar := false) y liberar el espacio de inmediato.

  - SOLO LEE (GET a la API REST de Supabase con la llave de servicio). No escribe nada en la base.
  - Exige decir QUÉ base: -Entorno desarrollo  (usa .env.local)
                          -Entorno produccion  (usa .env.produccion.local)
  - Deja un .json por tabla y un resumen.json (filas por tabla) en respaldos\<fecha>_<entorno>_tablas_viejas\
    (la carpeta respaldos\ está en .gitignore: los datos nunca suben al repositorio).
  - Comprueba que las filas bajadas = las que dice la base; si no, se detiene con error.
  - La llave nunca se muestra en pantalla.

  Uso (desde la carpeta del proyecto, en una ventana de PowerShell propia):
    powershell -ExecutionPolicy Bypass -File scripts\respaldar-tablas-viejas.ps1 -Entorno desarrollo
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('desarrollo', 'produccion')]
  [string]$Entorno
)
$ErrorActionPreference = 'Stop'

$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$archivoEnv = if ($Entorno -eq 'produccion') { '.env.produccion.local' } else { '.env.local' }
$rutaEnv = Join-Path $raiz $archivoEnv
if (-not (Test-Path -LiteralPath $rutaEnv)) { throw "No existe $archivoEnv en $raiz. No se hizo nada." }

# --- Leer URL y llave de servicio del archivo de entorno ----------------------
$vars = @{}
foreach ($linea in Get-Content -LiteralPath $rutaEnv -Encoding utf8) {
  if ($linea -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') {
    $vars[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
  }
}
$url = $vars['NEXT_PUBLIC_SUPABASE_URL']
$llave = $vars['SUPABASE_SERVICE_ROLE_KEY']
if (-not $url -or -not $llave) { throw "$archivoEnv no tiene NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. No se hizo nada." }
$url = $url.TrimEnd('/')
$ref = if ($url -match 'https://([a-z0-9]+)\.supabase\.co') { $Matches[1] } else { $url }

Write-Host ''
Write-Host "  Respaldo (solo lectura) de: $Entorno ($ref)" -ForegroundColor Cyan
Write-Host ''

$tablas = @('siembras', 'siembra_productos', 'siembras_terminadas', 'planes_siembra', 'recepcion_plantulas',
            'turnos_riego', 'turnos_riego_detalle', 'planes_nutricionales')
$encabezados = @{ apikey = $llave; Authorization = "Bearer $llave"; Accept = 'application/json' }

$sello = Get-Date -Format 'yyyyMMdd_HHmm'
$dir = Join-Path $raiz "respaldos\${sello}_${Entorno}_tablas_viejas"
New-Item -ItemType Directory -Force $dir | Out-Null

function Contar([string]$tabla) {
  # Windows PowerShell 5.1 no deja poner el encabezado Range: se pide 1 fila con limit y el total viene igual
  $h = $encabezados.Clone(); $h['Prefer'] = 'count=exact'
  $r = Invoke-WebRequest -UseBasicParsing -Method Get -Headers $h -Uri "$url/rest/v1/${tabla}?select=*&limit=1"
  $cr = $r.Headers['Content-Range']
  if ($cr -match '/(\d+)$') { return [int64]$Matches[1] }
  throw "No se pudo contar $tabla (Content-Range: $cr)."
}

$resumen = [ordered]@{ entorno = $Entorno; proyecto = $ref; fecha = (Get-Date).ToString('s'); tablas = [ordered]@{} }
$pagina = 1000
foreach ($t in $tablas) {
  try {
    $total = Contar $t
  } catch {
    $codigo = $null
    if ($_.Exception.Response) { $codigo = [int]$_.Exception.Response.StatusCode }
    if ($codigo -eq 404) {
      Write-Host "  $t : no existe (ya se retiró): se omite" -ForegroundColor DarkGray
      $resumen.tablas[$t] = 'no existe'
      continue
    }
    throw
  }

  # Ordenado por id para que las páginas no se pisen (todas estas tablas tienen id)
  $filas = New-Object System.Collections.Generic.List[object]
  for ($desde = 0; $desde -lt $total; $desde += $pagina) {
    $lote = Invoke-RestMethod -Method Get -Headers $encabezados `
      -Uri "$url/rest/v1/${t}?select=*&order=id.asc&limit=$pagina&offset=$desde"
    foreach ($f in @($lote)) { $filas.Add($f) }
  }
  if ($filas.Count -ne $total) {
    throw "$t : se bajaron $($filas.Count) filas y la base dice $total. Respaldo INCOMPLETO: no corras la 104 sin respaldo."
  }
  $json = ConvertTo-Json -InputObject @($filas.ToArray()) -Depth 20
  [IO.File]::WriteAllText((Join-Path $dir "$t.json"), $json, (New-Object Text.UTF8Encoding($false)))
  $resumen.tablas[$t] = $total
  Write-Host ("  {0,-22} {1,6} filas" -f $t, $total) -ForegroundColor Green
}

[IO.File]::WriteAllText((Join-Path $dir 'resumen.json'), (ConvertTo-Json $resumen -Depth 5), (New-Object Text.UTF8Encoding($false)))
Write-Host ''
Write-Host "  Listo. Archivos en: $dir" -ForegroundColor Cyan
Write-Host '  Ya puedes correr sql/104 (con v_respaldar := false si quieres liberar el espacio de inmediato).'
