# Manual del administrador · Usuarios, roles y permisos

> Para: Administrador y Torre de Control (y jefes de zona con delegación, sección 6).
> Pantallas: **Usuarios** y **Permisos**.
> Versión: noviembre 2026 (Permisos v2: varios roles por persona, permisos por módulo, delegación, historial).

---

## 1. Las ideas clave (en 1 minuto)

- **Rol** = un paquete de permisos (ej. «Estacionero», «Jefe de zona fertirriego», «Capturador»).
- **Una persona puede tener varios roles.** Se suman: tiene todo lo que le dé cualquiera de ellos y, en el alcance,
  **gana el más amplio**. Uno de sus roles es el **principal** (el que se muestra en listas).
- **Permiso** = en una **pantalla**, qué **acciones** puede hacer (ver, registrar, aprobar…) y con qué **alcance**:
  - **Solo lo suyo** (en Fertirriego: **Sus estaciones**)
  - **Sus zonas** (en Fertirriego: **Estaciones de sus zonas**)
  - **Todo** (en Fertirriego: **Todas las estaciones**)
- **Zonas de la persona:** se marcan en su ficha. **«Todas las zonas»** es un interruptor explícito: sin zonas
  marcadas y sin el interruptor, **no ve datos de ninguna zona**.
- Nada está «escrito en el código»: todo se decide en estas pantallas y la base de datos lo hace cumplir.

---

## 2. Pantalla «Permisos»: permisos por módulo

1. Menú **Permisos** › elige el **rol** a la izquierda (con búsqueda).
2. Las pantallas aparecen **agrupadas por módulo** (Maquinaria, Fertirriego, Administración…).
3. En cada pantalla elige un **nivel rápido**:

| Nivel | Qué enciende |
|---|---|
| **Sin acceso** | No ve la pantalla. |
| **Ver** | Consulta y exporta. |
| **Operar** | Además registra y corrige su trabajo. |
| **Supervisar** | Además aprueba, anula, elimina o registra por otros. |
| **Todo** | Además administra y configura. |

4. Elige el **alcance** (Solo lo suyo / Sus zonas / Todo).
5. ¿Necesitas algo a la medida (por ejemplo «puede anular pero no autorizar traslados»)? Abre la tarjeta y marca las
   **acciones** una por una. La tarjeta dirá **«A la medida»**.

Otras opciones del rol:

- **+ Rol nuevo**, **Copiar** (para crear uno parecido), **Eliminar** (los roles del sistema no se eliminan).
- **«Lo pueden asignar los jefes de zona»** (rol *delegable*, ver sección 6).
- **Historial de cambios** del rol: quién cambió qué y cuándo.

### Acciones de Fertirriego (pantalla «Fertirriego · Estaciones»)

| Acción | Nivel | Qué permite |
|---|---|---|
| Ver | Ver | Ver estaciones, bodega, bitácora, turnos. |
| Recibir | Operar | Registrar el producto que llega. |
| Aplicar | Operar | Registrar lo que se prepara para cada turno y las horas de riego. |
| Contar | Operar | Conteo físico (saldo inicial y ajustes). |
| Relevo | Operar | Entregar y recibir la estación (cambio de jornada). |
| Trasladar | Operar | Mandar producto a otra estación y recibir/rechazar lo que llega. |
| Autorizar traslado | Supervisar | Aprobar traslados (nunca los propios). |
| Anular | Supervisar | Anular registros de otros o de días anteriores (con motivo). |
| Registrar por otro | Supervisar | Registrar a nombre de un estacionero sin teléfono. |
| Gestionar choferes | Supervisar | Corregir y validar choferes y vehículos. |
| Administrar estaciones | Todo | Asignar personas y la custodia de las estaciones. |
| Configurar | Todo | Opciones administrativas del módulo. |

La pantalla **«Fertirriego · Conexión AGL»** (Ver + Publicar) es **solo para el usuario técnico de AGL**, no para personas.

---

## 3. Pantalla «Usuarios»: la ficha de una persona

Menú **Usuarios** › nueva persona o abre una existente:

1. **Datos**: nombre, correo, departamento, WhatsApp.
2. **Roles**: marca uno o varios; toca **«Hacer principal»** en el que la represente.
3. **Zonas**: marca sus zonas o enciende **«Todas las zonas»** (gerentes, Torre de Control). La ayuda debajo te dice
   exactamente qué verá.
4. **Estaciones de riego (Fertirriego)**: marca las estaciones donde trabaja (con búsqueda).
5. **Guardar**.
6. **«Qué puede hacer (lo guardado)»**: muestra sus permisos reales, por módulo, con el alcance y **qué rol se los
   da**. Úsalo para comprobar antes de entregarle el usuario.
7. **Historial de accesos**: quién le cambió roles, zonas, estaciones o permisos, y cuándo.

---

## 4. Configuración recomendada para Fertirriego

| Rol (sugerido) | Fertirriego · Estaciones | Alcance | Otros |
|---|---|---|---|
| **Estacionero** | Operar | Sus estaciones | Asignarle sus estaciones en Usuarios. |
| **Parametrista** | Supervisar (sin Autorizar traslado si no corresponde) | Estaciones de sus zonas | Zonas en Usuarios. |
| **Jefe de zona fertirriego** | Todo (o Supervisar + Administrar estaciones) | Estaciones de sus zonas | Zonas; si administra personas: Usuarios con alcance «Sus zonas». |
| **Gerente de fertirriego** | Todo | Todas las estaciones | «Todas las zonas». |
| **Integración AGL** (usuario técnico) | — | — | Solo «Fertirriego · Conexión AGL»: Ver + Publicar. |

Los nombres son sugerencias: crea los roles que necesites. **Prueba** con «Qué puede hacer» antes de entregar.

---

## 5. Paso a paso: dar de alta un estacionero

1. **Usuarios** › nueva persona › nombre y correo.
2. **Roles:** «Estacionero» (principal).
3. **Zonas:** la zona de su estación.
4. **Estaciones de riego:** su estación (o estaciones).
5. **Guardar** y revisar **«Qué puede hacer»**: debe decir Fertirriego · Estaciones › Recibir, Aplicar, Contar,
   Relevo, Trasladar › «Sus estaciones».
6. Entrégale su usuario y pídele que instale la aplicación y la abra **una vez con señal** (Manual del estacionero,
   sección 2).
7. Si es el primero de la estación, **asígnale la estación** (custodia) desde Fertirriego para que empiece con un
   **Conteo**.

---

## 6. Delegación a jefes de zona

Para no depender del administrador para cada alta:

1. En **Permisos**, marca como **«Lo pueden asignar los jefes de zona»** los roles que un jefe puede dar (por
   ejemplo «Estacionero»). Nunca marques roles con acceso total.
2. Al jefe de zona dale la pantalla **Usuarios** con alcance **«Sus zonas»**.
3. El jefe verá en Usuarios **solo a las personas de sus zonas** y, al editar, solo podrá:
   - asignar **sus** zonas,
   - asignar **estaciones de sus zonas**,
   - dar **roles delegables**.
   La base de datos lo exige aunque alguien intente otra cosa.
4. Todo cambio queda en el **Historial de accesos**.

---

## 7. Menú

Las pantallas nuevas (como Fertirriego) aparecen solas en el menú de quien tenga **Ver** sobre ellas. Si alguien
dice «no me aparece el módulo», revisa en este orden:

1. **Qué puede hacer** en su ficha: ¿tiene «Ver» en esa pantalla?
2. ¿Tiene **zonas** (o «Todas las zonas»)? Sin zonas no ve datos.
3. En Fertirriego: ¿tiene **estaciones asignadas** (si su alcance es «Sus estaciones»)?
4. Que cierre sesión y vuelva a entrar.

---

## 8. Buenas prácticas

- Un usuario por persona. Nunca compartir.
- Al salir alguien de la empresa: **desactivarlo** en Usuarios (su historial se conserva).
- Revisar cada mes el **Historial de accesos** de los roles con más poder.
- Para cambios grandes de permisos: primero en **desarrollo**, probar con «Qué puede hacer», y luego en producción.
