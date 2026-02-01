import { map } from './map-setup.js';
import { eduEnabled, showLabels } from './ui-controls.js';

const EDU_SOURCE_ID = 'education';
const EDU_CLUSTER_LAYER = 'edu-clusters';
const EDU_CLUSTER_COUNT = 'edu-cluster-count';
const EDU_POINTS_LAYER = 'edu-points';
const EDU_LABELS_LAYER = 'edu-labels';

let currentEduGeoJSON = { type: 'FeatureCollection', features: [] };
let filteredEduGeoJSON = { type: 'FeatureCollection', features: [] };

let eventsBound = false;
let loadTimer = null;
let inflightController = null;

// Cache with TTL + size cap (simple LRU-ish)
const bboxCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX = 25;

function showLoading(v){
  const el = document.getElementById('loading');
  if (el) el.style.display = v ? 'block' : 'none';
}

function showToast(msg){
  const toast = document.getElementById('toast');
  if (!toast) return alert(msg);
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(()=> toast.style.display = 'none', 2000);
}

// ----------------------------
// Security helpers (XSS-safe)
// ----------------------------
function esc(s=''){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#39;");
}

function safeUrl(u=''){
  u = String(u).trim();
  if (!u) return '';
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  // Block other schemes like javascript:, data:, etc.
  if (/^\w+:/i.test(u)) return '';
  // Many OSM websites are stored without scheme
  return 'https://' + u;
}

function safeTel(t=''){
  t = String(t).trim();
  // Allow digits, +, -, spaces, parentheses
  return t.replace(/[^\d+\-()\s]/g, '').trim();
}

function safeEmail(e=''){
  e = String(e).trim();
  // Minimal sanity check
  if (!e.includes('@') || e.length > 200) return '';
  return e;
}

// ----------------------------
// Overpass endpoints (mirrors)
// ----------------------------
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter'
];

// More precise cache key (includes zoom)
function bboxKey(b){
  const z = Math.round(map.getZoom() * 10) / 10;
  const r = x => Math.round(x * 200) / 200; // ~0.005 deg precision
  return `${z}:${[r(b.getSouth()), r(b.getWest()), r(b.getNorth()), r(b.getEast())].join(',')}`;
}

function cacheSet(key, gj){
  bboxCache.set(key, { gj, t: Date.now() });

  // Cap size: delete oldest entry
  if (bboxCache.size > CACHE_MAX){
    let oldestKey = null;
    let oldestT = Infinity;
    for (const [k, v] of bboxCache.entries()){
      if (v.t < oldestT){ oldestT = v.t; oldestKey = k; }
    }
    if (oldestKey) bboxCache.delete(oldestKey);
  }
}

function cacheGet(key){
  const hit = bboxCache.get(key);
  if (!hit) return null;

  // TTL check
  if ((Date.now() - hit.t) > CACHE_TTL_MS){
    bboxCache.delete(key);
    return null;
  }

  // Bump recency (simple LRU-ish)
  bboxCache.delete(key);
  bboxCache.set(key, hit);
  return hit.gj;
}

// ----------------------------
// Fetch education features via Overpass
// ----------------------------
async function fetchEducationGeoJSON(bbox, signal){
  const [s,w,n,e] = bbox;

  // Better coverage: amenity list + school=* ways/relations
  const query = `
[out:json][timeout:45];
(
  node["amenity"~"^(school|kindergarten|college|university|music_school|language_school|driving_school)$"](${s},${w},${n},${e});
  way["amenity"~"^(school|kindergarten|college|university|music_school|language_school|driving_school)$"](${s},${w},${n},${e});
  relation["amenity"~"^(school|kindergarten|college|university|music_school|language_school|driving_school)$"](${s},${w},${n},${e});

  way["school"](${s},${w},${n},${e});
  relation["school"](${s},${w},${n},${e});
);
out center tags;
  `.trim();

  let lastErr;
  for (const url of OVERPASS_ENDPOINTS){
    try{
      const res = await fetch(url, {
        method:'POST',
        headers:{ 'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ data: query }),
        signal
      });

      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }

      const data = await res.json();

      const features = (data.elements || []).map(el=>{
        const coords =
          el.type === 'node'
            ? [el.lon, el.lat]
            : [el.center?.lon, el.center?.lat];

        if (!coords || coords[0]==null || coords[1]==null) return null;

        // Normalize amenity when only school=* exists
        const tags = el.tags || {};
        const amenity = tags.amenity || (tags.school ? 'school' : undefined);

        // IMPORTANT: Keep properties flat strings for MapLibre style expressions
        return {
          type:'Feature',
          geometry:{ type:'Point', coordinates: coords },
          properties: {
            ...(tags),
            amenity,
            id: `${el.type}/${el.id}`
          }
        };
      }).filter(Boolean);

      return { type:'FeatureCollection', features };
    }catch(e){
      lastErr = e;
    }
  }

  throw lastErr || new Error('Overpass failed');
}

// ----------------------------
// Layers management
// ----------------------------
export function removeEducationLayers(){
  [EDU_LABELS_LAYER, EDU_CLUSTER_COUNT, EDU_CLUSTER_LAYER, EDU_POINTS_LAYER].forEach(id=>{
    if (map.getLayer(id)) map.removeLayer(id);
  });
  if (map.getSource(EDU_SOURCE_ID)) map.removeSource(EDU_SOURCE_ID);
}

export function clearEducationData(){
  removeEducationLayers();
  currentEduGeoJSON = { type:'FeatureCollection', features: [] };
  filteredEduGeoJSON = { type:'FeatureCollection', features: [] };

  if (loadTimer){ clearTimeout(loadTimer); loadTimer = null; }
  if (inflightController){ inflightController.abort(); inflightController = null; }
  bboxCache.clear();
}

// Add base layers (clusters + count + points)
function addEduLayers(){
  if (map.getLayer(EDU_CLUSTER_LAYER)) return;

  map.addLayer({
    id: EDU_CLUSTER_LAYER,
    type: 'circle',
    source: EDU_SOURCE_ID,
    filter: ['has','point_count'],
    paint: {
      'circle-color': ['step', ['get','point_count'], '#38BDF8', 20, '#22C55E', 100, '#7C3AED'],
      'circle-radius': ['step', ['get','point_count'], 14, 20, 18, 100, 24],
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 2
    }
  });

  map.addLayer({
    id: EDU_CLUSTER_COUNT,
    type: 'symbol',
    source: EDU_SOURCE_ID,
    filter: ['has','point_count'],
    layout: { 'text-field': ['to-string',['get','point_count']], 'text-size': 12 },
    paint: { 'text-color': '#000' }
  });

  map.addLayer({
    id: EDU_POINTS_LAYER,
    type: 'circle',
    source: EDU_SOURCE_ID,
    filter: ['!',['has','point_count']],
    paint: {
      'circle-radius': 6,
      'circle-color': '#7C3AED',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff'
    }
  });

  if (showLabels) addOrUpdateEduLabels();
}

// Ensure source exists; if exists => setData only (stable + fast)
export function ensureEducationLayers(geojson = currentEduGeoJSON){
  if (!geojson) return;
  currentEduGeoJSON = geojson;

  const src = map.getSource(EDU_SOURCE_ID);

  if (src){
    // Keep source data consistent (will be overridden by applyAmenityFilter)
    src.setData(geojson);
  } else {
    map.addSource(EDU_SOURCE_ID, {
      type: 'geojson',
      data: geojson,
      cluster: true,
      clusterRadius: 45,
      clusterMaxZoom: 16
    });
    addEduLayers();
  }

  if (!eventsBound) bindEvents();

  // IMPORTANT: rebuild filtered data so clusters match the selection
  applyAmenityFilter();
}

export function addOrUpdateEduLabels(){
  if (map.getLayer(EDU_LABELS_LAYER)) map.removeLayer(EDU_LABELS_LAYER);
  if (!map.getSource(EDU_SOURCE_ID)) return;

  // NOTE: Do NOT fall back to "amenity" here.
  // If no name exists, we prefer showing nothing instead of "school".
  map.addLayer({
    id: EDU_LABELS_LAYER,
    type: 'symbol',
    source: EDU_SOURCE_ID,
    filter: ['!',['has','point_count']],
    minzoom: 12,
    layout: {
      'text-field': [
        'coalesce',
        ['get','name:he'],
        ['get','name'],
        ['get','official_name:he'],
        ['get','official_name'],
        ['get','short_name:he'],
        ['get','short_name'],
        ['get','alt_name:he'],
        ['get','alt_name'],
        ['get','operator'],
        ['get','brand'],
        ['get','ref'],
        '' // if nothing exists -> show nothing
      ],
      'text-size': 11,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-optional': true
    },
    paint: { 'text-color': '#111', 'text-halo-color': '#fff', 'text-halo-width': 1.2 }
  });
}

// ----------------------------
// Map events
// ----------------------------
function bindEvents(){
  map.on('click', EDU_CLUSTER_LAYER, onClusterClick);
  map.on('click', EDU_POINTS_LAYER,  onPointClick);

  map.on('mouseenter', EDU_CLUSTER_LAYER, ()=> map.getCanvas().style.cursor='pointer');
  map.on('mouseleave', EDU_CLUSTER_LAYER, ()=> map.getCanvas().style.cursor='');
  map.on('mouseenter', EDU_POINTS_LAYER, ()=> map.getCanvas().style.cursor='pointer');
  map.on('mouseleave', EDU_POINTS_LAYER, ()=> map.getCanvas().style.cursor='');

  eventsBound = true;
}

function onClusterClick(e){
  const features = map.queryRenderedFeatures(e.point, { layers:[EDU_CLUSTER_LAYER] });
  if (!features?.length) return;

  const clusterId = features[0].properties?.cluster_id;
  if (clusterId == null) return;

  const src = map.getSource(EDU_SOURCE_ID);
  if (!src?.getClusterExpansionZoom) return;

  src.getClusterExpansionZoom(clusterId, (err, zoom)=>{
    if (err) return;
    map.easeTo({ center: features[0].geometry.coordinates, zoom });
  });
}

function onPointClick(e){
  const f = e.features?.[0];
  if (!f) return;

  const p = f.properties ? JSON.parse(JSON.stringify(f.properties)) : {};
  new maplibregl.Popup()
    .setLngLat(f.geometry.coordinates)
    .setHTML(formatEduPopup(p))
    .addTo(map);
}

// ----------------------------
// Popup formatting (with better name fallback)
// ----------------------------
function formatEduPopup(p={}){
  const nameRaw =
    p['name:he'] ||
    p.name ||
    p['official_name:he'] ||
    p.official_name ||
    p['short_name:he'] ||
    p.short_name ||
    p['alt_name:he'] ||
    p.alt_name ||
    p.operator ||
    p.brand ||
    p.ref ||
    p['addr:housename'] ||
    (p['addr:city'] ? `School in ${p['addr:city']}` : 'Education place');

  const typeRaw = p.amenity || p.education || '';
  const cityRaw = p['addr:city'] || '';
  const streetRaw = p['addr:street'] || '';
  const houseRaw = p['addr:housenumber'] || '';
  const operatorRaw = p.operator || '';

  const phoneRaw = p.phone || p['contact:phone'] || '';
  const websiteRaw = p.website || p['contact:website'] || '';
  const hoursRaw = p.opening_hours || '';
  const emailRaw = p.email || p['contact:email'] || '';

  const street = esc(streetRaw);
  const house = esc(houseRaw);
  const city = esc(cityRaw);

  const addressText =
    [street, house].filter(Boolean).join(' ') +
    (city ? ((street||house) ? ', ' : '') + city : '');

  const rows = [];
  if (typeRaw) rows.push(`<div><b>Type:</b> ${esc(typeRaw)}</div>`);
  if (addressText) rows.push(`<div><b>Address:</b> ${addressText}</div>`);
  if (operatorRaw) rows.push(`<div><b>Operator:</b> ${esc(operatorRaw)}</div>`);

  const phone = safeTel(phoneRaw);
  if (phone) rows.push(`<div><b>Phone:</b> <a href="tel:${esc(phone)}">${esc(phone)}</a></div>`);

  const email = safeEmail(emailRaw);
  if (email) rows.push(`<div><b>Email:</b> <a href="mailto:${esc(email)}">${esc(email)}</a></div>`);

  const website = safeUrl(websiteRaw);
  if (website) rows.push(`<div><b>Website:</b> <a href="${esc(website)}" target="_blank" rel="noopener">${esc(website)}</a></div>`);

  if (hoursRaw) rows.push(`<div><b>Hours:</b> ${esc(hoursRaw)}</div>`);

  return `<div style="min-width:240px;direction:rtl">
    <div style="font-weight:700;margin-bottom:6px">${esc(nameRaw)}</div>
    ${rows.join('') || '<div>No additional data</div>'}
  </div>`;
}

// ----------------------------
// Filtering (rebuild source data so clusters match selection)
// ----------------------------
function getAmenitySelection(){
  const vals = [...document.querySelectorAll('.amenity:checked')].map(i=>i.value);
  return new Set(vals);
}

function filterGeoJSONByAmenity(gj, selectedSet){
  if (!selectedSet || !selectedSet.size) return { type:'FeatureCollection', features: [] };
  return {
    type:'FeatureCollection',
    features: (gj.features || []).filter(f => selectedSet.has(f.properties?.amenity))
  };
}

export function applyAmenityFilter(){
  const src = map.getSource(EDU_SOURCE_ID);
  if (!src) return;

  const selected = getAmenitySelection();
  filteredEduGeoJSON = filterGeoJSONByAmenity(currentEduGeoJSON, selected);

  // This makes clusters + counts align with the selection
  src.setData(filteredEduGeoJSON);

  // Toggle labels layer based on showLabels
  if (showLabels) {
    if (!map.getLayer(EDU_LABELS_LAYER)) addOrUpdateEduLabels();
  } else {
    if (map.getLayer(EDU_LABELS_LAYER)) map.removeLayer(EDU_LABELS_LAYER);
  }
}

// ----------------------------
// Load data for current view
// ----------------------------
export async function loadEducationForView(){
  if (!eduEnabled) { removeEducationLayers(); return; }
  if (map.getZoom() < 10) { removeEducationLayers(); return; }

  clearTimeout(loadTimer);
  loadTimer = setTimeout(async ()=>{
    const b = map.getBounds();
    const key = bboxKey(b);

    showLoading(true);

    const cached = cacheGet(key);
    if (cached){
      ensureEducationLayers(cached);
      if (!cached.features.length) showToast('No education places found in view');
      showLoading(false);
      return;
    }

    if (inflightController) inflightController.abort();
    inflightController = new AbortController();

    try{
      const gj = await fetchEducationGeoJSON(
        [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()],
        inflightController.signal
      );

      cacheSet(key, gj);

      ensureEducationLayers(gj);
      if (!gj.features.length) showToast('No education places found in view');
    }catch(err){
      if (err?.name !== 'AbortError'){
        console.error('Overpass error', err);
        showToast('Failed to load education places');
      }
    } finally {
      inflightController = null;
      showLoading(false);
    }
  }, 350);
}

// Quick restore after setStyle
export function getCurrentEdu(){
  return currentEduGeoJSON;
}

// Bind checkbox changes
export function setupEducationLayers(){
  document.querySelectorAll('.amenity').forEach(cb =>
    cb.addEventListener('change', applyAmenityFilter)
  );
}
