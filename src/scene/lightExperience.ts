/** True on a phone-width window or when the browser asks to save data. */
export function lightExperience() {
  if (typeof window === 'undefined') return false;
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return connection?.saveData === true || window.innerWidth < 760;
}
