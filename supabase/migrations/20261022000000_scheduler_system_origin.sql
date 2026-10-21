alter table public.cargomove_schedulers
  add column origin text not null default 'CargoMove'
  check (length(btrim(origin)) between 1 and 100);
