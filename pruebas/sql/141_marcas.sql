-- Verifica que los parches de 132, 139, 140 y 141 estén TODOS presentes en las funciones de Inyección.
-- psql -d <base> -v ON_ERROR_STOP=1 -f pruebas/sql/141_marcas.sql   (se usa tras cada orden de corrida)
\set ON_ERROR_STOP 1
do $$
declare
    v_falta text := '';
    r record;
begin
    for r in select * from (values
        ('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)', 'v_obj_ids  uuid[];'),
        ('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)', '-- 132:lote'),
        ('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)', '139:de_bodega'),
        ('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)', '140:historica'),
        ('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)', '140:sin-bodega'),
        ('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)', '141:obj-registro'),
        ('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)', '_iny_resolver_objetivos(public._iny_objetivos_registro(d)'),
        ('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)', '141:obj-linea'),
        ('public._iny_op_aplicacion_lote(uuid,jsonb,timestamptz,boolean,uuid)', '141:zona'),
        ('public.fn_iny_publicar(jsonb)', '_iny_publicar_objetivos('),
        ('public.fn_iny_publicar(jsonb)', '141:plan'),
        ('public.fn_iny_publicar(jsonb)', 'variedad = excluded.variedad'),
        ('public.fn_iny_estado_campo(date)', '_iny_objetivos_campo('),
        ('public.fn_iny_estado_campo(date)', '''de_bodega'', d.de_bodega'),
        ('public.fn_iny_estado_campo(date)', '141:zona-plan'),
        ('public.fn_iny_estado_campo(date)', '''pct_aplicacion'', p.pct_aplicacion'),
        ('public.fn_iny_estado_campo(date)', '''objetivos'', to_jsonb(d.objetivos)'),
        ('public._iny_fila(public.iny_aplicaciones)', '''{}''::jsonb else jsonb_build_object(''objetivo_ids'''),
        ('public._iny_fila(public.iny_aplicaciones)', 'case when d.objetivo_ids is null then'),
        ('public._iny_lotes_campo()', '_iny_zona_visible')
    ) t(fn, marca) loop
        if position(r.marca in pg_get_functiondef(r.fn::regprocedure)) = 0 then
            v_falta := v_falta || E'\n  ' || r.fn || ' <- ' || r.marca;
        end if;
    end loop;
    if v_falta <> '' then raise exception 'FALLA marcas:%', v_falta; end if;
    raise notice 'ok  marcas 132/139/140/141 presentes (20/20)';
end $$;
