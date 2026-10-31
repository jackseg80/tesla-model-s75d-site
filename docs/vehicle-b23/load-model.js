import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Supply URLs exposed by the host project. No dependency on the inspection bench.
export async function loadTeslaModel(modelURL,manifestURL){
 const [gltf,response]=await Promise.all([new GLTFLoader().loadAsync(modelURL),fetch(manifestURL)]);
 if(!response.ok)throw Error('Vehicle manifest unavailable');
 const manifest=await response.json();
 return{scene:gltf.scene,manifest,explosion:createTeslaExplosion(gltf.scene,manifest)};
}

export function createTeslaExplosion(scene,manifest){
 const nodes=new Map();scene.traverse(node=>{const id=node.userData.selectionId;if(id){if(nodes.has(id))throw Error('Duplicate selection '+id);nodes.set(id,node);}});
 const targets=manifest.targets.map(t=>{const node=nodes.get(t.id);if(!node)throw Error('Missing selection '+t.id);return{...t,node,rest:new THREE.Vector3(...t.rest),offset:new THREE.Vector3(...t.offset)};});
 function set(value){if(!Number.isFinite(value))throw Error('Explosion progress must be finite');const t=THREE.MathUtils.clamp(value,0,1);for(const target of targets)target.node.position.copy(target.rest).addScaledVector(target.offset,THREE.MathUtils.smoothstep(t,...target.stage));scene.traverse(m=>{if(!m.isMesh)return;let id;for(let n=m;n;n=n.parent)if(n.userData.selectionId){id=n.userData.selectionId;break;}if(['battery','motorFront','motorRear','subframeFront','subframeRear'].includes(id))m.visible=t>0||m.userData.integratedUnderbody===true;});scene.updateMatrixWorld(true);return t;}
 set(0);return{set,targets,getNode:id=>nodes.get(id)??null};
}
