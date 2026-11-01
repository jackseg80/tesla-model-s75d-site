// Guided discovery only coordinates existing views and reviewed static content.
export function setupExploration({getStudio, getUI, restoreUI, closeFiche, chooseFiche}) {
  const $=s=>document.querySelector(s), panel=$('#tour-panel'), board=$('#parts-board');
  const steps=[...panel.querySelectorAll('[data-tour-step]')], cards=[...board.querySelectorAll('[data-part-card]')];
  let index=-1, saved=null, boardSaved=null, boardScroll=0;
  const status=text=>{$('#exploration-status').textContent=text;};
  function free() {
    if(index<0)return;
    index=-1;saved=null;panel.hidden=true;$('#tour-start').setAttribute('aria-pressed','false');status('Exploration libre.');
  }
  function showStep(value) {
    index=value;closeFiche();
    steps.forEach((el,i)=>el.hidden=i!==index);
    const family=steps[index].dataset.family, studio=getStudio();
    if(studio)studio.focusFamily(family,null);
    $('#tour-prev').disabled=index===0;$('#tour-next').disabled=index===steps.length-1;
    status(`Visite guidée · étape ${index+1} sur ${steps.length}`);
    steps[index].querySelector('h2').focus({preventScroll:true});
    if(studio)document.querySelector('#viewport').scrollIntoView({block:'center'});
  }
  function closeBoard({focus=true}={}) {
    if(board.hidden)return;
    board.hidden=true;document.body.classList.remove('board-open');
    const old=boardSaved;boardSaved=null;
    if(old){restoreUI(old.ui);if(old.scene)getStudio()?.restore(old.scene);}
    window.scrollTo(0,boardScroll);
    if(focus)$('#board-open').focus({preventScroll:true});
  }
  $('#explore-tools').hidden=false;
  $('#tour-start').addEventListener('click',()=>{
    closeBoard({focus:false});if(index>=0)return;
    saved={ui:getUI(),scene:getStudio()?.snapshot()??null};
    panel.hidden=false;$('#tour-start').setAttribute('aria-pressed','true');showStep(0);
  });
  $('#tour-prev').addEventListener('click',()=>{if(index>0)showStep(index-1);});
  $('#tour-next').addEventListener('click',()=>{if(index<steps.length-1)showStep(index+1);});
  $('#tour-exit').addEventListener('click',()=>{
    const old=saved;free();
    if(old){restoreUI(old.ui);if(old.scene)getStudio()?.restore(old.scene);}
    status('Exploration précédente rétablie.');$('#tour-start').focus({preventScroll:true});
  });
  panel.querySelectorAll('[data-tour-fiche]').forEach(button=>button.addEventListener('click',()=>chooseFiche(button.dataset.tourFiche,{part:null,navigation:'keep',guided:true,focus:true})));
  $('#board-open').addEventListener('click',()=>{
    free();boardScroll=scrollY;boardSaved={ui:getUI(),scene:getStudio()?.snapshot()??null};
    if(boardSaved.scene)getStudio().set(boardSaved.scene.progress);
    board.hidden=false;document.body.classList.add('board-open');closeFiche();filter();
    $('#board-title').focus();board.scrollIntoView({block:'start'});
  });
  $('#board-close').addEventListener('click',()=>closeBoard());
  const normalize=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr');
  function filter(){
    const q=normalize($('#board-search').value.trim()),family=$('#board-family').value;
    let count=0;
    for(const card of cards){card.hidden=!!((family&&card.dataset.family!==family)||!normalize(card.dataset.name).includes(q));if(!card.hidden)count++;}
    $('#board-count').textContent=`${count} pièce${count===1?'':'s'} sur 42`;$('#board-empty').hidden=count!==0;
  }
  $('#board-search').addEventListener('input',filter);$('#board-family').addEventListener('change',filter);
  cards.forEach(card=>card.addEventListener('click',()=>{
    const id=card.dataset.partCard,family=card.dataset.family;closeBoard({focus:false});
    chooseFiche(family,{part:id,navigation:'part',focus:true});
  }));
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    if(!board.hidden){event.preventDefault();closeBoard();}
    else if(index>=0){event.preventDefault();$('#tour-exit').click();}
  });
  return {free, closeBoard, onSceneReady(){
    const previous=index>=0?saved:boardSaved;
    if(previous&&!previous.scene){
      chooseFiche(previous.ui.fiche,{part:previous.ui.selectedPart,navigation:previous.ui.selectedPart?'part':'family',guided:true,updateURL:false});
      previous.scene=getStudio().snapshot();closeFiche();
    }
    if(index>=0)getStudio()?.focusFamily(steps[index].dataset.family,null);
  },inspect:()=>({tour:index,board:!board.hidden})};
}
