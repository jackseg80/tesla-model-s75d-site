import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadTeslaModel} from '/tesla-model-s75d-site/vehicle-b23/load-model.js';
import {modelURLs, technicalIds, cabinIds} from './model-map.js';
import {viewPresets} from './view-presets.js';
import {familyViews} from './family-views.js';

// Host scene only: B23 already contains all authoring results. Never reconstruct them here.
export async function createStudio(host, {onSelect, onState, onContextLost, modelSource = modelURLs, expectedVersion = 'B23-01'}) {
  const started = performance.now();
  let renderer, observer, environment, controls, model, pendingFrame = 0;
  const scene = new THREE.Scene();
  const cleanups = [];
  function dispose() {
    cancelAnimationFrame(pendingFrame);
    observer?.disconnect();
    for (const fn of cleanups) fn();
    controls?.dispose();
    const geometries = new Set(), materials = new Set(), textures = new Set();
    scene.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      for (const mat of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (!mat) continue;
        materials.add(mat);
        for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
      }
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    environment?.dispose(); renderer?.dispose(); renderer?.domElement.remove();
  }
  try {
    renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'default'});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .85;
    host.prepend(renderer.domElement);
    scene.background = new THREE.Color('#13191e');
    const camera = new THREE.PerspectiveCamera(38, 1, .01, 80);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = .2; controls.maxDistance = 24;
    controls.enablePan = true; controls.screenSpacePanning = true;
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    environment = pmrem.fromScene(room, .04);
    scene.environment = environment.texture; scene.environmentIntensity = .7;
    room.dispose(); pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xf4ede5, 0x334251, .85));
    const key = new THREE.DirectionalLight(0xfff4e8, 2.6); key.position.set(3, 5, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0xc5dcf8, .9); fill.position.set(-3, 2, -2); scene.add(fill);
    const underfill = new THREE.DirectionalLight(0xe4ebef,.65); underfill.position.set(0,-4,1); scene.add(underfill);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({color: '#13191e'}));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.008; scene.add(ground);
    ground.material.toneMapped = false;
    const contact = new THREE.Mesh(new THREE.CircleGeometry(2.3, 64), new THREE.MeshBasicMaterial({color: '#000000', transparent: true, opacity: .23, depthWrite: false}));
    contact.rotation.x = -Math.PI / 2; contact.scale.x = .47; contact.position.y = -.007; scene.add(contact);
    const box = new THREE.Box3(), helper = new THREE.Box3Helper(box, 0xf1c087); helper.visible = false; scene.add(helper);
    let progress = 0, selected = null, isolated = false, view = 'threeQuarter', autoFrame = true, contextLost = false;
    let focusedIds = null, focusFamily = null, focusLabel = null, focusDirection = null;
    const draw = () => { if (model && !contextLost && host.clientWidth && host.clientHeight) renderer.render(scene, camera); };
    const render = () => {
      if (!pendingFrame) pendingFrame = requestAnimationFrame(() => { pendingFrame = 0; draw(); });
    };
    controls.addEventListener('change', render);
    controls.addEventListener('start', () => { autoFrame = false; });
    function lost(event) { event.preventDefault(); contextLost = true; onContextLost(); }
    renderer.domElement.addEventListener('webglcontextlost', lost);
    cleanups.push(() => renderer.domElement.removeEventListener('webglcontextlost', lost));
    let timedOut = false, timeout;
    const loading = loadTeslaModel(modelSource.model, modelSource.manifest);
    // A late model is disposed rather than attached after the timeout/error UI.
    loading.then(result => { if (timedOut) { scene.add(result.scene); dispose(); } }, () => {});
    try {
      model = await Promise.race([loading, new Promise((_, reject) => { timeout = setTimeout(() => { timedOut = true; reject(Error('Le chargement dépasse 45 secondes. Les fiches restent disponibles.')); }, 45000); })]);
    } finally { clearTimeout(timeout); }
    scene.add(model.scene);
    const {explosion, manifest} = model;
    if (explosion.targets.length !== 42 || manifest.version !== expectedVersion) throw Error('Version du paquet inattendue.');
    const targets = new Map(explosion.targets.map(t => [t.id, t]));
    const meshes = [];
    model.scene.traverse(node => { if (node.isMesh) meshes.push(node); });
    function closestTarget(node) {
      for (let current = node; current; current = current.parent) {
        if (targets.has(current.userData.selectionId)) return targets.get(current.userData.selectionId);
      }
      return null;
    }
    function isDescendant(node, ancestor) {
      for (let n = node; n; n = n.parent) if (n === ancestor) return true;
      return false;
    }
    function isVisible(node) {
      for (let n = node; n; n = n.parent) if (!n.visible) return false;
      return true;
    }
    function visibility() {
      for (const target of explosion.targets) target.node.visible = true;
      const target = targets.get(selected);
      for (const mesh of meshes) {
        const id = closestTarget(mesh)?.id;
        mesh.visible = isolated && target ? isDescendant(mesh, target.node)
          : focusedIds ? focusedIds.has(id)
          : view === 'technical' ? technicalIds.has(id) || id?.startsWith('wheel')
          : view === 'cabin' ? cabinIds.has(id)
          : id === 'battery' ? mesh.userData.integratedUnderbody === true || progress > 0
          : !['motorFront', 'motorRear', 'subframeFront', 'subframeRear'].includes(id) || progress > 0;
      }
      ground.visible = !isolated; contact.visible = !isolated && progress === 0 && !['technical','cabin','family','detail','underbody'].includes(view);
      ground.position.y = THREE.MathUtils.lerp(-.008, -.65, THREE.MathUtils.smoothstep(progress, 0, .4));
    }
    function bounds() {
      const result = new THREE.Box3();
      model.scene.updateMatrixWorld(true);
      for (const mesh of meshes) if (isVisible(mesh)) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        result.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
      }
      return result;
    }
    function frame() {
      const b = bounds();
      if (b.isEmpty()) return;
      const centre = b.getCenter(new THREE.Vector3());
      const preset = viewPresets[view] ?? viewPresets.threeQuarter;
      const direction = new THREE.Vector3(...(focusDirection ?? preset.direction)).normalize();
      // The UI explicitly identifies the cutaway as bodywork hidden for interior viewing.
      const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();
      const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), tanX = tanY * camera.aspect;
      let distance = 0;
      // Fit each visible mesh box instead of the loose box around the whole car.
      // This removes empty corners while retaining a verified edge margin at every aspect ratio.
      const point = new THREE.Vector3();
      for (const mesh of meshes) if (isVisible(mesh)) {
        const local = mesh.geometry.boundingBox;
        for (const x of [local.min.x, local.max.x]) for (const y of [local.min.y, local.max.y]) for (const z of [local.min.z, local.max.z]) {
          const delta = point.set(x, y, z).applyMatrix4(mesh.matrixWorld).sub(centre);
          distance = Math.max(distance, delta.dot(direction) + Math.max(Math.abs(delta.dot(right)) / tanX, Math.abs(delta.dot(up)) / tanY) * preset.margin);
        }
      }
      controls.target.copy(centre); camera.position.copy(centre).addScaledVector(direction, Math.max(.3, distance));
      controls.update();
    }
    function refresh({fit = false} = {}) {
      visibility();
      const target = targets.get(selected);
      if (target) {
        box.setFromObject(target.node);
        helper.visible = meshes.some(m => isVisible(m) && isDescendant(m, target.node));
      } else helper.visible = false;
      if (fit || autoFrame) frame();
      render(); onState({progress, selected, isolated, view, focusFamily, focusLabel});
    }
    function resize() {
      const {width, height} = host.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
      if (autoFrame) frame(); render();
    }
    observer = new ResizeObserver(resize); observer.observe(host);
    function keyboard(event) {
      if (event.target !== host) return;
      const offset = camera.position.clone().sub(controls.target), spherical = new THREE.Spherical().setFromVector3(offset);
      if (event.key === 'ArrowLeft') spherical.theta -= .12;
      else if (event.key === 'ArrowRight') spherical.theta += .12;
      else if (event.key === 'ArrowUp') spherical.phi -= .1;
      else if (event.key === 'ArrowDown') spherical.phi += .1;
      else if (event.key === '+' || event.key === '=') spherical.radius *= .9;
      else if (event.key === '-') spherical.radius *= 1.1;
      else if (event.key === 'Home') { event.preventDefault(); autoFrame = true; frame(); render(); return; }
      else return;
      event.preventDefault(); autoFrame = false; spherical.makeSafe();
      spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical)); controls.update(); render();
    }
    host.addEventListener('keydown', keyboard); cleanups.push(() => host.removeEventListener('keydown', keyboard));
    const ray = new THREE.Raycaster(), pointers = new Set(); let down = null, multiTouch = false;
    function pointerDown(e) { pointers.add(e.pointerId); if (pointers.size > 1) multiTouch = true; if (pointers.size === 1) { down = [e.clientX, e.clientY]; multiTouch = false; } }
    function pointerUp(e) {
      pointers.delete(e.pointerId);
      if (e.pointerType === 'mouse' && (e.button !== 0 || controls.mouseButtons.LEFT === THREE.MOUSE.PAN)) { down = null; return; }
      if (multiTouch || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      down = null;
      const b = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1), camera);
      const hit = ray.intersectObject(model.scene, true).find(h => isVisible(h.object));
      const target = hit ? closestTarget(hit.object) : null;
      onSelect(target?.id ?? null);
    }
    const cancelPointer = e => { pointers.delete(e.pointerId); down = null; };
    for (const [type, fn] of [['pointerdown', pointerDown], ['pointerup', pointerUp], ['pointercancel', cancelPointer]]) {
      renderer.domElement.addEventListener(type, fn); cleanups.push(() => renderer.domElement.removeEventListener(type, fn));
    }
    resize(); refresh({fit: true});
    // Let the first requested model frame run before exposing the ready state.
    await new Promise(requestAnimationFrame);
    const metrics = {readyMs: performance.now() - started, meshes: meshes.length, triangles: meshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0), pixelRatio: renderer.getPixelRatio()};
    return {
      manifest, targets, renderer, camera, controls, model, metrics,
      set(value) { progress = explosion.set(value); refresh(); },
      select(id) { selected = targets.has(id) ? id : null; if (!selected) isolated = false; refresh(); },
      focusFamily(id, selectedId) {
        const setting = familyViews[id]; if (!setting) return;
        selected = targets.has(selectedId) ? selectedId : null;
        focusFamily = id; focusLabel = setting.label; focusDirection = setting.direction;
        focusedIds = setting.ids ? new Set(setting.ids) : null;
        isolated = false; view = 'family'; progress = explosion.set(0); autoFrame = true; refresh({fit:true});
      },
      focusPart(id) {
        const target = targets.get(id); if (!target) return;
        selected = id; focusFamily = target.ficheId; focusLabel = target.label;
        focusDirection = familyViews[target.ficheId]?.direction ?? [1,.55,1];
        focusedIds = new Set([id]); isolated = false; view = 'detail'; progress = explosion.set(0); autoFrame = true; refresh({fit:true});
      },
      isolate() { if (!selected) return; isolated = !isolated; autoFrame = true; refresh({fit: true}); },
      view(value) { focusedIds = focusFamily = focusLabel = focusDirection = null; isolated = false; view = value; if (value === 'cabin') progress = explosion.set(0); autoFrame = true; refresh({fit: true}); },
      recenter() { autoFrame = true; refresh({fit: true}); },
      reset() { controls.mouseButtons.LEFT=THREE.MOUSE.ROTATE; focusedIds = focusFamily = focusLabel = focusDirection = null; progress = explosion.set(0); selected = null; isolated = false; view = 'threeQuarter'; autoFrame = true; refresh({fit: true}); },
      setPanMode(value) { controls.mouseButtons.LEFT = value ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE; },
      inspect: () => ({progress, selected, isolated, view, focusFamily, focusLabel, contextLost, metrics, render: {...renderer.info.render}, camera: {position: camera.position.toArray(), target: controls.target.toArray()}}),
      render, resize, dispose,
    };
  } catch (error) { dispose(); throw error; }
}
