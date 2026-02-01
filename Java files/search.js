// search.js
import { map } from './map-setup.js';
import { clearEducationData, loadEducationForView } from './education-layers.js';

export function setupSearch() {
  const input = document.getElementById('q');
  if (!input) {
    console.warn('#q not found in DOM');
    return;
  }

  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;

    const text = input.value.trim();
    if (!text) return;

    try {
      // קריאת Nominatim
      const url = `https://nominatim.openstreetmap.org/search?format=geojson&q=${encodeURIComponent(text)}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'he' } });
      const data = await res.json();

      // לוקחים את התוצאה הראשונה
      const f = data.features?.[0];
      if (!f) {
        showToast('לא נמצאה תוצאה'); // אופציונלי—אם יש לך showToast גלובלי
        return;
      }

      // מנקים תוצאות קודמות (שכבות מוסדות + קאש/בקשה רצה)
      clearEducationData();

      // אם יש bbox עדיף להתאים אליו; אחרת, אל מרכז הנקודה
      const props = f.properties || {};
      const geom = f.geometry;

      // הסר שכבת "search-point" קודמת אם קיימת
      if (map.getSource('search-point')) {
        if (map.getLayer('search-point')) map.removeLayer('search-point');
        map.removeSource('search-point');
      }

      let targetCenter = null;
      if (geom?.type === 'Point') {
        targetCenter = geom.coordinates; // [lng, lat]
      } else if (props?.boundingbox?.length === 4) {
        // פורמט Nominatim: [south, north, west, east] או [s, n, w, e]
        const bb = props.boundingbox.map(Number);
        const south = Math.min(bb[0], bb[1]);
        const north = Math.max(bb[0], bb[1]);
        const west  = Math.min(bb[2], bb[3]);
        const east  = Math.max(bb[2], bb[3]);
        const bounds = [[west, south], [east, north]];
        map.fitBounds(bounds, { padding: 40, duration: 800 });
      }

      // אם אין bbox — טוס למרכז עם זום מספיק גבוה לטעינת מוסדות
      if (targetCenter) {
        map.easeTo({
          center: targetCenter,
          zoom: Math.max(12, map.getZoom()), // ודא >= 12 כדי לעבור את סף 10
          pitch: 0,
          bearing: 0,
          duration: 800
        });
      }

      // הוסף נקודה אדומה על תוצאת החיפוש (אם יש מרכז)
      if (targetCenter) {
        map.addSource('search-point', {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'Point', coordinates: targetCenter } }
        });
        map.addLayer({
          id: 'search-point',
          type: 'circle',
          source: 'search-point',
          paint: {
            'circle-radius': 8,
            'circle-color': '#ff3b3b',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff'
          }
        });
      }

      // כשתנועה מסתיימת — טען מוסדות בחלון החדש
      const once = () => {
        map.off('moveend', once);
        loadEducationForView();
      };
      map.on('moveend', once);

    } catch (err) {
      console.error(err);
      showToast?.('שגיאה בחיפוש'); // אם יש פונקציית טוסט גלובלית
    }
  });
}
