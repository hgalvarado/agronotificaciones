# QA: Tickets v2 (celular). Recientes por día sin acordeón, un ticket «Registrando» por día (lleva al existente),
# barra de proceso en el detalle (sin «Enviar a revisión»), botones de un toque si hay «Mover proceso» (sql/86).
# Crea tickets del usuario QA y los borra al final.
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base $Base -Ancho 390 -Alto 844 -Movil
$creados = @()
try {
    foreach ($t in (Rest "tickets?select=id&usuario_id=eq.$($script:QA.id)" -Servicio)) { Rest "tickets?id=eq.$($t.id)" 'Delete' -Servicio | Out-Null }
    $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
    $tk = (Rest 'tickets' 'Post' @{ usuario_id = $script:QA.id; fecha = $ayer; codigo = "QA-V2-$(Get-Random)"; estado = 'ABIERTO'; proceso = 'REGISTRADO' } -Servicio)[0].id
    $creados += $tk
    $hay86 = [bool]((Rest "permisos?select=id&rol_id=eq.2&recurso=eq.tickets&accion=eq.mover_proceso" -Servicio) | Where-Object { $_.id }); $script:Resultados.Add("(ticket QA: $tk · ayer: $ayer · sql/86: $hay86)")

    # 1 · Recientes: el ticket de ayer aparece sin abrir nada
    Ir '/tickets'
    $t0 = Esperar "!!document.querySelector('[data-tickets-recientes] [data-dia=""$ayer""]')" 20000
    OK ($t0 -ge 0) 'Recientes muestra el día de ayer sin abrir acordeones' "$t0 ms"
    $enDia = JS "!!document.querySelector('[data-dia=""$ayer""] a[href=""/tickets/$tk""]')"
    OK $enDia 'El ticket está en su día'
    OK ((JS "document.querySelector('[data-dia=""$ayer""] h3').innerText") -match 'AYER') 'El día se titula «Ayer»' (JS "document.querySelector('[data-dia=""$ayer""] h3').innerText")
    OK ((JS 'document.documentElement.scrollWidth') -le 400) 'Sin desborde horizontal'
    Captura 'tickets_v2_recientes.png'

    # 2 · Meses anteriores, aparte
    JS "document.querySelector('[data-ver-anteriores]').click(); true" | Out-Null
    $ma = Esperar "document.querySelector('[data-ver-anteriores]').getAttribute('aria-expanded') === 'true'" 3000
    OK ($ma -ge 0) '«Meses anteriores» se despliega'

    # 3 · Un ticket por día: «Nuevo» con la fecha de ayer lleva al existente
    $nuevo = "[...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.trim() === 'Nuevo')"
    for ($i = 0; $i -lt 20 -and -not (JS "!!document.querySelector('[data-crear-ticket]')"); $i++) { JS "($nuevo)?.click(); true" | Out-Null; Start-Sleep -Milliseconds 400 }
    $te = Esperar "!!document.querySelector('[data-ticket-existente]')" 8000
    OK ($te -ge 0) 'Avisa que el ticket de ese día ya existe' "$te ms"
    OK ((JS "document.querySelector('[data-crear-ticket]').innerText") -eq 'Ir al ticket de ese día') 'El botón cambia a «Ir al ticket de ese día»'
    Captura 'tickets_v2_ya_existe.png'
    JS "document.querySelector('[data-crear-ticket]').click(); true" | Out-Null
    $tv = Esperar "location.pathname === '/tickets/$tk' && !!document.querySelector('[data-proceso-ticket]')" 15000
    OK ($tv -ge 0) 'Lleva al ticket existente' (JS 'location.pathname')
    $n = @((Rest "tickets?select=id&usuario_id=eq.$($script:QA.id)&fecha=eq.$ayer" -Servicio) | Where-Object { $_.id }).Count
    OK ($n -eq 1) 'No se creó un segundo ticket' "tickets ese día: $n"

    # 4 · Detalle: barra de proceso, sin «Enviar a revisión»
    OK (-not (JS "document.body.innerText.includes('Enviar a revisión')")) 'Ya no existe «Enviar a revisión»'
    OK ((JS "document.querySelector('[data-proceso-ticket] [aria-current=step]')?.innerText") -match 'Registrado') 'La barra marca 0 · Registrado'
    if ($hay86) {
        $b = Esperar "!!document.querySelector('[data-proceso-ticket] [data-destino=REVISANDO]')" 5000
        OK ($b -ge 0) 'Con «Mover proceso»: botón de un toque a 1 · Revisando'
        JS "document.querySelector('[data-proceso-ticket] [data-destino=REVISANDO]').click(); true" | Out-Null
        $tr = Esperar "(document.querySelector('[data-proceso-ticket] [aria-current=step]')?.innerText || '').includes('Revisando')" 10000
        OK ($tr -ge 0 -and (Rest "tickets?select=proceso&id=eq.$tk" -Servicio)[0].proceso -eq 'REVISANDO') 'Un toque y el ticket queda en REVISANDO'
        Captura 'tickets_v2_detalle_revisando.png'
        # Con el de ayer en Revisando ya se puede crear otro del mismo día (por si faltó un equipo)
        $otro = Rest 'tickets' 'Post' @{ usuario_id = $script:QA.id; fecha = $ayer; codigo = "QA-V2-B-$(Get-Random)"; estado = 'ABIERTO'; proceso = 'REGISTRADO' } -Servicio
        $creados += $otro[0].id
        OK ($otro.Count -eq 1) 'Con el primero en Revisando, se permite otro ticket del mismo día'
        try { $x = Rest 'tickets' 'Post' @{ usuario_id = $script:QA.id; fecha = $ayer; codigo = "QA-V2-C-$(Get-Random)"; estado = 'ABIERTO'; proceso = 'REGISTRADO' } -Servicio; $creados += $x[0].id; OK $false 'La base frena un segundo «Registrando» del mismo día' }
        catch { OK $true 'La base frena un segundo «Registrando» del mismo día' }
    } else {
        $script:Resultados.Add('(sql/86 sin correr en desarrollo: se omiten los botones de proceso y el freno de la base)')
        Captura 'tickets_v2_detalle.png'
    }
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    foreach ($c in $creados) { Rest "tickets?id=eq.$c" 'Delete' -Servicio | Out-Null }
    $script:Resultados.Add('(tickets de prueba borrados)')
    Terminar-QA
}
