import {preferredTargets} from './scene/model-map.js';
import {setupExploration} from './exploration.js';

const $ = selector => document.querySelector(selector);
const articles = [...document.querySelectorAll('.paper article')];
const ids = new Set(articles.map(a => a.id));
const modeLink = $('#mode'), status = $('#scene-state'), loading = $('#loading');
const panel = $('#fiche-panel'), familyIds = [...document.querySelectorAll('[data-fiche]')].map(a => a.dataset.fiche);
let studio = null, loadingPromise = null, reading = new URL(location.href).searchParams.get('mode') === 'lecture';
let fiche = 'overview', selectedPart = null, lastTrigger = null, failed = false, failureReason = null;
let exploration;

function showFiche(id, {focus = false} = {}) {
  const previous = fiche;
  fiche = ids.has(id) ? id : 'overview';
  for (const article of articles) article.hidden = article.id !== fiche;
  document.querySelectorAll('[data-fiche]').forEach(a => a.setAttribute('aria-current', String(a.dataset.fiche === fiche)));
  $('#close-fiche').hidden = fiche === 'overview';
  const familyIndex = familyIds.indexOf(fiche), open = fiche !== 'overview';
  $('#paper-label').textContent = open ? `FICHE ${String(familyIndex + 1).padStart(2, '0')} / 08` : 'LA VOITURE EN DÉTAIL';
  $('#previous-fiche').hidden = $('#next-fiche').hidden = !open;
  panel.hidden = !reading && !open;
  document.body.classList.toggle('fiche-open', !reading && open);
  if (reading) { panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); }
  else { panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false'); }
  panel.setAttribute('aria-labelledby', open ? `title-${fiche}` : 'library-title');
  if (previous !== fiche) panel.scrollTop = 0;
  document.title = fiche === 'overview' ? 'Model S 75D — Explorer la voiture' : `${$('#' + fiche + ' h2').textContent} · Model S 75D`;
  if (focus) {
    const article = document.getElementById(fiche);
    article.focus({preventScroll: true});
    if (reading && matchMedia('(max-width: 760px)').matches) article.scrollIntoView({block: 'start', behavior: 'instant'});
  }
}
function address(id, part = null) {
  const next = id === 'overview' ? '' : `#${id}${part ? '/' + encodeURIComponent(part) : ''}`;
  if (location.hash !== next) history.pushState(null, '', location.pathname + location.search + next);
}
function chooseFiche(id, {part, focus = false, updateURL = true, navigation = part === undefined ? 'family' : 'keep', guided = false} = {}) {
  if (!guided) {exploration?.closeBoard({focus:false});exploration?.free();}
  const valid = ids.has(id) ? id : 'overview';
  selectedPart = part === undefined ? preferredTargets[valid] ?? null : part;
  if (studio && selectedPart && studio.targets.get(selectedPart)?.ficheId !== valid) selectedPart = null;
  if (studio) {
    if (!reading && navigation === 'family') studio.focusFamily(valid, selectedPart);
    else if (!reading && navigation === 'part' && selectedPart) studio.focusPart(selectedPart);
    else studio.select(selectedPart);
  }
  showFiche(valid, {focus});
  if (valid === 'charging') {
    $('#part-note').textContent = 'Recharge : fiche documentaire, sans pièce isolée dans ce modèle.';
    $('#panel-part').textContent = 'Fiche documentaire · aucune pièce dédiée';
  }
  if (updateURL) address(valid, selectedPart);
}
function fromAddress() {
  const [id, rawPart] = location.hash.slice(1).split('/');
  let part;
  try { part = rawPart ? decodeURIComponent(rawPart) : undefined; } catch { part = undefined; }
  chooseFiche(id || 'overview', {part, updateURL: false, navigation: part ? 'part' : 'family'});
}
function closeFiche() {
  // Closing the text preserves the exact 3D selection, isolation and camera.
  showFiche('overview'); address('overview');
  if (lastTrigger?.isConnected && !lastTrigger.closest('[hidden]')) lastTrigger.focus({preventScroll: true});
  else if (!reading) $('#viewport').focus({preventScroll: true});
  else document.querySelector('[data-fiche]').focus({preventScroll: true});
}
function changeReading(value) {
  if (reading !== value) {exploration?.closeBoard({focus:false});exploration?.free();}
  reading = value; document.body.classList.toggle('reading', reading);
  const url = new URL(location.href);
  if (reading) url.searchParams.set('mode', 'lecture'); else url.searchParams.delete('mode');
  history.replaceState(null, '', url);
  modeLink.textContent = reading ? 'Revenir à la 3D ↗' : 'Lire sans 3D ↗';
  modeLink.href = reading ? '?'+new URLSearchParams([...url.searchParams].filter(([key]) => key !== 'mode')) + url.hash : '?mode=lecture'+url.hash;
  $('#board-close').textContent=reading?'Retour aux fiches':'Retour à la voiture';
  document.querySelectorAll('.return-car').forEach(b => { b.textContent = reading ? 'Retour aux ensembles' : 'Retour à la voiture'; });
  showFiche(fiche);
  if (!reading) { if (studio) studio.resize(); else startScene(); }
}
modeLink.addEventListener('click', e => { e.preventDefault(); changeReading(!reading); });
document.querySelectorAll('.return-car').forEach(b => { b.hidden = false; b.addEventListener('click', () => {
  closeFiche(); if (!reading) { $('#viewport').focus({preventScroll: true}); $('#viewport').scrollIntoView({block: 'center'}); }
}); });
$('#close-fiche').addEventListener('click', closeFiche);
function adjacentFiche(step) {
  const index = familyIds.indexOf(fiche);
  chooseFiche(familyIds[(index + step + familyIds.length) % familyIds.length], {focus: true});
}
$('#previous-fiche').addEventListener('click', () => adjacentFiche(-1));
$('#next-fiche').addEventListener('click', () => adjacentFiche(1));
document.addEventListener('click', e => {
  const link = e.target.closest('a[href^="#"]');
  if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const id = link.getAttribute('href').slice(1);
  if (!ids.has(id)) return;
  e.preventDefault(); lastTrigger = link; chooseFiche(id, {focus: true});
});
window.addEventListener('hashchange', fromAddress);
window.addEventListener('popstate', () => { changeReading(new URL(location.href).searchParams.get('mode') === 'lecture'); fromAddress(); });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && fiche !== 'overview') { e.preventDefault(); closeFiche(); }
});
function updateSceneState(state) {
  $('#separation').value = String(Math.round(state.progress * 100));
  $('#percent').textContent = `${Math.round(state.progress * 100)} %`;
  $('#labels').setAttribute('aria-pressed',String(state.labelsEnabled));
  $('#part').value = state.selected || '';
  $('#isolate').disabled = !state.selected;
  $('#show-fiche').disabled = !state.selected;
  $('#isolate').setAttribute('aria-pressed', String(state.isolated));
  $('#isolate').textContent = state.isolated ? 'Revenir à l’ensemble' : 'Isoler la pièce';
  $('#panel-isolate').disabled = !state.selected;
  $('#panel-isolate').textContent = state.isolated ? 'Revenir à l’ensemble' : 'Isoler la pièce';
  $('#panel-isolate').setAttribute('aria-pressed', String(state.isolated));
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view && !state.isolated)));
  const target = studio?.targets.get(state.selected);
  $('#panel-part').textContent = target?.label ?? 'Choisissez une pièce de la voiture.';
  status.textContent = state.isolated ? 'Pièce isolée' : state.focusLabel ? state.focusLabel + (state.progress ? ` · éclaté ${Math.round(state.progress*100)} %` : '') : state.view === 'technical' ? 'Châssis schématique' : state.view === 'underbody' ? 'Dessous · finition intégrée estimée' : state.view === 'cabin' ? 'Habitacle · carrosserie masquée' : state.progress === 0 ? 'Voiture assemblée' : `Voiture éclatée · ${Math.round(state.progress * 100)} %`;
  $('#part-note').textContent = target ? `${target.label} · ${target.note}` : 'Cliquer sur une pièce ou choisir un ensemble dans la liste.';
}
function failScene(error) {
  failureReason = error.message;
  failed = true; status.textContent = 'Vue 3D indisponible'; loading.hidden = false;
  loading.replaceChildren();
  const title = document.createElement('p'); title.textContent = 'La voiture en 3D n’a pas pu être affichée.';
  const note = document.createElement('p'); note.className = 'small';
  note.textContent = error.message?.startsWith('Le chargement dépasse') || error.message?.startsWith('Le contexte graphique')
    ? error.message : /WebGL|context/i.test(error.message || '')
      ? 'Votre navigateur ne permet pas cet affichage 3D. Les fiches restent disponibles.'
      : 'Le modèle n’est pas accessible pour le moment. Réessayez ou consultez les fiches.';
  const actions = document.createElement('div'); actions.className = 'load-actions';
  const retry = document.createElement('button'); retry.textContent = 'Réessayer la 3D'; retry.addEventListener('click', () => {
    if (studio) { studio.dispose(); studio = null; } loadingPromise = null; startScene();
  });
  const read = document.createElement('button'); read.textContent = 'Continuer sans 3D'; read.addEventListener('click', () => { changeReading(true); $('#library').scrollIntoView({block: 'start'}); });
  actions.append(retry, read); loading.append(title, note, actions);
  document.querySelectorAll('[data-scene],#isolate,#show-fiche,#panel-isolate').forEach(b => { b.disabled = true; });
}
async function startScene() {
  if (loadingPromise || studio) return loadingPromise;
  failed = false; failureReason = null; status.textContent = 'Chargement du modèle…'; loading.hidden = false;
  loading.replaceChildren();
  const message = document.createElement('p'); message.textContent = 'Chargement de la voiture · environ 28 Mo';
  const progress = document.createElement('progress'); progress.setAttribute('aria-label', 'Chargement du modèle');
  const note = document.createElement('p'); note.className = 'small'; note.textContent = 'Les huit fiches sont déjà disponibles.';
  loading.append(message, progress, note);
  loadingPromise = (async () => {
    try {
      const {createStudio} = await import('./scene/studio.js');
      studio = await createStudio($('#viewport'), {
        onSelect(id) { if (!id) { closeFiche(); return; } lastTrigger = $('#viewport'); const target = studio.targets.get(id); chooseFiche(target.ficheId, {part: id, focus: true}); },
        onState: updateSceneState,
        onInteract: () => exploration?.free(),
        onProgress(info) {
          if (info.stage === 'prepare') {message.textContent='Préparation de la scène…';progress.removeAttribute('value');return;}
          if (info.total) {progress.max=info.total;progress.value=info.loaded;message.textContent=`Chargement de la voiture · ${Math.round(info.loaded/info.total*100)} %`;}
          else {progress.removeAttribute('value');message.textContent=`Chargement de la voiture · ${(info.loaded/1e6).toFixed(1).replace('.',',')} Mo reçus`;}
        },
        onContextLost: () => failScene(Error('Le contexte graphique a été perdu. Réessayez ou consultez les fiches.')),
      });
      if (failed) return;
      $('#part').replaceChildren(new Option('Choisir une pièce de la voiture', ''));
      for (const target of studio.targets.values()) {
        const option = document.createElement('option'); option.value = target.id; option.textContent = target.label; $('#part').append(option);
        if (!ids.has(target.ficheId)) throw Error('Une correspondance de fiche manque : ' + target.id);
      }
      loading.hidden = true;
      document.querySelectorAll('[data-scene]').forEach(b => { b.disabled = false; });
      if (exploration?.inspect().tour < 0) fromAddress();
      exploration?.onSceneReady(); studio.resize();
    } catch (error) { failScene(error); }
  })();
  return loadingPromise;
}
$('#separation').addEventListener('input', e => studio?.set(Number(e.target.value) / 100));
$('#explode').addEventListener('click', () => studio.animateTo(1));
$('#assemble').addEventListener('click', () => studio.animateTo(0));
$('#labels').addEventListener('click', () => studio?.setLabels($('#labels').getAttribute('aria-pressed')!=='true'));
$('.scene-controls').addEventListener('click',event=>{if(event.target.closest('button,input,select'))exploration?.free();},{capture:true});
$('.scene-controls').addEventListener('input',()=>exploration?.free(),{capture:true});
$('#reset').addEventListener('click', () => { studio.reset(); $('#pan-mode').setAttribute('aria-pressed','false');$('#pan-mode').textContent='Déplacer';selectedPart = null; closeFiche(); });
$('#recenter').addEventListener('click', () => studio?.recenter());
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => studio?.view(b.dataset.view)));
$('#isolate').addEventListener('click', () => studio?.isolate());
$('#panel-isolate').addEventListener('click', () => studio?.isolate());
$('#pan-mode').addEventListener('click', () => {
  const active = $('#pan-mode').getAttribute('aria-pressed') !== 'true';
  studio?.setPanMode(active); $('#pan-mode').setAttribute('aria-pressed', String(active));
  $('#pan-mode').textContent = active ? 'Revenir à la rotation' : 'Déplacer';
});
$('#show-fiche').addEventListener('click', () => {
  const target = studio?.targets.get(studio.inspect().selected);
  if (target) { lastTrigger = $('#show-fiche'); chooseFiche(target.ficheId, {part: target.id, focus: true}); }
});
$('#part').addEventListener('change', e => {
  const target = studio.targets.get(e.target.value);
  if (target) { lastTrigger = $('#part'); chooseFiche(target.ficheId, {part: target.id, focus: true, navigation:'part'}); }
  else { selectedPart = null; studio.select(null); closeFiche(); }
});
window.addEventListener('pagehide', e => { if (!e.persisted) studio?.dispose(); });
exploration=setupExploration({getStudio:()=>studio,chooseFiche,closeFiche,
  getUI:()=>({fiche,selectedPart,hash:location.hash,pan:$('#pan-mode').getAttribute('aria-pressed')==='true'}),
  restoreUI(saved){selectedPart=saved.selectedPart;showFiche(saved.fiche);history.replaceState(null,'',location.pathname+location.search+saved.hash);$('#pan-mode').setAttribute('aria-pressed',String(saved.pan));$('#pan-mode').textContent=saved.pan?'Revenir à la rotation':'Déplacer';},
});
document.body.classList.add('enhanced');
fromAddress(); changeReading(reading);
// Local diagnostic surface, no data collection or vehicle connection.
window.teslaApp = {get studio() { return studio; }, inspect: () => ({fiche, selectedPart, reading, failed, failureReason, loading: !studio && !failed && !reading, discovery:exploration.inspect(), scene: studio?.inspect() ?? null})};
