// sheet-db.js
export async function loadYouthDeptDB(htmlUrl){
  const html = await fetch(htmlUrl).then(r => r.text());
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const table = doc.querySelector('table.waffle');
  if (!table) throw new Error('לא נמצאה טבלת Sheets (table.waffle)');

  const rows = [...table.querySelectorAll('tbody tr')];

  const headerRowIndex = rows.findIndex(tr =>
    [...tr.querySelectorAll('td')].some(td => {
      const t = td.textContent.trim();
      return t === 'מס"ד' || t === 'מס״ד' || t === 'מס\"ד';
    })
  );
  if (headerRowIndex === -1) throw new Error('לא נמצאה שורת כותרות');

  const headers = [...rows[headerRowIndex].querySelectorAll('td')]
    .map(td => td.textContent.trim());

  const cellText = (td) => {
    const a = td.querySelector('a');
    if (a?.href?.startsWith('mailto:')) return a.href.replace('mailto:', '').trim();
    return td.textContent.trim();
  };

  const byName = new Map();

  for (let i = headerRowIndex + 1; i < rows.length; i++){
    const tds = [...rows[i].querySelectorAll('td')];
    if (tds.length < headers.length) continue;

    const row = {};
    headers.forEach((h, idx) => row[h] = cellText(tds[idx]));

    const name = (row['רשות'] || '').trim();
    if (!name) continue;

    byName.set(normalizeName(name), row);
  }

  return { byName, headers };
}

function normalizeName(s){
  return String(s)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/־|–|—/g, '-') // מאחד מקפים
    .replace(/["״]/g, '"'); // מאחד מרכאות
}
