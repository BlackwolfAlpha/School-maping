import { setupMap, map } from './map-setup.js';
import { setupControls } from './ui-controls.js';
import { setupEducationLayers, loadEducationForView } from './education-layers.js';
import { writeHash, readHash } from './hash-sync.js';
import { bus } from './events.js';

import { bindMunicipalInfoPopups } from './municipal-info.js';
import { addMunicipalBoundaries } from './municipal-boundaries.js';

import { setupSideMenu } from './side-menu.js';

function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

setupMap();
setupControls();
setupEducationLayers();

bus.addEventListener('statechanged', () => {
  writeHash();
});

map.on('load', async () => {
  readHash();
  loadEducationForView();
  writeHash();

  const muni = addMunicipalBoundaries(map, {
    url: './data/municipal_boundaries.geojson'
  });

  await bindMunicipalInfoPopups(map, {
    htmlPath: './data/מחלקות נוער.html',
    layerId: muni.fillLayerId,
    featureKey: 'name',
    sheetKey: 'name'
  });

  await setupSideMenu(map, {
    htmlPath: './data/מחלקות נוער.html',
    muniGeojsonUrl: './data/municipal_boundaries.geojson',
    featureKey: 'name'
  });

});

const onMoveEnd = debounce(() => {
  loadEducationForView();
  writeHash();
}, 200);

map.on('moveend', onMoveEnd);

export { map, writeHash };
