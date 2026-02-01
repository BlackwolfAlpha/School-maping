import { map, getProjectionMode, setProjectionMode } from './map-setup.js';
import { loadEducationForView, removeEducationLayers, ensureEducationLayers, addOrUpdateEduLabels, getCurrentEdu } from './education-layers.js';
import { emitStateChanged } from './events.js';

export let eduEnabled = true;
export let showLabels = true;

const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
const rasterStyle = (id, tiles, attribution='') => ({
  version: 8,
  glyphs: GLYPHS_URL,
  sources: { [id]: { type:'raster', tiles:[tiles], tileSize:256, attribution } },
  layers:  [ { id, type:'raster', source:id } ]
});

const satelliteWithLabelsStyle = () => ({
  version: 8,
  glyphs: GLYPHS_URL,
  sources: {
    'esri-imagery': { type:'raster',
      tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize:256, attribution:'Tiles © Esri' },
    'esri-labels': { type:'raster',
      tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize:256, attribution:'Labels © Esri' }
  },
  layers: [
    { id:'esri-imagery', type:'raster', source:'esri-imagery' },
    { id:'esri-labels',  type:'raster', source:'esri-labels' }
  ]
});

export const STYLES = {
  standard: 'https://demotiles.maplibre.org/style.json',
  satellite: satelliteWithLabelsStyle(),
  osm:       rasterStyle('osm','https://tile.openstreetmap.org/{z}/{x}/{y}.png','© OpenStreetMap contributors')
};

export function setBase(name){
  const s = STYLES[name];
  if (!s) return;
  map.setStyle(s);
  document.querySelectorAll('[data-style]').forEach(b=>b.classList.toggle('active', b.dataset.style===name));
  map.once('style.load', () => {
    try { map.setProjection(getProjectionMode()); } catch {}
    try { map.setFog({ range:[0.8,10], color:'white', 'horizon-blend':0.2 }); } catch {}
    try { map.setSky({ 'sky-type':'atmosphere', 'sky-atmosphere-sun-intensity':10 }); } catch {}

    if (eduEnabled) ensureEducationLayers(getCurrentEdu());
    if (showLabels) addOrUpdateEduLabels();
    if (eduEnabled) loadEducationForView();
    emitStateChanged();
  });
}

export function setupControls(){
  // Projection
  document.querySelectorAll('[data-proj]').forEach(btn=>{
    btn.onclick = () => {
      setProjectionMode(btn.dataset.proj);
      document.querySelectorAll('[data-proj]').forEach(b=>b.classList.toggle('active', b===btn));
      writemitStateChangedeHash();
    };
  });

  // Base style
  document.querySelectorAll('[data-style]').forEach(btn=>{
    btn.onclick = () => setBase(btn.dataset.style);
  });

  // Toggles
  const $toggleEdu = document.getElementById('toggle-edu');
  const $toggleLabels = document.getElementById('toggle-labels');

  if ($toggleEdu) {
    $toggleEdu.onclick = () => {
      setEduEnabledState(!$toggleEdu.classList.contains('active'));
      emitStateChanged();
    };
  }
  if ($toggleLabels) {
    $toggleLabels.onclick = () => {
      setShowLabelsState(!$toggleLabels.classList.contains('active'));
      emitStateChanged();
    };
  }
}

export function setEduEnabledState(v){
  eduEnabled = !!v;
  document.getElementById('toggle-edu')?.classList.toggle('active', eduEnabled);
  if (!eduEnabled) removeEducationLayers();
  else loadEducationForView();
}
export function setShowLabelsState(v){
  showLabels = !!v;
  document.getElementById('toggle-labels')?.classList.toggle('active', showLabels);
  if (showLabels) addOrUpdateEduLabels();
  else if (map.getLayer('edu-labels')) map.removeLayer('edu-labels');
}
