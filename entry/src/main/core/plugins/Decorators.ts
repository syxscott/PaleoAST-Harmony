/**
 * Plugin decorators ¡ª replaces plugins/decorators.py
 */

export function plugin(name: string, version: string, description: string) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    return class extends constructor {
      static pluginName = name;
      static pluginVersion = version;
      static pluginDescription = description;
    };
  };
}

export function analysis(name: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    descriptor.value.analysisName = name;
    return descriptor;
  };
}
