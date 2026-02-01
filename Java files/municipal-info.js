// municipal-info.js
import { loadYouthDeptDB } from './sheet-db.js';

function esc(x){
  return String(x ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export async function bindMunicipalInfoPopups(map, {
  htmlPath = './data/מחלקות נוער.html',
  layerId,                 // 👈 כאן תכניס את id השכבה של הרשויות/המחוזות במפה
  featureKey = 'lamas',     // או 'name' / 'NAME' וכו'
  sheetKey = 'lamas'        // 'lamas' או 'name' (נתחיל עם name אם אין לך lamas בשכבה)
}){
  const db = await loadYouthDeptDB(htmlPath);

  const getRow = (feature) => {
    const p = feature?.properties || {};

    if (sheetKey === 'lamas') {
      const lamas = String(p[featureKey] ?? '').trim();
      return lamas ? db.byLamas.get(lamas) : null;
    }

    // sheetKey === 'name'
    const name = String(p[featureKey] ?? '').trim();
    return name ? db.byName.get(name.trim().replace(/\s+/g, ' ')) || db.byName.get(name) : null;
  };

  const popupHTML = (row, fallbackName='') => {
    const muni = row?.['רשות'] || fallbackName;
    const district = row?.['מחוז'] || '';
    const lamas = row?.['למ"ס'] || row?.['למ״ס'] || '';
    const manager = row?.['שם מנהל יחידת נוער'] || '';
    const phone = row?.['טל'] || '';
    const email = row?.['אימייל'] || '';

    const emailLine = email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : '';

    return `
      <div style="font-family:system-ui;line-height:1.25;min-width:220px">
        <div style="font-weight:700;font-size:14px">${esc(muni)}</div>
        ${district ? `<div>מחוז: ${esc(district)}</div>` : ''}
        ${lamas ? `<div>למ"ס: ${esc(lamas)}</div>` : ''}
        ${manager ? `<div>מנהל יחידה: ${esc(manager)}</div>` : ''}
        ${phone ? `<div>טל: ${esc(phone)}</div>` : ''}
        ${emailLine ? `<div>אימייל: ${emailLine}</div>` : ''}
      </div>
    `;
  };

  map.on('click', layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;

    const row = getRow(f);
    const fallbackName = f.properties?.name || f.properties?.NAME || f.properties?.['שם'] || '';

    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(popupHTML(row, fallbackName))
      .addTo(map);
  });

  map.on('mouseenter', layerId, () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', layerId, () => map.getCanvas().style.cursor = '');
}
