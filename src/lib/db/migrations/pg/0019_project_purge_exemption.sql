-- 产物不可变性护栏收窄为「不可原地修改」：approved / released 产物依旧禁止
-- UPDATE，也依旧禁止任何常规 DELETE；唯一豁免是整项目清除
-- （features/projects/project-deletion.ts），它在同一事务内用
-- set_config('purpleink.project_purge', 'on', true) 显式声明意图，
-- 事务结束即失效。豁免只放开 DELETE，不放开 UPDATE，
-- 因此「已审批产物的内容与谱系永不被就地改写」这条不变量保持成立。
CREATE OR REPLACE FUNCTION prevent_immutable_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE'
		AND coalesce(current_setting('purpleink.project_purge', true), 'off') = 'on' THEN
		RETURN OLD;
	END IF;
	IF OLD.lifecycle IN ('approved', 'released') THEN
		RAISE EXCEPTION 'approved or released artifacts are immutable'
			USING ERRCODE = '55000';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
