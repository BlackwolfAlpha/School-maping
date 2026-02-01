// municipal-boundaries.js
// Adds municipal boundary polygons (GeoJSON) to a MapLibre map.
// Designed to survive map.setStyle(): call once and it will re-add itself on "style.load".

function normName(x){
  return String(x ?? '').trim().replace(/\s+/g, ' ');
}

function collectLngLatPairs(node, out){
  // Recursively collects [lng,lat] pairs from Polygon/MultiPolygon coordinate arrays.
  if (!Array.isArray(node)) return;

  // Leaf: [lng, lat]
  if (node.length === 2 && typeof node[0] === 'number' && typeof node[1] === 'number'){
    out.push(node);
    return;
  }

  for (const child of node){
    collectLngLatPairs(child, out);
  }
}

function featureBounds(feature){
  const coords = feature?.geometry?.coordinates;
  const pts = [];
  collectLngLatPairs(coords, pts);
  if (!pts.length) return null;

  let minLng = pts[0][0], maxLng = pts[0][0];
  let minLat = pts[0][1], maxLat = pts[0][1];

  for (const [lng, lat] of pts){
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  // MapLibre fitBounds expects [[west,south],[east,north]]
  return [[minLng, minLat], [maxLng, maxLat]];
}

function ensureLayer(map, spec){
  if (!map.getLayer(spec.id)) map.addLayer(spec);
}

export function addMunicipalBoundaries(map, {
  url = './data/municipal_boundaries.geojson',
  sourceId = 'municipal-boundaries',
  fillLayerId = 'municipal-fill',
  lineLayerId = 'municipal-line',
  namePropertyCandidates = ['name', 'NAME', 'שם', 'mun_name', 'municipality'],
  onCitySelected = null,
} = {}){
  let latestGeoJSON = null;
  let hoveredId = null;
  let selectedId = null;

  const pickName = (props = {}) => {
    for (const k of namePropertyCandidates){
      const v = props[k];
      if (v) return normName(v);
    }
    return '';
  };

  const apply = async () => {
    latestGeoJSON = await fetch(url).then(r => r.json());

    // Source
    const existing = map.getSource(sourceId);
    if (existing && existing.setData){
      existing.setData(latestGeoJSON);
    } else {
      map.addSource(sourceId, {
        type: 'geojson',
        data: latestGeoJSON,
        generateId: true, // gives each feature a stable numeric id for feature-state
      });
    }

    // Layers
    ensureLayer(map, {
      id: fillLayerId,
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 'rgba(37,99,235,0.28)',
          ['boolean', ['feature-state', 'hover'], false], 'rgba(37,99,235,0.18)',
          'rgba(37,99,235,0.08)'
        ],
        'fill-outline-color': 'rgba(37,99,235,0.55)',
      }
    });

    ensureLayer(map, {
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 'rgba(37,99,235,0.95)',
          ['boolean', ['feature-state', 'hover'], false], 'rgba(37,99,235,0.80)',
          'rgba(37,99,235,0.55)'
        ],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 3,
          ['boolean', ['feature-state', 'hover'], false], 2.5,
          2
        ]
      }
    });

    // Hover behavior
    map.on('mousemove', fillLayerId, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const id = f.id;
      if (id == null) return;

      if (hoveredId !== null && hoveredId !== id){
        try { map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: false }); } catch {}
      }
      hoveredId = id;
      try { map.setFeatureState({ source: sourceId, id }, { hover: true }); } catch {}

      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', fillLayerId, () => {
      if (hoveredId !== null){
        try { map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: false }); } catch {}
      }
      hoveredId = null;
      map.getCanvas().style.cursor = '';
    });

    // Click select
    map.on('click', fillLayerId, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const id = f.id;
      if (id == null) return;

      if (selectedId !== null && selectedId !== id){
        try { map.setFeatureState({ source: sourceId, id: selectedId }, { selected: false }); } catch {}
      }
      selectedId = id;
      try { map.setFeatureState({ source: sourceId, id }, { selected: true }); } catch {}

      const name = pickName(f.properties);
      if (typeof onCitySelected === 'function'){
        onCitySelected({ feature: f, name, lngLat: e.lngLat });
      }

      // Also dispatch a DOM event for anyone else to listen.
      window.dispatchEvent(new CustomEvent('municipality:selected', {
        detail: { feature: f, name, lngLat: e.lngLat }
      }));
    });
  };

  // Initial add
  // NOTE: Must be called only after the map is created.
  // If style is not loaded yet, MapLibre will queue addSource/addLayer after 'load'.
  const run = async () => {
    if (map.isStyleLoaded()) return apply();
    return new Promise((resolve) => {
      map.once('load', async () => { await apply(); resolve(); });
    });
  };

  // Re-add after style switch
  map.on('style.load', async () => {
    // When style changes, sources/layers are removed.
    // Re-apply everything.
    await apply();
  });

  const selectByName = (cityName, { fit = true, padding = 30, maxZoom = 12 } = {}) => {
    if (!latestGeoJSON?.features?.length) return false;
    const target = normName(cityName);

    const f = latestGeoJSON.features.find(ft => pickName(ft.properties) === target);
    if (!f) return false;

    // selected feature-state works only when feature id exists.
    // With generateId:true it should exist after source is added.
    // We can't reliably know it before render, so we just fit bounds here.
    if (fit){
      const b = featureBounds(f);
      if (b) map.fitBounds(b, { padding, maxZoom });
    }
    return true;
  };

  const getLatestGeoJSON = () => latestGeoJSON;

  // Kick off
  run();

  return {
    sourceId,
    fillLayerId,
    lineLayerId,
    selectByName,
    getLatestGeoJSON,
  };
}
