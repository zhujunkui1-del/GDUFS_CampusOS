import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Material,
  Mesh,
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
  // Preserve the approved bright materials; the separate ground plane receives the projection.
  mesh.receiveShadow = false;
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
  sun.castShadow = true;
  const size =
    profile === "conservative" ? 1024 : viewportWidth <= 760 ? 2048 : 4096;
  sun.shadow.mapSize.set(size, size);
  scene.add(new AmbientLight(0xffffff, 2), sun, sun.target);
  const padded = bounds.clone();
  padded.min.x -= 100;
  padded.max.x += 100;
  padded.min.z -= 100;
  padded.max.z += 100;
  let coverage = padded.clone();
  function configure(region: Box3) {
    const target = region.getCenter(new Vector3());
    target.y = 0;
    const distance = Math.max(
      250,
      region.getSize(new Vector3()).length() * 1.3,
    );
    sun.target.position.copy(target);
    sun.position
      .copy(target)
      .addScaledVector(new Vector3(-45, 90, 65).normalize(), distance);
    scene.updateMatrixWorld(true);
    const camera = sun.shadow.camera;
    camera.position.copy(sun.position);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    const lightBounds = new Box3();
    for (const x of [region.min.x, region.max.x])
      for (const z of [region.min.z, region.max.z])
        for (const y of [0, bounds.max.y])
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
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.3;
    coverage = region.clone();
  }
  configure(padded);
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
    get regionKey() {
      return [
        coverage.min.x,
        coverage.min.z,
        coverage.max.x,
        coverage.max.z,
      ].join(",");
    },
    fitView(view: Box3, refine: boolean) {
      const required = view.clone();
      required.min.y = 0;
      required.max.y = bounds.max.y;
      required.min.x -= 60;
      required.max.x += 60;
      required.min.z -= 60;
      required.max.z += 60;
      const oldSize = coverage.getSize(new Vector3()),
        neededSize = required.getSize(new Vector3());
      if (
        coverage.containsBox(required) &&
        (!refine ||
          Math.max(oldSize.x, oldSize.z) <=
            Math.max(neededSize.x, neededSize.z) * 2.5)
      )
        return false;
      const region = view.clone();
      region.min.y = 0;
      region.max.y = bounds.max.y;
      region.min.x = Math.floor((region.min.x - 140) / 64) * 64;
      region.max.x = Math.ceil((region.max.x + 140) / 64) * 64;
      region.min.z = Math.floor((region.min.z - 140) / 64) * 64;
      region.max.z = Math.ceil((region.max.z + 140) / 64) * 64;
      configure(region);
      return true;
    },
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
