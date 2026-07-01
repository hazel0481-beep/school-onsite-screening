create table if not exists public.oral_exam_board_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.oral_exam_board_state enable row level security;
