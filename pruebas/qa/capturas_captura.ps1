# Capturas (celular) del flujo de captura de campo: nuevo horómetro y nueva labor. Crea un ticket de prueba del
# usuario QA con un horómetro, toma capturas y borra todo al final. No es una prueba: es para revisar el diseño.
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base $Base -Ancho 390 -Alto 844 -Movil
$ticket = $null
try {
    $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
    $tk = Rest 'tickets' 'Post' @{ usuario_id = $script:QA.id; fecha = $ayer; codigo = "QA-CAPTURA-$(Get-Random)"; estado = 'ABIERTO'; proceso = 'REGISTRADO' } -Servicio
    $ticket = $tk[0].id
    $eq = (Rest 'equipos?select=id&limit=1' -Servicio)[0].id
    $h = Rest 'horometros' 'Post' @{ ticket_id = $ticket; fecha = $ayer; turno = 'DIURNO'; equipo_id = $eq; horometro_inicial = 100; horometro_final = 108; horas_hombre = 8; usuario_id = $script:QA.id } -Servicio
    $hid = $h[0].id
    foreach ($par in @(@("/tickets/$ticket/horometros/nuevo", 'form_horometro_nuevo'), @("/tickets/$ticket/horometros/$hid", 'horometro_detalle'), @("/tickets/$ticket/horometros/$hid/registros/nuevo", 'form_labor_nueva'))) {
        Ir $par[0]; Start-Sleep -Seconds 6; Captura "$($par[1]).png"
        $alto = JS 'document.documentElement.scrollHeight'
        $script:Resultados.Add("$($par[1]): alto total $alto px; ancho $(JS 'document.documentElement.scrollWidth') px; errores: $(Errores-Pagina)")
        # Captura de la parte de abajo también (formularios largos)
        JS 'window.scrollTo(0, document.documentElement.scrollHeight); true' | Out-Null; Start-Sleep -Milliseconds 600; Captura "$($par[1])_abajo.png"
    }
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    if ($ticket) { Rest "tickets?id=eq.$ticket" 'Delete' -Servicio | Out-Null; $script:Resultados.Add('(ticket de prueba borrado)') }
    Terminar-QA
}
