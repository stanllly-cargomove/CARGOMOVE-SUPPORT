const REGISTRATION_TEST_TOOLS_KEY = 'cargomove_registration_test_tools_enabled';

/** Developer-only browser setting for temporary registration test controls. */
export function areRegistrationTestToolsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const value = window.localStorage.getItem(REGISTRATION_TEST_TOOLS_KEY);
  // Keep the existing temporary tools available until a developer explicitly
  // turns them off from the Developer portal.
  return value === null ? true : value === 'true';
}

export function setRegistrationTestToolsEnabled(enabled: boolean): void {
  window.localStorage.setItem(REGISTRATION_TEST_TOOLS_KEY, String(enabled));
}
