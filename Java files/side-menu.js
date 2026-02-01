function norm(s) {
  return (s ?? "").toString().replace(/\s+/g, " ").trim();
}

function safeText(td) {
  if (!td) return "";
  const a = td.querySelector("a");
  return norm(a ? a.textContent : td.textContent);
}

function buildOptions(selectEl, values, allLabel = "All") {
  const first = document.createElement("option");
  first.value = "";
  first.textContent = allLabel;

  selectEl.innerHTML = "";
  selectEl.appendChild(first);

  [...values]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "he"))
    .forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    });
}

function normalizeCityName(name) {
  let s = norm(name);

  // remove suffix after dash: "אבו סנאן- דרוזי"
  s = s.split("-")[0].trim();
  s = s.split("–")[0].trim();

  // remove prefixes
  s = s.replace(/^מועצה\s+מקומית\s+/g, "");
  s = s.replace(/^עיריית\s+/g, "");

  // normalize quotes
  s = s.replace(/[׳״"]/g, "");

  // common variation קריית/קרית
  s = s.replace(/^קריית\s+/g, "קרית ");

  return s;
}

async function parseYouthDepartmentsFromHtml(htmlPath) {
  const res = await fetch(htmlPath, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${htmlPath}`);

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const table = doc.querySelector("table.waffle");
  if (!table) throw new Error("No table.waffle found in youth html");

  const rows = [...table.querySelectorAll("tbody tr")];

  const headerIndex = rows.findIndex(tr => {
    const t = norm(tr.textContent);
    return t.includes("מחוז") && t.includes("רשות") && t.includes("שם מנהל יחידת נוער");
  });
  if (headerIndex === -1) throw new Error("Header row not found in youth html");

  const dataRows = rows.slice(headerIndex + 1);

  const parsed = [];
  for (const tr of dataRows) {
    const tds = [...tr.querySelectorAll("td")];
    if (tds.length < 7) continue;

    const district = safeText(tds[1]);
    const city = safeText(tds[2]);
    const manager = safeText(tds[4]);
    const phoneRaw = safeText(tds[5]);
    const email = safeText(tds[6]).replace(/\s+/g, "");

    // Sector sometimes at 8, sometimes junk -> clean
    let sector = safeText(tds[8] ?? null);
    if (!sector || /^\d+$/.test(sector)) sector = "";
    if (sector === "ו'---") sector = "";

    if (!city || !district) continue;

    parsed.push({
      city,
      district,
      sector,
      manager,
      phone: phoneRaw,
      email
    });
  }

  // Deduplicate by city name (keep first)
  const uniq = new Map();
  for (const r of parsed) {
    if (!uniq.has(r.city)) uniq.set(r.city, r);
  }
  return [...uniq.values()];
}

function renderDetails(detailsEl, r) {
  const tel = (r.phone ?? "").replace(/[^\d+]/g, "");
  const phoneLine = tel
    ? `<div>📞 <a href="tel:${tel}">${r.phone}</a></div>`
    : "";

  const emailLine = r.email
    ? `<div>✉️ <a href="mailto:${r.email}">${r.email}</a></div>`
    : "";

  detailsEl.innerHTML = `
    <div class="title">${r.city}</div>
    <div><strong>District:</strong> ${r.district || "-"}</div>
    <div><strong>Region/Sector:</strong> ${r.sector || "-"}</div>
    <hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:8px 0;">
    <div><strong>Manager:</strong> ${r.manager || "-"}</div>
    ${phoneLine}
    ${emailLine}
  `;
}

function renderList(listEl, rows, onClickRow) {
  listEl.innerHTML = "";

  if (rows.length === 0) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="muted">No results</div>`;
    listEl.appendChild(li);
    return;
  }

  for (const r of rows) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <div><strong>${r.city}</strong></div>
        <div class="meta">${r.district}${r.sector ? " • " + r.sector : ""}</div>
      </div>
      <div class="meta">›</div>
    `;
    li.addEventListener("click", () => onClickRow(r));
    listEl.appendChild(li);
  }
}

// ---- GeoJSON bbox indexing (reliable zoom) ----
function bboxFromCoords(coords) {
  const flat = [];

  const walk = (c) => {
    if (!c) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      flat.push(c);
      return;
    }
    for (const x of c) walk(x);
  };

  walk(coords);

  if (!flat.length) return null;

  let minX = flat[0][0], minY = flat[0][1], maxX = flat[0][0], maxY = flat[0][1];
  for (const [x, y] of flat) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [[minX, minY], [maxX, maxY]];
}

async function buildMunicipalBboxIndex(geojsonUrl, featureKey = "name") {
  const res = await fetch(geojsonUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load municipal geojson: ${geojsonUrl}`);

  const gj = await res.json();
  const feats = Array.isArray(gj?.features) ? gj.features : [];

  const index = new Map(); // normalizedName -> bbox

  for (const f of feats) {
    const rawName = f?.properties?.[featureKey];
    if (!rawName) continue;

    const key = normalizeCityName(rawName);
    const bb = bboxFromCoords(f?.geometry?.coordinates);
    if (!bb) continue;

    // keep first
    if (!index.has(key)) index.set(key, bb);
  }

  return index;
}

function flyToCityByIndex(map, bboxIndex, cityName) {
  if (!map || !bboxIndex || !cityName) return;

  const key = normalizeCityName(cityName);
  const bb = bboxIndex.get(key);

  if (!bb) {
    console.warn("No bbox found for city:", cityName, "normalized:", key);
    return;
  }

  map.fitBounds(bb, { padding: 80, duration: 700 });
}

export async function setupSideMenu(map, {
  htmlPath = "./data/מחלקות נוער.html",
  muniGeojsonUrl = "./data/municipal_boundaries.geojson",
  featureKey = "name"
} = {}) {
  const listEl = document.getElementById("cityList");
  const detailsEl = document.getElementById("cityDetails");
  const qEl = document.getElementById("citySearch");
  const districtEl = document.getElementById("districtFilter");
  const sectorEl = document.getElementById("sectorFilter");
  const countEl = document.getElementById("cityCount");

  if (!listEl || !detailsEl || !qEl || !districtEl || !sectorEl) {
    console.warn("Side menu DOM elements missing");
    return;
  }

  // 1) load youth table
  let allRows = [];
  try {
    allRows = await parseYouthDepartmentsFromHtml(htmlPath);
  } catch (err) {
    console.error(err);
    detailsEl.innerHTML = `<div class="muted">Failed to load youth departments: ${err.message}</div>`;
    if (countEl) countEl.textContent = "";
    return;
  }

  // 2) build bbox index from geojson
  let bboxIndex;
  try {
    bboxIndex = await buildMunicipalBboxIndex(muniGeojsonUrl, featureKey);
  } catch (err) {
    console.error(err);
    detailsEl.innerHTML = `<div class="muted">Failed to load municipal boundaries: ${err.message}</div>`;
    if (countEl) countEl.textContent = "";
    return;
  }

  buildOptions(districtEl, new Set(allRows.map(r => r.district)), "All");
  buildOptions(sectorEl, new Set(allRows.map(r => r.sector).filter(Boolean)), "All");

  const apply = () => {
    const q = norm(qEl.value).toLowerCase();
    const d = districtEl.value;
    const s = sectorEl.value;

    const filtered = allRows.filter(r => {
      const okQ = !q || r.city.toLowerCase().includes(q);
      const okD = !d || r.district === d;
      const okS = !s || r.sector === s;
      return okQ && okD && okS;
    });

    if (countEl) {
      countEl.textContent = ` (${filtered.length}/${allRows.length})`;
      // אם אתה רוצה רק מספר אחד: countEl.textContent = ` (${filtered.length})`;
    }

    renderList(listEl, filtered, (r) => {
      renderDetails(detailsEl, r);
      flyToCityByIndex(map, bboxIndex, r.city);
    });
  };

  qEl.addEventListener("input", apply);
  districtEl.addEventListener("change", apply);
  sectorEl.addEventListener("change", apply);

  detailsEl.innerHTML = `<div class="muted">Click on the city to see details!</div>`;
  apply();
}
