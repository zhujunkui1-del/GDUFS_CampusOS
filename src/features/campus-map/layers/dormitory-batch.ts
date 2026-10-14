import { Group, InstancedMesh, Matrix4, Mesh, type Object3D } from "three";

/** Reuse unchanged template buffers. Caller owns geometry/material lifetime. */
export function createDormitoryBatch(
  template: Object3D,
  placements: readonly Matrix4[],
  batchSize = 10,
) {
  if (!Number.isInteger(batchSize) || batchSize < 1)
    throw new Error("Invalid batch size");
  template.updateMatrixWorld(true);
  const components: Mesh[] = [];
  template.traverse((node) => {
    if (node instanceof Mesh) components.push(node);
  });
  const root = new Group();
  for (let start = 0; start < placements.length; start += batchSize) {
    const group = new Group();
    group.name = `dormitory-batch-${start}`;
    const subset = placements.slice(start, start + batchSize);
    for (const component of components) {
      const copies = component instanceof InstancedMesh ? component.count : 1;
      const mesh = new InstancedMesh(
        component.geometry,
        component.material,
        subset.length * copies,
      );
      mesh.name = component.name;
      mesh.castShadow = component.castShadow;
      mesh.receiveShadow = component.receiveShadow;
      const local = new Matrix4();
      let index = 0;
      for (const placement of subset) {
        for (let i = 0; i < copies; i++) {
          if (component instanceof InstancedMesh)
            component.getMatrixAt(i, local);
          else local.identity();
          mesh.setMatrixAt(
            index++,
            new Matrix4()
              .multiplyMatrices(placement, component.matrixWorld)
              .multiply(local),
          );
        }
      }
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    root.add(group);
  }
  root.updateMatrixWorld(true);
  return root;
}

/** Dispose per-batch matrix buffers only; template buffers stay shared and owned by the caller. */
export function disposeDormitoryBatch(root: Object3D) {
  root.traverse((node) => {
    if (node instanceof InstancedMesh) node.dispose();
  });
  root.clear();
}
