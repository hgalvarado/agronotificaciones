# Piloto de Fertirriego · lista para arrancar

> Para: quien prepara el piloto (Torre de Control). Todo en **desarrollo** hasta que el piloto salga bien.
> Orden sugerido; cada paso dice dónde se hace.

## 1. Base y permisos (AgroNotificaciones de desarrollo)

- [ ] Correr `sql/97_roles_que_administra.sql` en el SQL Editor de **desarrollo** (qué roles administra cada jefe).
- [ ] **Permisos** › rol **Estacionero**: Fertirriego · Estaciones › Operar, alcance «Sus estaciones».
- [ ] **Permisos** › rol **Jefe de zona**: Fertirriego (Supervisar o Todo, «Sus zonas»); Usuarios con «Sus zonas»;
      **«Usuarios que administra este rol»** = Estacionero (así no toca a los Digitadores de campo).
- [ ] Revisar que **Torre de Control** tenga los permisos de Fertirriego que deba tener (hoy están todos en «No»).

## 2. Personas (Usuarios)

- [ ] Elegir **1 o 2 estaciones** y sus estacioneros (de cada turno de trabajo) y su jefe de zona.
- [ ] Crear o revisar a cada estacionero: rol Estacionero, su zona y **su estación** (manual del administrador §5).
- [ ] En cada ficha, «Qué puede hacer» debe decir Recibir, Aplicar, Contar, Relevo, Trasladar › «Sus estaciones».

## 3. AGL

- [ ] /SE03: conexión a **desarrollo** guardada y **Probar conexión** = Conectado.
- [ ] /FR01 › **Sincronizar**: revisar «Para revisar antes de publicar» de esas estaciones y **Sincronizar todo**.

## 4. Teléfonos (con cada estacionero)

- [ ] Instalar la app y **abrirla una vez con señal** (manual del estacionero §2).
- [ ] El jefe le **asigna la estación** (custodia) y el estacionero hace el **Conteo inicial**.
- [ ] Práctica guiada: Recibir (los productos del plan ya vienen), Aplicar desde «Plan de hoy», Horas de riego,
      Entregar / Recibir estación con el código, y un registro **en modo avión**.

## 5. Durante el piloto (cada día)

- [ ] /FR01 › **Sincronizar todo** en la mañana y en la tarde.
- [ ] Revisar **Relevos a revisar**, saldos negativos y el **Comparativo** contra el plan.
- [ ] Anotar dudas y fallas de la gente de campo para ajustarlas antes de producción.

## 6. Al terminar el piloto

- [ ] Decidir si pasa a producción («pasa a producción»): código, luego `sql/91` a `sql/97` en producción (con la
      prueba de equivalencia antes), usuario técnico de producción y /SE03 a la base de producción (AGL borra solo lo
      de prueba).
