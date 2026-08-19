(() => {
"use strict";

/*
  GÉNÉRATEUR DE LISTES — ARCHIVES DU COURANT

  Le moteur est séparé des données de jeu.
  Sources :
    data/supplements.json
    data/armees/<id>.json
    data/supplements/<id>.json

  Un supplément peut utiliser une ou plusieurs armées :
    "armies": ["hauts-elfes"]
    "armies": ["elfes-noirs", "hauts-elfes"]

  L'ancien champ "army" reste accepté pour compatibilité.
*/

const PATHS = {
  supplements: "data/supplements.json",
  armies: "data/armees/",
  supplementData: "data/supplements/"
};

const state = {
  supplements: [],
  supplement: null,
  army: null,
  armyOptions: [],
  list: [],
  pointsLimit: 2000
};

const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

async function getJSON(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Impossible de charger ${url} (${response.status})`);
  return response.json();
}

function setStatus(message, type="") {
  $("status").textContent = message;
  $("status").className = "status " + type;
}

function normalizeUnit(unit, fallbackId="") {
  return {
    id: unit.id || fallbackId || crypto.randomUUID(),
    name: unit.name || unit.nom || "Unité sans nom",
    category: unit.category || unit.categorie || "Autres",
    points: Number(unit.points ?? unit.cost ?? unit.cout ?? 0),
    minSize: Number(unit.minSize ?? unit.min ?? 1),
    maxSize: Number(unit.maxSize ?? unit.max ?? 1),
    rules: unit.rules || unit.regles || [],
    options: unit.options || [],
    profile: unit.profile || unit.profil || null
  };
}

function normalizeArmy(raw) {
  const units = [];

  if (Array.isArray(raw.units)) {
    raw.units.forEach(u => units.push(normalizeUnit(u)));
  } else if (raw.units && typeof raw.units === "object") {
    Object.entries(raw.units).forEach(([id,u]) => units.push(normalizeUnit(u,id)));
  }

  if (Array.isArray(raw.categories)) {
    raw.categories.forEach(cat => {
      (cat.units || []).forEach(u => units.push(normalizeUnit(u)));
    });
  }

  return {
    id: raw.id || raw.armyId || "",
    name: raw.name || raw.nom || "Armée",
    units
  };
}

function normalizeSupplement(raw) {
  let armies = [];
  if (Array.isArray(raw.armies)) armies = raw.armies.filter(Boolean);
  else if (raw.army) armies = [raw.army];
  else if (raw.armyId) armies = [raw.armyId];
  else if (raw.armee) armies = [raw.armee];
  else if (raw.armeeReference) armies = [raw.armeeReference];

  return {
    id: raw.id,
    name: raw.name || raw.nom,
    armies,
    armyFiles: raw.armyFiles || {},
    armyFile: raw.armyFile || raw.armyData || null,
    description: raw.description || "",
    allowedUnits: raw.allowedUnits || raw.unitesAutorisees || null,
    excludedUnits: raw.excludedUnits || raw.unitesInterdites || [],
    categories: raw.categories || null,
    restrictions: raw.restrictions || {},
    specialRules: raw.specialRules || raw.reglesSpeciales || []
  };
}

function armyLabel(id) {
  const known = {
    "elfes-noirs":"Elfes Noirs",
    "hauts-elfes":"Hauts-Elfes",
    "elfes-sylvains":"Elfes Sylvains"
  };
  return known[id] || id.replace(/[-_]/g," ").replace(/\b\w/g,m=>m.toUpperCase());
}

function getArmyUrl(supplement, armyId) {
  if (supplement.armyFiles && supplement.armyFiles[armyId]) {
    return supplement.armyFiles[armyId];
  }
  if (supplement.armyFile && supplement.armies.length === 1) {
    return supplement.armyFile;
  }
  return PATHS.armies + armyId + ".json";
}

async function loadSupplements() {
  const raw = await getJSON(PATHS.supplements);
  const list = Array.isArray(raw) ? raw : (raw.supplements || []);
  state.supplements = list.map(normalizeSupplement).filter(s => s.id && s.name && s.armies.length);

  const select = $("supplementSelect");
  select.innerHTML = "";
  state.supplements.forEach(s => {
    const option = document.createElement("option");
    option.value = s.id;
    option.textContent = s.name;
    select.appendChild(option);
  });

  if (!state.supplements.length) {
    throw new Error("Aucun supplément valide n'est défini dans supplements.json.");
  }

  await selectSupplement(state.supplements[0].id);
}

function populateArmySelect() {
  const wrapper = $("armyField");
  const select = $("armySelect");
  const armies = state.supplement?.armies || [];
  state.armyOptions = armies;

  select.innerHTML = "";
  armies.forEach(id => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = armyLabel(id);
    select.appendChild(option);
  });

  wrapper.style.display = armies.length > 1 ? "block" : "none";
  if (armies.length) select.value = armies[0];
}

function allowedBySupplement(unit, supplement) {
  if (supplement.excludedUnits.includes(unit.id)) return false;
  if (Array.isArray(supplement.allowedUnits) && supplement.allowedUnits.length && !supplement.allowedUnits.includes(unit.id)) return false;
  if (Array.isArray(supplement.categories) && supplement.categories.length && !supplement.categories.includes(unit.category)) return false;
  return true;
}

function getRestrictionCategory(category) {
  return state.supplement?.restrictions?.categories?.[category] || {};
}

function getRestrictionUnit(unitId) {
  return state.supplement?.restrictions?.units?.[unitId] || {};
}

async function selectSupplement(id) {
  const supplement = state.supplements.find(s => s.id === id);
  if (!supplement) return;

  state.supplement = supplement;
  state.list = [];
  populateArmySelect();

  const armyId = state.armyOptions[0];
  await loadSelectedArmy(armyId);
}

async function selectArmy(armyId) {
  if (!state.supplement?.armies.includes(armyId)) return;
  state.list = [];
  await loadSelectedArmy(armyId);
}

async function loadSelectedArmy(armyId) {
  if (!armyId) {
    state.army = null;
    renderAvailable();
    renderList();
    renderSummary();
    setStatus(`Le supplément "${state.supplement?.name || ""}" ne définit aucune armée.`, "error");
    return;
  }

  const armyUrl = getArmyUrl(state.supplement, armyId);
  const supplementUrl = PATHS.supplementData + state.supplement.id + ".json";

  try {
    const [armyRaw, supplementRaw] = await Promise.all([
      getJSON(armyUrl),
      getJSON(supplementUrl).catch(() => null)
    ]);

    state.army = normalizeArmy(armyRaw);

    // Le fichier spécifique complète/remplace les métadonnées du catalogue.
    if (supplementRaw) {
      const specific = normalizeSupplement(supplementRaw);
      state.supplement = {
        ...state.supplement,
        ...specific,
        armies: specific.armies.length ? specific.armies : state.supplement.armies,
        allowedUnits: specific.allowedUnits ?? state.supplement.allowedUnits,
        excludedUnits: specific.excludedUnits?.length ? specific.excludedUnits : state.supplement.excludedUnits,
        restrictions: Object.keys(specific.restrictions || {}).length ? specific.restrictions : state.supplement.restrictions,
        specialRules: specific.specialRules?.length ? specific.specialRules : state.supplement.specialRules
      };
    }

    // Le fichier d'armée est la source de vérité pour son identifiant.
    if (!state.army.id) state.army.id = armyId;
    if (!state.army.name) state.army.name = armyLabel(armyId);

    renderAvailable();
    renderList();
    renderSummary();

    const count = state.army.units.length;
    const suffix = count ? `${count} unité(s) chargée(s)` : "aucune unité chargée";
    setStatus(`${state.supplement.name} · ${state.army.name} · ${suffix}`, count ? "ok" : "error");

  } catch (error) {
    console.error(error);
    state.army = null;
    renderAvailable();
    renderList();
    renderSummary();
    setStatus(error.message, "error");
    $("availableUnits").innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
  }
}

function groupedAvailableUnits() {
  const groups = {};
  if (!state.army) return groups;

  state.army.units
    .filter(u => allowedBySupplement(u, state.supplement))
    .forEach(unit => {
      if (!groups[unit.category]) groups[unit.category] = [];
      groups[unit.category].push(unit);
    });
  return groups;
}

function renderAvailable() {
  const container = $("availableUnits");
  container.innerHTML = "";
  if (!state.army) return;

  const groups = groupedAvailableUnits();
  const categories = Object.keys(groups);

  if (!categories.length) {
    container.innerHTML = `<div class="empty">Aucune unité autorisée pour ce supplément ou aucune donnée d'armée n'est chargée.</div>`;
    return;
  }

  categories.forEach(category => {
    const section = document.createElement("section");
    section.innerHTML = `<h3 class="category-title"><span>${escapeHtml(category)}</span><span class="badge">${groups[category].length}</span></h3>`;

    groups[category].forEach(unit => {
      const card = document.createElement("div");
      card.className = "unit-card";
      const rules = Array.isArray(unit.rules) ? unit.rules.join(" · ") : unit.rules;
      card.innerHTML = `
        <div>
          <div class="unit-name">${escapeHtml(unit.name)}</div>
          <div class="unit-meta">${unit.points} pts${unit.minSize > 1 || unit.maxSize > 1 ? ` · ${unit.minSize}–${unit.maxSize} figurines` : ""}</div>
          ${rules ? `<div class="unit-rules">${escapeHtml(rules)}</div>` : ""}
        </div>
        <button class="add-btn" type="button" data-add="${escapeHtml(unit.id)}">Ajouter</button>`;
      container.appendChild(section);
      section.appendChild(card);
    });
  });

  container.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", () => addUnit(btn.dataset.add));
  });
}

function addUnit(id) {
  const unit = state.army?.units.find(u => u.id === id);
  if (!unit || !allowedBySupplement(unit, state.supplement)) return;

  const restriction = getRestrictionUnit(id);
  const current = state.list.find(x => x.id === id);
  const currentQty = current?.qty || 0;
  const max = Number(restriction.max ?? Infinity);

  if (currentQty >= max) {
    setStatus(`Maximum atteint pour ${unit.name} (${max}).`, "error");
    return;
  }

  if (current) current.qty++;
  else state.list.push({ id, qty: 1 });

  renderList();
  renderSummary();
}

function removeOne(id) {
  const item = state.list.find(x => x.id === id);
  if (!item) return;
  item.qty--;
  if (item.qty <= 0) state.list = state.list.filter(x => x.id !== id);
  renderList();
  renderSummary();
}

function removeAll(id) {
  state.list = state.list.filter(x => x.id !== id);
  renderList();
  renderSummary();
}

function renderList() {
  const container = $("armyList");
  container.innerHTML = "";

  if (!state.list.length || !state.army) {
    $("listEmpty").style.display = "block";
    return;
  }
  $("listEmpty").style.display = "none";

  const groups = {};
  state.list.forEach(item => {
    const unit = state.army.units.find(u => u.id === item.id);
    if (!unit) return;
    if (!groups[unit.category]) groups[unit.category] = [];
    groups[unit.category].push({ item, unit });
  });

  Object.entries(groups).forEach(([category, entries]) => {
    const section = document.createElement("section");
    section.innerHTML = `<h3>${escapeHtml(category)}</h3>`;
    entries.forEach(({item,unit}) => {
      const row = document.createElement("div");
      row.className = "army-unit";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(unit.name)}</strong>
          <div class="small">${unit.points} pts · ${unit.points * item.qty} pts</div>
        </div>
        <div class="qty-controls">
          <button type="button" data-minus="${escapeHtml(unit.id)}">−</button>
          <span class="qty">${item.qty}</span>
          <button type="button" data-plus="${escapeHtml(unit.id)}">+</button>
        </div>
        <button class="remove" type="button" data-remove="${escapeHtml(unit.id)}" title="Supprimer cette unité">×</button>`;
      section.appendChild(row);
    });
    container.appendChild(section);
  });

  container.querySelectorAll("[data-minus]").forEach(b => b.addEventListener("click",()=>removeOne(b.dataset.minus)));
  container.querySelectorAll("[data-plus]").forEach(b => b.addEventListener("click",()=>addUnit(b.dataset.plus)));
  container.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click",()=>removeAll(b.dataset.remove)));
}

function getTotal() {
  return state.list.reduce((sum,item) => {
    const unit = state.army?.units.find(u => u.id === item.id);
    return sum + (unit ? unit.points * item.qty : 0);
  },0);
}

function validate() {
  const errors = [];
  const warnings = [];
  const total = getTotal();

  if (!state.army) errors.push("Aucune armée générique n'est chargée.");
  if (total > state.pointsLimit) errors.push(`La liste dépasse le format de ${total - state.pointsLimit} points.`);

  const categoryCounts = {};
  state.list.forEach(item => {
    const unit = state.army?.units.find(u => u.id === item.id);
    if (!unit) return;
    categoryCounts[unit.category] = (categoryCounts[unit.category] || 0) + item.qty;

    const r = getRestrictionUnit(unit.id);
    if (r.max != null && item.qty > Number(r.max)) errors.push(`${unit.name} : maximum ${r.max}.`);
    if (r.min != null && item.qty < Number(r.min)) errors.push(`${unit.name} : minimum ${r.min}.`);
  });

  const categories = state.supplement?.restrictions?.categories || {};
  Object.entries(categories).forEach(([category,r]) => {
    const count = categoryCounts[category] || 0;
    if (r.min != null && count < Number(r.min)) errors.push(`${category} : minimum ${r.min} unité(s).`);
    if (r.max != null && count > Number(r.max)) errors.push(`${category} : maximum ${r.max} unité(s).`);
  });

  const global = state.supplement?.restrictions?.global || {};
  if (global.minPoints != null && total < Number(global.minPoints)) errors.push(`Minimum de ${global.minPoints} points requis.`);
  if (global.maxPoints != null && total > Number(global.maxPoints)) errors.push(`Maximum de ${global.maxPoints} points autorisé.`);

  return { errors, warnings };
}

function renderSummary() {
  const total = getTotal();
  const result = validate();
  $("totalPoints").textContent = total;
  $("formatPoints").textContent = state.pointsLimit;
  $("remainingPoints").textContent = state.pointsLimit - total;
  $("unitCount").textContent = state.list.reduce((s,x)=>s+x.qty,0);

  $("validation").innerHTML = result.errors.length
    ? `<div class="invalid">✗ Liste non valide</div><ul class="rule-list">${result.errors.map(e=>`<li>${escapeHtml(e)}</li>`).join("")}</ul>`
    : `<div class="valid">✓ Liste valide</div>`;

  const restrictions = state.supplement?.restrictions || {};
  const lines = [];
  if (restrictions.categories) {
    Object.entries(restrictions.categories).forEach(([cat,r]) => {
      const parts=[];
      if(r.min!=null) parts.push(`min. ${r.min}`);
      if(r.max!=null) parts.push(`max. ${r.max}`);
      lines.push(`<li><strong>${escapeHtml(cat)}</strong> : ${escapeHtml(parts.join(" · "))}</li>`);
    });
  }
  if (restrictions.units) {
    Object.entries(restrictions.units).forEach(([id,r]) => {
      const unit=state.army?.units.find(u=>u.id===id);
      if(!unit)return;
      const parts=[];
      if(r.min!=null)parts.push(`min. ${r.min}`);
      if(r.max!=null)parts.push(`max. ${r.max}`);
      lines.push(`<li><strong>${escapeHtml(unit.name)}</strong> : ${escapeHtml(parts.join(" · "))}</li>`);
    });
  }
  $("constraints").innerHTML = lines.length ? `<ul class="rule-list">${lines.join("")}</ul>` : `<div class="small">Aucune contrainte supplémentaire.</div>`;
}

function newList() {
  state.list = [];
  renderList();
  renderSummary();
  $("nameInput").value = "";
  setStatus(`Nouvelle liste · ${state.supplement?.name || ""} · ${state.army?.name || ""}`, "ok");
}

function saveList() {
  if (!state.supplement || !state.army) {
    setStatus("Impossible de sauvegarder sans supplément et armée chargés.", "error");
    return;
  }

  const payload = {
    version: 2,
    supplementId: state.supplement.id,
    supplementName: state.supplement.name,
    armyId: state.army.id,
    armyName: state.army.name,
    name: $("nameInput").value.trim() || "Ma liste",
    pointsLimit: state.pointsLimit,
    list: state.list,
    savedAt: new Date().toISOString()
  };
  localStorage.setItem("archivesCourantArmyList", JSON.stringify(payload));
  setStatus("Liste sauvegardée dans ce navigateur.", "ok");
}

async function loadList() {
  const raw = localStorage.getItem("archivesCourantArmyList");
  if (!raw) { setStatus("Aucune liste sauvegardée dans ce navigateur.", "error"); return; }
  try {
    const payload = JSON.parse(raw);
    if (payload.supplementId !== state.supplement.id) {
      setStatus("La liste sauvegardée appartient à un autre supplément.", "error");
      return;
    }
    if (payload.armyId && payload.armyId !== state.army?.id) {
      setStatus("La liste sauvegardée utilise une autre armée.", "error");
      return;
    }
    state.pointsLimit = Number(payload.pointsLimit) || 2000;
    $("pointsInput").value = state.pointsLimit;
    $("nameInput").value = payload.name || "";
    state.list = Array.isArray(payload.list) ? payload.list : [];
    renderList(); renderSummary();
    setStatus("Liste chargée.", "ok");
  } catch(e) {
    setStatus("La sauvegarde est invalide.", "error");
  }
}

function printList() {
  if (!state.army || !state.supplement) return;
  const name = escapeHtml($("nameInput").value.trim() || "Ma liste");
  const total = getTotal();
  const rows = state.list.map(item => {
    const u = state.army.units.find(x=>x.id===item.id);
    return u ? `<tr><td>${escapeHtml(u.category)}</td><td>${escapeHtml(u.name)}</td><td>${item.qty}</td><td>${u.points*item.qty}</td></tr>` : "";
  }).join("");
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${name}</title>
  <style>body{font-family:Georgia,serif;margin:40px;color:#222}h1{font-size:28px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:7px;text-align:left}.total{font-size:20px;margin:15px 0}</style></head>
  <body><h1>${name}</h1><p>${escapeHtml(state.supplement.name)} · ${escapeHtml(state.army.name)}</p>
  <div class="total">${total} / ${state.pointsLimit} points</div><table><thead><tr><th>Catégorie</th><th>Unité</th><th>Qté</th><th>Points</th></tr></thead><tbody>${rows}</tbody></table>
  <script>window.print()<\/script></body></html>`);
  w.document.close();
}

$("supplementSelect").addEventListener("change", e => selectSupplement(e.target.value));
$("armySelect").addEventListener("change", e => selectArmy(e.target.value));
$("pointsInput").addEventListener("input", e => {
  state.pointsLimit = Math.max(1, Number(e.target.value) || 1);
  renderSummary();
});
$("newListBtn").addEventListener("click", newList);
$("saveBtn").addEventListener("click", saveList);
$("loadBtn").addEventListener("click", loadList);
$("clearBtn").addEventListener("click", () => {
  if (confirm("Supprimer toutes les unités de la liste ?")) newList();
});
$("printBtn").addEventListener("click", printList);

loadSupplements().catch(error => {
  console.error(error);
  setStatus(error.message, "error");
  $("availableUnits").innerHTML = `<div class="notice">Vérifiez que la page est hébergée (GitHub Pages, par exemple) et que les fichiers JSON existent aux chemins indiqués.</div>`;
});
})();
