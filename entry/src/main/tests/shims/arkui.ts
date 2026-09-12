/**
 * Test-environment shim for @kit.ArkUI (the real module only exists on
 * HarmonyOS). Stripped decorators make models/ loadable in plain node.
 */
export function Observed(target: object): void {
  void target;
}
export function Track(target: object, propertyKey: string): void {
  void target; void propertyKey;
}
