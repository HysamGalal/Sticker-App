const STORAGE_KEY = "wc2026-stickers-v2";

// collection[stickerCode] = positive integer count.
// Missing stickers are not stored (treated as count 0).
let collection = loadCollection();

// Ephemeral filter state — not persisted; resets on reload.
const filterState = {
    status: "all", // "all" | "missing" | "collected" | "duplicates"
    search: "",
};
let lastFirstVisibleSection = null;

function loadCollection() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        return migrateCollection(JSON.parse(raw));
    } catch (e) {
        console.warn("Could not load saved collection:", e);
    }
    return {};
}

// Convert legacy { state, extras } entries to numeric counts.
// New format already uses numbers; pre-migrated data passes through unchanged.
function migrateCollection(raw) {
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    let didMigrate = false;
    for (const [code, value] of Object.entries(raw)) {
        if (typeof value === "number") {
            if (value > 0) out[code] = value;
        } else if (value && typeof value === "object" && typeof value.state === "string") {
            didMigrate = true;
            if (value.state === "have") {
                out[code] = 1;
            } else if (value.state === "dup") {
                out[code] = (Number(value.extras) || 0) + 1;
            }
            // legacy "missing" entries are dropped
        }
    }
    if (didMigrate) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
        } catch (e) {
            console.warn("Could not persist migrated data:", e);
        }
    }
    return out;
}

function saveCollection() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
}

function getCount(code) {
    return collection[code] || 0;
}

function setCount(code, count) {
    if (count <= 0) {
        delete collection[code];
    } else {
        collection[code] = count;
    }
    saveCollection();
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

function resetCollection() {
    collection = {};
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        console.warn("Could not clear localStorage:", e);
    }
    for (const section of STICKER_DATA) {
        for (const [code] of section.stickers) renderSticker(code);
    }
    updateAllStats();
    applyFilters(); // current filter may now match a different set (or none)
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

function buildSections() {
    const root = document.getElementById("sections");
    const frag = document.createDocumentFragment();

    for (const section of STICKER_DATA) {
        const sectionEl = document.createElement("section");
        sectionEl.className = "team-section";
        sectionEl.dataset.team = section.team;

        const meta = (typeof TEAM_META !== "undefined" && TEAM_META[section.team]) || {
            flag: "",
            colors: ["#64748b", "#94a3b8"],
        };

        const header = document.createElement("div");
        header.className = "team-header";
        const gradientStops = meta.colors.length >= 2 ? meta.colors : [meta.colors[0], meta.colors[0]];
        header.style.background = `linear-gradient(135deg, ${gradientStops.join(", ")})`;

        const headerInner = document.createElement("div");
        headerInner.className = "team-header-inner";

        const h2 = document.createElement("h2");
        const flagSpan = document.createElement("span");
        flagSpan.className = "flag";
        flagSpan.textContent = meta.flag;
        const nameNode = document.createTextNode(section.team);
        h2.appendChild(flagSpan);
        h2.appendChild(nameNode);

        const progress = document.createElement("span");
        progress.className = "team-progress";
        progress.dataset.teamProgress = section.team;

        headerInner.appendChild(h2);
        headerInner.appendChild(progress);
        header.appendChild(headerInner);
        sectionEl.appendChild(header);

        const grid = document.createElement("div");
        grid.className = "grid";
        for (const [code, name] of section.stickers) {
            const btn = document.createElement("button");
            btn.className = "sticker";
            btn.dataset.code = code;
            btn.title = `${code} — ${name}`;
            btn.textContent = code;
            btn.addEventListener("click", () => incrementCount(code));
            btn.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                decrementCount(code);
            });
            grid.appendChild(btn);
        }
        sectionEl.appendChild(grid);
        frag.appendChild(sectionEl);
    }

    root.appendChild(frag);

    for (const section of STICKER_DATA) {
        for (const [code] of section.stickers) renderSticker(code);
    }
    updateAllStats();
}

buildSections();
wireFilterControls();
wireFooterControls();
