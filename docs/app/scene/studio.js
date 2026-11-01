import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadStudioModel} from './model-loader.js';
import {modelURLs, technicalIds, cabinIds} from './model-map.js';
import {viewPresets} from './view-presets.js';
import {familyViews} from './family-views.js';

// Host scene only: B23 already contains all authoring results. Never reconstruct them here.
export async function createStudio(host, {onSelect, onState, onContextLost, onProgress, onInteract = () => {}, modelSource = modelURLs, expectedVersion = 'B23-01'}) {
  const started = performance.now();
  let renderer, observer, environment, controls, model, pendingFrame = 0, animation = null;
  const abort = new AbortController();
  const scene = new THREE.Scene();
  const cleanups = [];
  function dispose() {
    cancelAnimationFrame(pendingFrame);
    animation = null; abort.abort();
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
    scene.environment = environment.texture; scene.environmentIntensity = .68;
    room.dispose(); pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xf4ede5, 0x334251, .85));
    const key = new THREE.DirectionalLight(0xfff4e8, 2.45); key.position.set(3, 5, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0xc5dcf8, 1.0); fill.position.set(-3, 2, -2); scene.add(fill);
    const underfill = new THREE.DirectionalLight(0xe4ebef,.65); underfill.position.set(0,-4,1); scene.add(underfill);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({color: '#13191e'}));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.008; scene.add(ground);
    ground.material.toneMapped = false;
    const shadow = document.createElement('canvas'); shadow.width = shadow.height = 128;
    const ctx = shadow.getContext('2d'), gradient = ctx.createRadialGradient(64,64,12,64,64,64);
    gradient.addColorStop(0,'rgba(0,0,0,.36)'); gradient.addColorStop(.6,'rgba(0,0,0,.19)'); gradient.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=gradient; ctx.fillRect(0,0,128,128);
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(2.8,5.5), new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadow), transparent:true, depthWrite:false, toneMapped:false}));
    contact.rotation.x = -Math.PI / 2; contact.position.y = -.007; scene.add(contact);
    const box = new THREE.Box3(), helper = new THREE.Box3Helper(box, 0xf1c087); helper.visible = false; scene.add(helper);
    let progress = 0, selected = null, isolated = false, view = 'threeQuarter', autoFrame = true, contextLost = false;
    let focusedIds = null, focusFamily = null, focusLabel = null, focusDirection = null;
    let labelsEnabled = false, hover = null;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const labelLayer = document.createElement('div'); labelLayer.className='scene-labels'; labelLayer.setAttribute('aria-hidden','true'); host.append(labelLayer);
    cleanups.push(()=>labelLayer.remove());
    const cancelMotion = () => {animation=null;};
    const draw = now => {
      if (model && !contextLost && host.clientWidth && host.clientHeight) {
        if (animation) advance(now);
        renderer.render(scene, camera); updateLabels();
        if (animation) render();
      }
    };
    const render = () => {
      if (!pendingFrame) pendingFrame = requestAnimationFrame(now => { pendingFrame = 0; draw(now); });
    };
    controls.addEventListener('change', render);
    controls.addEventListener('start', () => { cancelMotion(); autoFrame = false; onInteract(); });
    function lost(event) { event.preventDefault(); contextLost = true; onContextLost(); }
    renderer.domElement.addEventListener('webglcontextlost', lost);
    cleanups.push(() => renderer.domElement.removeEventListener('webglcontextlost', lost));
    let timedOut = false, timeout;
    const loading = loadStudioModel(modelSource.model, modelSource.manifest, {onProgress, signal:abort.signal});
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
    // Some separated parts share a larger position buffer. Only referenced vertices
    // belong to the visible piece; unused vertices must not inflate its framing.
    const geometryBounds = new WeakMap();
    function renderedBox(mesh) {
      const g=mesh.geometry;
      if(!geometryBounds.has(g)){
        const b=new THREE.Box3(),p=new THREE.Vector3(),position=g.attributes.position;
        if(g.index){for(const index of g.index.array)b.expandByPoint(p.fromBufferAttribute(position,index));}
        else {for(let i=0;i<position.count;i++)b.expandByPoint(p.fromBufferAttribute(position,i));}
        geometryBounds.set(g,b);
      }
      return geometryBounds.get(g);
    }
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
        result.union(renderedBox(mesh).clone().applyMatrix4(mesh.matrixWorld));
      }
      return result;
    }
    function fitted(directionOverride = null, centreOverride = null) {
      const b = bounds();
      if (b.isEmpty()) return null;
      const centre = centreOverride ?? b.getCenter(new THREE.Vector3());
      const preset = viewPresets[view] ?? viewPresets.threeQuarter;
      const direction = directionOverride ?? new THREE.Vector3(...(focusDirection ?? preset.direction)).normalize();
      // The UI explicitly identifies the cutaway as bodywork hidden for interior viewing.
      const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();
      const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), tanX = tanY * camera.aspect;
      let distance = 0;
      // Fit each visible mesh box instead of the loose box around the whole car.
      // This removes empty corners while retaining a verified edge margin at every aspect ratio.
      const point = new THREE.Vector3();
      for (const mesh of meshes) if (isVisible(mesh)) {
        const local = renderedBox(mesh);
        for (const x of [local.min.x, local.max.x]) for (const y of [local.min.y, local.max.y]) for (const z of [local.min.z, local.max.z]) {
          const delta = point.set(x, y, z).applyMatrix4(mesh.matrixWorld).sub(centre);
          distance = Math.max(distance, delta.dot(direction) + Math.max(Math.abs(delta.dot(right)) / tanX, Math.abs(delta.dot(up)) / tanY) * preset.margin);
        }
      }
      return {centre, direction, distance:Math.max(.3,distance)};
    }
    function frame() {
      const fit=fitted(); if(!fit)return;
      controls.target.copy(fit.centre); camera.position.copy(fit.centre).addScaledVector(fit.direction,fit.distance);
      controls.update();
    }
    const notify = () => onState({progress, selected, isolated, view, focusFamily, focusLabel, labelsEnabled, animating:!!animation});
    function selectionBox() {
      const target=targets.get(selected);
      box.makeEmpty();
      if(target)for(const m of meshes)if(isVisible(m)&&isDescendant(m,target.node))box.union(renderedBox(m).clone().applyMatrix4(m.matrixWorld));
      helper.visible=!box.isEmpty();
    }
    function advance(now) {
      const a=animation, t=Math.min(1,(now-a.started)/2500), ease=t*t*(3-2*t);
      progress=explosion.set(THREE.MathUtils.lerp(a.from,a.to,ease)); visibility();
      const centre=a.centre.clone().lerp(a.endCentre,ease), fit=fitted(a.direction,centre);
      const distance=Math.max(THREE.MathUtils.lerp(a.distance,a.endDistance,ease),fit?.distance??0);
      controls.target.copy(centre); camera.position.copy(centre).addScaledVector(a.direction,distance); controls.update();
      selectionBox();
      if(t===1){progress=explosion.set(a.to);animation=null;}
      notify();
    }
    function animateTo(value) {
      cancelMotion();
      const from=progress, to=THREE.MathUtils.clamp(value,0,1);
      focusedIds=focusFamily=focusLabel=focusDirection=null; isolated=false; view='threeQuarter'; autoFrame=false;
      if(reducedMotion.matches||from===to){progress=explosion.set(to);autoFrame=true;refresh({fit:true});return;}
      const centre=controls.target.clone(), direction=camera.position.clone().sub(centre).normalize(), distance=camera.position.distanceTo(centre);
      progress=explosion.set(to);visibility();const end=fitted(direction);
      progress=explosion.set(from);visibility();
      animation={from,to,started:performance.now(),centre,direction,distance,endCentre:end.centre,endDistance:end.distance};
      notify(); render();
    }
    const reduceChanged=()=>{if(reducedMotion.matches&&animation){const to=animation.to;cancelMotion();progress=explosion.set(to);autoFrame=true;refresh({fit:true});}};
    reducedMotion.addEventListener('change',reduceChanged);cleanups.push(()=>reducedMotion.removeEventListener('change',reduceChanged));
    function refresh({fit = false} = {}) {
      visibility();
      selectionBox();
      if (fit || autoFrame) frame();
      render(); notify();
    }
    function resize() {
      const {width, height} = host.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
      if (animation) cancelMotion();
      if (autoFrame) frame(); render();
    }
    observer = new ResizeObserver(resize); observer.observe(host);
    function keyboard(event) {
      if (event.target !== host) return;
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(event.key)) return;
      cancelMotion(); onInteract();
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
    function hitAt(x,y) {
      const b=renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((x-b.left)/b.width*2-1,-(y-b.top)/b.height*2+1),camera);
      const hit=ray.intersectObject(model.scene,true).find(h=>isVisible(h.object));
      return hit?closestTarget(hit.object):null;
    }
    const labelNodes = new Map();
    function updateLabels() {
      const coarse=matchMedia('(pointer: coarse)').matches;
      const ids=coarse?[selected]:[selected,...(labelsEnabled?['battery','motorFront','motorRear','seatDriver','centerDisplay','forwardCameras','roof','wheel0']:[]),hover];
      const wanted=[...new Set(ids.filter(Boolean))],rectangles=[];
      for(const [id,el]of labelNodes)el.hidden=true;
      camera.updateMatrixWorld();
      for(const id of wanted){
        const target=targets.get(id);if(!target)continue;
        const visible=meshes.filter(m=>isVisible(m)&&isDescendant(m,target.node));if(!visible.length)continue;
        const b=new THREE.Box3();for(const m of visible)b.union(renderedBox(m).clone().applyMatrix4(m.matrixWorld));
        const p=b.getCenter(new THREE.Vector3()).project(camera);
        if(Math.abs(p.x)>.9||Math.abs(p.y)>.9||p.z>1||p.z< -1)continue;
        const screen=renderer.domElement.getBoundingClientRect();
        // A centre hidden by another ensemble should not receive a floating label.
        const occluder=hitAt(screen.left+(p.x*.5+.5)*screen.width,screen.top+(-p.y*.5+.5)*screen.height);
        if(occluder&&occluder.id!==id&&!isDescendant(occluder.node,target.node))continue;
        let el=labelNodes.get(id);
        if(!el){el=document.createElement('span');el.className='scene-label';el.textContent=target.label;labelNodes.set(id,el);labelLayer.append(el);}
        el.hidden=false;el.style.left=`${(p.x*.5+.5)*100}%`;el.style.top=`${(-p.y*.5+.5)*100}%`;
        const r=el.getBoundingClientRect();
        if(r.left<screen.left+4||r.right>screen.right-4||rectangles.some(q=>r.left<q.right+6&&r.right>q.left-6&&r.top<q.bottom+6&&r.bottom>q.top-6)){el.hidden=true;continue;}
        rectangles.push(r);
      }
    }
    function pointerDown(e) { pointers.add(e.pointerId); if (pointers.size > 1) multiTouch = true; if (pointers.size === 1) { down = [e.clientX, e.clientY]; multiTouch = false; } }
    function pointerUp(e) {
      pointers.delete(e.pointerId);
      if (e.pointerType === 'mouse' && (e.button !== 0 || controls.mouseButtons.LEFT === THREE.MOUSE.PAN)) { down = null; return; }
      if (multiTouch || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      down = null;
      cancelMotion();onInteract();
      const target = hitAt(e.clientX,e.clientY);
      onSelect(target?.id ?? null);
    }
    const cancelPointer = e => { pointers.delete(e.pointerId); down = null; };
    const movePointer=e=>{if(e.pointerType==='touch'||e.buttons)return;const id=hitAt(e.clientX,e.clientY)?.id??null;if(id!==hover){hover=id;renderer.domElement.style.cursor=id?'pointer':'grab';render();}};
    const leavePointer=()=>{hover=null;render();};
    for (const [type, fn] of [['pointerdown', pointerDown], ['pointerup', pointerUp], ['pointercancel', cancelPointer], ['pointermove',movePointer], ['pointerleave',leavePointer]]) {
      renderer.domElement.addEventListener(type, fn); cleanups.push(() => renderer.domElement.removeEventListener(type, fn));
    }
    resize(); refresh({fit: true});
    // Let the first requested model frame run before exposing the ready state.
    await new Promise(requestAnimationFrame);
    const metrics = {readyMs: performance.now() - started, ...model.timings, meshes: meshes.length, triangles: meshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0), pixelRatio: renderer.getPixelRatio()};
    return {
      manifest, targets, renderer, camera, controls, model, metrics,
      set(value) { cancelMotion(); progress = explosion.set(value); refresh(); },
      animateTo,
      select(id) { cancelMotion(); selected = targets.has(id) ? id : null; if (!selected) isolated = false; refresh(); },
      focusFamily(id, selectedId) {
        cancelMotion();
        const setting = familyViews[id]; if (!setting) return;
        selected = targets.has(selectedId) ? selectedId : null;
        focusFamily = id; focusLabel = setting.label; focusDirection = setting.direction;
        focusedIds = setting.ids ? new Set(setting.ids) : null;
        isolated = false; view = 'family'; progress = explosion.set(0); autoFrame = true; refresh({fit:true});
      },
      focusPart(id) {
        cancelMotion();
        const target = targets.get(id); if (!target) return;
        selected = id; focusFamily = target.ficheId; focusLabel = target.label;
        focusDirection = familyViews[target.ficheId]?.direction ?? [1,.55,1];
        focusedIds = new Set([id]); isolated = false; view = 'detail'; progress = explosion.set(0); autoFrame = true; refresh({fit:true});
      },
      isolate() { cancelMotion(); if (!selected) return; isolated = !isolated; autoFrame = true; refresh({fit: true}); },
      view(value) { cancelMotion(); focusedIds = focusFamily = focusLabel = focusDirection = null; isolated = false; view = value; if (value === 'cabin') progress = explosion.set(0); autoFrame = true; refresh({fit: true}); },
      recenter() { cancelMotion(); autoFrame = true; refresh({fit: true}); },
      reset() { cancelMotion(); controls.mouseButtons.LEFT=THREE.MOUSE.ROTATE; focusedIds = focusFamily = focusLabel = focusDirection = null; progress = explosion.set(0); selected = null; isolated = false; view = 'threeQuarter'; autoFrame = true; refresh({fit: true}); },
      setPanMode(value) { cancelMotion(); controls.mouseButtons.LEFT = value ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE; },
      setLabels(value) { labelsEnabled=!!value;render();notify(); },
      snapshot: () => ({progress,selected,isolated,view,autoFrame,focusedIds:focusedIds?[...focusedIds]:null,focusFamily,focusLabel,focusDirection,labelsEnabled,pan:controls.mouseButtons.LEFT===THREE.MOUSE.PAN,position:camera.position.toArray(),target:controls.target.toArray()}),
      restore(s) { cancelMotion();progress=explosion.set(s.progress);selected=s.selected;isolated=s.isolated;view=s.view;focusedIds=s.focusedIds?new Set(s.focusedIds):null;focusFamily=s.focusFamily;focusLabel=s.focusLabel;focusDirection=s.focusDirection;labelsEnabled=s.labelsEnabled;controls.mouseButtons.LEFT=s.pan?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;autoFrame=false;refresh();camera.position.fromArray(s.position);controls.target.fromArray(s.target);controls.update();autoFrame=s.autoFrame;render(); },
      inspect: () => ({progress, selected, isolated, view, focusFamily, focusLabel, labelsEnabled, animating:!!animation, contextLost, metrics, render: {...renderer.info.render}, camera: {position: camera.position.toArray(), target: controls.target.toArray()}}),
      render, resize, dispose,
    };
  } catch (error) { dispose(); throw error; }
}
