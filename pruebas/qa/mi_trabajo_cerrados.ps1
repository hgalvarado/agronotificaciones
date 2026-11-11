# QA: «Mi trabajo» cuenta como pendiente sólo lo que el capturador NO ha cerrado (un ticket cerrado en
# «0 · Registrando» ya es trabajo de Torre de Control). Crea tickets del usuario QA y los borra al final.
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base $Base -Ancho 390 -Alto 844 -Movil
$creados = @()
function Ticket($dias, $estado) {
    $f = (Get-Date).AddDays(-$dias).ToString('yyyy-MM-dd')
    $id = (Rest 'tickets' 'Post' @{ usuario_id = $script:QA.id; fecha = $f; codigo = "QA-MT-$dias-$(Get-Random)"; estado = $estado; proceso = 'REGISTRADO' } -Servicio)[0].id
    $script:creados += $id; return $id
}
try {
    foreach ($t in (Rest "tickets?select=id&usuario_id=eq.$($script:QA.id)" -Servicio)) { if ($t.id) { Rest "tickets?id=eq.$($t.id)" 'Delete' -Servicio | Out-Null } }
    $ayerCerrado = Ticket 1 'CERRADO'
    $abiertoViejo = Ticket 3 'ABIERTO'
    $cerradoViejo = Ticket 4 'CERRADO'

    Ir '/tickets'
    $t0 = Esperar "!!document.querySelector('[data-mi-trabajo]')" 20000
    $t1 = Esperar "!!document.querySelector('[data-jornada-cerrada]')" 10000
    OK ($t1 -ge 0) 'Jornada de ayer cerrada: dice «Ya cerraste esta jornada»' (JS "document.querySelector('[data-jornada-cerrada]')?.innerText")
    OK (-not (JS "!!document.querySelector('[data-continuar-hoy], [data-iniciar-hoy]')")) 'No pide continuar ni registrar esa jornada'
    $ids = JS "[...document.querySelectorAll('[data-mi-trabajo] ul a')].map(a => a.getAttribute('href').split('/')[2]).join(',')"
    OK ($ids -eq $abiertoViejo) 'Sin cerrar: solo el ticket abierto (no los cerrados)' "lista=$ids"
    OK ((JS "document.querySelector('[data-mi-trabajo]').innerText") -match 'SIN CERRAR · 1') 'El título dice «Sin cerrar · 1»'
    Captura 'mi_trabajo_cerrados.png'

    # Si el capturador cierra el abierto, desaparece de la lista (se actualiza sola)
    Start-Sleep -Seconds 4   # la pantalla termina de conectarse a los avisos de la base
    Rest "tickets?id=eq.$abiertoViejo" 'Patch' @{ estado = 'CERRADO' } -Servicio | Out-Null
    $t2 = Esperar "!document.querySelector('[data-mi-trabajo] ul')" 15000
    OK ($t2 -ge 0) 'Al cerrarlo, sale de «Sin cerrar» solo' "$t2 ms"
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    foreach ($c in $creados) { Rest "tickets?id=eq.$c" 'Delete' -Servicio | Out-Null }
    $script:Resultados.Add('(tickets de prueba borrados)')
    Terminar-QA
}
