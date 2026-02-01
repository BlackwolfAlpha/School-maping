// hash-sync.js
import { map, getProjectionMode, setProjectionMode } from './map-setup.js';
import { setBase, setEduEnabledState, setShowLabelsState } from './ui-controls.js';

const ALLOWED_PROJECTIONS = new Set(['mercator', 'globe']);

export function writeHash() {
  const c = map.getCenter(), z = map.getZoom().toFixed(2);
  const baseBtn = document.querySelector('[data-style].active');

  const proj = getProjectionMode();
  const safeProj = ALLOWED_PROJECTIONS.has(proj) ? proj : 'mercator';

  const params = new URLSearchParams({
    lng: c.lng.toFixed(5),
    lat: c.lat.toFixed(5),
    z,
    proj: safeProj,
    base: baseBtn ? baseBtn.dataset.style : 'standard',
    labels: document.getElementById('toggle-labels')?.classList.contains('active') ? '1' : '0',
    edu: document.getElementById('toggle-edu')?.classList.contains('active') ? '1' : '0'
  });

  const next = params.toString();
  if (location.hash.slice(1) !== next) location.hash = next;
}

export function readHash() {
  if (!location.hash) return;

  const p = new URLSearchParams(location.hash.slice(1));
  const lng = parseFloat(p.get('lng'));
  const lat = parseFloat(p.get('lat'));
  const z = parseFloat(p.get('z'));

  if (isFinite(lng) && isFinite(lat) && isFinite(z)) {
    map.jumpTo({ center: [lng, lat], zoom: z });
  }

  const base = p.get('base');
  if (base) setBase(base);
  const proj = (p.get('proj') || 'mercator').toLowerCase();
  setProjectionMode(ALLOWED_PROJECTIONS.has(proj) ? proj : 'mercator');

  setShowLabelsState(p.get('labels') !== '0');
  setEduEnabledState(p.get('edu') !== '0');

  document.querySelectorAll('[data-proj]').forEach(b =>
    b.classList.toggle('active', b.dataset.proj === getProjectionMode())
  );
}
