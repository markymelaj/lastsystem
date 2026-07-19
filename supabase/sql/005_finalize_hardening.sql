-- Complemento de 004: mantenimiento y auditoría de pagos.
begin;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'family_authorizations','professional_availability_rules','calendar_blocks',
    'calendar_connections','document_requirements','portal_document_submissions',
    'financial_charges','financial_payments','communications'
  ] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

create or replace function public.check_calendar_block_conflicts()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not new.active then return new; end if;
  if new.professional_id is not null then perform pg_advisory_xact_lock(hashtext('professional:'||new.professional_id::text)); end if;
  if new.room_id is not null then perform pg_advisory_xact_lock(hashtext('room:'||new.room_id::text)); end if;
  if exists(
    select 1 from public.appointments a
    where a.status not in ('cancelado','reprogramado')
      and tstzrange(a.start_at,a.end_at,'[)') && tstzrange(new.start_at,new.end_at,'[)')
      and ((new.professional_id is not null and a.professional_id=new.professional_id)
        or (new.room_id is not null and a.room_id=new.room_id))
  ) then raise exception 'El bloqueo se superpone con un turno vigente'; end if;
  return new;
end;
$$;
drop trigger if exists trg_check_calendar_block_conflicts on public.calendar_blocks;
create trigger trg_check_calendar_block_conflicts
before insert or update of active,professional_id,room_id,start_at,end_at on public.calendar_blocks
for each row execute function public.check_calendar_block_conflicts();

create or replace function public.refresh_charge_balance()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_charge uuid; v_paid numeric(14,2); v_total numeric(14,2);
begin
  if tg_op='DELETE' then v_charge:=old.charge_id; else v_charge:=new.charge_id; end if;
  if v_charge is null then return case when tg_op='DELETE' then old else new end; end if;
  select amount into v_total from public.financial_charges where id=v_charge;
  select coalesce(sum(amount),0) into v_paid from public.financial_payments where charge_id=v_charge and status='confirmed';
  update public.financial_charges set paid_amount=v_paid,
    status=case when status in ('waived','cancelled') then status when v_paid<=0 then 'open' when v_paid<v_total then 'partial' else 'paid' end
  where id=v_charge;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create or replace function public.audit_financial_payment()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.add_audit_log(
    case when tg_op='INSERT' then 'MANUAL_PAYMENT_RECORDED' when tg_op='DELETE' then 'MANUAL_PAYMENT_REMOVED' else 'MANUAL_PAYMENT_UPDATED' end,
    'financial_payments',coalesce(new.id,old.id),coalesce(new.patient_id,old.patient_id),
    jsonb_build_object('amount',coalesce(new.amount,old.amount),'status',coalesce(new.status,old.status)),'high'
  );
  return case when tg_op='DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_audit_financial_payment on public.financial_payments;
create trigger trg_audit_financial_payment
after insert or update or delete on public.financial_payments
for each row execute function public.audit_financial_payment();

commit;
