// Opt-in only. Installing the code never enables the new module by itself.
export const PRODUCTION_DB='https://bnzrnizrmonjxlktbhlp.supabase.co';
export const productionObservationEnabled=e=>e.VERCEL_ENV==='production'
 &&e.NEXT_PUBLIC_SUPABASE_URL===PRODUCTION_DB&&e.COMMENT_OBSERVATION_MODE==='human_review_only';
