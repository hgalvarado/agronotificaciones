# QA: un cambio hecho por OTRO usuario aparece solo en la pantalla abierta (Supabase Realtime, sql/84)
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base $Base
$id = $null; $original = $null
try {
    Ir '/horometros'
    $t = Esperar "document.querySelectorAll('tbody tr td').length > 3"; OK ($t -ge 0) 'Horómetros abierta' "$t ms"
    $hm = (Rest "horometros?select=id,comentario&order=fecha.desc&limit=1" -Servicio)[0]
    $id = $hm.id; $original = $hm.comentario
    Start-Sleep -Seconds 4   # que el canal de avisos termine de suscribirse
    $marca = "QA-RT-$(Get-Random -Maximum 99999)"
    Rest "horometros?id=eq.$id" 'Patch' @{ comentario = $marca } -Servicio | Out-Null
    # SIN eventos de foco ni recarga: solo el aviso de la base
    $ta = Esperar "document.body.innerText.includes('$marca')" 15000
    OK ($ta -ge 0) 'Cambio de otro usuario aparece solo (tiempo real, sin tocar nada)' "$ta ms"
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    if ($id) { Rest "horometros?id=eq.$id" 'Patch' @{ comentario = $original } -Servicio | Out-Null; $script:Resultados.Add('(comentario original restaurado)') }
    Terminar-QA
}
