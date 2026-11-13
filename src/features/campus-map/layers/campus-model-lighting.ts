import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Material,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Vector3,
} from "three";
import { MercatorCoordinate } from "maplibre-gl";
import { buildingModelCatalog } from "../data/building-models";
import type { RenderProfile } from "../data/model-budget";

export function setCampusModelShadows(mesh: Mesh) {
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  mesh.castShadow = materials.some(
    (material: Material) =>
      !["glass", "metal", "frame", "recess"].includes(
        material.name.toLowerCase(),
      ),
  );
  mesh.receiveShadow = materials.some((m) => m instanceof MeshStandardMaterial);
}

/** One static sun/depth map for all approved models, independent of the map camera. */
export function createCampusModelLighting(
  scene: Scene,
  reference: MercatorCoordinate,
  units: number,
  profile: RenderProfile,
  viewportWidth = 1280,
) {
  const bounds = new Box3();
  for (const entry of buildingModelCatalog.entries) {
    const origin = MercatorCoordinate.fromLngLat([
      entry.origin[0],
      entry.origin[1],
    ]);
    const scale = origin.meterInMercatorCoordinateUnits() / units;
    for (const asset of Object.values(entry.assets))
      for (const x of [asset.bounds.min[0], asset.bounds.max[0]])
        for (const z of [asset.bounds.min[2], asset.bounds.max[2]])
          for (const y of [0, asset.bounds.max[1]])
            bounds.expandByPoint(
              new Vector3(
                (origin.x - reference.x) / units + x * scale,
                y * scale,
                (origin.y - reference.y) / units + z * scale,
              ),
            );
  }
  const center = bounds.getCenter(new Vector3());
  center.y = 0;
  const sun = new DirectionalLight(0xfff5e5, 3);
  sun.target.position.copy(center);
  sun.position
    .copy(center)
    .addScaledVector(new Vector3(-45, 90, 65).normalize(), 2500);
  sun.castShadow = true;
  const size = profile === "conservative" ? 1024 : viewportWidth <= 760 ? 2048 : 4096;
  sun.shadow.mapSize.set(size, size);
  scene.add(new AmbientLight(0xffffff, 2), sun, sun.target);
  scene.updateMatrixWorld(true);

  const camera = sun.shadow.camera;
  camera.position.copy(sun.position);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  const padded = bounds.clone();
  padded.min.x -= 100;
  padded.max.x += 100;
  padded.min.z -= 100;
  padded.max.z += 100;
  const lightBounds = new Box3();
  for (const x of [padded.min.x, padded.max.x])
    for (const z of [padded.min.z, padded.max.z])
      for (const y of [0, padded.max.y])
        lightBounds.expandByPoint(
          new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse),
        );
  camera.left = lightBounds.min.x - 10;
  camera.right = lightBounds.max.x + 10;
  camera.bottom = lightBounds.min.y - 10;
  camera.top = lightBounds.max.y + 10;
  camera.near = Math.max(1, -lightBounds.max.z - 40);
  camera.far = -lightBounds.min.z + 40;
  camera.updateProjectionMatrix();
  // Keep bias in approximate world metres as the campus-wide depth range changes.
  const texelWorldSize = Math.max(camera.right - camera.left, camera.top - camera.bottom) / size;
  const worldBias = Math.max(0.2, texelWorldSize * 0.6);
  sun.shadow.bias = -worldBias / (camera.far - camera.near);
  sun.shadow.normalBias = Math.max(0.3, texelWorldSize * 0.8);
  const material = new ShadowMaterial({ opacity: 0.17, depthWrite: false });
  const receiver = new Mesh(
    new PlaneGeometry(padded.max.x - padded.min.x, padded.max.z - padded.min.z),
    material,
  );
  receiver.name = "campus-model-shadow";
  receiver.rotation.x = -Math.PI / 2;
  receiver.position.set(center.x, 0.03, center.z);
  receiver.receiveShadow = true;
  receiver.renderOrder = -1;
  scene.add(receiver);
  return {
    sun,
    receiver,
    size,
    setRouteVisible(visible: boolean) {
      material.opacity = visible ? 0.05 : 0.17;
    },
    dispose() {
      receiver.geometry.dispose();
      material.dispose();
      sun.shadow.dispose();
    },
  };
}
