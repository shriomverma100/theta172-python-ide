/**
 * PyPI requirement check for the renderer. Must match
 * electron/validate.cjs (a test keeps the two in sync).
 * Allows: name, optional [extras], optional single version clause.
 */
export const PACKAGE_SPEC = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?:\[[A-Za-z0-9._-]+(?:,[A-Za-z0-9._-]+)*\])?(?:(?:===|==|!=|~=|>=|<=|>|<)[A-Za-z0-9.*+!_-]+)?$/;

export function isValidPackageSpec(spec) {
  return typeof spec === 'string' && spec.length <= 200 && PACKAGE_SPEC.test(spec);
}
