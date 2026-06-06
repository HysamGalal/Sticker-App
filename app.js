// ============================================================
// Storage key for the LEGACY localStorage data (kept around so
// the "Import my old data" button can find it). The signed-in
// app no longer reads or writes localStorage as the source of truth.
// ============================================================
const STORAGE_KEY = "wc2026-stickers-v2";
// Flag we set after a successful one-time import so the button stays hidden.
const IMPORTED_FLAG_KEY = "wc2026-stickers-v2-imported";

// collection[stickerCode] = positive integer count.
// Missing stickers are not stored (treated as count 0).
// Populated from Supabase after sign-in; empty until then.
let collection = {};

// Current Supabase auth user (set after sign-in, cleared on sign-out).
let currentUser = null;

// Supabase JS client — created at startup.
let sb = null;

// Ephemeral filter state — not persisted; resets on reload.
const filterState = {
    status: "all", // "all" | "missing" | "collected" | "duplicates"
    search: "",
};
let lastFirstVisibleSection = null;

// Convert legacy { state, extras } localStorage entries to numeric counts.
// Used only by Step 6's import button.
function migrateCollection(raw) {
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    for (const [code, value] of Object.entries(raw)) {
        if (typeof value === "number") {
            if (value > 0) out[code] = value;
        } else if (value && typeof value === "object" && typeof value.state === "string") {
            if (value.state === "have") {
                out[code] = 1;
            } else if (value.state === "dup") {
                out[code] = (Number(value.extras) || 0) + 1;
            }
        }
    }
    return out;
}

function getCount(code) {
    return collection[code] || 0;
}

// Update in-memory state immediately (sync), then write to Supabase (async).
// Optimistic UI: rendering happens before the network round-trip completes.
// On failure we revert the in-memory value and re-render.
async function setCount(code, count) {
    const previous = collection[code] || 0;
    if (count <= 0) {
        delete collection[code];
    } else {
        collection[code] = count;
    }
    if (!currentUser || !sb) return;

    try {
        if (count <= 0) {
            const { error } = await sb
                .from("collections")
                .delete()
                .match({ user_id: currentUser.id, sticker_code: code });
            if (error) throw error;
        } else {
            const { error } = await sb
                .from("collections")
                .upsert(
                    { user_id: currentUser.id, sticker_code: code, count },
                    { onConflict: "user_id,sticker_code" }
                );
            if (error) throw error;
        }
    } catch (e) {
        console.error("Failed to save count for", code, e);
        // Revert
        if (previous <= 0) delete collection[code];
        else collection[code] = previous;
        renderSticker(code);
        updateAllStats();
        showToast(`Couldn't save change to ${code}. Reverted.`);
    }
}

function incrementCount(code) {
    setCount(code, getCount(code) + 1);
    renderSticker(code);
    updateAllStats();
}

function decrementCount(code) {
    const current = getCount(code);
    if (current <= 0) return; // floor at 0
    setCount(code, current - 1);
    renderSticker(code);
    updateAllStats();
}

// Lightweight inline error message (no dedicated toast component for now).
function showToast(message) {
    console.warn("[toast]", message);
    // Reuse the auth-info element if visible; otherwise alert.
    const el = document.getElementById("auth-error");
    if (el && !el.closest(".hidden")) {
        el.textContent = message;
    } else {
        alert(message);
    }
}

function renderSticker(code) {
    const el = document.querySelector(`[data-code="${CSS.escape(code)}"]`);
    if (!el) return;
    const count = getCount(code);
    el.classList.remove("have");
    el.querySelectorAll(".badge, .checkmark").forEach((n) => n.remove());

    if (count >= 1) {
        el.classList.add("have");
        if (count === 1) {
            const check = document.createElement("span");
            check.className = "checkmark";
            check.textContent = "✓";
            check.setAttribute("aria-label", "collected (1)");
            el.appendChild(check);
        } else {
            const extras = count - 1;
            const badge = document.createElement("span");
            badge.className = "badge";
            badge.textContent = `+${extras}`;
            badge.setAttribute("aria-label", `${count} owned, ${extras} extra${extras === 1 ? "" : "s"}`);
            el.appendChild(badge);
        }
    }
}

function computeStats(stickers) {
    let owned = 0;
    let extras = 0;
    for (const [code] of stickers) {
        const count = getCount(code);
        if (count >= 1) {
            owned++;
            extras += count - 1;
        }
    }
    return { owned, extras, total: stickers.length };
}

function updateAllStats() {
    let totalOwned = 0;
    let totalExtras = 0;
    let totalStickers = 0;
    for (const section of STICKER_DATA) {
        const s = computeStats(section.stickers);
        totalOwned += s.owned;
        totalExtras += s.extras;
        totalStickers += s.total;
        const teamProgress = document.querySelector(`[data-team-progress="${CSS.escape(section.team)}"]`);
        if (teamProgress) {
            teamProgress.innerHTML = `<strong>${s.owned}</strong> / ${s.total} collected` +
                (s.extras > 0 ? ` &middot; +${s.extras} extras` : "");
        }
    }
    const pct = totalStickers === 0 ? 0 : (totalOwned / totalStickers) * 100;
    const pctDisplay = pct === 0 || pct === 100 ? pct.toFixed(0) : pct.toFixed(1);

    document.getElementById("count-owned").textContent = totalOwned;
    document.getElementById("count-all").textContent = totalStickers;
    document.getElementById("count-pct").textContent = `${pctDisplay}%`;
    document.getElementById("count-dups").textContent =
        `${totalExtras} duplicate${totalExtras === 1 ? "" : "s"}`;
    document.getElementById("progress-fill").style.width = `${pct}%`;

    // Sidebar progress widget (editorial design)
    const sbCount = document.getElementById("sidebar-progress-count");
    const sbPct   = document.getElementById("sidebar-progress-pct");
    const sbFill  = document.getElementById("sidebar-progress-fill");
    if (sbCount) sbCount.textContent = `${totalOwned}/${totalStickers}`;
    if (sbPct)   sbPct.textContent   = `${pctDisplay}%`;
    if (sbFill)  sbFill.style.width  = `${pct}%`;
}

function stickerMatchesStatus(count) {
    switch (filterState.status) {
        case "missing":
            return count === 0;
        case "collected":
            return count >= 1;
        case "duplicates":
            return count >= 2;
        case "all":
        default:
            return true;
    }
}

function stickerMatchesSearch(code, teamName) {
    const q = filterState.search.toLowerCase();
    if (!q) return true;
    return code.toLowerCase().includes(q) || teamName.toLowerCase().includes(q);
}

function applyFilters({ scroll = false } = {}) {
    let firstVisibleSection = null;
    let anyVisible = false;

    for (const sectionEl of document.querySelectorAll(".team-section")) {
        const teamName = sectionEl.dataset.team || "";
        let teamHasVisible = false;
        for (const stickerEl of sectionEl.querySelectorAll(".sticker")) {
            const code = stickerEl.dataset.code;
            const count = getCount(code);
            const visible = stickerMatchesStatus(count) && stickerMatchesSearch(code, teamName);
            stickerEl.classList.toggle("hidden", !visible);
            if (visible) teamHasVisible = true;
        }
        sectionEl.classList.toggle("hidden", !teamHasVisible);
        if (teamHasVisible) {
            anyVisible = true;
            if (!firstVisibleSection) firstVisibleSection = sectionEl;
        }
    }

    updateEmptyState(!anyVisible);

    // Scroll only when searching AND the top-most visible team has changed.
    if (scroll && filterState.search && firstVisibleSection && firstVisibleSection !== lastFirstVisibleSection) {
        firstVisibleSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    lastFirstVisibleSection = firstVisibleSection;
}

function updateEmptyState(isEmpty) {
    const root = document.getElementById("sections");
    let emptyEl = document.getElementById("empty-state");
    if (isEmpty) {
        if (!emptyEl) {
            emptyEl = document.createElement("div");
            emptyEl.id = "empty-state";
            emptyEl.className = "empty-state";
            root.appendChild(emptyEl);
        }
        const parts = [];
        if (filterState.search) parts.push(`matching <strong>"${escapeHtml(filterState.search)}"</strong>`);
        if (filterState.status !== "all") parts.push(`in <strong>${filterState.status}</strong>`);
        emptyEl.innerHTML = parts.length
            ? `No stickers ${parts.join(" ")}.`
            : "No stickers to show.";
        emptyEl.classList.remove("hidden");
    } else if (emptyEl) {
        emptyEl.classList.add("hidden");
    }
}

function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

// ----- Lucide icon helpers ---------------------------------------------------
// Lucide's UMD script (loaded from CDN in index.html) exposes window.lucide.
// Calling lucide.createIcons() scans the document for <i data-lucide="name">
// elements and replaces each with an inline <svg>. It's idempotent and cheap,
// so we call it after every render path that injects new icon markup.
function lucideIcon(name, extraClass = "") {
    const i = document.createElement("i");
    i.setAttribute("data-lucide", name);
    i.setAttribute("aria-hidden", "true");
    if (extraClass) i.className = extraClass;
    return i;
}
function refreshIcons() {
    if (typeof window === "undefined") return;
    const l = window.lucide;
    if (l && typeof l.createIcons === "function") {
        try { l.createIcons(); } catch (e) { /* ignore */ }
    }
}

function setStatusFilter(status) {
    if (filterState.status === status) return;
    filterState.status = status;
    for (const btn of document.querySelectorAll(".filter-btn")) {
        btn.classList.toggle("active", btn.dataset.filter === status);
    }
    lastFirstVisibleSection = null; // allow next search scroll to fire
    applyFilters();
}

function setSearch(query) {
    const next = query.trim();
    if (filterState.search === next) return;
    filterState.search = next;
    applyFilters({ scroll: true });
}

function wireFilterControls() {
    for (const btn of document.querySelectorAll(".filter-btn")) {
        btn.addEventListener("click", () => setStatusFilter(btn.dataset.filter));
    }
    const searchInput = document.getElementById("search-input");
    if (searchInput) {
        searchInput.addEventListener("input", (e) => setSearch(e.target.value));
    }
}

/* ---------- Reset + Export ---------- */

async function resetCollection() {
    // Snapshot for revert-on-failure
    const previous = { ...collection };
    collection = {};
    for (const section of STICKER_DATA) {
        for (const [code] of section.stickers) renderSticker(code);
    }
    updateAllStats();
    applyFilters();

    // Wipe the cloud rows for this user. Legacy localStorage is left untouched
    // so Step 6's import button can still find it.
    if (!sb || !currentUser) return;
    const { error } = await sb
        .from("collections")
        .delete()
        .eq("user_id", currentUser.id);
    if (error) {
        console.error("Failed to reset cloud collection:", error);
        collection = previous;
        for (const section of STICKER_DATA) {
            for (const [code] of section.stickers) renderSticker(code);
        }
        updateAllStats();
        applyFilters();
        showToast("Couldn't reset your collection. Reverted.");
    }
}

/* ---------- Import legacy localStorage data ---------- */

// Returns the migrated legacy collection if any exists, otherwise null.
function readLegacyLocalData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const migrated = migrateCollection(parsed);
        const keys = Object.keys(migrated);
        if (keys.length === 0) return null;
        return migrated;
    } catch (e) {
        console.warn("Could not read legacy data:", e);
        return null;
    }
}

// Should the "Import my old data" button be visible?
// Only when: signed in + legacy data exists + import hasn't already happened.
function hasImportableLegacyData() {
    if (!currentUser) return false;
    if (localStorage.getItem(IMPORTED_FLAG_KEY) === "true") return false;
    return readLegacyLocalData() !== null;
}

function refreshImportButtonVisibility() {
    const btn = document.getElementById("import-btn");
    if (!btn) return;
    btn.classList.toggle("hidden", !hasImportableLegacyData());
}

async function importLegacyData() {
    if (!sb || !currentUser) {
        showToast("Sign in first.");
        return;
    }
    const legacy = readLegacyLocalData();
    if (!legacy) {
        showToast("No local data to import.");
        refreshImportButtonVisibility();
        return;
    }

    const btn = document.getElementById("import-btn");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Importing…";
    }

    try {
        // Merge by taking the higher count per sticker. Never reduce a cloud
        // value with a smaller local value — that would lose progress.
        const rowsToUpsert = [];
        for (const [code, localCount] of Object.entries(legacy)) {
            const cloudCount = collection[code] || 0;
            const merged = Math.max(cloudCount, localCount);
            if (merged > cloudCount) {
                rowsToUpsert.push({
                    user_id: currentUser.id,
                    sticker_code: code,
                    count: merged,
                });
            }
        }

        if (rowsToUpsert.length === 0) {
            // Nothing new to write — cloud already has everything.
            localStorage.setItem(IMPORTED_FLAG_KEY, "true");
            refreshImportButtonVisibility();
            showToast("Your cloud collection already covers your local data. Nothing to import.");
            return;
        }

        // Single batched upsert — one network round-trip regardless of size.
        const { error } = await sb
            .from("collections")
            .upsert(rowsToUpsert, { onConflict: "user_id,sticker_code" });
        if (error) throw error;

        // Update in-memory state and re-render.
        for (const row of rowsToUpsert) {
            collection[row.sticker_code] = row.count;
        }
        for (const section of STICKER_DATA) {
            for (const [code] of section.stickers) renderSticker(code);
        }
        updateAllStats();
        applyFilters();

        localStorage.setItem(IMPORTED_FLAG_KEY, "true");
        refreshImportButtonVisibility();

        const stickerCount = rowsToUpsert.length;
        alert(
            `Imported ${stickerCount} sticker${stickerCount === 1 ? "" : "s"} from your local data. ` +
            `Your old data is still saved in this browser as a backup.`
        );
    } catch (e) {
        console.error("Import failed:", e);
        showToast("Import failed. Check the console and try again.");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "Import my old data";
        }
    }
}

function exportCollection() {
    let owned = 0;
    let extras = 0;
    let total = 0;
    const items = [];

    for (const section of STICKER_DATA) {
        for (const [code, name] of section.stickers) {
            total++;
            const count = getCount(code);
            if (count <= 0) continue;
            owned++;
            extras += count - 1;
            items.push({
                code,
                team: section.team,
                name,
                count,
                extras: count - 1,
            });
        }
    }

    const payload = {
        app: "WC 2026 Sticker Tracker",
        exported: new Date().toISOString(),
        stats: { owned, total, duplicates: extras },
        collection: items,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `wc2026-stickers-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ---------- Modal ---------- */

let modalTriggerEl = null;

function openResetModal() {
    modalTriggerEl = document.activeElement;
    const modal = document.getElementById("reset-modal");
    modal.classList.remove("hidden");
    // Focus the safe option, not the destructive one
    document.getElementById("modal-cancel").focus();
    document.addEventListener("keydown", handleModalKeydown);
}

function closeResetModal() {
    const modal = document.getElementById("reset-modal");
    modal.classList.add("hidden");
    document.removeEventListener("keydown", handleModalKeydown);
    if (modalTriggerEl && typeof modalTriggerEl.focus === "function") {
        modalTriggerEl.focus();
    }
    modalTriggerEl = null;
}

function handleModalKeydown(e) {
    if (e.key === "Escape") {
        e.preventDefault();
        closeResetModal();
    }
}

function wireFooterControls() {
    document.getElementById("export-btn").addEventListener("click", exportCollection);
    document.getElementById("import-btn")?.addEventListener("click", importLegacyData);
    document.getElementById("reset-btn").addEventListener("click", openResetModal);
    document.getElementById("modal-cancel").addEventListener("click", closeResetModal);
    document.getElementById("modal-confirm").addEventListener("click", () => {
        resetCollection();
        closeResetModal();
    });
    for (const el of document.querySelectorAll("[data-modal-close]")) {
        el.addEventListener("click", closeResetModal);
    }
}

/* ---------- Group + team meta helpers ---------- */

const GROUPS = {
    A: ["Mexico", "South Africa", "Korea Republic", "Czechia"],
    B: ["Canada", "Bosnia-Herzegovina", "Qatar", "Switzerland"],
    C: ["Brazil", "Morocco", "Haiti", "Scotland"],
    D: ["USA", "Paraguay", "Australia", "Türkiye"],
    E: ["Germany", "Curaçao", "Côte d'Ivoire", "Ecuador"],
    F: ["Netherlands", "Japan", "Sweden", "Tunisia"],
    G: ["Belgium", "Egypt", "IR Iran", "New Zealand"],
    H: ["Spain", "Cabo Verde", "Saudi Arabia", "Uruguay"],
    I: ["France", "Senegal", "Iraq", "Norway"],
    J: ["Argentina", "Algeria", "Austria", "Jordan"],
    K: ["Portugal", "Congo DR", "Uzbekistan", "Colombia"],
    L: ["England", "Croatia", "Ghana", "Panama"],
};
// Stable group-rendering order.
const GROUP_ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

const TEAM_PRIMARY_OVERRIDE = {
    // Group A
    "Mexico": "#006847",
    "South Africa": "#E03C31",
    "Korea Republic": "#003478",
    "Czechia": "#11457E",
    // Group B
    "Canada": "#D52B1E",
    "Bosnia-Herzegovina": "#002395",
    "Qatar": "#8A1538",
    "Switzerland": "#DA291C",
    // Group C
    "Brazil": "#009C3B",
    "Morocco": "#C1272D",
    "Haiti": "#00209F",
    "Scotland": "#005EB8",
    // Group D
    "USA": "#002868",
    "Paraguay": "#DA121A",
    "Australia": "#B73070",
    "Türkiye": "#E30A17",
    // Group E
    "Germany": "#DD0000",
    "Curaçao": "#002B7F",
    "Côte d'Ivoire": "#FF8200",
    "Ecuador": "#ED1C24",
    // Group F
    "Netherlands": "#FF6600",
    "Japan": "#BC002D",
    "Sweden": "#006AA7",
    "Tunisia": "#E70013",
    // Group G
    "Belgium": "#ED2939",
    "Egypt": "#CE1126",
    "IR Iran": "#239F40",
    "New Zealand": "#1F3D7A",
    // Group H
    "Spain": "#AA151B",
    "Cabo Verde": "#003893",
    "Saudi Arabia": "#006C35",
    "Uruguay": "#1E5BBF",
    // Group I
    "France": "#002654",
    "Senegal": "#E31B23",
    "Iraq": "#CE1126",
    "Norway": "#002868",
    // Group J
    "Argentina": "#74ACDF",
    "Algeria": "#006233",
    "Austria": "#DC1E29",
    "Jordan": "#007A3D",
    // Group K
    "Portugal": "#006600",
    "Congo DR": "#007FFF",
    "Uzbekistan": "#0099B5",
    "Colombia": "#003893",
    // Group L
    "England": "#CE1124",
    "Croatia": "#171796",
    "Ghana": "#CE1126",
    "Panama": "#D21034",
};

// Real federation names where known. Falls back to "[Federation Name]" placeholder.
const TEAM_FEDERATION = {
    // Group B
    "Canada": "Canadian Soccer Association",
    "Bosnia-Herzegovina": "Nogometni/Fudbalski Savez Bosne i Hercegovine",
    "Qatar": "Qatar Football Association",
    "Switzerland": "Schweizerischer Fussballverband",
    // Group C
    "Brazil": "Confederação Brasileira de Futebol",
    "Morocco": "Fédération Royale Marocaine de Football",
    "Haiti": "Fédération Haïtienne de Football",
    "Scotland": "Scotland National Team",
    // Group D
    "USA": "U.S. Soccer Federation",
    "Paraguay": "Asociación Paraguaya de Fútbol",
    "Australia": "Football Australia",
    "Türkiye": "Türkiye Futbol Federasyonu",
    // Group E
    "Germany": "Deutscher Fußball-Bund",
    "Curaçao": "Federashon Futbol Kòrsou",
    "Côte d'Ivoire": "Fédération Ivoirienne de Football",
    "Ecuador": "Federación Ecuatoriana de Fútbol",
    // Group F
    "Netherlands": "Koninklijke Nederlandse Voetbalbond",
    "Japan": "Japan Football Association",
    "Sweden": "Svenska Fotbollförbundet",
    "Tunisia": "Fédération Tunisienne de Football",
    // Group G
    "Belgium": "Union Royale Belge des Sociétés de Football-Association",
    "Egypt": "Egyptian Football Association",
    "IR Iran": "Football Federation Islamic Republic of Iran",
    "New Zealand": "New Zealand Football",
    // Group H
    "Spain": "Real Federación Española de Fútbol",
    "Cabo Verde": "Federação Cabo-verdiana de Futebol",
    "Saudi Arabia": "Saudi Arabian Football Federation",
    "Uruguay": "Asociación Uruguaya de Fútbol",
    // Group I
    "France": "Fédération Française de Football",
    "Senegal": "Fédération Sénégalaise de Football",
    "Iraq": "Iraqi Football Association",
    "Norway": "Norges Fotballforbund",
    // Group J
    "Argentina": "Asociación del Fútbol Argentino",
    "Algeria": "Fédération Algérienne de Football",
    "Austria": "Österreichischer Fußball-Bund",
    "Jordan": "Jordan Football Association",
    // Group K
    "Portugal": "Federação Portuguesa de Futebol",
    "Congo DR": "Fédération Congolaise de Football Association",
    "Uzbekistan": "O'zbekiston Futbol Assotsiatsiyasi",
    "Colombia": "Federación Colombiana de Fútbol",
    // Group L
    "England": "The Football Association",
    "Croatia": "Hrvatski nogometni savez",
    "Ghana": "Ghana Football Association",
    "Panama": "Federación Panameña de Fútbol",
};

// Sections that aren't a real "team" — these skip the 4x5 album-spread treatment.
const NON_TEAM_SECTIONS = new Set([
    "Introduction",
    "World Cup History",
    "Coca-Cola Insert Set",
]);

function getGroupForTeam(name) {
    for (const [id, teams] of Object.entries(GROUPS)) {
        if (teams.includes(name)) return { id, teams };
    }
    return null;
}

function isHexLight(hex) {
    const h = (hex || "").replace("#", "");
    if (h.length !== 6) return false;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 180;
}

function getTeamPrimary(name) {
    if (TEAM_PRIMARY_OVERRIDE[name]) return TEAM_PRIMARY_OVERRIDE[name];
    if (typeof TEAM_META === "undefined") return "#475569";
    const meta = TEAM_META[name];
    if (!meta || !meta.colors || meta.colors.length === 0) return "#475569";
    // First non-light color, falling back to the first.
    return meta.colors.find((c) => !isHexLight(c)) || meta.colors[0];
}

function getTeamFederation(name) {
    return TEAM_FEDERATION[name] || "[Federation Name]";
}

// ISO 3166-1 alpha-2 (lowercase) for flag-icons CSS classes. Derived from the
// regional-indicator codepoints in TEAM_META[name].flag for normal countries.
// England/Scotland use UK subdivision codes; non-team sections return null.
function getCountryCode(name) {
    if (name === "England") return "gb-eng";
    if (name === "Scotland") return "gb-sct";
    if (NON_TEAM_SECTIONS.has(name)) return null;
    const meta = (typeof TEAM_META !== "undefined") ? TEAM_META[name] : null;
    if (!meta || !meta.flag) return null;
    const chars = [...meta.flag];
    if (chars.length !== 2) return null;
    try {
        return chars
            .map((c) => String.fromCharCode(c.codePointAt(0) - 0x1F1E6 + 65))
            .join("")
            .toLowerCase();
    } catch (e) {
        return null;
    }
}

// "MEX7" -> "MEX 7"; "FWC13" -> "FWC 13"; leaves "00" untouched.
function formatStickerCode(code) {
    return code.replace(/^([A-Z]+)(\d+)$/, "$1 $2");
}

// Order matches the actual album layout:
// Introduction → all 12 groups (A-L, with teams in user-specified order) →
// any remaining unclaimed teams → World Cup History → Coca-Cola insert last.
function sortedSections() {
    const all = STICKER_DATA;
    const result = [];

    const pushByName = (name) => {
        const s = all.find((x) => x.team === name);
        if (s) result.push(s);
    };

    pushByName("Introduction");

    const claimed = new Set(["Introduction", "World Cup History", "Coca-Cola Insert Set"]);
    for (const groupId of GROUP_ORDER) {
        const teams = GROUPS[groupId];
        if (!teams) continue;
        for (const name of teams) {
            pushByName(name);
            claimed.add(name);
        }
    }

    for (const s of all) {
        if (!claimed.has(s.team)) result.push(s);
    }

    pushByName("World Cup History");
    pushByName("Coca-Cola Insert Set");
    return result;
}

/* ---------- DOM builders ---------- */

function buildGroupHeader(group) {
    const el = document.createElement("div");
    el.className = "group-header";

    const title = document.createElement("h2");
    title.className = "group-title";
    title.textContent = `Group ${group.id}`;
    el.appendChild(title);

    const teams = document.createElement("div");
    teams.className = "group-teams";
    for (const teamName of group.teams) {
        const meta = (typeof TEAM_META !== "undefined" && TEAM_META[teamName]) || { flag: "🏳" };
        const chip = document.createElement("span");
        chip.className = "group-team";
        chip.dataset.team = teamName;
        const flag = document.createElement("span");
        const iso = getCountryCode(teamName);
        if (iso) {
            flag.className = `group-flag fi fi-${iso}`;
        } else {
            flag.className = "group-flag";
            flag.textContent = meta.flag || "🏳";
        }
        const name = document.createElement("span");
        name.textContent = teamName;
        chip.appendChild(flag);
        chip.appendChild(name);
        teams.appendChild(chip);
    }
    el.appendChild(teams);
    return el;
}

// Stylized FIFA World Cup trophy silhouette, used for the Introduction
// section instead of a generic trophy emoji. Globe + tulip arms + green
// malachite-banded pedestal.
const WORLD_CUP_TROPHY_SVG = `<svg viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="trophy-svg">
<defs>
<linearGradient id="trophy-gold" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#fde68a"/>
<stop offset="50%" stop-color="#fbbf24"/>
<stop offset="100%" stop-color="#854d0e"/>
</linearGradient>
</defs>
<circle cx="16" cy="7" r="5.5" fill="url(#trophy-gold)" stroke="#78350f" stroke-width="0.4"/>
<ellipse cx="16" cy="5" rx="2.5" ry="1" fill="#fef3c7" opacity="0.7"/>
<path d="M 10 12 C 8 18 9 23 12 26 L 20 26 C 23 23 24 18 22 12 C 20 12 19 13 18 13 C 17 13 16.5 13.5 16 13.5 C 15.5 13.5 15 13 14 13 C 13 13 12 12 10 12 Z" fill="url(#trophy-gold)" stroke="#78350f" stroke-width="0.3"/>
<line x1="12" y1="22" x2="20" y2="22" stroke="#78350f" stroke-width="0.3" opacity="0.5"/>
<path d="M 11 26 L 21 26 L 22 35 L 10 35 Z" fill="url(#trophy-gold)" stroke="#78350f" stroke-width="0.3"/>
<rect x="10.2" y="28" width="11.6" height="1.4" fill="#15803d"/>
<rect x="10.2" y="31" width="11.6" height="1.4" fill="#15803d"/>
</svg>`;

function buildTeamSection(section) {
    const sectionEl = document.createElement("section");
    sectionEl.className = "team-section";
    sectionEl.dataset.team = section.team;

    const meta = (typeof TEAM_META !== "undefined" && TEAM_META[section.team]) || { flag: "" };
    const primary = getTeamPrimary(section.team);
    const isRealTeam = !NON_TEAM_SECTIONS.has(section.team) && section.stickers.length === 20;

    // Header band
    const band = document.createElement("div");
    band.className = "team-band";
    band.style.background = primary;

    const flagEl = document.createElement("span");
    const iso = getCountryCode(section.team);
    if (section.team === "Introduction") {
        // Special-case the Introduction section with a custom trophy SVG.
        flagEl.className = "team-band-flag trophy-icon";
        flagEl.innerHTML = WORLD_CUP_TROPHY_SVG;
    } else if (iso) {
        flagEl.className = `team-band-flag fi fi-${iso}`;
    } else {
        flagEl.className = "team-band-flag";
        flagEl.textContent = meta.flag || "";
    }

    const textCol = document.createElement("div");
    textCol.className = "team-band-text";
    const nameEl = document.createElement("h2");
    nameEl.className = "team-band-name";
    nameEl.textContent = section.team;
    const fedEl = document.createElement("p");
    fedEl.className = "team-band-federation";
    fedEl.textContent = isRealTeam ? getTeamFederation(section.team) : "";
    textCol.appendChild(nameEl);
    if (fedEl.textContent) textCol.appendChild(fedEl);

    const progressEl = document.createElement("span");
    progressEl.className = "team-band-progress";
    progressEl.dataset.teamProgress = section.team;

    band.appendChild(flagEl);
    band.appendChild(textCol);
    band.appendChild(progressEl);
    sectionEl.appendChild(band);

    // 4-column album grid
    const grid = document.createElement("div");
    grid.className = "album-grid";
    grid.style.setProperty("--team-primary", primary);
    if (!isRealTeam) grid.classList.add("album-grid--special");

    section.stickers.forEach(([code, name], i) => {
        const btn = document.createElement("button");
        btn.className = "sticker";
        if (isRealTeam && i === 0) btn.classList.add("badge-cell");
        if (isRealTeam && i === 12) btn.classList.add("country-cell");
        btn.dataset.code = code;
        btn.title = `${formatStickerCode(code)} — ${name}`;
        btn.type = "button";

        const codeEl = document.createElement("span");
        codeEl.className = "sticker-code";
        codeEl.textContent = formatStickerCode(code);

        const nameEl = document.createElement("span");
        nameEl.className = "sticker-name";
        nameEl.textContent = name;

        btn.appendChild(codeEl);
        btn.appendChild(nameEl);

        btn.addEventListener("click", () => incrementCount(code));
        btn.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            decrementCount(code);
        });
        grid.appendChild(btn);
    });

    sectionEl.appendChild(grid);
    return sectionEl;
}

function buildSections() {
    const root = document.getElementById("sections");
    const frag = document.createDocumentFragment();
    const sections = sortedSections();
    const groupsRendered = new Set();

    for (const section of sections) {
        const group = getGroupForTeam(section.team);
        if (group && !groupsRendered.has(group.id)) {
            groupsRendered.add(group.id);
            frag.appendChild(buildGroupHeader(group));
        }
        frag.appendChild(buildTeamSection(section));
    }

    root.appendChild(frag);

    for (const section of STICKER_DATA) {
        for (const [code] of section.stickers) renderSticker(code);
    }
    updateAllStats();

    setupAlbumScrollSpy();
}

// Highlights the country chip in the (sticky) group header that corresponds
// to whichever team-section is currently in the focus band just below the
// sticky header. Uses IntersectionObserver — runs only when sections scroll
// in/out of the band, so it's essentially free at idle.
function setupAlbumScrollSpy() {
    if (window._albumScrollSpy) {
        window._albumScrollSpy.disconnect();
        window._albumScrollSpy = null;
    }
    const sections = document.querySelectorAll("#sections .team-section");
    if (sections.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            const teamName = entry.target.dataset.team;
            if (!teamName) continue;
            const chip = document.querySelector(`.group-team[data-team="${CSS.escape(teamName)}"]`);
            if (!chip) continue;
            chip.classList.toggle("is-current", entry.isIntersecting);
        }
    }, {
        // Focus band: from ~100px below the top of the viewport (clears the
        // top bar + sticky group header) down to ~85% from the top. A team
        // becomes "current" when its top edge enters this band.
        rootMargin: "-100px 0px -85% 0px",
        threshold: 0,
    });

    for (const section of sections) observer.observe(section);
    window._albumScrollSpy = observer;
}

/* =============================================================
   Auth & startup
   ============================================================= */

function showAuthScreen() {
    document.getElementById("auth-screen")?.classList.remove("hidden");
    document.getElementById("loading-screen")?.classList.add("hidden");
}

function hideAuthScreen() {
    document.getElementById("auth-screen")?.classList.add("hidden");
}

function showLoading() {
    document.getElementById("loading-screen")?.classList.remove("hidden");
}

function hideLoading() {
    document.getElementById("loading-screen")?.classList.add("hidden");
}

function showUserWidget(user) {
    const shell = document.getElementById("app-shell");
    if (shell) shell.classList.remove("hidden");

    const label = document.getElementById("user-label");
    if (label) label.textContent = user?.email || "Signed in";

    // Profile view fields.
    const emailEl = document.getElementById("profile-email");
    if (emailEl) emailEl.textContent = user?.email || "";
    refreshProfileDisplayName(); // best-effort fetch
}

function hideUserWidget() {
    document.getElementById("app-shell")?.classList.add("hidden");
}

// Fetch the current user's display name from profiles and write it into the
// Profile view. Falls back to "(not set)" if empty.
async function refreshProfileDisplayName() {
    const el = document.getElementById("profile-display-name");
    if (!el || !sb || !currentUser) return;
    try {
        const { data } = await sb
            .from("profiles")
            .select("display_name")
            .eq("id", currentUser.id)
            .single();
        el.textContent = data?.display_name || "(not set)";
    } catch (e) {
        el.textContent = "(not set)";
    }
}

/* ============================================================
   View routing — sidebar nav + URL ?view=xxx
   ============================================================ */

const VIEW_TITLES = {
    home:      "Home",
    album:     "Album",
    wanted:    "Trade",   // "Discover" sub-tab of the merged Trade section
    trades:    "Trade",   // "My trades" sub-tab of the merged Trade section
    community: "Community",
    activity:  "Activity",
    profile:   "Profile",
};

function getCurrentViewFromUrl() {
    try {
        const v = new URL(window.location.href).searchParams.get("view");
        return v && VIEW_TITLES[v] ? v : "home";
    } catch (e) {
        return "album";
    }
}

function showView(viewKey, options = {}) {
    if (!VIEW_TITLES[viewKey]) viewKey = "home";

    // Toggle .view-active across all view sections.
    document.querySelectorAll(".view").forEach((el) => {
        el.classList.toggle("view-active", el.id === `view-${viewKey}`);
    });
    // Active state on sidebar nav. The single "Trade" sidebar entry
    // (data-view="wanted") covers both the Discover (wanted) and My-trades
    // (trades) sub-tabs.
    document.querySelectorAll(".nav-item").forEach((btn) => {
        const dv = btn.dataset.view;
        const matches = dv === viewKey
            || (dv === "wanted" && viewKey === "trades");
        btn.classList.toggle("active", matches);
    });
    // Top-bar title.
    const titleEl = document.getElementById("top-bar-title");
    if (titleEl) titleEl.textContent = VIEW_TITLES[viewKey];

    // Close mobile drawer.
    document.getElementById("sidebar")?.classList.remove("open");
    document.getElementById("sidebar-backdrop")?.classList.remove("open");

    // Per-view refreshes — fetch the data each view needs and re-render.
    if (viewKey === "profile") {
        refreshProfileDisplayName();
    } else if (viewKey === "community") {
        // Always start on the member list — don't preserve trade-builder or
        // community-detail state from a previous navigation.
        closeTradeView();
        closeCommunityDetail();
        refreshCommunityView().catch((e) => console.warn(e));
    } else if (viewKey === "trades") {
        refreshTradesView().catch((e) => console.warn(e));
    } else if (viewKey === "wanted") {
        refreshWantedView().catch((e) => console.warn(e));
    } else if (viewKey === "activity") {
        refreshActivityView().catch((e) => console.warn(e));
    } else if (viewKey === "home") {
        refreshHomeView().catch((e) => console.warn(e));
    }

    // Update URL (unless we're handling a popstate event).
    if (!options.fromPopState) {
        try {
            const url = new URL(window.location.href);
            url.searchParams.set("view", viewKey);
            window.history.pushState({ view: viewKey }, "", url);
        } catch (e) {
            /* file:// URLs may not support pushState — fail quietly */
        }
    }
}

function wireShellControls() {
    // Sidebar nav clicks.
    for (const btn of document.querySelectorAll(".nav-item")) {
        btn.addEventListener("click", () => showView(btn.dataset.view));
    }
    // Mobile hamburger.
    document.getElementById("hamburger")?.addEventListener("click", () => {
        document.getElementById("sidebar")?.classList.toggle("open");
        document.getElementById("sidebar-backdrop")?.classList.toggle("open");
    });
    document.getElementById("sidebar-backdrop")?.addEventListener("click", () => {
        document.getElementById("sidebar")?.classList.remove("open");
        document.getElementById("sidebar-backdrop")?.classList.remove("open");
    });
    // (Phase 1A's temporary "Open trades/community" placeholder buttons are gone now.)
    // Profile "Edit" display name → reuse the existing edit handler.
    document.getElementById("profile-edit-name")?.addEventListener("click", async () => {
        await editMyDisplayName();
        await refreshProfileDisplayName();
    });
    // Browser back/forward.
    window.addEventListener("popstate", () => {
        showView(getCurrentViewFromUrl(), { fromPopState: true });
    });
}

function setAuthError(msg) {
    const el = document.getElementById("auth-error");
    if (el) el.textContent = msg || "";
}

function setAuthInfo(msg) {
    const el = document.getElementById("auth-info");
    if (el) el.textContent = msg || "";
}

function setFormMessage(prefix, kind, msg) {
    const el = document.getElementById(`${prefix}-${kind}`);
    if (el) el.textContent = msg || "";
}

function clearAuthMessages() {
    setAuthError("");
    setAuthInfo("");
    setFormMessage("forgot", "error", "");
    setFormMessage("forgot", "info", "");
    setFormMessage("recovery", "error", "");
    setFormMessage("recovery", "info", "");
}

// True between the moment a recovery link is detected and the password update
// completes. Used to suppress the normal "signed in → load collection" path,
// since Supabase opens a session with the recovery token.
let inRecoveryFlow = false;

// Fetch the user's collection rows from Supabase and populate the in-memory map.
async function loadCollectionFromCloud() {
    collection = {};
    if (!sb || !currentUser) return;
    const { data, error } = await sb
        .from("collections")
        .select("sticker_code, count")
        .eq("user_id", currentUser.id);
    if (error) {
        console.error("Failed to load collection:", error);
        showToast("Couldn't load your collection. Check your connection.");
        return;
    }
    for (const row of data || []) {
        if (row.count > 0) collection[row.sticker_code] = row.count;
    }
}

// Build the album for the first time after sign-in, OR re-render an existing
// album when a new session loads fresh data.
async function handleSignedIn(user) {
    currentUser = user;
    showLoading();
    hideAuthScreen();
    showUserWidget(user);

    // Ensure a profile row exists. Covers users who signed up before the
    // auto-create trigger was set up. `ignoreDuplicates: true` makes this a no-op
    // when the row already exists.
    try {
        await sb
            .from("profiles")
            .upsert({ id: user.id }, { onConflict: "id", ignoreDuplicates: true });
    } catch (e) {
        console.warn("Couldn't ensure profile row exists:", e);
    }

    await loadCollectionFromCloud();

    // Build sections on first sign-in, otherwise just re-render.
    const root = document.getElementById("sections");
    if (root && !root.children.length) {
        buildSections();
    } else {
        for (const section of STICKER_DATA) {
            for (const [code] of section.stickers) renderSticker(code);
        }
        updateAllStats();
        applyFilters();
    }
    refreshImportButtonVisibility();

    // Fetch pending requests so the Family badge can render correctly.
    refreshPendingRequests().catch((e) => console.warn("Pending requests fetch failed:", e));

    // Background-fetch my channels so the unread badges are accurate even
    // before the user opens any chat panel. Also starts the global realtime sub.
    (async () => {
        try {
            chatChannels = await fetchMyChannels();
            updateChatBadges();
            subscribeToAllChannels();
        } catch (e) { console.warn("Chat warmup failed:", e); }
    })();

    // Restore the view from the URL (or default to Album).
    showView(getCurrentViewFromUrl(), { fromPopState: true });

    hideLoading();
}

function handleSignedOut() {
    currentUser = null;
    collection = {};
    pendingRequestsCache = { incoming: [], outgoing: [] };
    bannerDismissedAtCount = -1;
    updateFamilyBadge();
    updateNotificationBanner();

    // Tear down chat state + realtime subscriptions.
    chatChannels = [];
    unsubscribeFromAllChannels();
    // Cleanup any embedded chat panels still mounted.
    unmountChatPanel(document.getElementById("community-chat-host"));
    unmountChatPanel(document.getElementById("group-chat-panel-host"));
    unmountChatPanel(document.getElementById("community-detail-chat-host"));
    for (const host of document.querySelectorAll(".trade-card-chat-host")) {
        unmountChatPanel(host);
    }
    updateChatBadges();

    // Wipe rendered state — empty out the sections so signing in as a different
    // user doesn't show the previous user's data briefly.
    const root = document.getElementById("sections");
    if (root) root.innerHTML = "";
    updateAllStats();
    hideUserWidget();
    refreshImportButtonVisibility(); // hides it since currentUser is null
    showAuthScreen();
    clearAuthMessages();
}

// Exposed at module scope so init() can flip into recovery mode when a
// reset-password link drops us back on the page.
let setAuthMode = null;

function wireAuthControls() {
    const tabSignin = document.getElementById("auth-tab-signin");
    const tabSignup = document.getElementById("auth-tab-signup");
    const tabs = document.querySelector(".auth-tabs");
    const form = document.getElementById("auth-form");
    const forgotForm = document.getElementById("forgot-form");
    const recoveryForm = document.getElementById("recovery-form");
    const nameField = document.querySelector(".auth-field-name");
    const passwordInput = document.getElementById("auth-password");
    const submitBtn = document.getElementById("auth-submit");
    const subtitle = document.querySelector(".auth-card > .auth-subtitle");

    let mode = "signin";

    const setMode = (next) => {
        mode = next;
        const isSignup = next === "signup";
        const isForgot = next === "forgot";
        const isRecovery = next === "recovery";
        const isCredentialForm = !isForgot && !isRecovery;

        // Tabs only make sense for signin / signup; hide them otherwise.
        tabs?.classList.toggle("hidden", !isCredentialForm);
        tabSignin?.classList.toggle("active", next === "signin");
        tabSignup?.classList.toggle("active", isSignup);
        tabSignin?.setAttribute("aria-selected", String(next === "signin"));
        tabSignup?.setAttribute("aria-selected", String(isSignup));

        // Swap which form is visible.
        form?.classList.toggle("hidden", !isCredentialForm);
        forgotForm?.classList.toggle("hidden", !isForgot);
        recoveryForm?.classList.toggle("hidden", !isRecovery);

        // Signup-only display name field.
        nameField?.classList.toggle("hidden", !isSignup);

        if (passwordInput) {
            passwordInput.autocomplete = isSignup ? "new-password" : "current-password";
        }
        if (submitBtn) submitBtn.textContent = isSignup ? "Create account" : "Sign in";

        // Subtitle text adapts to context. The forgot/recovery forms carry
        // their own inline explainer, so we hide the card subtitle there.
        if (subtitle) {
            if (isRecovery) {
                subtitle.textContent = "Almost there.";
                subtitle.classList.remove("hidden");
            } else if (isForgot) {
                subtitle.classList.add("hidden");
            } else {
                subtitle.textContent = "Sign in to track your collection.";
                subtitle.classList.remove("hidden");
            }
        }

        clearAuthMessages();
    };
    setAuthMode = setMode;

    tabSignin?.addEventListener("click", () => setMode("signin"));
    tabSignup?.addEventListener("click", () => setMode("signup"));

    document.getElementById("auth-forgot-link")?.addEventListener("click", () => {
        // Pre-fill the forgot-form email with whatever the user already typed.
        const typed = document.getElementById("auth-email")?.value?.trim();
        const forgotEmail = document.getElementById("forgot-email");
        if (forgotEmail && typed) forgotEmail.value = typed;
        setMode("forgot");
    });

    document.getElementById("forgot-back-link")?.addEventListener("click", () => {
        setMode("signin");
    });

    forgotForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        setFormMessage("forgot", "error", "");
        setFormMessage("forgot", "info", "");
        if (!sb) {
            setFormMessage("forgot", "error", "Auth not initialized. Refresh the page.");
            return;
        }
        const email = document.getElementById("forgot-email").value.trim();
        const btn = document.getElementById("forgot-submit");
        btn.disabled = true;
        const originalLabel = btn.textContent;
        btn.textContent = "Sending…";
        try {
            // redirectTo must match an allowed URL configured in the Supabase
            // dashboard (Authentication → URL Configuration → Redirect URLs).
            // We use the current origin + path so localhost dev works alongside
            // a deployed origin without code changes.
            const redirectTo = window.location.origin + window.location.pathname;
            const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
            if (error) throw error;
            setFormMessage("forgot", "info", "If an account exists for that email, a reset link is on its way. Check your inbox.");
        } catch (err) {
            console.error(err);
            setFormMessage("forgot", "error", err?.message || "Couldn't send reset email.");
        } finally {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    });

    recoveryForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        setFormMessage("recovery", "error", "");
        setFormMessage("recovery", "info", "");
        if (!sb) {
            setFormMessage("recovery", "error", "Auth not initialized. Refresh the page.");
            return;
        }
        const pw1 = document.getElementById("recovery-password").value;
        const pw2 = document.getElementById("recovery-password-confirm").value;
        if (pw1.length < 6) {
            setFormMessage("recovery", "error", "Password must be at least 6 characters.");
            return;
        }
        if (pw1 !== pw2) {
            setFormMessage("recovery", "error", "Passwords don't match.");
            return;
        }
        const btn = document.getElementById("recovery-submit");
        btn.disabled = true;
        const originalLabel = btn.textContent;
        btn.textContent = "Updating…";
        try {
            const { error } = await sb.auth.updateUser({ password: pw1 });
            if (error) throw error;
            // Done. Clear the recovery flag, scrub the access-token hash from
            // the URL, sign out the recovery session, and bounce back to the
            // sign-in form so the user logs in fresh with the new password.
            inRecoveryFlow = false;
            try {
                history.replaceState(null, "", window.location.pathname + window.location.search);
            } catch (_) { /* ignore */ }
            await sb.auth.signOut();
            setMode("signin");
            setAuthInfo("Password updated. Sign in with your new password.");
        } catch (err) {
            console.error(err);
            setFormMessage("recovery", "error", err?.message || "Couldn't update password.");
        } finally {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    });

    form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearAuthMessages();
        if (!sb) {
            setAuthError("Auth not initialized. Refresh the page.");
            return;
        }
        const email = document.getElementById("auth-email").value.trim();
        const password = document.getElementById("auth-password").value;
        const name = document.getElementById("auth-name").value.trim();

        submitBtn.disabled = true;
        submitBtn.textContent = mode === "signup" ? "Creating account…" : "Signing in…";

        try {
            if (mode === "signup") {
                const { data, error } = await sb.auth.signUp({
                    email,
                    password,
                    options: name ? { data: { display_name: name } } : undefined,
                });
                if (error) throw error;
                // If display name was provided, also write it to the profiles row
                // that the database trigger just created.
                if (name && data?.user?.id) {
                    await sb
                        .from("profiles")
                        .update({ display_name: name })
                        .eq("id", data.user.id);
                }
                // If email confirmation is enabled in the Supabase dashboard,
                // signUp returns a user but no session — they need to confirm first.
                if (!data?.session) {
                    setAuthInfo("Account created. Check your email to confirm, then sign in.");
                    setMode("signin");
                    return;
                }
                // Otherwise we're signed in immediately; onAuthStateChange will fire.
            } else {
                const { error } = await sb.auth.signInWithPassword({ email, password });
                if (error) throw error;
            }
        } catch (err) {
            console.error(err);
            setAuthError(err?.message || "Authentication failed.");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = mode === "signup" ? "Create account" : "Sign in";
        }
    });

    document.getElementById("signout-btn")?.addEventListener("click", async () => {
        if (!sb) return;
        const { error } = await sb.auth.signOut();
        if (error) {
            console.error(error);
            showToast("Couldn't sign out cleanly. Reloading.");
            location.reload();
        }
        // onAuthStateChange will fire and call handleSignedOut.
    });
}

/* ============================================================
   Family + Trading
   ============================================================ */

// Code → { team, name } lookup. Built once on first use.
let STICKER_INDEX = null;
function getStickerIndex() {
    if (STICKER_INDEX) return STICKER_INDEX;
    STICKER_INDEX = {};
    for (const section of STICKER_DATA) {
        for (const [code, name] of section.stickers) {
            STICKER_INDEX[code] = { team: section.team, name };
        }
    }
    return STICKER_INDEX;
}

let familyData = null; // { profiles: [...], collections: { userId: { code: count } } }

/* ============================================================
   LABELS (Phase 3) — private per-user tagging of community members.
   Each user manages their own labels and their own assignments;
   RLS makes other users' labels invisible.
   ============================================================ */

const LABEL_COLOR_PRESETS = [
    "#0F766E", // teal (matches accent)
    "#B45309", // amber
    "#1D4ED8", // blue
    "#9333EA", // violet
    "#BE185D", // pink
    "#15803D", // green
    "#4B5563", // slate
];

// Cached labels for the current user. byMember maps memberId -> [{ labelId, name, color }, ...].
let labelsData = { list: [], byMember: new Map() };
let activeLabelFilter = null; // null = "All", else a label.id

async function fetchLabels() {
    if (!sb || !currentUser) return { list: [], byMember: new Map() };

    // Labels owned by me (RLS auto-filters to owner_id = auth.uid()).
    const { data: labels, error: labelsErr } = await sb
        .from("labels")
        .select("id, name, color, created_at")
        .order("created_at", { ascending: true });
    if (labelsErr) throw labelsErr;

    // Assignments (RLS limits to my labels).
    const { data: assignments, error: asnErr } = await sb
        .from("member_labels")
        .select("label_id, member_id");
    if (asnErr) throw asnErr;

    const byLabel = new Map();
    for (const l of labels || []) byLabel.set(l.id, l);

    const byMember = new Map();
    for (const a of assignments || []) {
        const lbl = byLabel.get(a.label_id);
        if (!lbl) continue;
        if (!byMember.has(a.member_id)) byMember.set(a.member_id, []);
        byMember.get(a.member_id).push({
            labelId: lbl.id,
            name: lbl.name,
            color: lbl.color,
        });
    }

    return { list: labels || [], byMember };
}

async function createLabel(name, color) {
    if (!sb || !currentUser) return null;
    const clean = (name || "").trim();
    if (!clean) throw new Error("Label name can't be empty");
    const { data, error } = await sb
        .from("labels")
        .insert({
            owner_id: currentUser.id,
            name: clean,
            color: color || LABEL_COLOR_PRESETS[0],
        })
        .select("id, name, color, created_at")
        .single();
    if (error) throw error;
    return data;
}

async function updateLabel(labelId, fields) {
    if (!sb || !currentUser) return;
    const { error } = await sb.from("labels").update(fields).eq("id", labelId);
    if (error) throw error;
}

async function deleteLabel(labelId) {
    if (!sb || !currentUser) return;
    // member_labels rows cascade-delete via the FK on label_id.
    const { error } = await sb.from("labels").delete().eq("id", labelId);
    if (error) throw error;
}

async function addMemberToLabel(labelId, memberId) {
    if (!sb || !currentUser) return;
    const { error } = await sb
        .from("member_labels")
        .insert({ label_id: labelId, member_id: memberId });
    if (error) {
        // Unique constraint violation = already assigned, treat as success.
        const msg = String(error.message || "").toLowerCase();
        if (!msg.includes("duplicate") && !msg.includes("unique")) throw error;
    }
}

async function removeMemberFromLabel(labelId, memberId) {
    if (!sb || !currentUser) return;
    const { error } = await sb
        .from("member_labels")
        .delete()
        .eq("label_id", labelId)
        .eq("member_id", memberId);
    if (error) throw error;
}

// Convenience: refresh the cache + re-render any view that shows labels.
async function refreshLabels() {
    try {
        labelsData = await fetchLabels();
    } catch (e) {
        console.error("Failed to fetch labels:", e);
        labelsData = { list: [], byMember: new Map() };
    }
}

/* ----- Label manager modal ----- */

// State the modal uses while open.
let labelManagerState = { newColor: LABEL_COLOR_PRESETS[0], expandedLabelId: null };

async function openLabelManager() {
    // Make sure we have the latest data before opening.
    if (!familyData) {
        try { familyData = await fetchFamilyData(); } catch (e) { /* ignore */ }
    }
    await refreshLabels();
    const modal = document.getElementById("label-manager-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    renderLabelManager();
}

function closeLabelManager() {
    const modal = document.getElementById("label-manager-modal");
    if (modal) modal.classList.add("hidden");
}

function renderLabelManager() {
    const root = document.getElementById("label-manager-body");
    if (!root) return;
    root.innerHTML = "";

    // ----- "Create label" row -----
    const createRow = document.createElement("div");
    createRow.className = "label-create";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "New community name…";
    nameInput.className = "label-create-input";
    nameInput.maxLength = 40;
    createRow.appendChild(nameInput);

    const swatches = document.createElement("div");
    swatches.className = "label-color-picker";
    for (const c of LABEL_COLOR_PRESETS) {
        const sw = document.createElement("button");
        sw.type = "button";
        sw.className = "label-swatch" + (c === labelManagerState.newColor ? " active" : "");
        sw.style.background = c;
        sw.title = c;
        sw.setAttribute("aria-label", `Color ${c}`);
        sw.addEventListener("click", () => {
            labelManagerState.newColor = c;
            for (const child of swatches.children) {
                child.classList.toggle("active", child.title === c);
            }
        });
        swatches.appendChild(sw);
    }
    createRow.appendChild(swatches);

    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "btn btn-primary";
    createBtn.textContent = "Create";
    createBtn.addEventListener("click", async () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        createBtn.disabled = true;
        try {
            await createLabel(name, labelManagerState.newColor);
            await refreshLabels();
            nameInput.value = "";
            renderLabelManager();
            renderLabelFilterBar();
            renderFamilyList();
            renderWantedLabelBar();
        } catch (e) {
            alert("Couldn't create label: " + (e.message || e));
        } finally {
            createBtn.disabled = false;
        }
    });
    nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") createBtn.click();
    });
    createRow.appendChild(createBtn);

    root.appendChild(createRow);

    // ----- Existing labels list -----
    const list = document.createElement("div");
    list.className = "label-manager-list";

    if (labelsData.list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "trade-empty";
        empty.textContent = "No communities yet. Create your first one above.";
        list.appendChild(empty);
    } else {
        for (const lbl of labelsData.list) {
            list.appendChild(renderLabelManagerRow(lbl));
        }
    }
    root.appendChild(list);

    refreshIcons();
}

function renderLabelManagerRow(lbl) {
    const row = document.createElement("div");
    row.className = "label-manager-row";
    const expanded = labelManagerState.expandedLabelId === lbl.id;

    // Header: dot + name + member count + expand/delete buttons.
    const header = document.createElement("div");
    header.className = "label-manager-row-header";

    const dot = document.createElement("span");
    dot.className = "member-label-dot label-manager-dot";
    dot.style.setProperty("--label-color", lbl.color);
    header.appendChild(dot);

    const nameSpan = document.createElement("span");
    nameSpan.className = "label-manager-row-name";
    nameSpan.textContent = lbl.name;
    header.appendChild(nameSpan);

    const memberCount = countLabelMembers(lbl.id);
    const countSpan = document.createElement("span");
    countSpan.className = "label-manager-row-count";
    countSpan.textContent = `${memberCount} member${memberCount === 1 ? "" : "s"}`;
    header.appendChild(countSpan);

    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "btn btn-secondary btn-small";
    expandBtn.textContent = expanded ? "Done" : "Edit";
    expandBtn.addEventListener("click", () => {
        labelManagerState.expandedLabelId = expanded ? null : lbl.id;
        renderLabelManager();
    });
    header.appendChild(expandBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-secondary btn-icon";
    deleteBtn.title = "Delete label";
    deleteBtn.setAttribute("aria-label", "Delete label");
    deleteBtn.appendChild(lucideIcon("trash-2"));
    deleteBtn.addEventListener("click", async () => {
        if (!confirm(`Delete the label "${lbl.name}"? Members will no longer be tagged.`)) return;
        deleteBtn.disabled = true;
        try {
            await deleteLabel(lbl.id);
            if (activeLabelFilter === lbl.id) activeLabelFilter = null;
            if (activeWantedLabelFilter === lbl.id) activeWantedLabelFilter = null;
            await refreshLabels();
            renderLabelManager();
            renderLabelFilterBar();
            renderFamilyList();
            renderWantedLabelBar();
            renderWantedList();
        } catch (e) {
            alert("Couldn't delete: " + (e.message || e));
            deleteBtn.disabled = false;
        }
    });
    header.appendChild(deleteBtn);

    row.appendChild(header);

    // Body (when expanded): checklist of all members to add/remove.
    if (expanded) {
        const body = document.createElement("div");
        body.className = "label-manager-row-body";

        // Rename input.
        const renameWrap = document.createElement("div");
        renameWrap.className = "label-rename-wrap";
        const renameInput = document.createElement("input");
        renameInput.type = "text";
        renameInput.value = lbl.name;
        renameInput.className = "label-create-input";
        renameInput.maxLength = 40;
        const renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.className = "btn btn-secondary btn-small";
        renameBtn.textContent = "Rename";
        renameBtn.addEventListener("click", async () => {
            const next = renameInput.value.trim();
            if (!next || next === lbl.name) return;
            renameBtn.disabled = true;
            try {
                await updateLabel(lbl.id, { name: next });
                await refreshLabels();
                renderLabelManager();
                renderLabelFilterBar();
                renderFamilyList();
                renderWantedLabelBar();
            } catch (e) {
                alert("Couldn't rename: " + (e.message || e));
            } finally {
                renameBtn.disabled = false;
            }
        });
        renameWrap.appendChild(renameInput);
        renameWrap.appendChild(renameBtn);
        body.appendChild(renameWrap);

        // Color picker for this label (re-uses the same swatches design).
        const colorWrap = document.createElement("div");
        colorWrap.className = "label-color-picker";
        for (const c of LABEL_COLOR_PRESETS) {
            const sw = document.createElement("button");
            sw.type = "button";
            sw.className = "label-swatch" + (c === lbl.color ? " active" : "");
            sw.style.background = c;
            sw.title = c;
            sw.setAttribute("aria-label", `Color ${c}`);
            sw.addEventListener("click", async () => {
                if (c === lbl.color) return;
                try {
                    await updateLabel(lbl.id, { color: c });
                    await refreshLabels();
                    renderLabelManager();
                    renderLabelFilterBar();
                    renderFamilyList();
                    renderWantedLabelBar();
                } catch (e) {
                    alert("Couldn't update color: " + (e.message || e));
                }
            });
            colorWrap.appendChild(sw);
        }
        body.appendChild(colorWrap);

        // Member checklist.
        const memberList = document.createElement("div");
        memberList.className = "label-member-checklist";
        const sortedProfiles = [...(familyData?.profiles || [])]
            .filter((p) => p.id !== currentUser?.id)
            .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));

        if (sortedProfiles.length === 0) {
            const empty = document.createElement("div");
            empty.className = "trade-empty";
            empty.textContent = "No other members yet.";
            memberList.appendChild(empty);
        } else {
            for (const p of sortedProfiles) {
                const assignedLabels = labelsData.byMember.get(p.id) || [];
                const isAssigned = assignedLabels.some((l) => l.labelId === lbl.id);

                const wrap = document.createElement("label");
                wrap.className = "label-member-row";
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = isAssigned;
                cb.addEventListener("change", async () => {
                    cb.disabled = true;
                    try {
                        if (cb.checked) await addMemberToLabel(lbl.id, p.id);
                        else await removeMemberFromLabel(lbl.id, p.id);
                        await refreshLabels();
                        renderLabelManager();
                        renderLabelFilterBar();
                        renderFamilyList();
                        renderWantedLabelBar();
                        renderWantedList();
                    } catch (e) {
                        cb.checked = !cb.checked; // revert
                        alert("Couldn't update: " + (e.message || e));
                    } finally {
                        cb.disabled = false;
                    }
                });
                wrap.appendChild(cb);

                const nameEl = document.createElement("span");
                nameEl.textContent = p.display_name || "Unnamed user";
                wrap.appendChild(nameEl);

                memberList.appendChild(wrap);
            }
        }
        body.appendChild(memberList);

        row.appendChild(body);
    }

    return row;
}

function countLabelMembers(labelId) {
    let n = 0;
    for (const arr of labelsData.byMember.values()) {
        if (arr.some((l) => l.labelId === labelId)) n++;
    }
    return n;
}

/* ============================================================
   CHAT (Phase 4) — shared channels with realtime messages.
   Channels are separate from labels: labels are private taxonomy,
   channels are shared rooms with membership + messages.
   ============================================================ */

// In-memory state. Per-panel state lives inside each createChatPanel instance —
// these globals only track the lightweight metadata used for unread badges.
let chatChannels = [];           // [{ id, name, owner_id, kind, trade_id, label_id, last_read_at, last_message_at? }]
let chatGlobalRealtime = null;   // realtime subscription used to keep unread badges fresh

// Fetch the list of channels I'm a member of, including last_read_at + kind.
async function fetchMyChannels() {
    if (!sb || !currentUser) return [];
    const { data, error } = await sb
        .from("channel_members")
        .select("channel_id, last_read_at, channels(id, name, owner_id, kind, trade_id, label_id, created_at)")
        .eq("member_id", currentUser.id);
    if (error) throw error;
    const channels = (data || [])
        .filter((m) => m.channels)
        .map((m) => ({
            id: m.channels.id,
            name: m.channels.name,
            owner_id: m.channels.owner_id,
            kind: m.channels.kind,
            trade_id: m.channels.trade_id,
            label_id: m.channels.label_id,
            created_at: m.channels.created_at,
            last_read_at: m.last_read_at,
        }));

    // Fetch the latest message timestamp per channel so we can compute unread.
    // Simple approach: one query, max(created_at) grouped by channel. PostgREST
    // doesn't expose aggregates by default, so we query messages and reduce client-side.
    if (channels.length > 0) {
        const ids = channels.map((c) => c.id);
        const { data: lastMsgs, error: lmErr } = await sb
            .from("messages")
            .select("channel_id, created_at")
            .in("channel_id", ids)
            .order("created_at", { ascending: false })
            .limit(500); // upper bound; we only need the newest per channel
        if (lmErr) console.warn("Couldn't fetch last messages:", lmErr);
        const lastByChannel = new Map();
        for (const m of (lastMsgs || [])) {
            if (!lastByChannel.has(m.channel_id)) {
                lastByChannel.set(m.channel_id, m.created_at);
            }
        }
        for (const c of channels) {
            c.last_message_at = lastByChannel.get(c.id) || null;
        }
    }

    // Sort by most-recent activity (or by created_at for empty channels), newest first.
    channels.sort((a, b) => {
        const aT = new Date(a.last_message_at || a.created_at).getTime();
        const bT = new Date(b.last_message_at || b.created_at).getTime();
        return bT - aT;
    });

    return channels;
}

async function fetchChannelMembers(channelId) {
    const { data, error } = await sb
        .from("channel_members")
        .select("member_id, joined_at")
        .eq("channel_id", channelId);
    if (error) throw error;
    return data || [];
}

async function fetchMessages(channelId, limit = 200) {
    const { data, error } = await sb
        .from("messages")
        .select("id, channel_id, author_id, text, created_at")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: true })
        .limit(limit);
    if (error) throw error;
    return data || [];
}

async function createChannel(name) {
    if (!sb || !currentUser) return null;
    const clean = (name || "").trim();
    if (!clean) throw new Error("Channel name can't be empty");
    const { data, error } = await sb
        .from("channels")
        .insert({ name: clean, owner_id: currentUser.id })
        .select("id, name, owner_id, created_at")
        .single();
    if (error) throw error;
    // Add the creator as the first member.
    await addChannelMember(data.id, currentUser.id);
    return data;
}

async function deleteChannelById(channelId) {
    const { error } = await sb.from("channels").delete().eq("id", channelId);
    if (error) throw error;
}

async function renameChannel(channelId, name) {
    const clean = (name || "").trim();
    if (!clean) throw new Error("Name can't be empty");
    const { error } = await sb.from("channels").update({ name: clean }).eq("id", channelId);
    if (error) throw error;
}

async function addChannelMember(channelId, memberId) {
    const { error } = await sb
        .from("channel_members")
        .insert({ channel_id: channelId, member_id: memberId });
    if (error) {
        const msg = String(error.message || "").toLowerCase();
        if (!msg.includes("duplicate") && !msg.includes("unique")) throw error;
    }
}

async function removeChannelMember(channelId, memberId) {
    const { error } = await sb
        .from("channel_members")
        .delete()
        .eq("channel_id", channelId)
        .eq("member_id", memberId);
    if (error) throw error;
}

async function leaveChannel(channelId) {
    return removeChannelMember(channelId, currentUser.id);
}

async function sendChatMessage(channelId, text) {
    const clean = (text || "").trim();
    if (!clean) return null;
    const { data, error } = await sb
        .from("messages")
        .insert({ channel_id: channelId, author_id: currentUser.id, text: clean })
        .select("id, channel_id, author_id, text, created_at")
        .single();
    if (error) throw error;
    return data;
}

async function markChannelRead(channelId) {
    const { error } = await sb
        .from("channel_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("channel_id", channelId)
        .eq("member_id", currentUser.id);
    if (error) console.warn("Failed to mark channel read:", error);
}

/* ----- Realtime subscriptions -----
   We keep TWO subscriptions:
   1. chatRealtimeChannel — scoped to the currently-open channel, appends incoming
      messages directly into the visible thread.
   2. chatGlobalRealtime — fires for any INSERT into messages; we use it to refresh
      the sidebar badge + the channel list so unread counts stay live. (We filter
      client-side to channels we're a member of — RLS guarantees we only see those.)
*/

function subscribeToAllChannels() {
    if (chatGlobalRealtime) return; // already subscribed
    chatGlobalRealtime = sb
        .channel("chat-global")
        .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "messages",
        }, async (payload) => {
            const msg = payload.new;
            if (!msg) return;
            // Bump the channel in the list + refresh unread counts.
            const channel = chatChannels.find((c) => c.id === msg.channel_id);
            if (channel) {
                channel.last_message_at = msg.created_at;
            } else {
                // A channel we don't know about yet (someone added us) —
                // refresh our list so it shows up in future badge counts.
                try { chatChannels = await fetchMyChannels(); } catch (e) { /* ignore */ }
            }
            updateChatBadges();
        })
        .subscribe();
}

function unsubscribeFromAllChannels() {
    if (chatGlobalRealtime) {
        try { sb.removeChannel(chatGlobalRealtime); } catch (e) { /* ignore */ }
        chatGlobalRealtime = null;
    }
}

// True if the given channel has messages newer than my last_read_at.
function channelIsUnread(c) {
    if (!c.last_message_at) return false;
    const last = new Date(c.last_message_at).getTime();
    const read = new Date(c.last_read_at || 0).getTime();
    return last > read;
}

/* ----- Reusable chat panel (used by Community, group chats, trade cards) ----- */

// formatMessageTime is defined later, alongside the new chat panel factory.

// Thin wrappers around the three find-or-create RPCs from the schema.
async function getOrCreateDirectChannel(otherUserId) {
    const { data, error } = await sb.rpc("get_or_create_direct_channel", { _other: otherUserId });
    if (error) throw error;
    return data;
}
async function getOrCreateTradeChannel(tradeId) {
    const { data, error } = await sb.rpc("get_or_create_trade_channel", { _trade_id: tradeId });
    if (error) throw error;
    return data;
}
async function getOrCreateLabelChannel(labelId) {
    const { data, error } = await sb.rpc("get_or_create_label_channel", { _label_id: labelId });
    if (error) throw error;
    return data;
}

// Format an ISO timestamp as a chat-style time string.
function formatMessageTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
        return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " +
        d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Build a self-contained chat panel for the given channel. The returned DOM
// element exposes a `.cleanup()` method — call it before removing the panel to
// unsubscribe from realtime and free resources.
function createChatPanel(channelId, options = {}) {
    const root = document.createElement("div");
    root.className = "chat-panel";
    root.dataset.channelId = channelId;

    const messagesEl = document.createElement("div");
    messagesEl.className = "chat-panel-messages";
    root.appendChild(messagesEl);

    const composeEl = document.createElement("div");
    composeEl.className = "chat-panel-compose";
    const textarea = document.createElement("textarea");
    textarea.className = "chat-compose-input";
    textarea.placeholder = options.placeholder || "Write a message…";
    textarea.rows = 1;
    textarea.maxLength = 4000;
    const sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "btn btn-primary chat-send-btn";
    sendBtn.setAttribute("aria-label", "Send");
    sendBtn.appendChild(lucideIcon("send-horizontal"));
    composeEl.appendChild(textarea);
    composeEl.appendChild(sendBtn);
    root.appendChild(composeEl);

    let msgs = [];
    let subscription = null;
    let alive = true;

    function render() {
        const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 50;
        messagesEl.innerHTML = "";

        if (msgs.length === 0) {
            const empty = document.createElement("div");
            empty.className = "chat-panel-empty";
            empty.textContent = "No messages yet. Say something.";
            messagesEl.appendChild(empty);
            return;
        }

        let lastAuthor = null;
        let lastTime = 0;
        for (const m of msgs) {
            const isMe = m.author_id === currentUser?.id;
            const time = new Date(m.created_at).getTime();
            const grouped = m.author_id === lastAuthor && (time - lastTime) < 5 * 60 * 1000;

            const row = document.createElement("div");
            row.className = "message-row" + (isMe ? " message-row-me" : "") + (grouped ? " message-row-grouped" : "");

            if (!grouped) {
                const meta = document.createElement("div");
                meta.className = "message-meta";
                const name = document.createElement("span");
                name.className = "message-author";
                name.textContent = isMe ? "You" : profileNameById(m.author_id);
                meta.appendChild(name);
                const t = document.createElement("span");
                t.className = "message-time";
                t.textContent = formatMessageTime(m.created_at);
                meta.appendChild(t);
                row.appendChild(meta);
            }

            const bubble = document.createElement("div");
            bubble.className = "message-bubble";
            bubble.textContent = m.text;
            row.appendChild(bubble);

            messagesEl.appendChild(row);
            lastAuthor = m.author_id;
            lastTime = time;
        }
        if (atBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function send() {
        const text = textarea.value;
        if (!text.trim()) return;
        sendBtn.disabled = true;
        textarea.value = "";
        try {
            const msg = await sendChatMessage(channelId, text);
            if (msg && !msgs.some((m) => m.id === msg.id)) {
                msgs.push(msg);
                render();
            }
        } catch (e) {
            alert("Couldn't send: " + (e.message || e));
            textarea.value = text;
        } finally {
            sendBtn.disabled = false;
            textarea.focus();
        }
    }

    sendBtn.addEventListener("click", send);
    textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    });

    // Load existing messages + subscribe to realtime inserts.
    (async () => {
        try {
            msgs = await fetchMessages(channelId);
            if (!alive) return;
            render();
            markChannelRead(channelId).catch(() => {});
            const cached = chatChannels.find((c) => c.id === channelId);
            if (cached) cached.last_read_at = new Date().toISOString();
            updateChatBadges();
        } catch (e) {
            console.error("Failed to load messages:", e);
        }
    })();

    subscription = sb
        .channel(`chat-panel-${channelId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `channel_id=eq.${channelId}`,
        }, (payload) => {
            if (!alive) return;
            const m = payload.new;
            if (!m || msgs.some((x) => x.id === m.id)) return;
            msgs.push(m);
            render();
            markChannelRead(channelId).catch(() => {});
        })
        .subscribe();

    root.cleanup = () => {
        alive = false;
        if (subscription) {
            try { sb.removeChannel(subscription); } catch (e) { /* ignore */ }
            subscription = null;
        }
    };

    refreshIcons();
    return root;
}

// Replace whatever is in `host` with a fresh chat panel for `channelId`.
function mountChatPanel(host, channelId, options = {}) {
    if (!host) return null;
    unmountChatPanel(host);
    const panel = createChatPanel(channelId, options);
    host.appendChild(panel);
    return panel;
}

function unmountChatPanel(host) {
    if (!host) return;
    for (const child of host.children) {
        if (typeof child.cleanup === "function") child.cleanup();
    }
    host.innerHTML = "";
}

/* ----- Badge updates (Community for direct/group, Trades absorbs trade chat) ----- */

function updateChatBadges() {
    let communityUnread = 0;
    for (const c of chatChannels) {
        if (!channelIsUnread(c)) continue;
        if (c.kind !== "trade") communityUnread++;
    }
    const communityBadge = document.getElementById("community-badge");
    if (communityBadge) {
        if (communityUnread > 0) {
            communityBadge.textContent = communityUnread;
            communityBadge.classList.remove("hidden");
        } else {
            communityBadge.classList.add("hidden");
        }
    }
    // Trade chat unread folds into the existing trades badge via updateFamilyBadge.
    updateFamilyBadge();
}

/* ----- Group chat modal (label-scoped) ----- */

let groupChatState = { labelId: null, channelId: null };

/* ----- Community detail page (inline, replaces the modal group chat) ----- */
let activeCommunityDetailId = null;

async function openCommunityDetail(labelId) {
    if (!sb || !currentUser) return;
    if (!familyData) {
        try { familyData = await fetchFamilyData(); } catch (e) { /* ignore */ }
    }
    activeCommunityDetailId = labelId;

    // Toggle subviews — close any other inner state first.
    closeTradeView();
    document.getElementById("community-list-subview")?.classList.add("hidden");
    document.getElementById("community-detail-subview")?.classList.remove("hidden");

    // Set name + color dot in the header.
    const lbl = labelsData.list.find((l) => l.id === labelId);
    if (!lbl) {
        closeCommunityDetail();
        return;
    }
    const nameEl = document.getElementById("community-detail-name");
    if (nameEl) nameEl.textContent = lbl.name;
    const dot = document.getElementById("community-detail-dot");
    if (dot) dot.style.setProperty("--label-color", lbl.color);

    renderCommunityDetailMembers(labelId);

    // Mount chat (get-or-create the label-scoped channel).
    try {
        const channelId = await getOrCreateLabelChannel(labelId);
        const host = document.getElementById("community-detail-chat-host");
        mountChatPanel(host, channelId, {
            placeholder: `Message ${lbl.name}…`,
        });
        // Background-fetch channel cache so unread badge math stays accurate.
        fetchMyChannels()
            .then((cs) => { chatChannels = cs; updateChatBadges(); })
            .catch(() => {});
    } catch (e) {
        alert("Couldn't open community chat: " + (e.message || e));
        closeCommunityDetail();
        return;
    }
    refreshIcons();
}

function closeCommunityDetail() {
    activeCommunityDetailId = null;
    document.getElementById("community-detail-subview")?.classList.add("hidden");
    document.getElementById("community-list-subview")?.classList.remove("hidden");
    unmountChatPanel(document.getElementById("community-detail-chat-host"));
}

function renderCommunityDetailMembers(labelId) {
    const root = document.getElementById("community-detail-members");
    const countEl = document.getElementById("community-detail-count");
    if (!root) return;
    root.innerHTML = "";

    const profiles = (familyData?.profiles || [])
        .filter((p) => p.id !== currentUser?.id)
        .filter((p) => {
            const labels = labelsData.byMember.get(p.id) || [];
            return labels.some((l) => l.labelId === labelId);
        })
        .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));

    if (countEl) {
        countEl.textContent = `${profiles.length} member${profiles.length === 1 ? "" : "s"}`;
    }
    if (profiles.length === 0) {
        root.innerHTML = `<div class="community-detail-member-empty">No members yet. Use <strong>Manage</strong> above to add some.</div>`;
        return;
    }
    for (const p of profiles) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "community-detail-member";
        const avatar = document.createElement("div");
        avatar.className = "community-detail-member-avatar";
        avatar.textContent = (p.display_name || "?").trim().charAt(0).toUpperCase() || "?";
        row.appendChild(avatar);
        const name = document.createElement("span");
        name.className = "community-detail-member-name";
        name.textContent = p.display_name || "Unnamed user";
        row.appendChild(name);
        // Tap a member to jump straight into a trade with them.
        row.addEventListener("click", () => {
            const displayName = p.display_name || "Unnamed user";
            closeCommunityDetail();
            openTradeView(p.id, displayName);
        });
        root.appendChild(row);
    }
}

function wireCommunityDetailControls() {
    document.getElementById("community-detail-back")?.addEventListener("click", closeCommunityDetail);
    document.getElementById("community-detail-manage")?.addEventListener("click", openLabelManager);
}

async function openLabelGroupChat(labelId) {
    // Legacy modal entrypoint, kept in case something external still calls it.
    // Routes to the new inline detail page.
    return openCommunityDetail(labelId);
}

async function openLabelGroupChat_legacy(labelId) {
    if (!sb || !currentUser) return;
    if (!familyData) {
        try { familyData = await fetchFamilyData(); } catch (e) { /* ignore */ }
    }
    let channelId;
    try {
        channelId = await getOrCreateLabelChannel(labelId);
    } catch (e) {
        alert("Couldn't open group chat: " + (e.message || e));
        return;
    }
    groupChatState = { labelId, channelId };

    // Make sure our channel cache knows about this channel so the badge math
    // includes it. Fetch fresh in the background — non-blocking.
    fetchMyChannels().then((cs) => { chatChannels = cs; updateChatBadges(); }).catch(() => {});

    const label = labelsData.list.find((l) => l.id === labelId);
    const titleEl = document.getElementById("group-chat-title");
    if (titleEl) titleEl.textContent = (label?.name || "Group") + " chat";
    const dot = document.getElementById("group-chat-dot");
    if (dot && label) dot.style.setProperty("--label-color", label.color);

    const host = document.getElementById("group-chat-panel-host");
    mountChatPanel(host, channelId, { placeholder: "Message the group…" });

    document.getElementById("group-chat-members-pane")?.classList.add("hidden");
    document.getElementById("group-chat-modal")?.classList.remove("hidden");
    refreshIcons();
}

function closeGroupChatModal() {
    document.getElementById("group-chat-modal")?.classList.add("hidden");
    unmountChatPanel(document.getElementById("group-chat-panel-host"));
    groupChatState = { labelId: null, channelId: null };
}

async function toggleGroupChatMembersPane() {
    const pane = document.getElementById("group-chat-members-pane");
    if (!pane) return;
    if (!pane.classList.contains("hidden")) {
        pane.classList.add("hidden");
        return;
    }
    pane.innerHTML = `<div class="channel-members-loading">Loading members…</div>`;
    pane.classList.remove("hidden");

    if (!groupChatState.channelId) return;
    try {
        const members = await fetchChannelMembers(groupChatState.channelId);
        const memberIds = new Set(members.map((m) => m.member_id));
        pane.innerHTML = "";

        const heading = document.createElement("div");
        heading.className = "group-chat-members-heading";
        heading.textContent = "Add or remove members";
        pane.appendChild(heading);

        const list = document.createElement("div");
        list.className = "label-member-checklist";
        const profiles = [...(familyData?.profiles || [])]
            .filter((p) => p.id !== currentUser?.id)
            .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));

        if (profiles.length === 0) {
            list.innerHTML = `<div class="trade-empty">No other members yet.</div>`;
        } else {
            for (const p of profiles) {
                const row = document.createElement("label");
                row.className = "label-member-row";
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = memberIds.has(p.id);
                cb.addEventListener("change", async () => {
                    cb.disabled = true;
                    try {
                        if (cb.checked) await addChannelMember(groupChatState.channelId, p.id);
                        else await removeChannelMember(groupChatState.channelId, p.id);
                    } catch (e) {
                        cb.checked = !cb.checked;
                        alert("Couldn't update: " + (e.message || e));
                    } finally {
                        cb.disabled = false;
                    }
                });
                row.appendChild(cb);
                const name = document.createElement("span");
                name.textContent = p.display_name || "Unnamed user";
                row.appendChild(name);
                list.appendChild(row);
            }
        }
        pane.appendChild(list);
    } catch (e) {
        pane.innerHTML = `<div class="trade-empty">Couldn't load members.</div>`;
    }
}

function wireGroupChatControls() {
    document.getElementById("group-chat-close")?.addEventListener("click", closeGroupChatModal);
    document.getElementById("group-chat-modal")?.addEventListener("click", (e) => {
        if (e.target?.dataset?.groupChatClose === "true") closeGroupChatModal();
    });
    document.getElementById("group-chat-members-toggle")?.addEventListener("click", toggleGroupChatMembersPane);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const m = document.getElementById("group-chat-modal");
            if (m && !m.classList.contains("hidden")) closeGroupChatModal();
        }
    });
}

function wireLabelManagerControls() {
    document.getElementById("label-manager-close")?.addEventListener("click", closeLabelManager);
    const modal = document.getElementById("label-manager-modal");
    if (modal) {
        modal.addEventListener("click", (e) => {
            if (e.target?.dataset?.labelClose === "true") closeLabelManager();
        });
    }
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const m = document.getElementById("label-manager-modal");
            if (m && !m.classList.contains("hidden")) closeLabelManager();
        }
    });
}

/* ----- Wanted view: label filter bar ----- */

// Filter state for the Wanted view. Independent of the Community-view filter
// so the user can flip between views without losing context in either.
let activeWantedLabelFilter = null;

function renderWantedLabelBar() {
    const root = document.getElementById("wanted-label-bar");
    if (!root) return;
    // Only show the bar if any labels exist — otherwise it's useless clutter.
    if (labelsData.list.length === 0) {
        root.classList.add("hidden");
        root.innerHTML = "";
        return;
    }
    root.classList.remove("hidden");
    root.innerHTML = "";

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "label-chip" + (activeWantedLabelFilter === null ? " active" : "");
    allChip.textContent = "All people";
    allChip.addEventListener("click", () => {
        if (activeWantedLabelFilter === null) return;
        activeWantedLabelFilter = null;
        onWantedFilterChanged();
    });
    root.appendChild(allChip);

    for (const lbl of labelsData.list) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "label-chip label-chip-colored" + (activeWantedLabelFilter === lbl.id ? " active" : "");
        chip.style.setProperty("--label-color", lbl.color);
        chip.innerHTML = `<span class="label-chip-dot" aria-hidden="true"></span>${escapeHtml(lbl.name)}`;
        chip.addEventListener("click", () => {
            activeWantedLabelFilter = lbl.id;
            onWantedFilterChanged();
        });
        root.appendChild(chip);
    }

    const manage = document.createElement("button");
    manage.type = "button";
    manage.className = "label-manage-btn";
    manage.innerHTML = '<i data-lucide="settings-2" class="inline-icon" aria-hidden="true"></i> Manage communities';
    manage.addEventListener("click", openLabelManager);
    root.appendChild(manage);
    refreshIcons();
}

// Re-derive everything when the Wanted label filter changes.
function onWantedFilterChanged() {
    wantedCache = computeWantedMatches();
    renderWantedLabelBar();
    renderWantedList();
}

async function fetchFamilyData() {
    const [profilesRes, collectionsRes] = await Promise.all([
        sb.from("profiles").select("id, display_name, created_at"),
        sb.from("collections").select("user_id, sticker_code, count"),
    ]);
    if (profilesRes.error) throw profilesRes.error;
    if (collectionsRes.error) throw collectionsRes.error;

    const collectionsByUser = {};
    for (const row of collectionsRes.data || []) {
        if (row.count <= 0) continue;
        if (!collectionsByUser[row.user_id]) collectionsByUser[row.user_id] = {};
        collectionsByUser[row.user_id][row.sticker_code] = row.count;
    }
    return { profiles: profilesRes.data || [], collections: collectionsByUser };
}

function getTotalStickerCount() {
    let total = 0;
    for (const section of STICKER_DATA) total += section.stickers.length;
    return total;
}

function summarizeCollection(map) {
    let owned = 0, extras = 0;
    for (const code in map) {
        const c = map[code];
        if (c > 0) {
            owned++;
            extras += c - 1;
        }
    }
    return { owned, extras };
}

// Build the chip strip above the member list: "All" + each label + "Manage".
function renderLabelFilterBar() {
    const root = document.getElementById("label-filter-bar");
    if (!root) return;
    root.innerHTML = "";

    // "All" chip — keeps the "see all members" entrypoint for the list subview.
    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "label-chip" + (activeLabelFilter === null ? " active" : "");
    allChip.textContent = "All members";
    allChip.addEventListener("click", () => {
        activeLabelFilter = null;
        renderLabelFilterBar();
        renderFamilyList();
    });
    root.appendChild(allChip);

    // One chip per community. Clicking now ENTERS the community detail page
    // (where the chat lives) instead of just filtering the member list.
    for (const lbl of labelsData.list) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "label-chip label-chip-colored";
        chip.style.setProperty("--label-color", lbl.color);
        chip.innerHTML = `<span class="label-chip-dot" aria-hidden="true"></span>${escapeHtml(lbl.name)}`;
        chip.addEventListener("click", () => openCommunityDetail(lbl.id));
        root.appendChild(chip);
    }

    // Manage button — always last in the strip.
    const manage = document.createElement("button");
    manage.type = "button";
    manage.className = "label-manage-btn";
    manage.innerHTML = '<i data-lucide="settings-2" class="inline-icon" aria-hidden="true"></i> Manage communities';
    manage.addEventListener("click", openLabelManager);
    root.appendChild(manage);

    refreshIcons();
}

// Small colored chip rendered next to a member's name.
function renderMemberLabelChip(lbl) {
    const chip = document.createElement("span");
    chip.className = "member-label-chip";
    chip.style.setProperty("--label-color", lbl.color);
    chip.innerHTML = `<span class="member-label-dot" aria-hidden="true"></span>${escapeHtml(lbl.name)}`;
    chip.title = lbl.name;
    return chip;
}

function renderFamilyList() {
    const root = document.getElementById("family-list");
    if (!root || !familyData) return;
    root.innerHTML = "";
    const total = getTotalStickerCount();

    // Sort: me first, then by display name
    let sorted = [...familyData.profiles].sort((a, b) => {
        if (a.id === currentUser?.id) return -1;
        if (b.id === currentUser?.id) return 1;
        const an = a.display_name || "zzz_unnamed";
        const bn = b.display_name || "zzz_unnamed";
        return an.localeCompare(bn);
    });

    // Apply active label filter (if any).
    if (activeLabelFilter) {
        sorted = sorted.filter((p) => {
            if (p.id === currentUser?.id) return false; // never filter "you" through someone else's lens
            const labels = labelsData.byMember.get(p.id) || [];
            return labels.some((l) => l.labelId === activeLabelFilter);
        });
    }

    if (sorted.length === 0) {
        const msg = activeLabelFilter
            ? "No members in this community yet. Use Manage communities to assign some."
            : "No family members found.";
        root.innerHTML = `<div class="trade-empty">${msg}</div>`;
        return;
    }

    for (const profile of sorted) {
        const userCol = familyData.collections[profile.id] || {};
        const { owned, extras } = summarizeCollection(userCol);
        const isMe = profile.id === currentUser?.id;
        const displayName = profile.display_name
            || (isMe ? "(set your display name)" : "Unnamed user");
        const memberLabels = labelsData.byMember.get(profile.id) || [];

        const row = document.createElement("div");
        row.className = "family-member" + (isMe ? " family-member-self" : " clickable");

        // Left column: name (+ labels) + progress line.
        const left = document.createElement("div");
        left.className = "family-member-info";

        const nameLine = document.createElement("div");
        nameLine.className = "family-member-name-line";
        const name = document.createElement("span");
        name.className = "family-member-name";
        name.textContent = displayName;
        nameLine.appendChild(name);
        for (const lbl of memberLabels) {
            nameLine.appendChild(renderMemberLabelChip(lbl));
        }
        left.appendChild(nameLine);

        const progress = document.createElement("div");
        progress.className = "family-member-progress";
        progress.textContent = `${owned} / ${total} collected · ${extras} extras`;
        left.appendChild(progress);

        row.appendChild(left);

        // Right: arrow chevron (only for clickable rows).
        const arrow = document.createElement("div");
        arrow.className = "family-member-arrow";
        if (!isMe) arrow.innerHTML = '<i data-lucide="chevron-right" aria-hidden="true"></i>';
        row.appendChild(arrow);

        if (!isMe) {
            row.addEventListener("click", () => openTradeView(profile.id, displayName));
        }
        root.appendChild(row);
    }
    refreshIcons();
}

// Returns lists of stickers that are "easy" trades, accounting for reservations.
//   - mine/theirs come from the live collections.
//   - myReservations/theirReservations come from get_user_reservations (RPC):
//     they're stickers each side has committed to give in open trades but
//     hasn't shipped yet. Subtracting them ensures we don't surface stickers
//     that are already promised elsewhere.
function computeTradeMatches(myCol, theirCol, myReservations, theirReservations) {
    const theyHaveYouNeed = [];
    const youHaveTheyNeed = [];
    for (const section of STICKER_DATA) {
        for (const [code] of section.stickers) {
            const myRaw = myCol[code] || 0;
            const theirRaw = theirCol[code] || 0;
            const myAvail = Math.max(0, myRaw - (myReservations[code] || 0));
            const theirAvail = Math.max(0, theirRaw - (theirReservations[code] || 0));

            // They can spare it AND I don't have one at all.
            if (theirAvail >= 2 && myRaw === 0) {
                theyHaveYouNeed.push({ code, count: theirAvail, extras: theirAvail - 1 });
            }
            // I can spare it AND they don't have one at all.
            if (myAvail >= 2 && theirRaw === 0) {
                youHaveTheyNeed.push({ code, count: myAvail, extras: myAvail - 1 });
            }
        }
    }
    theyHaveYouNeed.sort((a, b) => b.count - a.count);
    youHaveTheyNeed.sort((a, b) => b.count - a.count);
    return { theyHaveYouNeed, youHaveTheyNeed };
}

// Trade builder state — populated when openTradeView fires, cleared on close.
let tradeSelection = null;

// Builds a "flag + code + name" element fragment shared by trade rows.
function appendStickerInline(parent, code) {
    const meta = getStickerIndex()[code] || {};
    const team = meta.team || "";
    const playerName = meta.name || code;
    const iso = team ? getCountryCode(team) : null;

    if (iso) {
        const flag = document.createElement("span");
        flag.className = `fi fi-${iso}`;
        parent.appendChild(flag);
    } else {
        const emoji = (typeof TEAM_META !== "undefined" && TEAM_META[team]?.flag) || "";
        if (emoji) {
            const span = document.createElement("span");
            span.className = "trade-row-flag-emoji";
            span.textContent = emoji;
            parent.appendChild(span);
        }
    }

    const codeSpan = document.createElement("span");
    codeSpan.className = "trade-row-code";
    codeSpan.textContent = formatStickerCode(code);
    parent.appendChild(codeSpan);

    const nameSpan = document.createElement("span");
    nameSpan.className = "trade-row-name";
    nameSpan.textContent = playerName;
    parent.appendChild(nameSpan);
}

// Renders a single checkbox row in the duplicates list.
// Layout is two-line — header (flag + code + badge) on top, name below — so
// long player names don't get squeezed by the narrow trade columns.
function renderCheckboxRow(code, count, side) {
    const extras = count - 1;
    const isChecked = (side === "asks" ? tradeSelection.checkedAsks : tradeSelection.checkedGives).has(code);
    const meta = getStickerIndex()[code] || {};
    const team = meta.team || "";
    const playerName = meta.name || code;
    const iso = team ? getCountryCode(team) : null;

    const row = document.createElement("div");
    row.className = "trade-row trade-row-tradeable" + (isChecked ? " selected" : "");
    row.title = `${formatStickerCode(code)} — ${playerName}`;

    const label = document.createElement("label");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isChecked;
    cb.addEventListener("change", () => {
        const set = side === "asks" ? tradeSelection.checkedAsks : tradeSelection.checkedGives;
        if (cb.checked) set.add(code); else set.delete(code);
        row.classList.toggle("selected", cb.checked);
        refreshTradeSummary();
    });
    label.appendChild(cb);

    const content = document.createElement("div");
    content.className = "trade-row-content";

    const header = document.createElement("div");
    header.className = "trade-row-header";

    if (iso) {
        const flag = document.createElement("span");
        flag.className = `fi fi-${iso}`;
        header.appendChild(flag);
    } else {
        const emoji = (typeof TEAM_META !== "undefined" && TEAM_META[team]?.flag) || "";
        if (emoji) {
            const span = document.createElement("span");
            span.className = "trade-row-flag-emoji";
            span.textContent = emoji;
            header.appendChild(span);
        }
    }

    const codeSpan = document.createElement("span");
    codeSpan.className = "trade-row-code";
    codeSpan.textContent = formatStickerCode(code);
    header.appendChild(codeSpan);

    const badge = document.createElement("span");
    badge.className = "trade-row-badge trade-badge-yes";
    badge.textContent = `+${extras}`;
    badge.title = `${extras} extra${extras === 1 ? "" : "s"}`;
    header.appendChild(badge);

    const nameDiv = document.createElement("div");
    nameDiv.className = "trade-row-name";
    nameDiv.textContent = playerName;

    content.appendChild(header);
    content.appendChild(nameDiv);
    label.appendChild(content);
    row.appendChild(label);
    return row;
}

// Renders a row in the "Also asking" / "Also offering" extras list (added via search).
function renderExtraItem(code, side) {
    const row = document.createElement("div");
    row.className = "trade-extras-item";

    appendStickerInline(row, code);

    const note = document.createElement("span");
    note.className = "trade-extras-note";
    note.textContent = side === "asks" ? "their copy" : "your copy";
    row.appendChild(note);

    const removeBtn = document.createElement("button");
    removeBtn.className = "trade-extras-remove";
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", "Remove from trade");
    removeBtn.addEventListener("click", () => {
        const set = side === "asks" ? tradeSelection.extraAsks : tradeSelection.extraGives;
        set.delete(code);
        renderTradeExtras(side);
        refreshTradeSummary();
    });
    row.appendChild(removeBtn);

    return row;
}

function renderTradeExtras(side) {
    const root = document.getElementById(side === "asks" ? "trade-asks-extras" : "trade-gives-extras");
    if (!root) return;
    root.innerHTML = "";
    const set = side === "asks" ? tradeSelection.extraAsks : tradeSelection.extraGives;
    for (const code of set) root.appendChild(renderExtraItem(code, side));
}

function refreshTradeSummary() {
    const asksCount = tradeSelection.checkedAsks.size + tradeSelection.extraAsks.size;
    const givesCount = tradeSelection.checkedGives.size + tradeSelection.extraGives.size;

    const summary = document.getElementById("trade-summary");
    if (summary) summary.textContent = `Asking: ${asksCount} · Offering: ${givesCount}`;

    const btn = document.getElementById("trade-propose");
    if (btn) {
        btn.disabled = asksCount === 0 && givesCount === 0;
        if (asksCount === 0 && givesCount > 0) btn.textContent = "Offer stickers";
        else if (asksCount > 0 && givesCount === 0) btn.textContent = "Request stickers";
        else btn.textContent = "Propose trade";
    }
}

// Search helper: find stickers matching `query` that the partner has (and I don't),
// for the "asks" side; or that I have (and partner doesn't), for the "gives" side.
// Excludes anything already in the duplicates list since those are checkboxes above.
function searchTradeCandidates(side, query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const myCol = collection;
    const theirCol = familyData?.collections[tradeSelection.partnerId] || {};
    const myRes = tradeSelection.myReservations || {};
    const theirRes = tradeSelection.theirReservations || {};
    const dupSet = side === "asks"
        ? new Set(tradeSelection.matches.theyHaveYouNeed.map((m) => m.code))
        : new Set(tradeSelection.matches.youHaveTheyNeed.map((m) => m.code));

    const results = [];
    for (const section of STICKER_DATA) {
        for (const [code, name] of section.stickers) {
            if (dupSet.has(code)) continue;

            // Available counts on each side (raw - reserved) — we don't want to
            // suggest stickers that are already promised elsewhere.
            const myAvail = Math.max(0, (myCol[code] || 0) - (myRes[code] || 0));
            const theirAvail = Math.max(0, (theirCol[code] || 0) - (theirRes[code] || 0));

            if (side === "asks") {
                if (theirAvail < 1) continue;
                if ((myCol[code] || 0) > 0) continue;
            } else {
                if (myAvail < 1) continue;
                if ((theirCol[code] || 0) > 0) continue;
            }

            if (
                code.toLowerCase().includes(q) ||
                name.toLowerCase().includes(q) ||
                section.team.toLowerCase().includes(q)
            ) {
                const ownerCount = side === "asks" ? theirAvail : myAvail;
                results.push({ code, name, team: section.team, ownerCount });
            }
        }
    }
    return results.slice(0, 40);
}

function renderSearchResults(side) {
    const input = document.getElementById(side === "asks" ? "trade-search-asks" : "trade-search-gives");
    const root = document.getElementById(side === "asks" ? "trade-search-asks-results" : "trade-search-gives-results");
    if (!input || !root) return;

    const query = input.value;
    if (!query.trim()) {
        root.classList.add("hidden");
        root.innerHTML = "";
        return;
    }

    const results = searchTradeCandidates(side, query);
    root.innerHTML = "";

    if (results.length === 0) {
        const empty = document.createElement("div");
        empty.className = "trade-search-result-empty";
        empty.textContent = "No matches.";
        root.appendChild(empty);
    } else {
        const alreadyAdded = side === "asks" ? tradeSelection.extraAsks : tradeSelection.extraGives;
        for (const r of results) {
            const item = document.createElement("div");
            item.className = "trade-search-result";

            appendStickerInline(item, r.code);

            const meta = document.createElement("span");
            meta.className = "trade-search-result-meta";
            const label = side === "asks" ? "they have" : "you have";
            meta.textContent = `${label} ${r.ownerCount}` + (alreadyAdded.has(r.code) ? " · added" : "");
            item.appendChild(meta);

            if (alreadyAdded.has(r.code)) {
                item.style.opacity = "0.5";
                item.style.cursor = "default";
            } else {
                item.addEventListener("click", () => {
                    alreadyAdded.add(r.code);
                    renderTradeExtras(side);
                    refreshTradeSummary();
                    input.value = "";
                    root.classList.add("hidden");
                    root.innerHTML = "";
                });
            }
            root.appendChild(item);
        }
    }
    root.classList.remove("hidden");
}

async function openTradeView(memberId, memberName) {
    // Fetch both parties' reservations in parallel so the matches reflect what's
    // actually available (raw count minus already-committed stickers).
    let myReservations = {};
    let theirReservations = {};
    try {
        const [mine, theirs] = await Promise.all([
            fetchUserReservations(currentUser.id),
            fetchUserReservations(memberId),
        ]);
        myReservations = mine;
        theirReservations = theirs;
    } catch (e) {
        console.warn("Failed to fetch reservations; matches may be stale:", e);
    }

    const partnerCol = familyData?.collections[memberId] || {};
    const matches = computeTradeMatches(collection, partnerCol, myReservations, theirReservations);

    tradeSelection = {
        partnerId: memberId,
        partnerName: memberName,
        matches,
        myReservations,
        theirReservations,
        checkedAsks: new Set(),
        checkedGives: new Set(),
        extraAsks: new Set(),
        extraGives: new Set(),
    };

    document.getElementById("community-list-subview")?.classList.add("hidden");
    document.getElementById("community-trade-subview")?.classList.remove("hidden");

    const title = document.getElementById("trade-title");
    if (title) title.textContent = `Trade with ${memberName}`;

    // Section: their duplicates I'm missing (ask side)
    const theyRoot = document.getElementById("trade-they-have");
    if (theyRoot) {
        theyRoot.innerHTML = "";
        if (matches.theyHaveYouNeed.length === 0) {
            theyRoot.innerHTML = `<div class="trade-empty">No duplicates from them match stickers you're missing.</div>`;
        } else {
            for (const m of matches.theyHaveYouNeed) {
                theyRoot.appendChild(renderCheckboxRow(m.code, m.count, "asks"));
            }
        }
    }

    // Section: my duplicates they're missing (give side)
    const youRoot = document.getElementById("trade-you-have");
    if (youRoot) {
        youRoot.innerHTML = "";
        if (matches.youHaveTheyNeed.length === 0) {
            youRoot.innerHTML = `<div class="trade-empty">No duplicates from you match stickers they're missing.</div>`;
        } else {
            for (const m of matches.youHaveTheyNeed) {
                youRoot.appendChild(renderCheckboxRow(m.code, m.count, "gives"));
            }
        }
    }

    // Clear search inputs, extras, dropdowns
    for (const side of ["asks", "gives"]) {
        const input = document.getElementById(`trade-search-${side}`);
        if (input) input.value = "";
        const results = document.getElementById(`trade-search-${side}-results`);
        if (results) {
            results.classList.add("hidden");
            results.innerHTML = "";
        }
        renderTradeExtras(side);
    }

    refreshTradeSummary();

    // Mount the 1:1 chat panel for this member on the right side.
    const titleSpan = document.getElementById("community-chat-title");
    if (titleSpan) titleSpan.textContent = `Chat with ${memberName}`;
    const chatHost = document.getElementById("community-chat-host");
    if (chatHost) {
        try {
            const channelId = await getOrCreateDirectChannel(memberId);
            mountChatPanel(chatHost, channelId, {
                placeholder: `Message ${memberName.split(" ")[0] || memberName}…`,
            });
        } catch (e) {
            console.error("Couldn't open chat:", e);
            chatHost.innerHTML = `<div class="chat-empty-inline">Couldn't open chat: ${escapeHtml(e.message || String(e))}</div>`;
        }
    }
}

function closeTradeView() {
    document.getElementById("community-trade-subview")?.classList.add("hidden");
    document.getElementById("community-list-subview")?.classList.remove("hidden");
    // Tear down the embedded chat panel + its realtime subscription.
    unmountChatPanel(document.getElementById("community-chat-host"));
}

// Reload family data (profiles + collections) and re-render the Community view.
async function refreshCommunityView() {
    if (!sb || !currentUser) return;
    const list = document.getElementById("family-list");
    if (list && list.children.length === 0) {
        list.innerHTML = `<div class="trade-empty">Loading members…</div>`;
    }
    try {
        const [fam] = await Promise.all([fetchFamilyData(), refreshLabels()]);
        familyData = fam;
        renderLabelFilterBar();
        renderFamilyList();
    } catch (e) {
        console.error("Failed to load family data:", e);
        if (list) list.innerHTML = `<div class="trade-empty">Couldn't load members. Try again.</div>`;
    }
}

// Reload trade data and re-render the Trades view.
async function refreshTradesView() {
    if (!sb || !currentUser) return;
    try {
        // We need family data so the trade cards can show member display names.
        if (!familyData) {
            try { familyData = await fetchFamilyData(); } catch (e) { /* ignore */ }
        }
        await refreshPendingRequests();
        await refreshCompletedTrades();
        updateTradesEmptyState();
    } catch (e) {
        console.error("Failed to refresh Trades view:", e);
    }
}

function updateTradesEmptyState() {
    const empty = document.getElementById("trades-empty-state");
    if (!empty) return;
    const hasPending = pendingRequestsCache.incoming.length + pendingRequestsCache.outgoing.length > 0;
    const hasCompleted = completedTradesCache.length > 0;
    empty.classList.toggle("hidden", hasPending || hasCompleted);
}

async function editMyDisplayName() {
    if (!sb || !currentUser) return;

    const { data } = await sb
        .from("profiles")
        .select("display_name")
        .eq("id", currentUser.id)
        .single();
    const current = data?.display_name || "";
    const next = window.prompt("Set your display name (leave blank to clear):", current);
    if (next === null) return;

    const trimmed = next.trim();
    const { error } = await sb
        .from("profiles")
        .upsert(
            { id: currentUser.id, display_name: trimmed || null },
            { onConflict: "id" }
        );
    if (error) {
        console.error(error);
        showToast("Couldn't update display name.");
        return;
    }

    // Refresh the Community view if it's currently active, so the new name shows.
    if (document.getElementById("view-community")?.classList.contains("view-active")) {
        try {
            familyData = await fetchFamilyData();
            renderFamilyList();
        } catch (e) {
            console.warn("Refresh after rename failed:", e);
        }
    }
}

/* ---------- Pending trade requests ---------- */

// Note: variable name kept ("pendingRequestsCache") for compatibility,
// but it now also contains accepted (in-progress) trades.
let pendingRequestsCache = { incoming: [], outgoing: [] };

async function fetchPendingRequests() {
    if (!currentUser || !sb) return { incoming: [], outgoing: [] };
    const { data, error } = await sb
        .from("trade_requests")
        .select(
            "id, sender_id, recipient_id, status, created_at, " +
            "accepted_at, sender_sent_at, recipient_received_at, " +
            "recipient_sent_at, sender_received_at, " +
            "trade_request_items(sticker_code, direction, quantity)"
        )
        .or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`)
        .in("status", ["pending", "accepted"])
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Failed to fetch active trades:", error);
        return { incoming: [], outgoing: [] };
    }

    const incoming = [];
    const outgoing = [];
    for (const req of data || []) {
        if (req.recipient_id === currentUser.id) incoming.push(req);
        else outgoing.push(req);
    }
    return { incoming, outgoing };
}

// Fetch reservations for a user via the SECURITY DEFINER RPC.
// Returns { [stickerCode]: reservedQuantity }.
async function fetchUserReservations(userId) {
    if (!sb || !userId) return {};
    const { data, error } = await sb.rpc("get_user_reservations", { p_user_id: userId });
    if (error) {
        console.error("Failed to fetch reservations for", userId, error);
        return {};
    }
    const out = {};
    for (const row of data || []) out[row.sticker_code] = row.reserved;
    return out;
}

function profileNameById(id) {
    if (!familyData) return "Someone";
    const p = familyData.profiles.find((x) => x.id === id);
    return p?.display_name || "Unnamed user";
}

// Top-level dispatcher: render the appropriate card based on trade status.
function renderPendingRequest(req, kind) {
    if (req.status === "pending") {
        return renderPendingCard(req, kind);
    }
    if (req.status === "accepted") {
        return renderAcceptedCard(req, kind);
    }
    // Defensive fallback — shouldn't appear in the active cache.
    return null;
}

// PENDING state: the old Accept / Decline / Cancel UI.
function renderPendingCard(req, kind) {
    const card = document.createElement("div");
    card.className = "pending-request";

    const header = document.createElement("div");
    header.className = "pending-request-header";
    const otherId = kind === "incoming" ? req.sender_id : req.recipient_id;
    const otherName = profileNameById(otherId);
    header.textContent = kind === "incoming"
        ? `${otherName} wants to trade`
        : `Sent to ${otherName} · waiting`;
    card.appendChild(header);

    const items = req.trade_request_items || [];
    const senderGives = items.filter((i) => i.direction === "sender_gives");
    const recipientGives = items.filter((i) => i.direction === "recipient_gives");

    const body = document.createElement("div");
    body.className = "pending-request-body";

    const renderItemList = (labelText, list) => {
        const wrap = document.createElement("div");
        const label = document.createElement("strong");
        label.textContent = labelText;
        wrap.appendChild(label);
        wrap.appendChild(document.createTextNode(" "));
        if (list.length === 0) {
            const empty = document.createElement("em");
            empty.textContent = "nothing";
            wrap.appendChild(empty);
        } else {
            const ul = document.createElement("ul");
            ul.className = "pending-request-items";
            for (const it of list) {
                const li = document.createElement("li");
                appendStickerInline(li, it.sticker_code);
                ul.appendChild(li);
            }
            wrap.appendChild(ul);
        }
        body.appendChild(wrap);
    };

    if (kind === "incoming") {
        renderItemList("They'd give you:", senderGives);
        renderItemList("They ask for:", recipientGives);
    } else {
        renderItemList("You'd give:", senderGives);
        renderItemList("You ask for:", recipientGives);
    }
    card.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "pending-request-actions";

    if (kind === "incoming") {
        const accept = document.createElement("button");
        accept.className = "btn btn-primary";
        accept.type = "button";
        accept.textContent = "Accept";
        accept.addEventListener("click", () => onAcceptRequest(req.id, accept));
        actions.appendChild(accept);

        const decline = document.createElement("button");
        decline.className = "btn btn-secondary";
        decline.type = "button";
        decline.textContent = "Decline";
        decline.addEventListener("click", () => onDeclineRequest(req.id, decline));
        actions.appendChild(decline);
    } else {
        const cancel = document.createElement("button");
        cancel.className = "btn btn-secondary";
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => onCancelRequest(req.id, cancel));
        actions.appendChild(cancel);
    }
    card.appendChild(actions);
    return card;
}

// ACCEPTED (in-progress) state: each direction shown as its own shipment
// with status badge and an action button if it's the viewer's turn.
/* ----- Trade lifecycle (5-step pipeline) ----------------------------------
   Summarises a trade at the deal level:
   1) Proposed   — created_at
   2) Accepted   — accepted_at (or "Declined" if status===declined)
   3) In transit — at least one side has marked Sent
   4) Delivered  — at least one side has confirmed Received
   5) Complete   — completed_at

   A step is "active" if it's the first one not yet "done". The action
   buttons (Sent / Received) live below in renderShipment — this pipeline
   is the at-a-glance summary above the per-direction details.
   ------------------------------------------------------------------------ */
function computeTradeLifecycle(req) {
    if (!req) return [];

    const status = req.status;
    const isDeclined = status === "declined";
    const isCancelled = status === "cancelled";
    const isCompleted = status === "completed" || !!req.completed_at;

    const senderSentAt = req.sender_sent_at;
    const recipientSentAt = req.recipient_sent_at;
    const recipientReceivedAt = req.recipient_received_at;
    const senderReceivedAt = req.sender_received_at;

    const oneShipped = !!senderSentAt || !!recipientSentAt;
    const bothShipped = !!senderSentAt && !!recipientSentAt;
    const oneReceived = !!recipientReceivedAt || !!senderReceivedAt;
    const bothReceived = !!recipientReceivedAt && !!senderReceivedAt;

    const latestShip = maxDate(senderSentAt, recipientSentAt);
    const latestReceive = maxDate(recipientReceivedAt, senderReceivedAt);

    const steps = [
        {
            label: "Proposed",
            done: !!req.created_at,
            time: req.created_at,
        },
        {
            label: isDeclined ? "Declined" : "Accepted",
            done: !!req.accepted_at || isDeclined,
            time: req.accepted_at || (isDeclined ? req.updated_at : null),
            declined: isDeclined,
        },
        {
            label: "In transit",
            done: bothShipped,
            time: latestShip,
            partial: oneShipped && !bothShipped,
        },
        {
            label: "Delivered",
            done: bothReceived,
            time: latestReceive,
            partial: oneReceived && !bothReceived,
        },
        {
            label: "Complete",
            done: isCompleted,
            time: req.completed_at,
        },
    ];

    // First not-done step is "active" (unless the trade was declined/cancelled).
    if (!isDeclined && !isCancelled) {
        for (const step of steps) {
            if (step.done) continue;
            step.active = true;
            break;
        }
    }
    return steps;
}

function maxDate(a, b) {
    if (!a) return b || null;
    if (!b) return a || null;
    return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function formatLifecycleDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
    });
}

function renderTradeLifecycle(req) {
    const wrap = document.createElement("div");
    wrap.className = "lifecycle";

    const pipeline = document.createElement("div");
    pipeline.className = "lifecycle-pipeline";

    const steps = computeTradeLifecycle(req);
    for (const [i, step] of steps.entries()) {
        const cell = document.createElement("div");
        let cls = "lifecycle-step";
        if (step.declined) cls += " declined";
        else if (step.done) cls += " done";
        if (step.active) cls += " active";
        if (step.partial) cls += " partial";
        cell.className = cls;

        const numEl = document.createElement("div");
        numEl.className = "lifecycle-step-num";
        numEl.textContent = String(i + 1).padStart(2, "0");
        cell.appendChild(numEl);

        const labelEl = document.createElement("div");
        labelEl.className = "lifecycle-step-label";
        labelEl.textContent = step.label;
        cell.appendChild(labelEl);

        const whenEl = document.createElement("div");
        whenEl.className = "lifecycle-step-when";
        whenEl.textContent = step.time ? formatLifecycleDate(step.time) : "—";
        cell.appendChild(whenEl);

        pipeline.appendChild(cell);
    }

    wrap.appendChild(pipeline);
    return wrap;
}

function renderAcceptedCard(req, kind) {
    const card = document.createElement("div");
    card.className = "pending-request pending-accepted";

    const isViewerSender = req.sender_id === currentUser.id;
    const otherId = isViewerSender ? req.recipient_id : req.sender_id;
    const otherName = profileNameById(otherId);

    const header = document.createElement("div");
    header.className = "pending-request-header";
    header.innerHTML = `<i data-lucide="handshake" class="inline-icon" aria-hidden="true"></i> Accepted · with ${escapeHtml(otherName)}`;
    card.appendChild(header);

    // 5-step lifecycle pipeline — visual summary of where the trade is.
    card.appendChild(renderTradeLifecycle(req));

    const items = req.trade_request_items || [];

    // The viewer's two "tracks" — outgoing (You give) and incoming (You receive).
    // These map to different directions depending on the viewer's role in the trade.
    const giveDir = isViewerSender ? "sender_gives" : "recipient_gives";
    const recvDir = isViewerSender ? "recipient_gives" : "sender_gives";

    const givesItems = items.filter((i) => i.direction === giveDir);
    const recvItems = items.filter((i) => i.direction === recvDir);

    // Timestamp mapping based on viewer's role.
    const yourSentAt = isViewerSender ? req.sender_sent_at : req.recipient_sent_at;
    const theirReceivedAt = isViewerSender ? req.recipient_received_at : req.sender_received_at;
    const theirSentAt = isViewerSender ? req.recipient_sent_at : req.sender_sent_at;
    const yourReceivedAt = isViewerSender ? req.sender_received_at : req.recipient_received_at;

    // Outgoing shipment: stickers you're sending to them.
    if (givesItems.length > 0) {
        const status = theirReceivedAt ? "Received" : (yourSentAt ? "Sent" : "Not sent");
        const statusClass = theirReceivedAt
            ? "trade-status-delivered"
            : (yourSentAt ? "trade-status-in-transit" : "trade-status-reserved");
        card.appendChild(
            renderShipment({
                labelText: '<i data-lucide="arrow-up-right" class="inline-icon" aria-hidden="true"></i> You give',
                items: givesItems,
                statusLabel: status,
                statusClass,
                actionButton: !yourSentAt
                    ? {
                        label: "Sent",
                        primary: true,
                        onClick: (btn) => onMarkYouSent(req.id, isViewerSender, btn),
                    }
                    : null,
            })
        );
    }

    // Incoming shipment: stickers they're sending you.
    if (recvItems.length > 0) {
        const status = yourReceivedAt ? "Received" : (theirSentAt ? "Sent" : "Not sent");
        const statusClass = yourReceivedAt
            ? "trade-status-delivered"
            : (theirSentAt ? "trade-status-in-transit" : "trade-status-waiting");
        card.appendChild(
            renderShipment({
                labelText: '<i data-lucide="arrow-down-left" class="inline-icon" aria-hidden="true"></i> You receive',
                items: recvItems,
                statusLabel: status,
                statusClass,
                actionButton: (theirSentAt && !yourReceivedAt)
                    ? {
                        label: "Received",
                        primary: true,
                        onClick: (btn) => onMarkYouReceived(req.id, isViewerSender, btn),
                    }
                    : null,
            })
        );
    }

    // ----- Trade-scoped chat (collapsible) -----
    // Active only on accepted trades; the chat panel disappears once the trade
    // is marked complete (messages are preserved in the DB, just hidden here).
    card.appendChild(renderTradeChatSection(req));

    return card;
}

// Creates the "Chat" toggle + lazy-mounted panel for an accepted-trade card.
function renderTradeChatSection(req) {
    const wrap = document.createElement("div");
    wrap.className = "trade-card-chat";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "trade-chat-toggle";
    const updateToggleLabel = (open) => {
        toggle.innerHTML = "";
        toggle.appendChild(lucideIcon(open ? "chevron-up" : "message-square"));
        const label = document.createElement("span");
        label.textContent = open ? "Hide chat" : "Open chat";
        toggle.appendChild(label);
        refreshIcons();
    };
    updateToggleLabel(false);

    const host = document.createElement("div");
    host.className = "trade-card-chat-host hidden";

    toggle.addEventListener("click", async () => {
        if (host.classList.contains("hidden")) {
            // Lazy-load: only fetch the channel when the user expands.
            try {
                const channelId = await getOrCreateTradeChannel(req.id);
                mountChatPanel(host, channelId, { placeholder: "Message about this trade…" });
                host.classList.remove("hidden");
                updateToggleLabel(true);
            } catch (e) {
                alert("Couldn't open trade chat: " + (e.message || e));
            }
        } else {
            unmountChatPanel(host);
            host.classList.add("hidden");
            updateToggleLabel(false);
        }
    });

    wrap.appendChild(toggle);
    wrap.appendChild(host);
    return wrap;
}

function renderShipment({ labelText, items, statusLabel, statusClass, actionButton }) {
    const wrap = document.createElement("div");
    wrap.className = "trade-shipment";

    const label = document.createElement("div");
    label.className = "trade-shipment-label";
    label.innerHTML = labelText;
    wrap.appendChild(label);

    const ul = document.createElement("ul");
    ul.className = "pending-request-items";
    for (const it of items) {
        const li = document.createElement("li");
        appendStickerInline(li, it.sticker_code);
        ul.appendChild(li);
    }
    wrap.appendChild(ul);

    const footer = document.createElement("div");
    footer.className = "trade-shipment-footer";

    const status = document.createElement("span");
    status.className = `trade-shipment-status ${statusClass}`;
    status.textContent = statusLabel;
    footer.appendChild(status);

    if (actionButton) {
        const btn = document.createElement("button");
        btn.className = `btn ${actionButton.primary ? "btn-primary" : "btn-secondary"}`;
        btn.type = "button";
        btn.textContent = actionButton.label;
        btn.addEventListener("click", () => actionButton.onClick(btn));
        footer.appendChild(btn);
    }

    wrap.appendChild(footer);
    return wrap;
}

function renderPendingSection() {
    const root = document.getElementById("pending-requests-section");
    if (!root) return;

    const all = [...pendingRequestsCache.incoming, ...pendingRequestsCache.outgoing];
    if (all.length === 0) {
        root.classList.add("hidden");
        root.innerHTML = "";
        return;
    }
    root.classList.remove("hidden");
    root.innerHTML = "";

    const newIncoming     = pendingRequestsCache.incoming.filter((r) => r.status === "pending");
    const inProgress      = all.filter((r) => r.status === "accepted");
    const outgoingPending = pendingRequestsCache.outgoing.filter((r) => r.status === "pending");

    const renderGroup = (titleHtml, list, kind) => {
        if (list.length === 0) return;
        const title = document.createElement("div");
        title.className = "pending-section-title";
        title.innerHTML = titleHtml;
        root.appendChild(title);
        for (const req of list) {
            const card = renderPendingRequest(req, kind);
            if (card) root.appendChild(card);
        }
    };

    renderGroup(
        `<i data-lucide="mail" class="inline-icon" aria-hidden="true"></i> New requests (${newIncoming.length})`,
        newIncoming, "incoming"
    );
    // For 'accepted' (in-progress) cards, `kind` is ignored — role is derived from sender_id.
    renderGroup(
        `<i data-lucide="handshake" class="inline-icon" aria-hidden="true"></i> In progress (${inProgress.length})`,
        inProgress, "incoming"
    );
    renderGroup(
        `<i data-lucide="send" class="inline-icon" aria-hidden="true"></i> Sent, awaiting reply (${outgoingPending.length})`,
        outgoingPending, "outgoing"
    );
    refreshIcons();
}

// True if this trade has an action waiting on the current user.
// Covers both pending (accept/decline) AND in-progress (mark sent / mark received).
function tradeNeedsMyAction(req) {
    if (!currentUser) return false;
    if (req.status === "pending") {
        // Recipient must respond.
        return req.recipient_id === currentUser.id;
    }
    if (req.status === "accepted") {
        const isViewerSender = req.sender_id === currentUser.id;
        const items = req.trade_request_items || [];
        const giveDir = isViewerSender ? "sender_gives" : "recipient_gives";
        const recvDir = isViewerSender ? "recipient_gives" : "sender_gives";
        const hasGives = items.some((i) => i.direction === giveDir);
        const hasReceives = items.some((i) => i.direction === recvDir);

        const yourSentAt = isViewerSender ? req.sender_sent_at : req.recipient_sent_at;
        const yourReceivedAt = isViewerSender ? req.sender_received_at : req.recipient_received_at;
        const theirSentAt = isViewerSender ? req.recipient_sent_at : req.sender_sent_at;

        // I haven't marked my items sent yet.
        if (hasGives && !yourSentAt) return true;
        // They marked sent and I haven't confirmed received.
        if (hasReceives && theirSentAt && !yourReceivedAt) return true;
    }
    return false;
}

function countActionable() {
    const all = [...pendingRequestsCache.incoming, ...pendingRequestsCache.outgoing];
    return all.filter(tradeNeedsMyAction).length;
}

function updateFamilyBadge() {
    const count = countActionable();
    const badges = [
        document.getElementById("family-badge"),
        document.getElementById("trade-mine-badge"),
        document.getElementById("trade-mine-badge-2"),
    ];
    for (const badge of badges) {
        if (!badge) continue;
        if (count > 0) {
            badge.textContent = count;
            badge.classList.remove("hidden");
        } else {
            badge.classList.add("hidden");
        }
    }
}

// Notification banner state — tracks which pending count the user has dismissed.
// When the count increases beyond that, the banner re-shows automatically.
let bannerDismissedAtCount = -1;

function updateNotificationBanner() {
    const banner = document.getElementById("notification-banner");
    const text = document.getElementById("notification-text");
    if (!banner || !text) return;

    const count = countActionable();
    if (count === 0) {
        banner.classList.add("hidden");
        bannerDismissedAtCount = -1; // reset so future incoming triggers banner again
        return;
    }

    // If a new actionable item appeared after the user dismissed, show again.
    if (count > bannerDismissedAtCount) {
        text.textContent =
            `You have ${count} trade${count === 1 ? "" : "s"} to act on.`;
        banner.classList.remove("hidden");
    } else {
        banner.classList.add("hidden");
    }
}

function wireNotificationBanner() {
    document.getElementById("notification-view")?.addEventListener("click", () => {
        showView("trades");
    });
    document.getElementById("notification-dismiss")?.addEventListener("click", () => {
        bannerDismissedAtCount = pendingRequestsCache.incoming.length;
        document.getElementById("notification-banner")?.classList.add("hidden");
    });
}

async function refreshPendingRequests() {
    pendingRequestsCache = await fetchPendingRequests();
    updateFamilyBadge();
    updateNotificationBanner();
    renderPendingSection();
}

/* ---------- Completed trades ---------- */

let completedTradesCache = [];

async function fetchCompletedTrades() {
    if (!currentUser || !sb) return [];
    const { data, error } = await sb
        .from("trade_requests")
        .select(
            "id, sender_id, recipient_id, status, created_at, completed_at, " +
            "trade_request_items(sticker_code, direction, quantity)"
        )
        .or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(50);
    if (error) {
        console.error("Failed to fetch completed trades:", error);
        return [];
    }
    return data || [];
}

async function refreshCompletedTrades() {
    completedTradesCache = await fetchCompletedTrades();
    renderCompletedTradesSection();
}

function renderCompletedTradesSection() {
    const section = document.getElementById("completed-trades-section");
    const list = document.getElementById("completed-trades-list");
    if (!section || !list) return;

    if (completedTradesCache.length === 0) {
        section.classList.add("hidden");
        list.innerHTML = "";
        return;
    }
    section.classList.remove("hidden");
    list.innerHTML = "";
    for (const req of completedTradesCache) {
        list.appendChild(renderCompletedTradeCard(req));
    }
    refreshIcons();
}

function renderCompletedTradeCard(req) {
    const card = document.createElement("div");
    card.className = "pending-request completed-trade";

    const isViewerSender = req.sender_id === currentUser.id;
    const otherId = isViewerSender ? req.recipient_id : req.sender_id;
    const otherName = profileNameById(otherId);
    const items = req.trade_request_items || [];
    const giveDir = isViewerSender ? "sender_gives" : "recipient_gives";
    const recvDir = isViewerSender ? "recipient_gives" : "sender_gives";
    const yourGivesCount = items.filter((i) => i.direction === giveDir).length;
    const youReceiveCount = items.filter((i) => i.direction === recvDir).length;

    const dateStr = req.completed_at
        ? new Date(req.completed_at).toLocaleDateString()
        : "";

    const header = document.createElement("div");
    header.className = "pending-request-header";
    const left = document.createElement("span");
    left.innerHTML = `<i data-lucide="check-check" class="inline-icon" aria-hidden="true"></i> With ${escapeHtml(otherName)}`;
    const right = document.createElement("span");
    right.className = "trade-date";
    right.textContent = dateStr;
    header.appendChild(left);
    header.appendChild(right);
    card.appendChild(header);

    const body = document.createElement("div");
    body.className = "pending-request-body";
    body.innerHTML =
        `<strong>You gave:</strong> ${yourGivesCount} sticker${yourGivesCount === 1 ? "" : "s"} · ` +
        `<strong>You received:</strong> ${youReceiveCount} sticker${youReceiveCount === 1 ? "" : "s"}`;
    card.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "pending-request-actions";
    const del = document.createElement("button");
    del.className = "btn btn-secondary btn-icon";
    del.type = "button";
    del.appendChild(lucideIcon("trash-2"));
    del.title = "Remove this trade from history (counts won't change)";
    del.setAttribute("aria-label", "Delete this completed trade");
    del.addEventListener("click", () => onDeleteCompletedTrade(req.id, del));
    actions.appendChild(del);
    card.appendChild(actions);

    return card;
}

async function onDeleteCompletedTrade(requestId, btnEl) {
    if (!confirm("Remove this completed trade from history? Your sticker counts won't change.")) return;
    if (btnEl) btnEl.disabled = true;
    try {
        const { error } = await sb.from("trade_requests").delete().eq("id", requestId);
        if (error) throw error;
        await refreshCompletedTrades();
        updateTradesEmptyState();
    } catch (e) {
        console.error(e);
        showToast("Couldn't delete: " + (e.message || e));
        if (btnEl) btnEl.disabled = false;
    }
}

/* ---------- Propose / Accept / Decline / Cancel handlers ---------- */

async function onProposeTrade() {
    if (!sb || !currentUser || !tradeSelection) return;
    const asks = [...tradeSelection.checkedAsks, ...tradeSelection.extraAsks];
    const gives = [...tradeSelection.checkedGives, ...tradeSelection.extraGives];
    if (asks.length === 0 && gives.length === 0) return;

    const btn = document.getElementById("trade-propose");
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

    try {
        const { data: req, error: reqErr } = await sb
            .from("trade_requests")
            .insert({ sender_id: currentUser.id, recipient_id: tradeSelection.partnerId, status: "pending" })
            .select("id")
            .single();
        if (reqErr || !req) throw reqErr || new Error("Couldn't create request");

        const items = [
            ...asks.map((code) => ({ request_id: req.id, sticker_code: code, direction: "recipient_gives", quantity: 1 })),
            ...gives.map((code) => ({ request_id: req.id, sticker_code: code, direction: "sender_gives", quantity: 1 })),
        ];
        if (items.length > 0) {
            const { error: itemsErr } = await sb.from("trade_request_items").insert(items);
            if (itemsErr) {
                // Best-effort cleanup of the orphaned request.
                await sb.from("trade_requests").delete().eq("id", req.id);
                throw itemsErr;
            }
        }

        alert(`Trade proposal sent to ${tradeSelection.partnerName}.`);
        await refreshPendingRequests();
        closeTradeView();
        // Jump to the Trades view so the user sees their new outgoing request.
        showView("trades");
    } catch (err) {
        console.error(err);
        showToast(`Couldn't send proposal: ${err.message || err}`);
    } finally {
        if (btn) btn.disabled = false;
        refreshTradeSummary();
    }
}

async function onAcceptRequest(requestId, btnEl) {
    if (!sb || !currentUser) return;
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Accepting…"; }
    try {
        const { error } = await sb.rpc("accept_trade_request", { p_request_id: requestId });
        if (error) throw error;

        // Accept no longer changes counts — only reserves the stickers. So we just
        // refresh the active-trades list so the card flips from pending → accepted view.
        await refreshPendingRequests();
        alert("Trade accepted. Mark items as sent / received when they physically change hands.");
    } catch (err) {
        console.error(err);
        showToast(`Couldn't accept: ${err.message || err}`);
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = "Accept"; }
    }
}

// Refresh the local sticker grid + counter after a count-changing trade action.
async function refreshCollectionUI() {
    await loadCollectionFromCloud();
    for (const section of STICKER_DATA) {
        for (const [code] of section.stickers) renderSticker(code);
    }
    updateAllStats();
    applyFilters();
}

// "Mark sent" — viewer ships their items. Calls the appropriate RPC based on
// whether the viewer is the sender or recipient of the trade.
async function onMarkYouSent(requestId, isViewerSender, btnEl) {
    if (!sb || !currentUser) return;
    const rpcName = isViewerSender ? "mark_sender_sent" : "mark_recipient_sent";
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Marking…"; }
    try {
        const { error } = await sb.rpc(rpcName, { p_request_id: requestId });
        if (error) throw error;
        // Sending decreases viewer's collection. Refresh the grid + counter.
        await refreshCollectionUI();
        // Refresh family snapshot so partner views see updated counts next time.
        try { familyData = await fetchFamilyData(); renderFamilyList(); } catch (e) { /* ignore */ }
        await refreshPendingRequests();
    } catch (err) {
        console.error(err);
        showToast(`Couldn't mark sent: ${err.message || err}`);
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = "Mark sent"; }
    }
}

// "Mark received" — viewer confirms receipt of the partner's items.
async function onMarkYouReceived(requestId, isViewerSender, btnEl) {
    if (!sb || !currentUser) return;
    const rpcName = isViewerSender ? "mark_sender_received" : "mark_recipient_received";
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Marking…"; }
    try {
        const { error } = await sb.rpc(rpcName, { p_request_id: requestId });
        if (error) throw error;
        // Receiving increases viewer's collection. Refresh.
        await refreshCollectionUI();
        try { familyData = await fetchFamilyData(); renderFamilyList(); } catch (e) { /* ignore */ }
        await refreshPendingRequests();
    } catch (err) {
        console.error(err);
        showToast(`Couldn't mark received: ${err.message || err}`);
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = "Mark received"; }
    }
}

async function onDeclineRequest(requestId, btnEl) {
    if (!sb || !currentUser) return;
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Declining…"; }
    try {
        const { error } = await sb
            .from("trade_requests")
            .update({ status: "declined" })
            .eq("id", requestId);
        if (error) throw error;
        await refreshPendingRequests();
    } catch (err) {
        console.error(err);
        showToast(`Couldn't decline: ${err.message || err}`);
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = "Decline"; }
    }
}

async function onCancelRequest(requestId, btnEl) {
    if (!sb || !currentUser) return;
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Cancelling…"; }
    try {
        const { error } = await sb
            .from("trade_requests")
            .update({ status: "cancelled" })
            .eq("id", requestId);
        if (error) throw error;
        await refreshPendingRequests();
    } catch (err) {
        console.error(err);
        showToast(`Couldn't cancel: ${err.message || err}`);
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = "Cancel"; }
    }
}

/* ---------- Wiring ---------- */

function wireFamilyControls() {
    // The Community view's "back" button returns from trade builder → member list.
    document.getElementById("trade-back")?.addEventListener("click", closeTradeView);
    document.getElementById("trade-propose")?.addEventListener("click", onProposeTrade);

    // Select-all buttons (one per side)
    for (const btn of document.querySelectorAll(".trade-select-all")) {
        btn.addEventListener("click", () => {
            if (!tradeSelection) return;
            const side = btn.dataset.side;
            const list = side === "asks"
                ? tradeSelection.matches.theyHaveYouNeed
                : tradeSelection.matches.youHaveTheyNeed;
            const set = side === "asks" ? tradeSelection.checkedAsks : tradeSelection.checkedGives;
            const allChecked = list.length > 0 && list.every((m) => set.has(m.code));
            if (allChecked) {
                for (const m of list) set.delete(m.code);
            } else {
                for (const m of list) set.add(m.code);
            }
            // Re-render that side's checkbox list (lighter than full re-render).
            const root = document.getElementById(side === "asks" ? "trade-they-have" : "trade-you-have");
            if (root) {
                root.innerHTML = "";
                if (list.length === 0) {
                    root.innerHTML = `<div class="trade-empty">No duplicates here.</div>`;
                } else {
                    for (const m of list) root.appendChild(renderCheckboxRow(m.code, m.count, side));
                }
            }
            refreshTradeSummary();
        });
    }

    // Live search inputs
    for (const side of ["asks", "gives"]) {
        const input = document.getElementById(`trade-search-${side}`);
        if (!input) continue;
        input.addEventListener("input", () => renderSearchResults(side));
        input.addEventListener("focus", () => {
            if (input.value.trim()) renderSearchResults(side);
        });
        // Hide dropdown when clicking outside the wrapper
        input.addEventListener("blur", () => {
            // Slight delay so click on a result fires first
            setTimeout(() => {
                const r = document.getElementById(`trade-search-${side}-results`);
                if (r) r.classList.add("hidden");
            }, 150);
        });
    }

    // Old family-modal backdrop click handler removed — the modal no longer exists.
}

/* ============================================================
   WANTED view — find who has what you need (and who needs what you have)
   ============================================================ */

// Navigate to the Community trade builder pre-targeted at a specific member.
async function jumpToTradeWith(memberId, memberName) {
    if (!familyData) {
        try { familyData = await fetchFamilyData(); } catch (e) { console.warn(e); return; }
    }
    showView("community");
    await openTradeView(memberId, memberName);
}

// Compute "i need" and "others need" match lists from the family snapshot.
// If a Wanted label filter is active, only consider members that pass it.
function computeWantedMatches() {
    if (!familyData) return { iNeed: [], othersNeed: [] };
    const myCol = collection;
    const otherIds = familyData.profiles
        .map((p) => p.id)
        .filter((id) => id !== currentUser?.id)
        .filter(memberPassesWantedFilter);

    const iNeed = [];
    const othersNeed = [];

    for (const section of STICKER_DATA) {
        for (const [code] of section.stickers) {
            const myCount = myCol[code] || 0;

            if (myCount === 0) {
                // I'm missing — list members who have it (any count).
                const owners = [];
                for (const uid of otherIds) {
                    const c = familyData.collections[uid]?.[code] || 0;
                    if (c >= 1) {
                        owners.push({
                            userId: uid,
                            displayName: profileNameById(uid),
                            count: c,
                            extras: c - 1,
                        });
                    }
                }
                if (owners.length > 0) {
                    owners.sort((a, b) => b.count - a.count);
                    const totalExtras = owners.reduce((s, o) => s + o.extras, 0);
                    iNeed.push({ code, owners, totalExtras });
                }
            }

            if (myCount >= 2) {
                // I have extras — list members who are missing it.
                const needers = [];
                for (const uid of otherIds) {
                    const c = familyData.collections[uid]?.[code] || 0;
                    if (c === 0) {
                        needers.push({
                            userId: uid,
                            displayName: profileNameById(uid),
                        });
                    }
                }
                if (needers.length > 0) {
                    needers.sort((a, b) => a.displayName.localeCompare(b.displayName));
                    othersNeed.push({ code, needers, myExtras: myCount - 1 });
                }
            }
        }
    }

    // Sort with the easiest/most opportunities first.
    iNeed.sort((a, b) => b.totalExtras - a.totalExtras);
    othersNeed.sort((a, b) => b.needers.length - a.needers.length);

    return { iNeed, othersNeed };
}

let wantedCache = { iNeed: [], othersNeed: [] };
let wantedActiveTab = "i-need";
let wantedGroupBy = "person"; // "sticker" | "person" — default to By person per UX brief

// Walk the family snapshot once and return per-member match counts for the
// active tab. iNeed: members who have stickers I'm missing. othersNeed:
// members who are missing stickers I have duplicates of. Sorted descending
// by match count so the easiest trade partners surface first.
function computeWantedByPerson(tab) {
    if (!familyData) return [];
    const myCol = collection;
    const otherIds = familyData.profiles
        .map((p) => p.id)
        .filter((id) => id !== currentUser?.id)
        .filter(memberPassesWantedFilter);

    const rows = otherIds.map((uid) => {
        const theirCol = familyData.collections[uid] || {};
        // Two complementary counts (regardless of which tab is active):
        //   theyHave = stickers they own that I'm missing (their potential offer)
        //   theyNeed = my dupes that they're missing       (their potential ask)
        let theyHave = 0;
        let theyNeed = 0;
        for (const section of STICKER_DATA) {
            for (const [code] of section.stickers) {
                const myCount = myCol[code] || 0;
                const theirCount = theirCol[code] || 0;
                if (myCount === 0 && theirCount >= 1) theyHave++;
                if (myCount >= 2 && theirCount === 0) theyNeed++;
            }
        }
        // The "count" used for sorting + the big badge is whichever side
        // of the trade the active tab cares about.
        const count = tab === "i-need" ? theyHave : theyNeed;
        const reciprocal = tab === "i-need" ? theyNeed : theyHave;
        return {
            userId: uid,
            displayName: profileNameById(uid),
            count,
            reciprocal,
        };
    }).filter((r) => r.count > 0);

    // Sort by primary count descending — most-tradeable people surface first.
    rows.sort((a, b) => b.count - a.count);
    return rows;
}

function renderWantedRow(item, tab) {
    const meta = getStickerIndex()[item.code] || {};
    const card = document.createElement("div");
    card.className = "wanted-row";
    // For client-side search filtering, store the searchable text on the element.
    const searchable = `${item.code} ${meta.name || ""} ${meta.team || ""}`.toLowerCase();
    card.dataset.search = searchable;

    // Left: sticker info.
    const stickerDiv = document.createElement("div");
    stickerDiv.className = "wanted-row-sticker";
    appendStickerInline(stickerDiv, item.code);
    card.appendChild(stickerDiv);

    // Right: member list + buttons.
    const membersDiv = document.createElement("div");
    membersDiv.className = "wanted-row-members";

    if (tab === "i-need") {
        for (const owner of item.owners) {
            const row = document.createElement("div");
            row.className = "wanted-member";
            const label = document.createElement("span");
            label.className = "wanted-member-name";
            if (owner.extras > 0) {
                label.innerHTML =
                    `<strong>${escapeHtml(owner.displayName)}</strong> · has ${owner.count} ` +
                    `(<span class="wanted-extras-yes">+${owner.extras}</span>)`;
            } else {
                label.innerHTML = `<strong>${escapeHtml(owner.displayName)}</strong> · only copy`;
            }
            row.appendChild(label);

            const btn = document.createElement("button");
            btn.className = "btn btn-primary";
            btn.type = "button";
            const firstName = (owner.displayName || "").split(" ")[0] || "them";
            btn.textContent = `Trade with ${firstName}`;
            btn.addEventListener("click", () => jumpToTradeWith(owner.userId, owner.displayName));
            row.appendChild(btn);

            membersDiv.appendChild(row);
        }
    } else {
        const summary = document.createElement("div");
        summary.className = "wanted-summary";
        summary.innerHTML =
            `You have <strong>${item.myExtras} extra${item.myExtras === 1 ? "" : "s"}</strong> · ` +
            `<strong>${item.needers.length}</strong> member${item.needers.length === 1 ? " is" : "s are"} missing it`;
        membersDiv.appendChild(summary);

        for (const needer of item.needers) {
            const row = document.createElement("div");
            row.className = "wanted-member";
            const label = document.createElement("span");
            label.className = "wanted-member-name";
            label.innerHTML = `<strong>${escapeHtml(needer.displayName)}</strong> · missing`;
            row.appendChild(label);

            const btn = document.createElement("button");
            btn.className = "btn btn-primary";
            btn.type = "button";
            const firstName = (needer.displayName || "").split(" ")[0] || "them";
            btn.textContent = `Trade with ${firstName}`;
            btn.addEventListener("click", () => jumpToTradeWith(needer.userId, needer.displayName));
            row.appendChild(btn);

            membersDiv.appendChild(row);
        }
    }

    card.appendChild(membersDiv);
    return card;
}

function renderWantedPersonRow(row, tab) {
    const card = document.createElement("div");
    card.className = "wanted-person-row";
    // dataset.search powers client-side filtering (by-person search = by name).
    card.dataset.search = (row.displayName || "").toLowerCase();

    // Initial avatar — first letter of the display name in a tinted circle.
    const avatar = document.createElement("div");
    avatar.className = "wanted-person-avatar";
    avatar.textContent = (row.displayName || "?").trim().charAt(0).toUpperCase() || "?";
    card.appendChild(avatar);

    // Name + sub-label.
    const meta = document.createElement("div");
    meta.className = "wanted-person-meta";
    const nameLine = document.createElement("div");
    nameLine.className = "wanted-person-name-line";
    const name = document.createElement("span");
    name.className = "wanted-person-name";
    name.textContent = row.displayName || "Unnamed";
    nameLine.appendChild(name);
    const personLabels = labelsData.byMember.get(row.userId) || [];
    for (const lbl of personLabels) {
        nameLine.appendChild(renderMemberLabelChip(lbl));
    }
    meta.appendChild(nameLine);
    const sub = document.createElement("div");
    sub.className = "wanted-person-sub";
    const word = row.count === 1 ? "sticker" : "stickers";
    sub.textContent = tab === "i-need"
        ? `has ${row.count} ${word} you're missing`
        : `missing ${row.count} of your duplicate ${word}`;
    meta.appendChild(sub);

    // Reciprocal sub-line — shows the OTHER side of the trade in a smaller font.
    // Helps gauge fairness at a glance.
    if (typeof row.reciprocal === "number" && row.reciprocal > 0) {
        const sub2 = document.createElement("div");
        sub2.className = "wanted-person-sub-secondary";
        const recWord = row.reciprocal === 1 ? "sticker" : "stickers";
        sub2.textContent = tab === "i-need"
            ? `wants ${row.reciprocal} of your ${recWord}`
            : `offers ${row.reciprocal} ${recWord} you need`;
        meta.appendChild(sub2);
    }
    card.appendChild(meta);

    // Big count chip — the headline metric.
    const count = document.createElement("div");
    count.className = "wanted-person-count";
    count.textContent = String(row.count);
    card.appendChild(count);

    // Trade button.
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.type = "button";
    const firstName = (row.displayName || "").split(" ")[0] || "them";
    btn.textContent = `Trade with ${firstName}`;
    btn.addEventListener("click", () => jumpToTradeWith(row.userId, row.displayName));
    card.appendChild(btn);

    return card;
}

function renderWantedList() {
    const root = document.getElementById("wanted-list");
    const empty = document.getElementById("wanted-empty");
    if (!root || !empty) return;
    root.innerHTML = "";
    root.classList.toggle("wanted-list-person", wantedGroupBy === "person");

    if (wantedGroupBy === "person") {
        const rows = computeWantedByPerson(wantedActiveTab);
        if (rows.length === 0) {
            empty.classList.remove("hidden");
            return;
        }
        empty.classList.add("hidden");
        for (const row of rows) {
            root.appendChild(renderWantedPersonRow(row, wantedActiveTab));
        }
    } else {
        const items = wantedActiveTab === "i-need" ? wantedCache.iNeed : wantedCache.othersNeed;
        if (items.length === 0) {
            empty.classList.remove("hidden");
            return;
        }
        empty.classList.add("hidden");
        for (const item of items) {
            root.appendChild(renderWantedRow(item, wantedActiveTab));
        }
    }

    // Re-apply current search filter, if any.
    const searchEl = document.getElementById("wanted-search");
    if (searchEl?.value) applyWantedSearch(searchEl.value);
}

function applyWantedSearch(query) {
    const q = (query || "").trim().toLowerCase();
    const root = document.getElementById("wanted-list");
    if (!root) return;
    let anyVisible = false;
    for (const row of root.children) {
        const haystack = row.dataset.search || "";
        const visible = !q || haystack.includes(q);
        row.classList.toggle("hidden", !visible);
        if (visible) anyVisible = true;
    }
    const empty = document.getElementById("wanted-empty");
    if (empty) empty.classList.toggle("hidden", anyVisible || root.children.length === 0);
}

async function refreshWantedView() {
    if (!sb || !currentUser) return;
    // Need family data + labels to compute matches and render the filter bar.
    if (!familyData) {
        try { familyData = await fetchFamilyData(); } catch (e) { console.warn(e); return; }
    }
    await refreshLabels();
    wantedCache = computeWantedMatches();
    renderWantedLabelBar();
    renderWantedList();
}

// True if this member passes the active Wanted-view label filter.
function memberPassesWantedFilter(memberId) {
    if (!activeWantedLabelFilter) return true;
    const labels = labelsData.byMember.get(memberId) || [];
    return labels.some((l) => l.labelId === activeWantedLabelFilter);
}

function wireWantedControls() {
    // Tab buttons (I'm missing / Others are missing).
    for (const btn of document.querySelectorAll(".wanted-tab")) {
        btn.addEventListener("click", () => {
            const next = btn.dataset.wantedTab;
            if (next === wantedActiveTab) return;
            wantedActiveTab = next;
            for (const t of document.querySelectorAll(".wanted-tab")) {
                t.classList.toggle("active", t.dataset.wantedTab === next);
                t.setAttribute("aria-selected", String(t.dataset.wantedTab === next));
            }
            renderWantedList();
        });
    }
    // Group-by toggle (By sticker / By person).
    for (const btn of document.querySelectorAll(".wanted-group")) {
        btn.addEventListener("click", () => {
            const next = btn.dataset.wantedGroup;
            if (next === wantedGroupBy) return;
            wantedGroupBy = next;
            for (const t of document.querySelectorAll(".wanted-group")) {
                t.classList.toggle("active", t.dataset.wantedGroup === next);
                t.setAttribute("aria-selected", String(t.dataset.wantedGroup === next));
            }
            // Update search placeholder + clear current query so the user
            // isn't stuck filtering a different domain than they expect.
            const searchEl = document.getElementById("wanted-search");
            if (searchEl) {
                searchEl.placeholder = wantedGroupBy === "person"
                    ? "Filter by person name…"
                    : "Filter by code or player…";
                searchEl.value = "";
            }
            renderWantedList();
        });
    }
    // Search input.
    const searchEl = document.getElementById("wanted-search");
    if (searchEl) {
        searchEl.addEventListener("input", (e) => applyWantedSearch(e.target.value));
        // Default mode is "person", so the placeholder should reflect that.
        if (wantedGroupBy === "person") {
            searchEl.placeholder = "Filter by person name…";
        }
    }

    // Trade sub-view tabs (Discover / My trades) — appear on both wanted + trades views.
    for (const btn of document.querySelectorAll(".trade-subview-tab")) {
        btn.addEventListener("click", () => {
            const next = btn.dataset.tradeTab;
            if (next === "discover") showView("wanted");
            else if (next === "mine") showView("trades");
        });
    }
}

/* ============================================================
   ACTIVITY feed — chronological events derived from trades + profiles
   ============================================================ */

function timeAgo(timestamp) {
    if (!timestamp) return "";
    const t = new Date(timestamp);
    const diff = Date.now() - t.getTime();
    if (isNaN(diff)) return "";
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
    return t.toLocaleDateString();
}

async function fetchAllMyTrades() {
    if (!currentUser || !sb) return [];
    const { data, error } = await sb
        .from("trade_requests")
        .select(
            "id, sender_id, recipient_id, status, created_at, updated_at, " +
            "accepted_at, sender_sent_at, recipient_received_at, " +
            "recipient_sent_at, sender_received_at, completed_at"
        )
        .or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`)
        .order("created_at", { ascending: false })
        .limit(100);
    if (error) {
        console.error("Failed to fetch activity trades:", error);
        return [];
    }
    return data || [];
}

function buildActivityEvents(trades, profiles) {
    const events = [];
    const meId = currentUser?.id;
    const youName = "you";

    for (const t of trades || []) {
        const isSender = t.sender_id === meId;
        const otherId = isSender ? t.recipient_id : t.sender_id;
        const otherName = profileNameById(otherId);

        events.push({
            time: t.created_at,
            icon: "handshake",
            tone: "neutral",
            text: isSender
                ? `You proposed a trade with <strong>${escapeHtml(otherName)}</strong>`
                : `<strong>${escapeHtml(otherName)}</strong> proposed a trade with ${youName}`,
        });

        if (t.accepted_at) events.push({
            time: t.accepted_at,
            icon: "circle-check",
            tone: "success",
            text: isSender
                ? `<strong>${escapeHtml(otherName)}</strong> accepted your trade`
                : `You accepted <strong>${escapeHtml(otherName)}</strong>'s trade`,
        });

        if (t.sender_sent_at) events.push({
            time: t.sender_sent_at,
            icon: "package",
            tone: "info",
            text: isSender
                ? `You marked items sent to <strong>${escapeHtml(otherName)}</strong>`
                : `<strong>${escapeHtml(otherName)}</strong> marked items sent to ${youName}`,
        });

        if (t.recipient_received_at) events.push({
            time: t.recipient_received_at,
            icon: "package-check",
            tone: "success",
            text: isSender
                ? `<strong>${escapeHtml(otherName)}</strong> confirmed receiving your items`
                : `You confirmed receiving items from <strong>${escapeHtml(otherName)}</strong>`,
        });

        if (t.recipient_sent_at) events.push({
            time: t.recipient_sent_at,
            icon: "package",
            tone: "info",
            text: isSender
                ? `<strong>${escapeHtml(otherName)}</strong> marked items sent to ${youName}`
                : `You marked items sent to <strong>${escapeHtml(otherName)}</strong>`,
        });

        if (t.sender_received_at) events.push({
            time: t.sender_received_at,
            icon: "package-check",
            tone: "success",
            text: isSender
                ? `You confirmed receiving items from <strong>${escapeHtml(otherName)}</strong>`
                : `<strong>${escapeHtml(otherName)}</strong> confirmed receiving your items`,
        });

        if (t.completed_at) events.push({
            time: t.completed_at,
            icon: "party-popper",
            tone: "success",
            text: `Trade with <strong>${escapeHtml(otherName)}</strong> completed`,
        });

        if (t.status === "declined") events.push({
            time: t.updated_at,
            icon: "circle-x",
            tone: "danger",
            text: isSender
                ? `<strong>${escapeHtml(otherName)}</strong> declined your trade`
                : `You declined <strong>${escapeHtml(otherName)}</strong>'s trade`,
        });

        if (t.status === "cancelled") events.push({
            time: t.updated_at,
            icon: "ban",
            tone: "muted",
            text: isSender
                ? `You cancelled your trade with <strong>${escapeHtml(otherName)}</strong>`
                : `<strong>${escapeHtml(otherName)}</strong> cancelled their trade with ${youName}`,
        });
    }

    // Member-joined events. Skip self, skip undated profiles.
    for (const p of profiles || []) {
        if (!p.created_at || p.id === meId) continue;
        events.push({
            time: p.created_at,
            icon: "user-plus",
            tone: "info",
            text: `<strong>${escapeHtml(p.display_name || "Someone")}</strong> joined`,
        });
    }

    events.sort((a, b) => new Date(b.time) - new Date(a.time));
    return events.slice(0, 100); // cap the rendered feed
}

function renderActivityFeed(events) {
    const root = document.getElementById("activity-feed");
    const empty = document.getElementById("activity-empty");
    if (!root || !empty) return;

    if (!events || events.length === 0) {
        root.innerHTML = "";
        empty.classList.remove("hidden");
        return;
    }
    empty.classList.add("hidden");
    root.innerHTML = "";

    for (const e of events) {
        const row = document.createElement("div");
        row.className = "activity-event";

        const icon = document.createElement("span");
        icon.className = `activity-icon activity-icon-${e.tone || "neutral"}`;
        icon.appendChild(lucideIcon(e.icon));
        row.appendChild(icon);

        const content = document.createElement("div");
        content.className = "activity-content";
        const text = document.createElement("div");
        text.className = "activity-text";
        text.innerHTML = e.text;
        const time = document.createElement("div");
        time.className = "activity-time";
        time.textContent = timeAgo(e.time);
        content.appendChild(text);
        content.appendChild(time);
        row.appendChild(content);

        root.appendChild(row);
    }
    refreshIcons();
}

async function refreshActivityView() {
    if (!sb || !currentUser) return;
    if (!familyData) {
        try { familyData = await fetchFamilyData(); } catch (e) { /* ignore */ }
    }
    try {
        const trades = await fetchAllMyTrades();
        const events = buildActivityEvents(trades, familyData?.profiles || []);
        renderActivityFeed(events);
    } catch (e) {
        console.error("Failed to refresh activity feed:", e);
    }
}

/* ============================================================
   HOME / LANDING view (Phase 4 design migration)
   ============================================================ */

// Pick 3 random real teams + a random sticker from each for the hero deco.
// Re-shuffled every page load so the hero feels fresh.
function renderHomeHeroStack() {
    const root = document.getElementById("home-hero-stack");
    if (!root) return;
    root.innerHTML = "";

    // Eligible teams: real country teams (skip Introduction / History / CC) that
    // have a flag (iso code) AND at least 2 stickers so we can pick a non-badge.
    const eligible = STICKER_DATA.filter((s) =>
        s.team &&
        isRealTeam(s.team) &&
        Array.isArray(s.stickers) &&
        s.stickers.length >= 2 &&
        getCountryCode(s.team)
    );
    if (eligible.length === 0) return;

    // Fisher-Yates shuffle, take first 3.
    const pool = [...eligible];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picks = pool.slice(0, 3);

    for (const section of picks) {
        // Pick a random sticker from the team (skip the badge at index 0).
        const idx = 1 + Math.floor(Math.random() * (section.stickers.length - 1));
        const [code, name] = section.stickers[idx];

        const card = document.createElement("div");
        card.className = "home-hero-sticker";

        const iso = getCountryCode(section.team);
        if (iso) {
            const flag = document.createElement("span");
            flag.className = `sticker-flag fi fi-${iso}`;
            card.appendChild(flag);
        }
        const codeEl = document.createElement("span");
        codeEl.className = "sticker-code";
        codeEl.textContent = formatStickerCode(code);
        card.appendChild(codeEl);

        const nameEl = document.createElement("span");
        nameEl.className = "sticker-name";
        nameEl.textContent = name;
        card.appendChild(nameEl);

        root.appendChild(card);
    }
}

function renderHomeStats() {
    let totalOwned = 0;
    let totalExtras = 0;
    let totalStickers = 0;
    for (const section of STICKER_DATA) {
        const s = computeStats(section.stickers);
        totalOwned += s.owned;
        totalExtras += s.extras;
        totalStickers += s.total;
    }
    const pct = totalStickers === 0 ? 0 : (totalOwned / totalStickers) * 100;
    const pctDisplay = pct === 0 || pct === 100 ? pct.toFixed(0) : pct.toFixed(1);

    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    set("home-stat-collected", totalOwned.toLocaleString());
    set("home-stat-dupes", totalExtras.toLocaleString());
    set("home-stat-pct", `${pctDisplay}%`);
}

// Pick 4 "featured" groups — sorted by progress descending, so the user sees
// the ones they're closest to completing first.
function renderHomeFeatured() {
    const root = document.getElementById("home-featured");
    if (!root) return;
    root.innerHTML = "";

    // Aggregate by group letter (A, B, ...) using the GROUPS constant.
    const teamProgress = [];
    for (const section of STICKER_DATA) {
        const teamName = section.team;
        // Skip non-team sections (Introduction, World Cup History, Coca-Cola).
        if (!TEAM_META[teamName] || !Array.isArray(TEAM_META[teamName].colors)) {
            // crude check; not all entries are real teams
        }
        if (!isRealTeam(teamName)) continue;
        const s = computeStats(section.stickers);
        const group = findTeamGroup(teamName);
        teamProgress.push({ teamName, group, owned: s.owned, total: s.total });
    }

    teamProgress.sort((a, b) => {
        const ap = a.total === 0 ? 0 : a.owned / a.total;
        const bp = b.total === 0 ? 0 : b.owned / b.total;
        return bp - ap;
    });

    const featured = teamProgress.slice(0, 4);
    for (const t of featured) {
        const pct = t.total === 0 ? 0 : Math.round((t.owned / t.total) * 100);
        const card = document.createElement("button");
        card.type = "button";
        card.className = "featured-team";
        card.innerHTML =
            `<div class="featured-team-code">GROUP ${escapeHtml(t.group || "?")} · ${escapeHtml(t.teamName.toUpperCase())}</div>` +
            `<div class="featured-team-name">${escapeHtml(t.teamName)}</div>` +
            `<div>` +
                `<div class="featured-team-prog"><span>${t.owned}/${t.total}</span><span>${pct}%</span></div>` +
                `<div class="progress-bar"><i style="width: ${pct}%"></i></div>` +
            `</div>`;
        card.addEventListener("click", () => {
            showView("album");
            // Scroll to team after navigation paints.
            setTimeout(() => {
                const el = document.querySelector(`[data-team="${CSS.escape(t.teamName)}"]`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 100);
        });
        root.appendChild(card);
    }
}

// Helper: find which group a team is in. Returns "A", "B", etc.
function findTeamGroup(teamName) {
    if (typeof GROUPS === "undefined") return "";
    for (const letter of Object.keys(GROUPS)) {
        if (GROUPS[letter].includes(teamName)) return letter;
    }
    return "";
}

function isRealTeam(teamName) {
    const NON_TEAM = new Set(["Introduction", "FIFA World Cup History", "Coca-Cola Insert Set"]);
    return !NON_TEAM.has(teamName);
}

// Recent activity strip (top 5 events).
async function renderHomeActivity() {
    const root = document.getElementById("home-activity");
    if (!root) return;
    root.innerHTML = '<div class="home-activity-empty">Loading…</div>';

    try {
        if (!familyData) familyData = await fetchFamilyData();
        const trades = await fetchAllMyTrades();
        const events = buildActivityEvents(trades, familyData?.profiles || []).slice(0, 5);

        root.innerHTML = "";
        if (events.length === 0) {
            root.innerHTML = '<div class="home-activity-empty">Nothing yet. Trades and member joins will appear here as they happen.</div>';
            return;
        }
        for (const e of events) {
            const row = document.createElement("div");
            row.className = "home-activity-row";
            const dot = document.createElement("span");
            dot.className = `home-activity-dot ${e.tone || "neutral"}`;
            row.appendChild(dot);
            const txt = document.createElement("span");
            txt.className = "home-activity-text";
            txt.innerHTML = e.text;
            row.appendChild(txt);
            const t = document.createElement("span");
            t.className = "home-activity-when";
            t.textContent = timeAgo(e.time);
            row.appendChild(t);
            root.appendChild(row);
        }
    } catch (e) {
        console.error("Home activity failed:", e);
        root.innerHTML = '<div class="home-activity-empty">Couldn\'t load activity.</div>';
    }
}

async function refreshHomeView() {
    if (!sb || !currentUser) return;
    renderHomeStats();
    renderHomeHeroStack();
    renderHomeFeatured();
    // Activity is async — let it stream in.
    renderHomeActivity().catch((e) => console.warn(e));
}

// Hero action buttons (Open my album / Browse traders) — wire once at init time.
function wireHomeControls() {
    document.querySelectorAll("[data-route]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = btn.getAttribute("data-route");
            if (target) showView(target);
        });
    });
}

async function init() {
    // Sanity check: config + SDK present?
    if (typeof SUPABASE_URL !== "string" || typeof SUPABASE_PUBLISHABLE_KEY !== "string") {
        alert("Supabase config missing — supabase-config.js didn't load.");
        return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
        alert("Supabase SDK didn't load. Check your internet connection and refresh.");
        return;
    }

    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

    wireAuthControls();
    wireFilterControls();
    wireFooterControls();
    wireFamilyControls();
    wireNotificationBanner();
    wireShellControls();
    wireWantedControls();
    wireLabelManagerControls();
    wireGroupChatControls();
    wireHomeControls();
    wireCommunityDetailControls();

    // Render all static lucide icons present in index.html.
    refreshIcons();

    // Recovery links land here with `#access_token=...&type=recovery&...`.
    // Detect that *before* we look at the session, so we don't accidentally
    // load the app shell using the recovery session.
    const hash = window.location.hash || "";
    if (hash.includes("type=recovery")) {
        inRecoveryFlow = true;
    }

    // Check for an existing session (the SDK persists tokens in localStorage
    // separately, so refreshes keep the user signed in).
    const { data: { session } } = await sb.auth.getSession();
    if (inRecoveryFlow) {
        // Show the "set a new password" form regardless of session state.
        showAuthScreen();
        setAuthMode?.("recovery");
    } else if (session?.user) {
        await handleSignedIn(session.user);
    } else {
        showAuthScreen();
    }

    // React to sign-in / sign-out events from anywhere.
    sb.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") {
            // Fired by the SDK after it parses the recovery token from the URL.
            inRecoveryFlow = true;
            showAuthScreen();
            setAuthMode?.("recovery");
            return;
        }
        if (event === "SIGNED_IN" && session?.user) {
            // Suppress the normal post-signin flow while a recovery is in
            // progress — the user hasn't actually signed in, the SDK just
            // opened a session with the recovery token.
            if (inRecoveryFlow) return;
            // Only do the full re-load if the user actually changed,
            // since this also fires on token refresh.
            if (!currentUser || currentUser.id !== session.user.id) {
                handleSignedIn(session.user);
            }
        } else if (event === "SIGNED_OUT") {
            handleSignedOut();
        }
    });
}

init();
