-- Milestone 10: optional fixed acknowledgements only. Everything defaults to human review.
begin;
alter table public.support_automation_rules drop constraint support_automation_initial_human_only;
alter table public.support_automation_rules add constraint support_automation_ack_only check(
 not auto_send_enabled or (active and ai_analysis_enabled and ai_draft_enabled and not always_require_human
 and minimum_confidence>=0.90 and subcategory is not null
 and category in ('DRIVER','VEHICLE','BOOKING','ACCOUNT','REGISTRATION')
 and subcategory not in ('EARLY_ENTRY','PORT_CANCELLED','VESSEL_CHANGE','UNKNOWN_ERROR','CONTAINER_NOT_FOUND','SYSTEM_OUTAGE','YARD_OPENING','DG_DECLARATION')));
alter table public.support_automation_rules add constraint support_automation_risk_human check(
 always_require_human or (category in ('DRIVER','VEHICLE','BOOKING','ACCOUNT','REGISTRATION') and subcategory is not null
 and subcategory not in ('EARLY_ENTRY','PORT_CANCELLED','VESSEL_CHANGE','UNKNOWN_ERROR','CONTAINER_NOT_FOUND','SYSTEM_OUTAGE','YARD_OPENING','DG_DECLARATION')));
alter table public.support_reply_deliveries add column approval_mode text not null default 'MANUAL' check(approval_mode in ('MANUAL','AUTOMATIC_ACK')),
 add column automation_rule_id uuid references public.support_automation_rules(id) on delete restrict,
 add column automation_rule_version timestamptz;
create table public.support_automation_rule_events (
 id uuid primary key default gen_random_uuid(),rule_id uuid not null references public.support_automation_rules(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,before_rule jsonb,after_rule jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.support_automation_rule_events enable row level security;
revoke all on public.support_automation_rule_events from public,anon,authenticated;
grant select,insert,update,delete on public.support_automation_rule_events to service_role;
create function public.list_support_automation() returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('rules',coalesce((select jsonb_agg(to_jsonb(r) order by category,subcategory nulls first,port) from public.support_automation_rules r),'[]'::jsonb));
$$;
create function public.save_support_automation(p_id uuid,p_expected timestamptz,p_rule jsonb,p_admin uuid) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare old public.support_automation_rules; saved public.support_automation_rules;
begin
 if p_id is not null then
 select * into old from public.support_automation_rules where id=p_id for update;
 if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
 if old.updated_at is distinct from p_expected then return jsonb_build_object('error','CONFLICT'); end if;
 end if;
 if p_id is null then
 insert into public.support_automation_rules(category,subcategory,port,ai_analysis_enabled,ai_draft_enabled,auto_send_enabled,minimum_confidence,always_require_human,active,created_by,updated_by)
 values(p_rule->>'category',p_rule->>'subcategory',p_rule->>'port',(p_rule->>'ai_analysis_enabled')::boolean,(p_rule->>'ai_draft_enabled')::boolean,(p_rule->>'auto_send_enabled')::boolean,(p_rule->>'minimum_confidence')::numeric,(p_rule->>'always_require_human')::boolean,(p_rule->>'active')::boolean,p_admin,p_admin) returning * into saved;
 else
 update public.support_automation_rules set category=p_rule->>'category',subcategory=p_rule->>'subcategory',port=p_rule->>'port',ai_analysis_enabled=(p_rule->>'ai_analysis_enabled')::boolean,ai_draft_enabled=(p_rule->>'ai_draft_enabled')::boolean,auto_send_enabled=(p_rule->>'auto_send_enabled')::boolean,minimum_confidence=(p_rule->>'minimum_confidence')::numeric,always_require_human=(p_rule->>'always_require_human')::boolean,active=(p_rule->>'active')::boolean,updated_by=p_admin where id=p_id returning * into saved;
 end if;
 insert into public.support_automation_rule_events(rule_id,actor_id,before_rule,after_rule)values(saved.id,p_admin,case when p_id is null then null else to_jsonb(old) end,to_jsonb(saved));
 return to_jsonb(saved);
exception when unique_violation then return jsonb_build_object('error','DUPLICATE_SCOPE');
end;$$;
create function public.support_automation_policy(p_case uuid) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 with source as(select c.*,public.get_support_analysis(c.id) as analysis from public.support_cases c where c.id=p_case),
 scope as(select c.*,r.id as rule_id,to_jsonb(r) as rule from source c left join lateral(
 select * from public.support_automation_rules where category=c.category and (subcategory is null or subcategory=c.subcategory) and (port='ALL' or port=c.port)
 order by (subcategory is not null) desc,(port<>'ALL') desc,id limit 1
 )r on true)
 select jsonb_build_object('rule',rule,'status',status,'case_version',updated_at,'analysis',analysis,
 'can_auto_ack',coalesce((rule->>'active')::boolean and (rule->>'auto_send_enabled')::boolean and not (rule->>'always_require_human')::boolean
 and status not in ('RESOLVED','ESCALATED') and urgency in ('LOW','NORMAL')
 and ai_confidence>=(rule->>'minimum_confidence')::numeric and not (analysis->>'stale')::boolean
 and category in ('DRIVER','VEHICLE','BOOKING','ACCOUNT','REGISTRATION') and subcategory is not null
 and subcategory not in ('EARLY_ENTRY','PORT_CANCELLED','VESSEL_CHANGE','UNKNOWN_ERROR','CONTAINER_NOT_FOUND','SYSTEM_OUTAGE','YARD_OPENING','DG_DECLARATION')
 and not exists(select 1 from public.support_knowledge k where k.active and k.category=scope.category and (k.subcategory is null or k.subcategory=scope.subcategory) and (k.port='ALL' or k.port=scope.port) and (k.requires_port_verification or k.human_review_required)),false)) from scope;
$$;
-- Only the server's automation route calls this; it rechecks policy under locks.
create function public.claim_support_auto_ack(p_draft uuid,p_expected timestamptz,p_case_version timestamptz,p_kind text,p_id uuid,p_admin uuid,p_mailbox text,p_email text,p_subject text,p_rule uuid,p_rule_version timestamptz) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare d public.support_reply_drafts;c public.support_cases;policy jsonb; result jsonb; expected text; lang text;
begin
 select * into d from public.support_reply_drafts where id=p_draft;
 if not found then return jsonb_build_object('error','NOT_FOUND'); end if;
 select * into c from public.support_cases where id=d.case_id for update;
 select * into d from public.support_reply_drafts where id=p_draft for update;
 perform id from public.support_automation_rules where id=p_rule for share;
 -- All eligible matching articles are locked against safety-flag changes through commit.
 perform id from public.support_knowledge where active and category=c.category order by id for share;
 policy:=public.support_automation_policy(c.id);
 if not coalesce((policy->>'can_auto_ack')::boolean,false) or (policy->'rule'->>'id')::uuid is distinct from p_rule or (policy->'rule'->>'updated_at')::timestamptz is distinct from p_rule_version then return jsonb_build_object('error','AUTOMATION_BLOCKED'); end if;
 lang:=policy->'analysis'->'interaction'->>'language';
 expected:=case when lang in ('MS','MIXED_MS_EN') then 'Terima kasih kerana menghubungi CargoMove. Kami telah menerima pertanyaan anda. Maklumat lanjut memerlukan semakan oleh pasukan sokongan.' else 'Thank you for contacting CargoMove. We have received your enquiry. Further guidance requires review by our support team.' end;
 if p_kind<>'SEND' or d.template_id<>'ACKNOWLEDGE' or d.edited_reply is distinct from expected or (select generated_reply from public.ai_interactions where id=d.interaction_id) is distinct from expected then return jsonb_build_object('error','AUTOMATION_BLOCKED'); end if;
 result:=public.claim_support_delivery(p_draft,p_expected,p_case_version,p_kind,p_id,p_admin,p_mailbox,p_email,p_subject);
 if not result ? 'error' and not coalesce((result->>'cached')::boolean,false) then
 update public.support_reply_deliveries set approval_mode='AUTOMATIC_ACK',automation_rule_id=p_rule,automation_rule_version=p_rule_version where id=p_id;
 result:=jsonb_set(result,'{operation}',(select to_jsonb(x) from public.support_reply_deliveries x where id=p_id));
 end if;
 return result;
end;$$;
-- Preserve the confirmed receipt/outbound transaction and remove human-review attribution for automatic acknowledgements.
alter function public.finish_support_delivery(uuid,text,text,text,timestamptz) rename to finish_support_delivery_receipt;
revoke all on function public.finish_support_delivery_receipt(uuid,text,text,text,timestamptz) from public,anon,authenticated;
create function public.finish_support_delivery(p_id uuid,p_message text,p_thread text,p_draft text,p_sent_at timestamptz) returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare result jsonb;op public.support_reply_deliveries;
begin
 result:=public.finish_support_delivery_receipt(p_id,p_message,p_thread,p_draft,p_sent_at);
 if result ? 'error' then return result; end if;
 select * into op from public.support_reply_deliveries where id=p_id;
 if op.approval_mode='AUTOMATIC_ACK' and op.status='DONE' then
 update public.ai_interactions set approved_by=null,approved_at=null where id=(select interaction_id from public.support_reply_drafts where id=op.draft_id);
 end if;
 return result;
end;$$;
revoke all on function public.list_support_automation(),public.save_support_automation(uuid,timestamptz,jsonb,uuid),public.support_automation_policy(uuid),public.claim_support_auto_ack(uuid,timestamptz,timestamptz,text,uuid,uuid,text,text,text,uuid,timestamptz),public.finish_support_delivery(uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.list_support_automation(),public.save_support_automation(uuid,timestamptz,jsonb,uuid),public.support_automation_policy(uuid),public.claim_support_auto_ack(uuid,timestamptz,timestamptz,text,uuid,uuid,text,text,text,uuid,timestamptz),public.finish_support_delivery(uuid,text,text,text,timestamptz) to service_role;
commit;
