export function createThreeResourceOwnershipRegistry() {
  const geometries = new WeakSet();
  const materials = new WeakSet();
  return {
    markGeometry(resource) { geometries.add(resource); return resource; },
    markMaterial(resource) { materials.add(resource); return resource; },
    ownsGeometry(resource) { return geometries.has(resource); },
    ownsMaterial(resource) { return materials.has(resource); },
  };
}
