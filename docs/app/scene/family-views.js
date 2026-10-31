import {cabinIds, technicalIds} from './model-map.js';
// Information navigation explicitly reveals its subject, independently of the last preset.
export const familyViews = {
  battery: {label:'Batterie', ids:['battery'], direction:[1,.55,1]},
  powertrain: {label:'Deux moteurs', ids:['motorFront','motorRear'], direction:[1,.65,1]},
  seats: {label:'Sièges et habitacle', ids:[...cabinIds], direction:[.7,.95,-1.15]},
  infotainment: {label:'Écrans et tableau de bord', ids:['dashboard','steering','centerDisplay','instrumentDisplay','console'], direction:[.25,.28,-1.2]},
  'driver-assistance': {label:'Caméras au pare-brise · forme schématique', ids:['forwardCameras'], direction:[.7,.35,-1]},
  charging: {label:'Recharge · fiche documentaire', ids:null, direction:[1,.58,1.15]},
  'body-roof': {label:'Carrosserie et toit plein', ids:null, direction:[1,.8,1.15]},
  'wheels-suspension': {label:'Roues, freins et suspensions', ids:[...technicalIds].filter(id=>!['battery','motorFront','motorRear'].includes(id)).concat(['wheel0','wheel1','wheel2','wheel3']), direction:[1,.55,1]},
};
