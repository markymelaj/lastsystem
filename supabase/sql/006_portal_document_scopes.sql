-- Respeta el alcance solicitado para cada documento de portal.
begin;

update public.family_authorizations
set can_view_profile=true
where active=true and can_view_profile=false;

create or replace function public.can_submit_document_requirement(p_requirement_id uuid,p_patient_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.document_requirements r
    join public.user_profiles u on u.id=auth.uid() and u.active
    where r.id=p_requirement_id and r.patient_id=p_patient_id and r.status in ('requested','rejected')
      and (
        (u.account_kind='patient' and u.patient_id=p_patient_id and r.allow_patient)
        or (
          u.account_kind='family' and r.allow_family
          and exists(
            select 1 from public.family_authorizations fa
            where fa.user_id=u.id and fa.patient_id=p_patient_id and fa.active
              and fa.can_upload_documents and (fa.valid_until is null or fa.valid_until>=current_date)
          )
        )
      )
  );
$$;

drop policy if exists "document requirements portal read" on public.document_requirements;
create policy "document requirements portal read" on public.document_requirements for select to authenticated
using(public.can_submit_document_requirement(id,patient_id));

drop policy if exists "portal submissions scoped insert" on public.portal_document_submissions;
create policy "portal submissions scoped insert" on public.portal_document_submissions for insert to authenticated
with check(
  submitted_by=auth.uid()
  and file_path like auth.uid()::text || '/%'
  and public.can_submit_document_requirement(requirement_id,patient_id)
);

commit;
