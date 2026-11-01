import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {createTeslaExplosion} from '/tesla-model-s75d-site/vehicle-b23/load-model.js';

// Both original B23 and lossless Meshopt variants use the same portable selection map.
export async function loadStudioModel(modelURL, manifestURL, {onProgress = () => {}, signal} = {}) {
  const started=performance.now();
  const manifestPromise = fetch(manifestURL, {signal}).then(response => {
    if (!response.ok) throw Error('Manifeste du modèle inaccessible.');
    return response.json();
  });
  // Attach an error handler immediately while the model download is in progress.
  manifestPromise.catch(() => {});
  const response = await fetch(modelURL, {signal});
  if (!response.ok) throw Error('Modèle inaccessible.');
  const encoding = response.headers.get('content-encoding');
  const total = !encoding || encoding === 'identity' ? Number(response.headers.get('content-length')) || 0 : 0;
  let loaded = 0;
  const chunks = [];
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.byteLength;
      onProgress({stage:'download', loaded, total: total >= loaded ? total : 0});
    }
  } else {const value = new Uint8Array(await response.arrayBuffer());chunks.push(value);loaded=value.length;}
  onProgress({stage:'prepare', loaded, total:loaded});
  const downloaded=performance.now();
  // Give the preparation message a paint before parsing and uploading geometry.
  await new Promise(requestAnimationFrame);
  if (signal?.aborted) throw new DOMException('Chargement annulé', 'AbortError');
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset);offset += chunk.length;}
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [gltf, manifest] = await Promise.all([loader.parseAsync(bytes.buffer, new URL('.', new URL(modelURL, location.href)).href), manifestPromise]);
  return {scene:gltf.scene, manifest, explosion:createTeslaExplosion(gltf.scene, manifest), timings:{downloadMs:downloaded-started,preparationMs:performance.now()-downloaded,bytes:loaded}};
}
