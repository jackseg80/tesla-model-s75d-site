// Correspondences belong to the host, never to the fiche content or the geometry.
export const modelURLs = {model: '/tesla-model-s75d-site/vehicle-b23/model.glb', manifest: '/tesla-model-s75d-site/vehicle-b23/manifest.json'};
export const preferredTargets = {
  battery: 'battery', powertrain: 'motorFront', seats: 'seatDriver',
  infotainment: 'centerDisplay', 'driver-assistance': 'forwardCameras',
  charging: null, 'body-roof': 'roof', 'wheels-suspension': 'wheel0',
};
export const technicalIds = new Set(['battery', 'motorFront', 'motorRear', 'subframeFront', 'subframeRear',
  ...Array.from({length: 4}, (_, i) => `brake${i}`), ...Array.from({length: 4}, (_, i) => `suspension${i}`)]);
export const cabinIds = new Set(['seats', 'dashboard', 'steering', 'console', 'floor', 'armrest0', 'armrest1',
  'trimRight', 'trimLeft', 'centerDisplay', 'instrumentDisplay', 'seatDriver', 'seatPassenger', 'rearBench']);
