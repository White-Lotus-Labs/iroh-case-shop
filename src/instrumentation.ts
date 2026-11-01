export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  // Next loads this file for every runtime. The refresh loop is Node-only,
  // so the import stays inside register instead of at the top of the module.
  const { startHourlyNansenRefresh } = await import('./nansen/refresh-loop');
  startHourlyNansenRefresh();
}
