import { createClient } from '@/lib/supabase/server'
import { MenuCatalogos } from '@/components/catalogos/MenuCatalogos'
import type { PestanaCatalogo } from '@/components/catalogos/tipos'
import { Alerta } from '@/components/ui/Primitivos'
import { getPermisos, puede } from '@/lib/auth'

export default async function CatalogosPage() {
  const supabase = await createClient()
  const permisos = await getPermisos()
  // Sólo lectura si puede ver pero no editar ni crear. Antes era «es
  // DIGITADOR», que ignoraba lo que dijera el panel de permisos.
  const soloLectura =
    !puede(permisos, 'catalogos', 'editar') && !puede(permisos, 'catalogos', 'crear')

  const [
    { data: zonas },
    { data: familias },
    { data: equipos },
    { data: implementos },
    { data: operadores },
    { data: categoriasLabor },
    { data: tareasSap },
    { data: temporadas },
    { data: departamentos },
    { data: puestos },
    { data: labores },
    { data: proveedores },
    { data: procesos },
    sondaProveedoresLabor,
    sondaSeguimiento,
    { data: implementosFisicos },
    { data: variedades },
    { data: materiales },
    sondaContador,
    sondaPerfil,
    { data: planesNutricionales },
    { data: turnosCatalogo },
    { data: estacionesRiego },
  ] = await Promise.all([
    supabase.from('zonas').select('*').order('nombre'),
    supabase.from('familias_equipo').select('*').order('nombre'),
    supabase.from('equipos').select('*').order('codigo'),
    supabase.from('implementos').select('*').order('nombre'),
    supabase.from('operadores').select('*').order('nombre'),
    supabase.from('categorias_labor').select('*').order('nombre'),
    supabase.from('tareas_sap').select('*').order('codigo'),
    supabase.from('temporadas').select('*').order('nombre'),
    supabase.from('departamentos').select('*').order('nombre'),
    supabase.from('puestos_trabajo').select('*').order('operacion_sap'),
    supabase.from('labores').select('*').order('nombre'),
    // Los proveedores llegan con la migración 12; si todavía no se ha
    // corrido, la pestaña simplemente sale vacía en vez de tumbar la
    // pantalla completa.
    supabase.from('proveedores').select('*').order('nombre'),
    // Llegan con la migración 13.
    supabase.from('procesos_sap').select('*').order('orden'),
    // Sonda de la migración 15: si las columnas todavía no existen, las
    // dos casillas de proveedor no se ofrecen. Mostrar una columna que
    // la base no tiene sólo consigue que el interruptor falle al tocarlo.
    supabase.from('labores').select('usa_proveedor_plastico').limit(1),
    // Sonda aparte de la migración 21, por la misma razón: si se juntara
    // con la anterior, tener la 15 corrida y la 21 no escondería también
    // las casillas de proveedor.
    supabase.from('labores').select('seguimiento_emplasticado').limit(1),
    // Llega con la migración 19. Si no está corrida la pestaña sale
    // vacía en vez de tumbar la pantalla completa.
    supabase.from('implementos_fisicos').select('*').order('codigo'),
    // Llegan con la migración 26. Si no está corrida, la pestaña sale
    // vacía en vez de tumbar la pantalla completa.
    supabase.from('variedades').select('*').order('nombre'),
    supabase.from('materiales').select('*').order('codigo'),
    // Sonda de la migración 38: enseñar una columna que la base no tiene
    // sólo consigue que la celda falle al tocarla.
    supabase.from('equipos').select('contador_sap').limit(1),
    // Sonda de la migración 47: sin ella la columna de perfil no se
    // ofrece. Enseñar una columna que la base no tiene sólo consigue que
    // la celda falle al tocarla.
    supabase.from('operadores').select('tipo_perfil').limit(1),
    // Llegan con la migración 40. Si no está corrida, la pestaña sale
    // vacía en vez de tumbar la pantalla completa.
    supabase.from('planes_nutricionales').select('*').order('nombre'),
    // Llegan con la migración 41.
    supabase.from('turnos').select('*').order('codigo'),
    supabase.from('estaciones_riego').select('*').order('nombre'),
  ])

  const soportaContador = !sondaContador.error
  const soportaPerfil = !sondaPerfil.error
  const soportaProveedoresLabor = !sondaProveedoresLabor.error
  const soportaSeguimiento = !sondaSeguimiento.error

  // Las zonas alimentan el selector del catálogo de turnos: cada turno
  // riega normalmente en una, y es la que la captura propone.
  const opcionesZona = (zonas ?? []).map((z) => ({
    value: z.id as string,
    label: z.nombre as string,
  }))

  // Las familias alimentan el selector dentro del catálogo de equipos,
  // para poder asignarla en el mismo momento en que se crea el equipo.
  const opcionesFamilia = (familias ?? []).map((f) => ({
    value: f.id as string,
    label: f.nombre as string,
  }))

  // Los puestos de trabajo llevan la operación SAP; se enlazan tanto desde
  // implementos como desde familias de equipo.
  const opcionesPuesto = (puestos ?? []).map((p) => ({
    value: p.id as string,
    label: `${p.codigo} · ${String(p.operacion_sap ?? '').padStart(4, '0')}`,
  }))

  // Las categorías alimentan el selector dentro del catálogo de labores,
  // igual que las familias dentro del de equipos.
  const opcionesCategoria = (categoriasLabor ?? []).map((c) => ({
    value: c.id as string,
    label: c.nombre as string,
  }))

  // Los procesos alimentan el selector del catálogo de tareas SAP. Es la
  // vinculación que decide en qué plan entra el avance de cada tarea: una
  // tarea sin proceso no suma en ningún plan.
  const opcionesProceso = (procesos ?? []).map((p) => ({
    value: p.id as string,
    label: `${p.codigo} · ${p.nombre}`,
  }))

  // Estas dos alimentan las listas desplegables de la plantilla de
  // labores y la resolución de nombres al importar.
  const opcionesTarea = (tareasSap ?? []).map((t) => ({
    value: t.id as string,
    label: `${t.codigo} · ${t.nombre}`,
  }))

  const opcionesImplemento = (implementos ?? []).map((i) => ({
    value: i.id as string,
    label: `${i.codigo} · ${i.nombre}`,
  }))

  // Los códigos físicos se vinculan a cada labor, así que también entran
  // como relación del importador de labores.
  const opcionesImplementoFisico = (implementosFisicos ?? []).map((i) => ({
    value: i.id as string,
    label: `${i.codigo} · ${i.descripcion}`,
  }))

  const pestanas: PestanaCatalogo[] = [
    {
      key: 'equipos',
      clave: 'codigo',
      label: 'Equipos',
      tabla: 'equipos',
      campos: [
        { key: 'codigo', label: 'Código', tipo: 'text', requerido: true },
        { key: 'nombre', label: 'Nombre', tipo: 'text', requerido: true },
        { key: 'familia_id', label: 'Familia', tipo: 'select', opciones: opcionesFamilia },
        { key: 'distrito', label: 'Distrito', tipo: 'text' },
        // Llega con la migración 38. Es sólo de consulta aquí: quien la
        // mueve de verdad es el historial de contadores, que además deja
        // constancia de cuándo se cambió y por qué.
        ...(soportaContador
          ? [{ key: 'contador_sap', label: 'Contador SAP', tipo: 'text' as const }]
          : []),
        { key: 'comentario', label: 'Observaciones', tipo: 'text' },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: equipos ?? [],
    },
    {
      key: 'familias',
      clave: 'nombre',
      label: 'Familias de equipo',
      tabla: 'familias_equipo',
      campos: [
        { key: 'nombre', label: 'Familia', tipo: 'text', requerido: true },
        {
          key: 'puesto_trabajo_id',
          label: 'Puesto trabajo · Oper',
          tipo: 'select',
          opciones: opcionesPuesto,
        },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: familias ?? [],
    },
    {
      key: 'implementos',
      clave: 'codigo',
      label: 'Implementos',
      tabla: 'implementos',
      campos: [
        { key: 'codigo', label: 'Código', tipo: 'text', requerido: true },
        { key: 'nombre', label: 'Nombre', tipo: 'text', requerido: true },
        {
          key: 'puesto_trabajo_id',
          label: 'Puesto trabajo · Oper',
          tipo: 'select',
          opciones: opcionesPuesto,
        },
        { key: 'comentario', label: 'Observaciones', tipo: 'text' },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: implementos ?? [],
    },
    {
      key: 'implementos_fisicos',
      clave: 'codigo',
      label: 'Códigos de implemento',
      tabla: 'implementos_fisicos',
      campos: [
        { key: 'codigo', label: 'Código', tipo: 'text', requerido: true },
        { key: 'descripcion', label: 'Descripción', tipo: 'text', requerido: true },
        { key: 'tipo_equipo', label: 'Tipo de equipo', tipo: 'text' },
        {
          key: 'implemento_id',
          label: 'Implemento (tarifa)',
          tipo: 'select',
          opciones: opcionesImplemento,
        },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: implementosFisicos ?? [],
    },
    {
      key: 'variedades',
      clave: 'nombre',
      label: 'Variedades',
      tabla: 'variedades',
      campos: [
        { key: 'nombre', label: 'Variedad', tipo: 'text', requerido: true },
        { key: 'codigo_sap', label: 'Código SAP', tipo: 'text' },
        // El cultivo vive en la variedad y la siembra lo hereda: el
        // digitador no lo escribe y no puede equivocarse.
        { key: 'producto', label: 'Producto (cultivo)', tipo: 'text' },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: variedades ?? [],
    },
    {
      key: 'materiales',
      clave: 'codigo',
      label: 'Materiales',
      tabla: 'materiales',
      campos: [
        { key: 'codigo', label: 'Código', tipo: 'text', requerido: true },
        { key: 'descripcion', label: 'Descripción', tipo: 'text' },
        { key: 'grupo', label: 'Grupo', tipo: 'text' },
        // Las etiquetas se guardan como arreglo en la base para poder
        // buscar dentro; aquí se editan como lista separada por comas,
        // que es lo que un catálogo de texto sabe manejar. Un disparador
        // mantiene las dos caras iguales.
        {
          key: 'etiquetas_texto',
          label: 'Etiquetas (separadas por coma)',
          tipo: 'text',
        },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: materiales ?? [],
    },
    {
      key: 'labores',
      label: 'Labores',
      tabla: 'labores',
      clave: 'nombre',
      campos: [
        { key: 'nombre', label: 'Labor', tipo: 'text', requerido: true },
        {
          key: 'categoria_labor_id',
          label: 'Categoría',
          tipo: 'select',
          opciones: opcionesCategoria,
        },
        // «Añadir opción/checkbox para habilitar proveedores de plástico y
        //  manguera de forma individual por labor.»
        //
        // Al ser columnas normales de la tabla, entran solas en el
        // interruptor de la tabla, en los cambios en masa y en el
        // importador de Excel.
        ...(soportaProveedoresLabor
          ? ([
              { key: 'usa_proveedor_plastico', label: 'Pide prov. plástico', tipo: 'checkbox' },
              { key: 'usa_proveedor_manguera', label: 'Pide prov. manguera', tipo: 'checkbox' },
            ] as const)
          : []),
        // «El seguimiento de Planes y Etapas aplica única y exclusivamente
        //  para la labor de Emplasticado.» La labor marcada aquí es la que
        //  pide etapa en la captura y la que mide el plan.
        ...(soportaSeguimiento
          ? ([
              {
                key: 'seguimiento_emplasticado',
                label: 'Seguimiento de emplasticado',
                tipo: 'checkbox',
              },
            ] as const)
          : []),
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      // Las labores no son un catálogo plano: su utilidad está en las
      // tareas SAP y los códigos físicos que tienen vinculados. Sin esto,
      // cargar labores desde Excel las dejaría sin tareas y la captura
      // no ofrecería ninguna.
      relaciones: [
        {
          label: 'Tareas SAP',
          tabla: 'labores_tareas',
          columnaPadre: 'labor_id',
          columnaHijo: 'tarea_id',
          opciones: opcionesTarea,
        },
        ...(opcionesImplementoFisico.length > 0
          ? [
              {
                label: 'Códigos de implemento',
                tabla: 'labores_implementos_fisicos',
                columnaPadre: 'labor_id',
                columnaHijo: 'implemento_fisico_id',
                opciones: opcionesImplementoFisico,
              },
            ]
          : []),
      ],
      filas: labores ?? [],
    },
    {
      key: 'operadores',
      clave: 'nombre',
      // Ya no son sólo operadores de maquinaria: el teléfono lo lleva
      // también la gente de oficina, y tener dos catálogos de personas
      // sería tener dos listas del mismo señor que se desincronizan al
      // primer cambio de puesto.
      label: 'Personal',
      tabla: 'operadores',
      campos: [
        { key: 'codigo', label: 'Código', tipo: 'text' },
        { key: 'nombre', label: 'Nombre', tipo: 'text', requerido: true },
        ...(soportaPerfil
          ? [
              {
                key: 'tipo_perfil',
                label: 'Perfil',
                tipo: 'multiseleccion' as const,
                opciones: [
                  { value: 'OPERADOR', label: 'Operador' },
                  { value: 'ADMINISTRATIVO', label: 'Administrativo' },
                ],
              },
            ]
          : []),
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: operadores ?? [],
    },
    {
      key: 'zonas',
      clave: 'nombre',
      label: 'Zonas',
      tabla: 'zonas',
      campos: [
        { key: 'nombre', label: 'Zona', tipo: 'text', requerido: true },
        { key: 'responsable', label: 'Responsable', tipo: 'text' },
        { key: 'correo_electronico', label: 'Correo', tipo: 'text' },
        { key: 'telefono', label: 'Teléfono', tipo: 'text' },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: zonas ?? [],
    },
    {
      key: 'categorias_labor',
      clave: 'nombre',
      label: 'Categorías de labor',
      tabla: 'categorias_labor',
      campos: [
        { key: 'nombre', label: 'Categoría', tipo: 'text', requerido: true },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: categoriasLabor ?? [],
    },
    {
      key: 'tareas_sap',
      clave: 'codigo',
      label: 'Tareas SAP',
      tabla: 'tareas_sap',
      campos: [
        { key: 'codigo', label: 'Código', tipo: 'text', requerido: true },
        { key: 'nombre', label: 'Nombre', tipo: 'text', requerido: true },
        {
          key: 'proceso_id',
          label: 'Proceso',
          tipo: 'select',
          opciones: opcionesProceso,
        },
        { key: 'ejecucion', label: 'Ejecución', tipo: 'text' },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: tareasSap ?? [],
    },
    {
      key: 'puestos_trabajo',
      clave: 'codigo',
      label: 'Puestos de trabajo SAP',
      tabla: 'puestos_trabajo',
      campos: [
        { key: 'codigo', label: 'Puesto', tipo: 'text', requerido: true },
        { key: 'descripcion', label: 'Descripción', tipo: 'text' },
        { key: 'operacion_sap', label: 'Operación', tipo: 'number' },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: puestos ?? [],
    },
    {
      key: 'procesos',
      label: 'Procesos SAP',
      tabla: 'procesos_sap',
      clave: 'codigo',
      campos: [
        { key: 'codigo', label: 'Código', tipo: 'text', requerido: true },
        { key: 'nombre', label: 'Proceso', tipo: 'text', requerido: true },
        { key: 'momento', label: 'Momento', tipo: 'text' },
        { key: 'descripcion', label: 'Descripción', tipo: 'text' },
        { key: 'orden', label: 'Orden', tipo: 'number' },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: procesos ?? [],
    },
    {
      key: 'departamentos',
      clave: 'nombre',
      label: 'Departamentos',
      tabla: 'departamentos',
      campos: [
        { key: 'nombre', label: 'Departamento', tipo: 'text', requerido: true },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: departamentos ?? [],
    },
    {
      key: 'proveedores',
      label: 'Proveedores',
      tabla: 'proveedores',
      clave: 'nombre',
      campos: [
        { key: 'nombre', label: 'Proveedor', tipo: 'text', requerido: true },
        {
          key: 'tipo',
          label: 'Tipo',
          tipo: 'select',
          opciones: [
            { value: 'PLASTICO', label: 'Plástico' },
            { value: 'MANGUERA', label: 'Manguera' },
            { value: 'OTRO', label: 'Otro' },
          ],
        },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: proveedores ?? [],
    },
    {
      key: 'planes_nutricionales',
      clave: 'nombre',
      label: 'Planes nutricionales',
      tabla: 'planes_nutricionales',
      campos: [
        { key: 'codigo', label: 'Código', tipo: 'text' },
        { key: 'nombre', label: 'Plan nutricional', tipo: 'text', requerido: true },
        { key: 'descripcion', label: 'Descripción', tipo: 'text' },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: planesNutricionales ?? [],
    },
    {
      key: 'turnos',
      clave: 'codigo',
      label: 'Turnos de riego',
      tabla: 'turnos',
      campos: [
        { key: 'codigo', label: 'Turno', tipo: 'text', requerido: true },
        { key: 'nombre', label: 'Descripción', tipo: 'text' },
        // La zona habitual: al elegir el turno en la captura, se propone.
        { key: 'zona_id', label: 'Zona', tipo: 'select', opciones: opcionesZona },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: turnosCatalogo ?? [],
    },
    {
      key: 'estaciones_riego',
      clave: 'nombre',
      label: 'Estaciones de riego',
      tabla: 'estaciones_riego',
      campos: [
        { key: 'codigo', label: 'Código', tipo: 'text' },
        { key: 'nombre', label: 'Estación', tipo: 'text', requerido: true },
        { key: 'descripcion', label: 'Descripción', tipo: 'text' },
        { key: 'activo', label: 'Activo', tipo: 'checkbox' },
      ],
      filas: estacionesRiego ?? [],
    },
    {
      key: 'temporadas',
      clave: 'nombre',
      label: 'Temporadas',
      tabla: 'temporadas',
      campos: [
        { key: 'nombre', label: 'Temporada', tipo: 'text', requerido: true },
        { key: 'fecha_inicio', label: 'Inicio', tipo: 'date', requerido: true },
        { key: 'fecha_fin', label: 'Fin', tipo: 'date', requerido: true },
        { key: 'activa', label: 'Activa', tipo: 'checkbox' },
      ],
      filas: temporadas ?? [],
    },
  ]

  return (
    <div className="anim-aparecer mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Catálogos</h1>
        <p className="text-sm text-slate-400">
          Datos maestros, agrupados por lo que configuran. Cada catálogo se puede ordenar, filtrar,
          cambiar en masa y cargar desde Excel; la plantilla de cada uno trae las{' '}
          <strong>listas desplegables</strong> ya puestas. En <strong>Labores</strong> el archivo
          también carga las tareas SAP y los implementos de cada labor, y con qué proveedores
          trabaja.
        </p>
      </div>

      {soloLectura && (
        <Alerta tono="ambar">
          Tu rol permite crear algunos registros de catálogo, pero no editar los existentes.
        </Alerta>
      )}

      <MenuCatalogos pestanas={pestanas} soloLectura={soloLectura} />
    </div>
  )
}
