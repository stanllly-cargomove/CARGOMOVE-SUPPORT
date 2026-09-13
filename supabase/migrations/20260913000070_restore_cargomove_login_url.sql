-- Correct databases where migration 00060 was already applied. The Vercel URL
-- hosts registration/admin; customers log in to the separate CargoMove system.
update public.email_templates
set
  body_template = replace(
    replace(
      body_template,
      'Login Link: https://cargomove-register.vercel.app/',
      'Login Link: https://www.cargomove.my/'
    ),
    E'\n\nhttps://cargomove-register.vercel.app/',
    E'\n\nwww.cargomove.com.my/'
  ),
  version = version + 1,
  updated_at = now()
where id = 'cargomove-welcome'
  and (
    body_template like '%Login Link: https://cargomove-register.vercel.app/%'
    or body_template like E'%\n\nhttps://cargomove-register.vercel.app/%'
  );
