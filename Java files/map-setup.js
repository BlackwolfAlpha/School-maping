// map-setup.js
export let map = null;

const state = {
  currentProjection: 'mercator', // default safe
  minZoom: 6,
  maxZoom: 19.2,
};

// Only allow known values
const ALLOWED_PROJECTIONS = new Set(['mercator', 'globe']);

export function getProjectionMode() {
  return state.currentProjection;
}

export function setProjectionMode(mode = 'mercator') {
  const proj = mode || 'mercator';

  const apply = () => {
    try {
      map.setProjection(proj);
    } catch (e) {
      console.warn("setProjection failed, falling back to mercator:", e);
      try { map.setProjection('mercator'); } catch {}
    }
  };

  if (!map.isStyleLoaded()) {
    map.once('idle', apply);
    return;
  }

  apply();
}

export function setupMap() {
  const MIN_ZOOM = state.minZoom;
  const MAX_ZOOM = state.maxZoom;

  map = new maplibregl.Map({
    container: 'map',
    style: 'https://demotiles.maplibre.org/style.json',
    center: [34.78, 31.8],
    zoom: Math.max(5, MIN_ZOOM),
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    // NOTE: Some versions expect projection as object in style, but map constructor here may accept string.
    // We'll keep it simple and safe:
    projection: state.currentProjection,
    attributionControl: true,
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
  map.addControl(new maplibregl.FullscreenControl(), 'top-left');
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true, showUserHeading: true }), 'top-left');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 200, unit: 'metric' }));

  // Make zoom limits stick
  map.setMinZoom(MIN_ZOOM);
  map.setMaxZoom(MAX_ZOOM);

  map.on('zoomend', () => {
    const z = map.getZoom();
    if (z > MAX_ZOOM) map.jumpTo({ zoom: MAX_ZOOM });
    if (z < MIN_ZOOM) map.jumpTo({ zoom: MIN_ZOOM });
  });

  // After ANY setStyle(), re-apply projection ONLY if supported
  map.on('style.load', () => {
    map.setMinZoom(MIN_ZOOM);
    map.setMaxZoom(MAX_ZOOM);

    // Re-apply projection safely
    if (typeof map.setProjection === 'function') {
      const p = getProjectionMode();
      if (ALLOWED_PROJECTIONS.has(p)) {
        try { map.setProjection(p); } catch {}
      }
    }

    // IMPORTANT: Do NOT call setSky/setFog here (your build rejects these props)
  });

  return map;
}
