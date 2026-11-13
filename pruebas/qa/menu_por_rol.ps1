# QA · Menú por rol (sql/103): diseñar el menú de un rol con clics, verlo como esa persona (escritorio y teléfono),
# inicio, el menú no da acceso, copiar, descartar y restablecer.
# Corre contra la copia en :3100 y la base de DESARROLLO (con la 103 corrida). Crea un rol de prueba y lo borra;
# guarda los roles del usuario QA y los devuelve al final.
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base http://localhost:3100

function Lista($ruta, $metodo = 'Get', $cuerpo = $null) { $r = Rest $ruta $metodo $cuerpo -Servicio; $o = New-Object System.Collections.ArrayList; foreach ($x in $r) { if ($null -ne $x) { [void]$o.Add($x) } }; return ,$o }
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.click(); return true })()" }
# Abre un SelectorBuscable (botón dentro de $contenedor) y elige la opción cuyo título empieza con $texto
function ElegirBuscable($contenedor, $texto) {
    $abierto = -1
    for ($i = 0; $i -lt 10 -and $abierto -lt 0; $i++) { ClicEn "document.querySelector('$contenedor button')" | Out-Null; $abierto = Esperar "!!document.querySelector('[role=dialog] input')" 1500 }
    if ($abierto -lt 0) { return $false }
    Teclear "document.querySelector('[role=dialog] input')" $texto
    Start-Sleep -Milliseconds 300
    return (ClicEn "[...document.querySelectorAll('[role=dialog] button')].find(b => (b.querySelector('span span')?.textContent || '').trim().startsWith('$texto'))")
}
# Elige una opción de un Selector con buscador (panel) dentro de $contenedor
function ElegirSelector($contenedor, $texto) {
    ClicEn "document.querySelector('$contenedor button')" | Out-Null
    if ((Esperar "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '$texto' && b.closest('$contenedor') === null)" 3000) -lt 0) { return $false }
    return (ClicEn "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '$texto' && b.closest('$contenedor') === null)")
}

$s = Get-Random -Maximum 99999
$qaId = $script:QA.id
$orig = (Lista "perfiles?select=rol_id&id=eq.$qaId")[0]
$origRoles = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } })
$idAdmin = (Lista 'roles?select=id&acceso_total=eq.true&solo_lectura=eq.false&limit=1')[0].id
$rolesCreados = New-Object System.Collections.ArrayList
$nombreRol = "QA Menu $s"
$grupo = "Campo QA $s"

try {
    # Rol de prueba: Fertirriego y Tickets (NO Costos)
    $rMenu = (Rest 'roles' 'Post' @{ codigo = "QA_MENU_$s"; nombre = $nombreRol } -Servicio)[0].id; [void]$rolesCreados.Add($rMenu)
    foreach ($p in 'fertirriego', 'tickets') { Rest 'permisos' 'Post' @{ rol_id = $rMenu; recurso = $p; accion = 'ver' } -Servicio | Out-Null }

    # ===================== Como ADMINISTRADOR: diseñar =====================
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($orig.rol_id, $idAdmin); p_principal = $orig.rol_id } -Servicio | Out-Null
    Ir "/admin/menu?r=$s"
    $t = Esperar "!!document.querySelector('[data-disenador-menu]')" 60000
    OK ($t -ge 0) 'Administración › Menú por rol abre' "$t ms"
    OK ((JS "[...document.querySelectorAll('a')].some(a => a.getAttribute('href') === '/admin/menu')")) 'La pestaña «Menú por rol» sale en Administración'

    $ok = $false
    for ($i = 0; $i -lt 3 -and -not $ok; $i++) { ElegirBuscable '[data-rol-menu]' $nombreRol | Out-Null; $ok = (Esperar "document.querySelector('[data-disenador-menu]')?.dataset.rolActual === 'QA_MENU_$s'" 4000) -ge 0 }
    if (-not $ok) { throw 'No se pudo elegir el rol de prueba: se detiene para no tocar otro rol' }
    OK $ok 'Elegir el rol con el selector buscable'
    OK ((JS "document.querySelector('[data-estado-menu]')?.dataset.estadoMenu") -eq 'siempre') 'Rol nuevo: usa el menú de siempre'
    $t = Esperar "!!document.querySelector('[data-vista-previa]')" 15000
    $previa = JS "[...document.querySelectorAll('[data-previa-entrada]')].map(e => e.dataset.previaEntrada).join('|')"
    OK ($t -ge 0 -and $previa -match 'Tickets' -and $previa -match 'Fertirriego' -and $previa -notmatch 'Costos') 'Vista previa con los permisos del rol (sin Costos)' $previa

    # Grupo nuevo, mover Fertirriego adentro, nombre propio, inicio y subir el grupo
    Teclear "document.querySelector('[data-nuevo-grupo]')" $grupo
    ClicEn "document.querySelector('[data-agregar-grupo]')" | Out-Null
    $t = Esperar "!!document.querySelector('[data-nodo=grupo][data-grupo-etiqueta=""$grupo""]')" 5000
    OK ($t -ge 0) 'Agregar un grupo'
    ElegirSelector "[data-destino=fertirriego] [data-mover-a]" "En «$grupo»" | Out-Null
    $t = Esperar "!!document.querySelector('[data-nodo=grupo][data-grupo-etiqueta=""$grupo""] [data-destino=fertirriego]')" 5000
    OK ($t -ge 0) 'Mover Fertirriego al grupo («Mover a…»)'
    Teclear "document.querySelector('[data-destino=fertirriego] [data-etiqueta]')" 'Mi estación'
    ClicEn "document.querySelector('[data-destino=fertirriego] [data-inicio]')" | Out-Null
    OK ((Esperar "document.querySelector('[data-destino=fertirriego] [data-inicio]')?.getAttribute('aria-pressed') === 'true'" 3000) -ge 0) 'Marcar Fertirriego como inicio'
    for ($i = 0; $i -lt 30; $i++) {
        $primero = JS "document.querySelector('[data-editor-menu] > li')?.dataset.grupoEtiqueta"
        if ($primero -eq $grupo) { break }
        ClicEn "document.querySelector('[data-nodo=grupo][data-grupo-etiqueta=""$grupo""] [data-subir]')" | Out-Null
        Start-Sleep -Milliseconds 150
    }
    OK ((JS "document.querySelector('[data-editor-menu] > li')?.dataset.grupoEtiqueta") -eq $grupo) 'Subir el grupo hasta arriba con ↑'
    # Teclado: Enter sobre ↓ de Tickets la baja un lugar
    $antes = JS "[...document.querySelectorAll('[data-editor-menu] > li')].findIndex(l => l.dataset.destino === 'tickets')"
    JS "document.querySelector('[data-editor-menu] > li[data-destino=tickets] [data-bajar]').focus()" | Out-Null
    CDP 'Input.dispatchKeyEvent' @{ type = 'keyDown'; key = 'Enter'; code = 'Enter'; windowsVirtualKeyCode = 13 } | Out-Null
    CDP 'Input.dispatchKeyEvent' @{ type = 'keyUp'; key = 'Enter'; code = 'Enter'; windowsVirtualKeyCode = 13 } | Out-Null
    $t = Esperar "[...document.querySelectorAll('[data-editor-menu] > li')].findIndex(l => l.dataset.destino === 'tickets') === $antes + 1" 3000
    OK ($t -ge 0) 'Con el teclado (Enter en ↓) se mueve una fila'
    $previa = JS "[...document.querySelectorAll('[data-previa-entrada]')].map(e => e.dataset.previaEntrada).join('|')"
    OK ($previa.StartsWith($grupo)) 'La vista previa sigue el diseño' $previa
    OK ((JS "document.querySelector('[data-disenador-menu]').dataset.sucio") -eq 'si') 'Avisa «Cambios sin guardar»'

    ClicEn "document.querySelector('[data-guardar]')" | Out-Null
    $t = Esperar "!!document.querySelector('[data-aviso-menu]') && document.querySelector('[data-estado-menu]')?.dataset.estadoMenu === 'disenado'" 15000
    OK ($t -ge 0) 'Guardar' "$t ms"
    $g = @(Rest 'rpc/fn_menus_roles' 'Post' @{}) | Where-Object { $_.rol_id -eq $rMenu }
    $json = $g.nodos | ConvertTo-Json -Depth 6 -Compress
    OK ($g -and $g.inicio -eq 'fertirriego' -and $json -match [regex]::Escape($grupo) -and $json -match 'Mi estaci') 'Quedó guardado en la base (grupo, nombre, inicio)' $json

    # ===================== Como la PERSONA del rol (escritorio) =====================
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rMenu); p_principal = $rMenu } -Servicio | Out-Null
    Ir "/?r=$s"
    $t = Esperar "location.pathname.startsWith('/fertirriego')" 60000
    OK ($t -ge 0) 'Al entrar va directo a su inicio (Fertirriego)' "$t ms · $(JS 'location.pathname')"
    $t = Esperar "document.querySelector('[data-menu-lateral]')?.dataset.menuLateral === 'disenado'" 30000
    $entradas = JS "[...document.querySelectorAll('[data-menu-lateral] [data-menu-entrada]')].map(a => a.dataset.menuEntrada + '=' + a.textContent.trim()).join('|')"
    OK ($t -ge 0 -and $entradas -match "^fertirriego=$grupo\|tickets=Tickets") 'Menú lateral = el diseñado, en su orden' $entradas
    OK ($entradas -notmatch 'costos') 'El menú no da acceso: Costos no aparece'
    Ir "/admin/menu?r=$s"
    $t = Esperar "location.pathname === '/' || location.pathname.startsWith('/fertirriego')" 30000
    OK ($t -ge 0) 'Sin «Diseñar menú» no entra a Administración › Menú por rol' (JS 'location.pathname')

    # ===================== Teléfono =====================
    Pantalla -Ancho 390 -Alto 800 -Movil
    Ir "/tickets?r=$s"
    $t = Esperar "!!document.querySelector('[data-barra-movil] [data-barra-entrada]')" 60000
    $barra = JS "[...document.querySelectorAll('[data-barra-movil] [data-barra-entrada]')].map(a => a.dataset.barraEntrada + '=' + a.textContent.trim()).join('|')"
    OK ($t -ge 0 -and $barra -match "^fertirriego=$grupo: Mi estación\|tickets=Tickets") 'Barra del teléfono = el diseñado (Fertirriego primero)' $barra
    Pantalla -Ancho 1440 -Alto 900

    # ===================== Admin otra vez: copiar, descartar, restablecer =====================
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($orig.rol_id, $idAdmin); p_principal = $orig.rol_id } -Servicio | Out-Null
    Ir "/admin/menu?r=$s"
    Esperar "!!document.querySelector('[data-disenador-menu]')" 60000 | Out-Null
    $ok = $false
    for ($i = 0; $i -lt 3 -and -not $ok; $i++) { ElegirBuscable '[data-rol-menu]' $nombreRol | Out-Null; $ok = (Esperar "document.querySelector('[data-disenador-menu]')?.dataset.rolActual === 'QA_MENU_$s'" 4000) -ge 0 }
    if (-not $ok) { throw 'No se pudo volver a elegir el rol de prueba' }
    $nombreOrig = (Lista "roles?select=nombre&id=eq.$($orig.rol_id)")[0].nombre
    ElegirBuscable '[data-copiar-de]' $nombreOrig | Out-Null
    ClicEn "document.querySelector('[data-copiar]')" | Out-Null
    $t = Esperar "document.querySelector('[data-disenador-menu]')?.dataset.sucio === 'si' && !document.querySelector('[data-nodo=grupo][data-grupo-etiqueta=""$grupo""]')" 5000
    OK ($t -ge 0) "Copiar el menú de «$nombreOrig» (queda en borrador, sin guardar)"
    Clic 'Descartar cambios' | Out-Null
    $t = Esperar "!!document.querySelector('[data-nodo=grupo][data-grupo-etiqueta=""$grupo""]') && document.querySelector('[data-disenador-menu]').dataset.sucio === 'no'" 5000
    OK ($t -ge 0) 'Descartar cambios vuelve a lo guardado'
    JS "window.confirm = () => true" | Out-Null
    ClicEn "document.querySelector('[data-restablecer]')" | Out-Null
    $t = Esperar "document.querySelector('[data-estado-menu]')?.dataset.estadoMenu === 'siempre'" 15000
    $g = @(Rest 'rpc/fn_menus_roles' 'Post' @{}) | Where-Object { $_.rol_id -eq $rMenu }
    OK ($t -ge 0 -and -not $g) 'Restablecer: el rol vuelve al menú de siempre (sin fila en la base)'
    $e = Errores-Pagina
    OK (-not $e) 'Sin errores en la página' $e
}
catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    try { Pantalla -Ancho 1440 -Alto 900 } catch {}
    try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = $origRoles; p_principal = $orig.rol_id } -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA roles QA: $($_.Exception.Message)") }
    foreach ($r in $rolesCreados) {
        # Borrar el rol borra también su menú (on delete cascade)
        try { Rest "permisos?rol_id=eq.$r" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$r" 'Delete' -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA rol ${r}: $($_.Exception.Message)") }
    }
    try {
        $ahoraRoles = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } }) | Sort-Object
        $ahora = (Lista "perfiles?select=rol_id&id=eq.$qaId")[0]
        OK (($ahoraRoles -join ',') -eq (($origRoles | Sort-Object) -join ',') -and $ahora.rol_id -eq $orig.rol_id) 'Usuario QA restaurado como estaba' "roles $($ahoraRoles -join ',')"
        OK (@(Lista "roles?select=id&codigo=like.QA_MENU_*").Count -eq 0) 'Rol de prueba borrado'
    } catch { $script:Resultados.Add("LIMPIEZA verificación: $($_.Exception.Message)") }
    Terminar-QA
}
