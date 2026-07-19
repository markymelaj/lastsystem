function demoFlag() {
  const value = String(process.env.ENABLE_DEMO_SETUP ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(value);
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    demoEnabled: demoFlag(),
    // --- diagnóstico (podés quitar estas dos líneas más adelante) ---
    build: 'demo-switch-2',
    demoVarPresent: process.env.ENABLE_DEMO_SETUP !== undefined,
    // ----------------------------------------------------------------
    timezone: process.env.ORGANIZATION_TIMEZONE || 'America/Argentina/Mendoza'
  });
}
