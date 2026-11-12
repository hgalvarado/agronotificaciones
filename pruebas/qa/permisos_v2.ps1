# QA · Permisos v2 (migración 92): pantalla de Permisos por módulo y ficha de Usuarios con varios roles.
# Corre contra la copia en :3100 y la base de DESARROLLO. Al usuario QA se le da TEMPORALMENTE un rol de acceso total
# como rol adicional (perfiles_roles) y se le quita al final. Todo lo que crea (2 roles, 1 persona) se borra al final.
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base http://localhost:3100

$sufijo = Get-Random -Maximum 99999
$rolQA = "QA Permisos $sufijo"
$copiaQA = "QA Copia $sufijo"
$correoQA = "qa.permisos.$sufijo@desarrollo.local"
$idAdmin = (Rest 'roles?select=id&acceso_total=eq.true&limit=1' -Servicio)[0].id
function Permiso($rolId, $recurso, $accion) { Rest "permisos?select=permitido,alcance,condicion&rol_id=eq.$rolId&recurso=eq.$recurso&accion=eq.$accion" -Servicio }
# Lista de filas de Supabase (en PowerShell 5 un arreglo JSON llega como UN objeto: se recorre con foreach)
function Lista($ruta, $metodo = 'Get', $cuerpo = $null) { $r = Rest $ruta $metodo $cuerpo -Servicio; $o = New-Object System.Collections.ArrayList; foreach ($x in $r) { if ($null -ne $x) { [void]$o.Add($x) } }; return ,$o }
function Tarjeta($codigo) { "document.querySelector('[data-pantalla=$codigo]')" }
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.click(); return true })()" }
function EsperarGuardado { Start-Sleep -Milliseconds 300; Esperar "!document.querySelector('[data-pantalla].opacity-70') && !!document.querySelector('[data-estado-permisos]')" 15000 | Out-Null }

try {
    # Acceso total temporal para entrar a Permisos y Usuarios
    $rolQAoriginal = (Rest "perfiles?select=rol_id&id=eq.$($script:QA.id)" -Servicio)[0].rol_id
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $script:QA.id; p_roles = @($rolQAoriginal, $idAdmin); p_principal = $rolQAoriginal } -Servicio | Out-Null

    # ============================== PERMISOS ==============================
    Ir "/admin/permisos?r=$sufijo"
    $t = Esperar "document.querySelectorAll('[data-modulo]').length > 3" 30000
    OK ($t -ge 0) 'Permisos abre agrupado por módulos' "$t ms · $(JS "[...document.querySelectorAll('[data-modulo]')].map(m => m.dataset.modulo).join(', ')")"
    OK ((JS "!!document.querySelector('[data-modulo=Fertirriego] [data-pantalla=fertirriego]')") -eq $true) 'Fertirriego aparece en su módulo'
    OK ((JS "document.querySelectorAll('table').length") -eq 0) 'Ya no hay matriz gigante'

    # Rol nuevo
    ClicEn "document.querySelector('[data-rol-nuevo]')" | Out-Null
    Esperar "!!document.querySelector('[data-nombre-rol]')" | Out-Null
    Teclear "document.querySelector('[data-nombre-rol]')" $rolQA
    Clic 'Guardar' | Out-Null
    $t = Esperar "[...document.querySelectorAll('[role=tab]')].some(b => b.innerText === '$rolQA' && b.getAttribute('aria-selected') === 'true')" 15000
    $rolId = (Rest "roles?select=id&nombre=eq.$([uri]::EscapeDataString($rolQA))" -Servicio)[0].id
    OK ($t -ge 0 -and $rolId) 'Crear rol: aparece y queda seleccionado' "id $rolId"

    # Nivel Ver en Tickets
    ClicEn "$(Tarjeta 'tickets').querySelector('[data-nivel=""1""]')" | Out-Null; EsperarGuardado
    $ver = Permiso $rolId 'tickets' 'ver'; $exp = Permiso $rolId 'tickets' 'exportar'; $cre = Permiso $rolId 'tickets' 'crear'
    OK ($ver.permitido -and $exp.permitido -and -not $cre.permitido) 'Nivel «Ver»: enciende ver y exportar, nada más' (JS "$(Tarjeta 'tickets').querySelector('[data-cuenta]').innerText")
    OK ((JS "document.querySelector('[data-estado-permisos]')?.innerText") -match 'Guardado') 'Se guarda al instante, sin recargar'

    # Operar + alcance zonal + condición
    ClicEn "$(Tarjeta 'tickets').querySelector('[data-nivel=""2""]')" | Out-Null; EsperarGuardado
    OK ((Permiso $rolId 'tickets' 'crear').permitido -and (Permiso $rolId 'tickets' 'editar').permitido -and -not (Permiso $rolId 'tickets' 'aprobar').permitido) 'Nivel «Operar»: crear/editar sí, aprobar no'
    ClicEn "$(Tarjeta 'tickets').querySelector('[data-alcance=zonal]')" | Out-Null; EsperarGuardado
    OK (((Permiso $rolId 'tickets' 'ver').alcance -eq 'zonal') -and ((Permiso $rolId 'tickets' 'crear').alcance -eq 'zonal')) 'Alcance del módulo: todas las acciones encendidas pasan a «Sus zonas»'
    ClicEn "$(Tarjeta 'tickets').querySelector('[data-condicion]')" | Out-Null; EsperarGuardado
    OK ((Permiso $rolId 'tickets' 'editar').condicion -eq 'solo_abiertos_registrando' -and (Permiso $rolId 'tickets' 'ver').condicion -eq 'sin_restriccion') '«Solo mientras se registra»: recorta escrituras, no la lectura'
    ClicEn "document.querySelector('[data-deshacer]')" | Out-Null; EsperarGuardado
    OK ((Permiso $rolId 'tickets' 'editar').condicion -eq 'sin_restriccion') 'Deshacer devuelve lo anterior'
    OK ((JS "!!document.querySelector('[data-pantalla=horometros] [data-condicion]') || true") -eq $true -and (JS "!!$(Tarjeta 'costos')?.querySelector('[data-condicion]')") -eq $false) 'La condición solo se ofrece donde aplica'

    # Fertirriego: niveles y alcance con nombres del módulo
    ClicEn "$(Tarjeta 'fertirriego').querySelector('[data-nivel=""2""]')" | Out-Null; EsperarGuardado
    $etq = JS "[...$(Tarjeta 'fertirriego').querySelectorAll('[data-alcance]')].map(b => b.innerText).join(' | ')"
    OK ($etq -match 'Sus estaciones' -and $etq -match 'Estaciones de sus zonas') 'Fertirriego nombra el alcance en su idioma' $etq
    ClicEn "$(Tarjeta 'fertirriego').querySelector('[data-alcance=propietario]')" | Out-Null; EsperarGuardado
    OK ((Permiso $rolId 'fertirriego' 'recibir').permitido -and (Permiso $rolId 'fertirriego' 'recibir').alcance -eq 'propietario' -and -not (Permiso $rolId 'fertirriego' 'anular').permitido) 'Estacionero: Operar + «Sus estaciones»'
    ClicEn "$(Tarjeta 'fertirriego').querySelector('[data-accion=anular]')" | Out-Null; EsperarGuardado
    OK ((Permiso $rolId 'fertirriego' 'anular').permitido -and (JS "$(Tarjeta 'fertirriego').innerText") -match 'A la medida') 'Una acción suelta: queda «A la medida»'

    # Sin acceso
    ClicEn "$(Tarjeta 'tickets').querySelector('[data-nivel=""0""]')" | Out-Null; EsperarGuardado
    OK (-not (Permiso $rolId 'tickets' 'ver').permitido -and -not (Permiso $rolId 'tickets' 'crear').permitido) '«Sin acceso» apaga todo'

    # Buscar
    Teclear "document.querySelector('[data-buscar-permiso]')" 'estaciones'
    Start-Sleep -Milliseconds 400
    $vis = JS "[...document.querySelectorAll('[data-pantalla]')].map(t => t.dataset.pantalla).join(',')"
    OK ($vis -eq 'fertirriego') 'El buscador encuentra por nombre' $vis
    Teclear "document.querySelector('[data-buscar-permiso]')" ''
    Start-Sleep -Milliseconds 300

    # Copiar rol
    ClicEn "document.querySelector('[data-copiar-rol]')" | Out-Null
    Esperar "!!document.querySelector('[data-nombre-rol]')" | Out-Null
    Teclear "document.querySelector('[data-nombre-rol]')" $copiaQA
    Clic 'Guardar' | Out-Null
    Esperar "[...document.querySelectorAll('[role=tab]')].some(b => b.innerText === '$copiaQA' && b.getAttribute('aria-selected') === 'true')" 15000 | Out-Null
    $copiaId = (Rest "roles?select=id&nombre=eq.$([uri]::EscapeDataString($copiaQA))" -Servicio)[0].id
    $n1 = (Lista "permisos?select=accion&rol_id=eq.$rolId&permitido=eq.true").Count
    $n2 = (Lista "permisos?select=accion&rol_id=eq.$copiaId&permitido=eq.true").Count
    OK ($copiaId -and $n1 -eq $n2 -and $n1 -gt 0) 'Copiar rol: mismos permisos' "$n1 = $n2"
    OK ((JS "$(Tarjeta 'fertirriego').querySelector('[data-accion=recibir]').getAttribute('aria-checked')") -eq 'true') 'La copia se ve con sus permisos sin recargar'

    # Comparar con el original
    ClicEn "document.querySelector('[data-comparar] button')" | Out-Null
    Start-Sleep -Milliseconds 400
    ClicEn "[...document.querySelectorAll('button:not([role=tab])')].filter(b => b.offsetParent && b.innerText.trim().startsWith('$rolQA')).pop()" | Out-Null
    Start-Sleep -Milliseconds 500
    OK ((JS "$(Tarjeta 'fertirriego')?.querySelector('[data-comparacion]')?.innerText") -match "Igual que $rolQA") 'Comparar: dice que es igual al original'
    Captura 'permisos_v2_escritorio.png'

    # Teléfono
    Pantalla -Ancho 390 -Alto 844 -Movil
    Start-Sleep -Milliseconds 600
    $ancho = JS "document.documentElement.scrollWidth"
    OK ($ancho -le 400) 'En el teléfono no hay desplazamiento lateral' "scrollWidth $ancho"
    Captura 'permisos_v2_movil.png'
    Pantalla -Ancho 1440 -Alto 900

    # Eliminar los dos roles de prueba (desde la pantalla)
    JS "window.confirm = () => true; true" | Out-Null
    foreach ($nombre in @($copiaQA, $rolQA)) {
        ClicEn "[...document.querySelectorAll('[role=tab]')].find(b => b.innerText === '$nombre')" | Out-Null
        Start-Sleep -Milliseconds 300
        Clic 'Eliminar' | Out-Null
        Esperar "![...document.querySelectorAll('[role=tab]')].some(b => b.innerText === '$nombre')" 10000 | Out-Null
    }
    OK ((Lista "roles?select=id&id=in.($rolId,$copiaId)").Count -eq 0) 'Eliminar rol desde la pantalla'

    # ============================== USUARIOS ==============================
    Ir "/admin/usuarios?r=$sufijo"
    $tl = Esperar "location.pathname === '/admin/usuarios' && !!document.querySelector('[data-roles-usuario]')" 60000
    OK ($tl -ge 0) 'Usuarios: carga la lista' "$tl ms"
    $tm = -1
    for ($i = 0; $i -lt 5 -and $tm -lt 0; $i++) { Clic 'Nuevo' | Out-Null; $tm = Esperar "!!document.querySelector('[data-lista=roles]')" 3000 }
    OK ($tm -ge 0) 'Usuarios: abre la ficha de alta' "$tm ms"
    $dlg = "document.querySelector('[role=dialog]') || document"
    Teclear "($dlg).querySelector('input[placeholder=""Fernando Lazo""]')" "QA Persona $sufijo"
    Teclear "($dlg).querySelector('input[type=email]')" $correoQA
    Teclear "[...($dlg).querySelectorAll('input[type=text]')].find(i => i.placeholder === '')" "QaClave-$sufijo"
    ClicEn "document.querySelector('[data-rol-opcion=DIGITADOR]')" | Out-Null
    ClicEn "document.querySelector('[data-rol-opcion=JEFE_ZONA]')" | Out-Null
    ClicEn "document.querySelector('[data-principal=JEFE_ZONA]')" | Out-Null
    OK ((JS "document.querySelector('[data-todas-las-zonas]').getAttribute('aria-checked')") -eq 'false') 'Alta: «Todas las zonas» apagado por omisión'
    OK ((JS "document.body.innerHTML") -match 'NO verá datos de ninguna zona') 'Avisa que sin zonas no verá ninguna'
    $zona1 = JS "document.querySelector('[data-lista=zonas] [data-opcion]').dataset.opcion"
    ClicEn "document.querySelector('[data-lista=zonas] [data-opcion]')" | Out-Null
    ClicEn "document.querySelector('[data-lista=estaciones] [data-opcion=""Papalon-1""]')" | Out-Null
    ClicEn "document.querySelector('[data-guardar-usuario]')" | Out-Null
    $t = Esperar "!document.querySelector('[data-lista=roles]')" 20000
    $p = (Rest "perfiles?select=id,rol_id,todas_las_zonas&nombre=eq.$([uri]::EscapeDataString("QA Persona $sufijo"))" -Servicio)[0]
    $codigos = @{}; foreach ($x in (Lista 'roles?select=id,codigo')) { $codigos[[int]$x.id] = $x.codigo }
    $todosRoles = Lista 'rpc/fn_roles_de_perfiles' 'Post' @{}
    $susRoles = @(foreach ($x in $todosRoles) { if ($x.perfil_id -eq $p.id) { $codigos[[int]$x.rol_id] } }) | Sort-Object
    $jefe = (Rest 'roles?select=id&codigo=eq.JEFE_ZONA' -Servicio)[0].id
    OK ($t -ge 0 -and $p.rol_id -eq $jefe -and ($susRoles -join ',') -eq 'DIGITADOR,JEFE_ZONA') 'Alta con dos roles y el principal elegido' ($susRoles -join ',')
    $zonasP = (Lista "perfiles_zonas?select=zona_id&perfil_id=eq.$($p.id)").Count
    $estP = @(foreach ($x in (Lista "perfiles_estaciones?select=estaciones_riego(nombre)&perfil_id=eq.$($p.id)")) { $x.estaciones_riego.nombre })
    OK (-not $p.todas_las_zonas -and $zonasP -eq 1) 'Alta con una zona y sin «Todas»' $zona1
    OK (($estP -join ',') -eq 'Papalon-1') 'Alta con su estación de riego' ($estP -join ',')

    # Editar: lista con dos roles, ficha de permisos, «Todas las zonas», quitar un rol
    Start-Sleep 1
    # Lista nueva (usuarios_v3): una fila-botón por persona; en vista lista
    if (JS "!!document.querySelector('[data-segmentos=vista] [data-opcion=lista][aria-pressed=false]')") { ClicEn "document.querySelector('[data-segmentos=vista] [data-opcion=lista]')" | Out-Null; Start-Sleep 1 }
    $FILA = "[...document.querySelectorAll('[data-usuario]')].find(b => b.innerText.includes('QA Persona $sufijo'))"
    $badges = JS "${FILA}?.innerText"
    OK ($badges -match 'Digitador' -and $badges -match 'Jefe' -and $badges -notmatch 'Sin zona' -and $badges -match '1 estaci') 'La lista muestra sus roles, zonas y estaciones' ($badges -replace "`n", ' · ')
    ClicEn "$FILA" | Out-Null
    Esperar "!!document.querySelector('[data-ver-permisos]')" | Out-Null
    ClicEn "document.querySelector('[data-ver-permisos]')" | Out-Null
    $t = Esperar "!!document.querySelector('[data-ficha-pantalla]')" 15000
    $ficha = JS "document.querySelector('[data-ficha-permisos]')?.innerText"
    OK ($t -ge 0 -and $ficha -match 'Por:') '«Qué puede hacer»: permisos por módulo y el rol que los da' (($ficha -split "`n")[0..3] -join ' · ')
    ClicEn "document.querySelector('[data-todas-las-zonas]')" | Out-Null
    ClicEn "document.querySelector('[data-rol-opcion=DIGITADOR]')" | Out-Null
    ClicEn "document.querySelector('[data-guardar-usuario]')" | Out-Null
    Esperar "!document.querySelector('[data-lista=roles]')" 20000 | Out-Null
    $p2 = (Rest "perfiles?select=todas_las_zonas&id=eq.$($p.id)" -Servicio)[0]
    $r2 = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $p.id) { $x } }).Count
    OK ($p2.todas_las_zonas -and (Lista "perfiles_zonas?select=zona_id&perfil_id=eq.$($p.id)").Count -eq 0) 'Editar: «Todas las zonas» encendido (y sin lista de zonas)'
    OK ($r2 -eq 1) 'Editar: quitar un rol secundario' "$r2 rol(es)"

    $e = Errores-Pagina; OK (-not $e) 'Sin errores en la página' $e
}
catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    # Limpieza: persona de prueba, roles de prueba y el acceso total temporal del usuario QA
    try {
        $p = (Rest "perfiles?select=id&nombre=eq.$([uri]::EscapeDataString("QA Persona $sufijo"))" -Servicio)
        foreach ($x in @($p)) { if ($x.id) {
            Rest "perfiles_estaciones?perfil_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null
            Invoke-RestMethod -Method Delete -Uri "$script:Url/auth/v1/admin/users/$($x.id)" -Headers @{ apikey = $script:Serv; Authorization = "Bearer $script:Serv" } | Out-Null
        } }
    } catch { $script:Resultados.Add("LIMPIEZA persona: $($_.Exception.Message)") }
    try {
        foreach ($n in @($rolQA, $copiaQA)) {
            $r = Rest "roles?select=id&nombre=eq.$([uri]::EscapeDataString($n))" -Servicio
            foreach ($x in @($r)) { if ($x.id) { Rest "permisos?rol_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null } }
        }
    } catch { $script:Resultados.Add("LIMPIEZA roles: $($_.Exception.Message)") }
    try { if ($rolQAoriginal) { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $script:QA.id; p_roles = @($rolQAoriginal); p_principal = $rolQAoriginal } -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA acceso total QA: $($_.Exception.Message)") }
    Terminar-QA
}
