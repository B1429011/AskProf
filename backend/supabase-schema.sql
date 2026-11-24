-- AskProf shared booking data
-- Run this once in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.faculty_availability (
  id uuid primary key default gen_random_uuid(),
  faculty_key text not null,
  faculty_email text not null,
  slot_label text not null,
  status text not null default 'open' check (status in ('open', 'paused', 'booked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (faculty_key, slot_label)
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  faculty_key text not null,
  faculty_email text not null,
  slot_label text not null,
  student_email text not null,
  topic text not null default '',
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faculty_availability_lookup
  on public.faculty_availability (faculty_key, status, slot_label);
create index if not exists appointments_faculty_lookup
  on public.appointments (faculty_key, status, created_at desc);
create index if not exists appointments_student_lookup
  on public.appointments (student_email, status, created_at desc);

alter table public.faculty_availability enable row level security;
alter table public.appointments enable row level security;

-- The AskProf backend uses the Supabase service role and is the only writer.
-- No anonymous policies are created here, so the public API cannot read these
-- tables directly if the backend is misconfigured.
