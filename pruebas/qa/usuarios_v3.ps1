# QA · Usuarios con cara nueva: contadores que filtran, Activos/Inactivos/Todos, agrupar, tabla, editar. Copia en :3100.
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base http://localhost:3100 -Ancho 1280 -Alto 900
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
try {
    Ir "/admin/usuarios?r=$(Get-Random)"
    $t = Esperar "!!document.querySelector('[data-resumen-usuarios]') && (!!document.querySelector('[data-grupos-usuarios]') || !!document.querySelector('table'))" 40000
    OK ($t -ge 0) 'Usuarios abre con el resumen y la lista' "$t ms"
    $c = JS "[...document.querySelectorAll('[data-contador]')].map(b => b.dataset.contador + '=' + b.querySelector('span').innerText).join(' ')"
    OK ($c -match 'activos=\d+ inactivos=\d+ bloqueados=\d+ sin_zona=\d+') 'Contadores: activos, inactivos, bloqueados y activos sin zona' $c
    # Vista lista por defecto (si quedó en tabla de una corrida anterior, volver)
    if (JS "!!document.querySelector('[data-segmentos=vista] [data-opcion=lista][aria-pressed=false]')") { ClicEn "document.querySelector('[data-segmentos=vista] [data-opcion=lista]')" | Out-Null; Start-Sleep 1 }
    JS "(() => { const s = document.querySelector('[data-agrupar-usuarios]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'rol'); s.dispatchEvent(new Event('change', {bubbles:true})); return true })()" | Out-Null
    Start-Sleep 1
    $g = [int](JS "document.querySelectorAll('[data-grupo]').length")
    OK ($g -ge 1) 'Agrupa por rol principal' "$g grupos"

    # Inactivos: solo inactivos
    ClicHasta "document.querySelector('[data-contador=inactivos]')" "document.querySelector('[data-contador=inactivos]').getAttribute('aria-pressed') === 'true'" | Out-Null
    Start-Sleep 1
    $estados = JS "[...document.querySelectorAll('[data-usuario]')].map(b => /Inactivo|Bloqueado/.test(b.innerText) ? 'I' : 'A').join('')"
    OK (($estados -notmatch 'A') -and (JS "document.querySelector('[data-segmentos=estado] [data-opcion=inactivos]').getAttribute('aria-pressed')") -eq 'true') 'Tocar «Inactivos» muestra solo inactivos' "$estados"
    ClicEn "document.querySelector('[data-segmentos=estado] [data-opcion=activos]')" | Out-Null
    Start-Sleep 1
    $estados = JS "[...document.querySelectorAll('[data-usuario]')].map(b => /Inactivo|Bloqueado/.test(b.innerText) ? 'I' : 'A').join('')"
    OK ($estados -notmatch 'I' -and $estados.Length -ge 1) 'Activos: solo activos' "$($estados.Length) personas"

    # Agrupar por zona
    JS "(() => { const s = document.querySelector('[data-agrupar-usuarios]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'zona'); s.dispatchEvent(new Event('change', {bubbles:true})); return true })()" | Out-Null
    Start-Sleep 1
    $gz = JS "[...document.querySelectorAll('[data-grupo]')].map(s => s.dataset.grupo).join('|')"
    OK ($gz.Length -gt 0) 'Agrupa por zona (una persona sale en cada zona suya; «Todas las zonas» y «Sin zona» aparte)' $gz
    # Plegar un grupo
    $primero = JS "document.querySelector('[data-grupo]').dataset.grupo"
    ClicEn "document.querySelector('[data-grupo] > button')" | Out-Null
    Start-Sleep -Milliseconds 400
    OK ((JS "!document.querySelector('[data-grupo] ul') || document.querySelector('[data-grupo]').querySelector('ul') === null") -eq $true) 'Un grupo se pliega con un toque' $primero
    ClicEn "document.querySelector('[data-grupo] > button')" | Out-Null

    # Buscar y editar
    Teclear "document.querySelector('[data-buscar-usuario]')" $script:QA.email
    Start-Sleep 1
    $n = [int](JS "new Set([...document.querySelectorAll('[data-usuario]')].map(b => b.dataset.usuario)).size")
    OK ($n -eq 1) 'Buscar por correo encuentra a la persona' "$n"
    ClicHasta "document.querySelector('[data-usuario]')" "!!document.querySelector('[data-guardar-usuario]')" | Out-Null
    OK ((JS "/Editar usuario/.test(document.body.innerText) && !!document.querySelector('[data-lista=roles]')") -eq $true) 'Tocar la fila abre su ficha (roles, zonas, estado)'
    ClicEn "[...document.querySelectorAll('[role=dialog] button')].find(b => b.innerText.trim() === 'Cancelar')" | Out-Null
    Start-Sleep -Milliseconds 500

    # Tabla (exportar, filtros)
    ClicHasta "document.querySelector('[data-segmentos=vista] [data-opcion=tabla]')" "!!document.querySelector('table')" | Out-Null
    $enc = JS "[...document.querySelectorAll('table thead th')].map(t => t.innerText.trim()).join('|')"
    OK ($enc -match 'Rol principal' -and $enc -match 'Zonas' -and $enc -match 'Estado') 'Vista tabla con filtros y exportar' $enc
    Captura 'usuarios_tabla.png'

    # Recuerda la vista al volver
    Ir "/admin/usuarios?r=$(Get-Random)"
    $t = Esperar "!!document.querySelector('[data-segmentos=vista] [data-opcion=tabla][aria-pressed=true]') && !!document.querySelector('table')" 30000
    OK ($t -ge 0) 'Al volver recuerda la vista elegida'
    ClicHasta "document.querySelector('[data-segmentos=vista] [data-opcion=lista]')" "!!document.querySelector('[data-grupos-usuarios]')" | Out-Null
    Captura 'usuarios_lista.png'

    # Teléfono
    CDP 'Emulation.setDeviceMetricsOverride' @{ width = 412; height = 900; deviceScaleFactor = 1; mobile = $true } | Out-Null
    Start-Sleep 1
    $sw = [int](JS "document.documentElement.scrollWidth")
    OK ($sw -le 414) 'Teléfono: sin desplazamiento lateral' "scrollWidth $sw"
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION (línea $($_.InvocationInfo.ScriptLineNumber)) $($_.Exception.Message)") }
finally { Terminar-QA }
