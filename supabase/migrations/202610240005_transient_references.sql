-- New references keep only numbered slots, roles and hashes in the database.
-- Preserve every existing storage object and historical reference.
begin;
create or replace function public.ps_valid_references(p_images jsonb,p_owner uuid) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; seen text[] := array[]::text[];
begin
 if jsonb_typeof(p_images) is distinct from 'array' then return false; end if;
 if jsonb_array_length(p_images)>5 then return false; end if;
 for item in select value from jsonb_array_elements(p_images) loop
  if jsonb_typeof(item) is distinct from 'object'
   or coalesce(item->>'path','') !~ ('^'||p_owner::text||'/[a-f0-9-]+\.(png|jpg|jpeg)$')
   or coalesce(item->>'role','') not in ('auto','product','scene','person','style','detail')
   or jsonb_typeof(item->'note') is distinct from 'string' or length(item->>'note')>1000
   or (item->>'path')=any(seen)
   or exists(select 1 from jsonb_object_keys(item) key where key not in ('path','role','note','temporary','digest','sourceDigest'))
   or (item ? 'temporary' and item->'temporary' is distinct from 'true'::jsonb)
   or (item->'temporary'='true'::jsonb and (
     coalesce(item->>'digest','') !~ '^[a-f0-9]{64}$' or coalesce(item->>'sourceDigest','') !~ '^[a-f0-9]{64}$'
   )) then return false; end if;
  seen := array_append(seen,item->>'path');
 end loop;
 return true;
end; $$;
commit;

