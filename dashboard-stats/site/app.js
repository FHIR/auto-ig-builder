/* IG build retrospective — live SQL over igstats.sqlite (sql.js), cross-filtered by a global state in the URL hash. */
"use strict";
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ================= database =================
let db;
function run(sql, params = {}) {
  const st = db.prepare(sql); const out = [];
  try { st.bind(params); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
  return out;
}
const one = (sql, p) => run(sql, p)[0] || {};

// lookups filled at load
const LK = { orgId: {}, orgName: {}, repoId: {}, repoName: {}, personId: {}, personLogin: {}, cls: [], meta: {} };

// ================= global filter state =================
const KEYS = ["cls", "org", "repo", "branch", "kind", "outcome", "from", "to", "dow", "hour", "dhtz", "login", "region",
  "dur", "size", "errb", "fhir", "mem", "ccls", "cpool", "tz", "metric", "tab", "sort", "dir", "page", "sql"];
let S = {};
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1)); S = {};
  for (const k of KEYS) if (p.has(k)) S[k] = p.get(k);
}
function writeHash() {
  const p = new URLSearchParams(); for (const k of KEYS) if (S[k] != null && S[k] !== "") p.set(k, S[k]);
  const h = "#" + p.toString();
  if (h !== location.hash) history.pushState(null, "", h || location.pathname);
}
function set(patch, opts = {}) {
  for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") delete S[k]; else S[k] = String(v); }
  if (!opts.keepPage) delete S.page;
  writeHash(); schedule();
}
addEventListener("popstate", () => { readHash(); schedule(); });
addEventListener("hashchange", () => { readHash(); schedule(); });

const CLASSES = ["HL7 International", "HL7 affiliates", "IHE", "FHIR community", "Everyone else"];
const CCOL = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)"];
const CINK = ["var(--on-s1)", "var(--on-s2)", "var(--on-s3)", "var(--on-s4)", "var(--on-s5)"];
const OUTC = { 1: ["success", "var(--s1)"], 2: ["failure", "var(--critical)"], 3: ["no result", "var(--muted)"], 4: ["no logs", "var(--axis)"] };
const ERRB = [["No errors", 0, 0], ["1–9", 1, 9], ["10–99", 10, 99], ["100 or more", 100, 1e9]];
const unix = (d) => Date.parse(d + "T00:00:00Z") / 1000;
const isoDay = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const addDays = (d, n) => isoDay(unix(d) + n * 86400);

/** Build the filter clauses. skip = keys this view ignores (so it can show its own dimension in context). */
function where(skip = []) {
  const b = [], c = [], p = {}, sk = new Set(skip);
  const use = (k) => S[k] != null && !sk.has(k);
  if (use("cls")) { p[":cls"] = CLASSES.indexOf(S.cls) + 1; b.push("b.cls = :cls"); c.push("c.repo_id in (select r.id from repos r join orgs o on o.id = r.org_id where o.cls = :cls)"); }
  if (use("region")) { p[":region"] = S.region; b.push("b.org_id in (select id from orgs where region = :region)"); c.push("c.repo_id in (select r.id from repos r join orgs o on o.id = r.org_id where o.region = :region)"); }
  if (use("org")) { p[":org"] = LK.orgId[S.org] ?? -1; b.push("b.org_id = :org"); c.push("c.repo_id in (select id from repos where org_id = :org)"); }
  if (use("repo")) { p[":repo"] = LK.repoId[S.repo] ?? -1; b.push("b.repo_id = :repo"); c.push("c.repo_id = :repo"); }
  if (use("branch") && S.repo) { p[":branch"] = (one("select id from branches where repo_id = :r and name = :n", { ":r": LK.repoId[S.repo] ?? -1, ":n": S.branch }).id) ?? -1; b.push("b.branch_id = :branch"); }
  if (use("kind")) { p[":kind"] = S.kind === "main/master" ? 1 : 2; b.push("b.kind = :kind"); }
  if (use("outcome")) { p[":outcome"] = +Object.keys(OUTC).find((k) => OUTC[k][0] === S.outcome) || -1; b.push("b.outcome = :outcome"); }
  if (use("from")) { p[":t0"] = unix(S.from); b.push("b.ts >= :t0"); c.push("c.ts >= :t0"); }
  if (use("to")) { p[":t1"] = unix(S.to) + 86400; b.push("b.ts < :t1"); c.push("c.ts < :t1"); }
  const et = S.dhtz === "et";
  if (use("dow")) { p[":dow"] = +S.dow; b.push(et ? "b.dow_et = :dow" : "b.dow = :dow"); }
  if (use("hour")) { p[":hour"] = +S.hour; b.push(et ? "b.hour_et = :hour" : "b.hour = :hour"); }
  if (use("login")) { p[":login"] = LK.personId[S.login] ?? -1; b.push("b.repo_id in (select repo_id from commits where person_id = :login)"); c.push("c.person_id = :login"); }
  if (use("dur")) { const [a, z] = S.dur.split("-").map(Number); p[":d0"] = a; p[":d1"] = z; b.push("b.minutes >= :d0 and b.minutes < :d1"); }
  if (use("size")) { const [a, z] = S.size.split("-").map(Number); p[":s0"] = a; p[":s1"] = z; b.push("b.upload_mb >= :s0 and b.upload_mb < :s1"); }
  if (use("errb")) { const e = ERRB.find((x) => x[0] === S.errb) || ERRB[0]; p[":e0"] = e[1]; p[":e1"] = e[2]; b.push("b.outcome = 1 and b.errors between :e0 and :e1"); }
  if (use("fhir")) { p[":fhir"] = S.fhir; b.push("b.branch_id in (select id from branches where fhir = :fhir)"); }
  if (use("mem")) { p[":m0"] = +S.mem; b.push("b.branch_id in (select id from branches where qa_mem_gib >= :m0 and qa_mem_gib < :m0 + 1)"); }
  return { W: b.map((x) => " and " + x).join(""), C: c.map((x) => " and " + x).join(""), p };
}
function q(name, skip = [], extra = {}, repl = {}) {
  const w = where(skip);
  let sql = Q[name].replaceAll("/*W*/", w.W).replaceAll("/*C*/", w.C);
  for (const [k, v] of Object.entries(repl)) sql = sql.replaceAll(k, v);
  lastSQL[curView] = (lastSQL[curView] ? lastSQL[curView] + "\n\n" : "") + "-- " + name + "\n" + sql.trim() + (Object.keys({ ...w.p, ...extra }).length ? "\n-- params: " + JSON.stringify({ ...w.p, ...extra }) : "");
  return run(sql, { ...w.p, ...extra });
}
const lastSQL = {}; let curView = null;

// ================= layout helpers =================
const app = () => $("#app");
const views = []; // {id, el(card), body, draw()}
function section(id, title) {
  const sec = h("section", { id }, h("h2", {}, title), h("p", { class: "finding", id: id + "-finding" }));
  app().append(sec); return sec;
}
function view(parent, id, title, sub, draw, opts = {}) {
  const body = h("div", { class: "vbody" });
  const sqlBox = h("details", { class: "sql" }, h("summary", {}, "SQL"), h("pre", {}));
  const card = h("div", { class: "card", id: "v-" + id }, h("div", { class: "card-head" }, h("h3", {}, title), opts.tools || null),
    sub ? h("p", { class: "sub", html: sub }) : null, body, opts.note != null ? h("p", { class: "note", html: opts.note }) : null, sqlBox);
  parent.append(card);
  const v = { id, card, body, draw, sqlBox };
  views.push(v); return v;
}
function chartBox(v, key = "c") { let el = v.body.querySelector(`[data-k="${key}"]`); if (!el) { el = h("div", { class: "chart", "data-k": key }); v.body.append(el); } return el; }
function table(cols, rows, opts = {}) {
  const t = h("table", {}, h("thead", {}, h("tr", {}, cols.map((c, i) => h("th", {
    class: opts.sortable ? "sortable" + (opts.sortCol === c ? " on " + opts.sortDir : "") : "", role: opts.sortable ? "button" : null, tabindex: opts.sortable ? 0 : null,
    onclick: opts.sortable ? () => opts.onSort(c) : null, onkeydown: opts.sortable ? (e) => { if (e.key === "Enter") opts.onSort(c); } : null,
  }, c)))), h("tbody", {}, rows.map((r, ri) => h("tr", { class: opts.onRow ? "clickable" : "", tabindex: opts.onRow ? 0 : null,
    onclick: opts.onRow ? () => opts.onRow(r, ri) : null, onkeydown: opts.onRow ? (e) => { if (e.key === "Enter") opts.onRow(r, ri); } : null,
  }, cols.map((c, i) => { const v = Array.isArray(r) ? r[i] : r[c]; return h("td", { class: typeof v === "number" || (typeof v === "string" && /^[\d,.%×$–-]+$/.test(v)) ? "num" : "" }, v == null ? "" : typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : v.nodeType ? v : String(v)); })))));
  return h("div", { class: "tablewrap" + (opts.cls ? " " + opts.cls : "") }, t);
}
const swatch = (col) => { const i = h("i", { class: "sw" }); i.style.background = col; return i; };
const btn = (label, on, onclick, extra = {}) => h("button", { type: "button", class: "seg" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", onclick, ...extra }, label);

// ================= chips / breadcrumb / kpis =================
function chipLabel(k) {
  switch (k) {
    case "from": return S.to && S.to !== S.from ? `${dlabel(S.from, true)} – ${dlabel(S.to, true)}` : dlabel(S.from, true);
    case "dow": return DOW[S.dow - 1] + (S.hour != null ? ` ${String(S.hour).padStart(2, "0")}:00` : "") + (S.dhtz === "et" ? " ET" : " UTC");
    case "hour": return `${String(S.hour).padStart(2, "0")}:00 ${S.dhtz === "et" ? "ET" : "UTC"} (any day)`;
    case "dur": return `${S.dur.replace("-", "–")} min`;
    case "size": return `${S.size.replace("-", "–")} MB`;
    case "errb": return `QA errors: ${S.errb}`;
    case "mem": return `peak memory ${S.mem}–${+S.mem + 1} GiB`;
    case "login": return `contributor: ${S.login}`;
    case "branch": return `branch: ${S.branch}`;
    case "ccls": return `cost: ${S.ccls}`;
    case "cpool": return `pool: ${S.cpool}`;
    default: return S[k];
  }
}
const CHIPS = { cls: [], region: [], org: ["repo", "branch"], repo: ["branch"], branch: [], kind: [], outcome: [], from: ["to"], dow: ["hour", "dhtz"],
  hour: ["dhtz"], login: [], dur: [], size: [], errb: [], fhir: [], mem: [], ccls: ["cpool"], cpool: [] };
function drawChips() {
  const bar = $("#chips"); bar.replaceChildren();
  const active = Object.keys(CHIPS).filter((k) => S[k] != null && !(k === "hour" && S.dow != null));
  if (!active.length) { bar.append(h("span", { class: "hint" }, "Tap any bar, tile, cell or row to filter. Everything updates together.")); return; }
  for (const k of active) {
    bar.append(h("button", { type: "button", class: "chip", "aria-label": "Remove filter " + chipLabel(k),
      onclick: () => set(Object.fromEntries([k, ...CHIPS[k]].map((x) => [x, null]))) }, chipLabel(k), h("span", { class: "x", "aria-hidden": "true" }, "×")));
  }
  bar.append(h("button", { type: "button", class: "chip clear", onclick: () => { const keep = { tz: S.tz, metric: S.metric, sql: S.sql }; S = {}; set(keep); } }, "Clear all"));
}

// ================= views =================
function buildPage() {
  const T = LK.meta;
  $("#lede").textContent = `Each push to a GitHub repository connected to build.fhir.org starts a build of that Implementation Guide. ` +
    `This draft looks at ${dlabel(T.first_ts, true)} to ${dlabel(T.last_ts, true)}. Every chart below is a live SQL query over a small database in your browser.`;
  app().append(h("div", { class: "sticky" }, h("div", { id: "chips", class: "chips", "aria-live": "polite" })));
  app().append(h("div", { id: "kpis", class: "tiles" }), h("p", { id: "within", class: "within" }));
  app().append(h("div", { id: "focus" }));
  app().append(h("nav", { class: "toc", "aria-label": "Sections" },
    [["volume", "Volume"], ["repos", "Repositories"], ["outcomes", "Outcomes"], ["time", "Time"], ["calendar", "HL7 calendar"], ["people", "People"], ["cost", "Cost"], ["inside", "Inside a build"], ["longer", "Multi-year"], ["rows", "Rows"], ["about", "About"]]
      .map(([id, l]) => h("a", { href: "#", onclick: (e) => { e.preventDefault(); $("#" + id).scrollIntoView({ behavior: "smooth" }); } }, l))));

  // ---------- Volume ----------
  let sec = section("volume", "A year of builds");
  view(sec, "timeline", "Build requests over time", "Stacked by who owns the repository. Tap a bar to zoom in (month → weeks → days); drag across bars to pick a range.", function () {
    const grain = !S.from ? "month" : (unix(S.to || S.from) - unix(S.from)) / 86400 + 1 <= 8 ? "day" : "week";
    const B = { month: "strftime('%Y-%m', b.ts, 'unixepoch')", week: "date(b.ts, 'unixepoch', 'weekday 0', '-6 days')", day: "date(b.ts, 'unixepoch')" }[grain];
    const raw = q("timeline", [], {}, { "{BUCKET}": B });
    const by = {}; for (const r of raw) { (by[r.k] ||= { k: r.k })["c" + r.cls] = r.n; }
    const rows = Object.values(by).sort((a, b) => (a.k < b.k ? -1 : 1));
    const cal = run(Q.calendar).filter((e) => e.kind !== "connectathon");
    const bands = grain === "month" ? [] : cal.map((e) => ({ i0: rows.findIndex((r) => r.k >= (grain === "week" ? addDays(e.start, -6) : e.start)), i1: rows.findLastIndex((r) => r.k <= e.end), fill: e.kind === "ballot" ? "var(--band-ballot)" : "var(--band-wgm)" })).filter((b) => b.i0 >= 0 && b.i1 >= b.i0);
    const crumbs = h("div", { class: "crumbs" }, h("button", { type: "button", class: "link", onclick: () => set({ from: null, to: null }) }, "All months"));
    if (S.from) {
      const m = S.from.slice(0, 7);
      crumbs.append(" › ", h("button", { type: "button", class: "link", onclick: () => set({ from: m + "-01", to: addDays(nextMonth(m) + "-01", -1) }) }, mlabel(m, true)));
      if (grain === "day") crumbs.append(" › ", h("span", {}, S.to && S.to !== S.from ? `${dlabel(S.from)} – ${dlabel(S.to)}` : dlabel(S.from)));
    }
    this.body.replaceChildren(crumbs, legend(CLASSES.map((c, i) => ({ label: c, color: CCOL[i], value: c, active: S.cls === c, dim: S.cls && S.cls !== c })), (c) => set({ cls: S.cls === c ? null : c })));
    if (grain !== "month") this.body.append(legend([{ label: "Ballot window (approx.)", color: "var(--band-ballot)", kind: "band" }, { label: "WGM week", color: "var(--band-wgm)", kind: "band" }]));
    const range = (r) => grain === "month" ? [r.k + "-01", addDays(nextMonth(r.k) + "-01", -1)] : grain === "week" ? [r.k, addDays(r.k, 6)] : [r.k, r.k];
    columns(chartBox(this), {
      rows, x: "k", series: CLASSES.map((c, i) => ({ key: "c" + (i + 1), name: c, color: CCOL[i] })), bands, height: 220,
      xfmt: (k, i) => grain === "month" ? (k.endsWith("-01") || i === 0 ? mlabel(k) + " ’" + k.slice(2, 4) : mlabel(k)) : grain === "week" ? dlabel(k) : DOW[(new Date(k + "T00:00:00Z").getUTCDay() + 6) % 7] + " " + +k.slice(8),
      labelW: grain === "week" ? 44 : 34,
      tipTitle: (r) => grain === "month" ? mlabel(r.k, true) : grain === "week" ? "Week of " + dlabel(r.k, true) : dlabel(r.k, true),
      onClick: (r) => { const [a, z] = range(r); set({ from: a, to: z }); },
      onBrush: (i0, i1) => set({ from: range(rows[i0])[0], to: range(rows[i1])[1] }),
    });
  }, { note: `A build request is one push-triggered build. Since ${dlabel(LK.meta.ab_first, true)} many pushes launch two sibling Kubernetes jobs (-a and -b) seconds apart; they are merged here, so ${fmt.int(+LK.meta.job_launches)} job launches become ${fmt.int(LK.meta.requests)} requests.` });

  view(sec, "classes", "Who builds", null, function () {
    const r = q("classes", ["cls"]); const tot = r.reduce((a, x) => a + x.n, 0);
    hbars(chartBox(this), { rows: r.map((x) => ({ label: x.name, value: x.n, color: CCOL[x.id - 1], note: fmt.pct(x.n / tot), key: x.name })),
      selected: (x) => x.key === S.cls, onClick: (x) => set({ cls: S.cls === x.key ? null : x.key }) });
    const e = r.find((x) => x.name === "Everyone else");
    this.card.querySelector(".sub")?.remove();
    this.body.prepend(h("p", { class: "sub", html: `<b>${fmt.pct(e.n / tot)}</b> of build requests come from organizations outside HL7, IHE and the FHIR community: governments, vendors and individuals.` }));
  }, { note: "Grouped by GitHub organization name: HL7 International is the HL7 org; HL7 affiliates are orgs whose name starts with “hl7” (e.g. hl7au, hl7-eu, HL7Austria) plus HL7NZ; FHIR community is FHIR and cqframework. Name-based, so some affiliate-run orgs with other names fall under “Everyone else”." });

  // ---------- Repositories (centrepiece) ----------
  sec = section("repos", "Which repositories do the building");
  view(sec, "treemap", "Every repository, sized by its builds", "Colour = who owns it. Tap a tile to drill in: repository → its branches.", function () {
    const metric = S.metric === "hours" ? "hrs" : "n";
    const tools = h("div", { class: "segs", role: "group", "aria-label": "Size tiles by" },
      btn("Build requests", metric === "n", () => set({ metric: null }, { keepPage: true })), btn("Build-hours", metric === "hrs", () => set({ metric: "hours" }, { keepPage: true })));
    const crumbs = h("div", { class: "crumbs" }, h("button", { type: "button", class: "link", onclick: () => set({ org: null, repo: null, branch: null }) }, "All repositories"));
    let items;
    if (S.repo) {
      crumbs.append(" › ", h("button", { type: "button", class: "link", onclick: () => set({ repo: null, branch: null }) }, S.repo.split("/")[0]), " › ", h("span", {}, S.repo.split("/")[1]));
      const r = q("tm_branches", ["branch"]);
      items = r.map((x) => ({ label: x.name, value: x[metric] || 0, color: x.kind === 1 ? "var(--s1)" : "var(--s7)", ink: "var(--on-s1)", dim: S.branch && S.branch !== x.name,
        sub: metric === "n" ? fmt.int(x.n) : fmt.num(x.hrs) + " h",
        tip: () => [x.name, [{ value: fmt.int(x.n), label: "build requests" }, { value: fmt.num(x.hrs), label: "build-hours" }]], onClick: () => set({ branch: S.branch === x.name ? null : x.name }) }));
      this.body.replaceChildren(h("div", { class: "row" }, crumbs, tools), legend([{ label: "main / master", color: "var(--s1)" }, { label: "other branches", color: "var(--s7)" }]));
    } else {
      if (S.org) crumbs.append(" › ", h("span", {}, S.org));
      const r = q("tm_repos", ["repo", "branch"]);
      const tot = r.reduce((a, x) => a + (x[metric] || 0), 0);
      const top = r.slice().sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
      const shown = top.slice(0, 60), rest = top.slice(60);
      items = shown.map((x) => ({ label: S.org ? x.repo : x.repo, value: x[metric] || 0, color: CCOL[x.cls - 1], ink: CINK[x.cls - 1],
        sub: (metric === "n" ? fmt.int(x.n) : fmt.num(x.hrs, 0) + " h") + (S.org ? "" : " · " + x.org),
        tip: () => [x.org + "/" + x.repo, [{ value: fmt.int(x.n), label: "build requests" }, { value: fmt.num(x.hrs), label: "build-hours" }, { value: fmt.pct((x[metric] || 0) / tot, 1), label: "of selection" }]],
        onClick: () => set({ org: x.org, repo: x.org + "/" + x.repo }) }));
      this._rest = rest.length ? `Showing the ${shown.length} largest; ${rest.length} smaller repositories (${fmt.pct(rest.reduce((a, x) => a + (x[metric] || 0), 0) / tot)} of the total) are left out of the picture but are in the table views.` : "";
      this.body.replaceChildren(h("div", { class: "row" }, crumbs, tools), legend(CLASSES.map((c, i) => ({ label: c, color: CCOL[i], value: c, active: S.cls === c })), (c) => set({ cls: S.cls === c ? null : c })));
    }
    treemap(chartBox(this), { items, height: Math.min(460, Math.max(320, (this.body.clientWidth || 340) * 1.15)) });
    if (!S.repo && this._rest) this.body.append(h("p", { class: "note" }, this._rest));
  }, { note: "Build-hours count only builds that reached the publish step and logged a duration (container logs start 30 Oct 2025)." });

  view(sec, "ranked", "Top 25 repositories", "Ranked by build requests in the current selection. Tap a row to filter to that repository.", function () {
    const r = q("tm_repos", ["repo", "branch"]).slice(0, 25);
    const tot = one(`select count(*) n from builds b where 1=1 ${where(["repo", "branch"]).W}`, where(["repo", "branch"]).p).n;
    const med = {};
    if (r.length) { const mins = q("repo_minutes", ["repo", "branch"], {}, { "{IDS}": r.map((x) => x.id).join(",") }); const g = {}; for (const m of mins) (g[m.repo_id] ||= []).push(m.minutes); for (const [k, a] of Object.entries(g)) { a.sort((x, y) => x - y); med[k] = a[Math.floor(a.length / 2)]; } }
    const cum = r.reduce((a, x) => a + x.n, 0);
    this.body.replaceChildren(h("p", { class: "sub", html: `These ${r.length} account for <b>${fmt.pct(cum / tot)}</b> of the ${fmt.int(tot)} build requests in the selection.` }),
      table(["#", "Repository", "Builds", "Share", "Med. min"], r.map((x, i) => [i + 1, h("span", { class: "repo" }, swatch(CCOL[x.cls - 1]), h("span", {}, h("b", {}, x.repo), h("small", {}, x.org))), fmt.int(x.n), fmt.pct(x.n / tot, 1), fmt.num(med[x.id])]),
        { cls: "ranked", onRow: (row, i) => set({ org: r[i].org, repo: r[i].org + "/" + r[i].repo }) }));
  });

  view(sec, "orgs", "Top 15 organizations", "Tap to filter to an organization; its repositories then fill the treemap.", function () {
    const r = q("top_orgs", ["org", "repo", "branch"]);
    hbars(chartBox(this), { rows: r.map((x) => ({ label: x.org, value: x.n, color: CCOL[x.cls - 1], note: x.repos + " repos", key: x.org, tip: [{ value: fmt.int(x.n), label: "build requests" }, { value: x.repos, label: "repositories" }] })),
      selected: (x) => x.key === S.org, onClick: (x) => set({ org: S.org === x.key ? null : x.key, repo: null, branch: null }) });
  });

  view(sec, "lorenz", "How concentrated", null, function () {
    const r = q("tm_repos", ["repo", "branch"]).map((x) => x.n).sort((a, b) => b - a);
    const tot = r.reduce((a, b) => a + b, 0); let c = 0; const cum = r.map((v) => (c += v) / tot * 100);
    const k10 = Math.max(1, Math.round(r.length / 10)), s10 = cum[k10 - 1] || 0;
    this.body.replaceChildren(h("p", { class: "sub", html: `The busiest 10% of repositories (${k10} of ${fmt.int(r.length)}) produced <b>${fmt.num(s10, 0)}%</b> of build requests. The median repository had ${fmt.int(r[Math.floor(r.length / 2)] || 0)}; ${r.filter((v) => v === 1).length} had just one.` }));
    lines(chartBox(this), { x: r.map((_, i) => ((i + 1) / r.length) * 100), xmin: 0, xmax: 100, minMax: 100, height: 170,
      series: [{ name: "of builds", color: "var(--s1)", values: cum, area: true }], yfmt: (v) => v + "%", vfmt: (v) => v.toFixed(0) + "%",
      xticks: [0, 10, 25, 50, 75, 100].map((v) => ({ v, label: v + "%" })), marks: r.length > 9 ? [{ x: (k10 / r.length) * 100, y: s10, color: "var(--s1)", label: `top 10% → ${s10.toFixed(0)}%`, anchor: "start", dx: 6 }] : [],
      tipTitle: (i) => `Busiest ${i + 1} repos (${(((i + 1) / r.length) * 100).toFixed(0)}%)`, aria: "Cumulative share of builds by repository rank" });
  }, { note: "x: repositories ranked busiest first, as a share of all repositories. y: cumulative share of build requests." });

  // ---------- Outcomes ----------
  sec = section("outcomes", "Outcomes, duration and size");
  view(sec, "outcomes", "Outcome", "Tap an outcome to filter.", function () {
    const r = q("outcomes", ["outcome"]); const tot = r.reduce((a, x) => a + x.n, 0);
    hbars(chartBox(this), { rows: r.map((x) => ({ label: x.name, value: x.n, color: OUTC[x.id][1], note: fmt.pct(x.n / tot), key: x.name })),
      selected: (x) => x.key === S.outcome, onClick: (x) => set({ outcome: S.outcome === x.key ? null : x.key }) });
  }, { note: `<b>no result</b>: a build started but never reached the publish step (superseded, preempted or crashed). <b>no logs</b>: before container logs begin (${dlabel(LK.meta.logs_first, true)}).` });

  view(sec, "failrate", "Failure rate by month", null, function () {
    const r = q("fail_monthly", ["outcome"]).filter((x) => x.n >= 20);
    const fr = r.map((x) => x.bad / x.n);
    this.body.replaceChildren(r.length > 1 ? h("p", { class: "sub", html: `Share of finished builds that failed: <b>${fmt.pct(fr[0])}</b> in ${mlabel(r[0].m, true)}, <b>${fmt.pct(fr[fr.length - 1])}</b> in ${mlabel(r[r.length - 1].m, true)}. Tap a month to zoom to it.` }) : "");
    lines(chartBox(this), { x: r.map((_, i) => i), series: [{ name: "failed", color: "var(--critical)", values: fr.map((v) => v * 100), endLabel: r.length ? fmt.pct(fr[fr.length - 1]) : "" }],
      minMax: 30, yfmt: (v) => v + "%", vfmt: (v) => v.toFixed(1) + "%", ticks: 3, mr: 34, height: 170,
      xticks: r.map((x, i) => ({ v: i, label: r.length > 8 && i % 2 ? "" : mlabel(x.m) })), tipTitle: (i) => mlabel(r[i].m, true),
      extraTip: (i) => [{ value: fmt.int(r[i].bad), label: `of ${fmt.int(r[i].n)} finished` }], onClick: (i) => set({ from: r[i].m + "-01", to: addDays(nextMonth(r[i].m) + "-01", -1) }), aria: "Monthly failure rate" });
  }, { note: "Months with fewer than 20 finished builds in the selection are hidden. Oct 2025 has only two days of logs." });

  view(sec, "duration", "How long a build takes", "Minutes from builder start to publish. Tap a bar to filter to builds of that length.", function () {
    const r = q("dur_hist", ["dur"]);
    const med = one(Q.median_minutes.replace("/*W*/", where().W), where().p).m;
    const n = r.reduce((a, x) => a + x.ok + x.bad, 0);
    this.body.replaceChildren(h("p", { class: "sub", html: `Median <b>${fmt.num(med)} min</b> across ${fmt.int(n)} builds with a duration.` }), legend([{ label: "Succeeded", color: "var(--s1)" }, { label: "Failed", color: "var(--critical)" }]));
    columns(chartBox(this), { rows: r, x: "bin", series: [{ key: "ok", name: "succeeded", color: "var(--s1)" }, { key: "bad", name: "failed", color: "var(--critical)" }], height: 180,
      xfmt: (b) => (b % 5 === 0 ? (b === 40 ? "40+" : String(b)) : ""), labelAll: true, tipTitle: (x) => (x.bin === 40 ? "40 min or more" : `${x.bin}–${x.bin + 1} min`),
      selected: S.dur ? (x) => S.dur === `${x.bin}-${x.bin === 40 ? 9999 : x.bin + 1}` : null, onClick: (x) => { const k = `${x.bin}-${x.bin === 40 ? 9999 : x.bin + 1}`; set({ dur: S.dur === k ? null : k }); } });
  });

  view(sec, "size", "How big the output is", "Upload directory size in 25 MB bins. Tap a bar to filter.", function () {
    const r = q("size_hist", ["size"]); const k = one(Q.kpi.replace("/*W*/", where(["size"]).W), where(["size"]).p);
    this.body.replaceChildren(h("p", { class: "sub", html: `${fmt.int(k.nsize)} builds logged a size, totalling <b>${fmt.num(k.tb)} TB</b>. Only about half of successful builds log one, so true volume is higher.` }));
    columns(chartBox(this), { rows: r, x: "bin", series: [{ key: "n", name: "builds", color: "var(--s1)" }], height: 170,
      xfmt: (b) => (b % 100 === 0 ? (b === 600 ? "600+" : String(b)) : ""), labelAll: true, tipTitle: (x) => (x.bin === 600 ? "600 MB or more" : `${x.bin}–${x.bin + 25} MB`),
      selected: S.size ? (x) => S.size === `${x.bin}-${x.bin === 600 ? 99999 : x.bin + 25}` : null, onClick: (x) => { const kk = `${x.bin}-${x.bin === 600 ? 99999 : x.bin + 25}`; set({ size: S.size === kk ? null : kk }); } });
  });

  // ---------- Time patterns ----------
  sec = section("time", "When people build");
  view(sec, "heat", "Day of week × hour", "Tap a cell to filter to that hour; tap a day or hour label for the whole row or column.", function () {
    const et = S.tz === "et";
    const r = q("heat", ["dow", "hour", "dhtz"], {}, { "{DOW}": et ? "b.dow_et" : "b.dow", "{HOUR}": et ? "b.hour_et" : "b.hour" });
    const cells = Array.from({ length: 7 }, () => Array(24).fill(0)); for (const x of r) cells[x.d - 1][x.hr] = x.n;
    const tot = r.reduce((a, x) => a + x.n, 0), wk = cells[5].concat(cells[6]).reduce((a, b) => a + b, 0);
    const byH = Array.from({ length: 24 }, (_, i) => cells.reduce((a, row) => a + row[i], 0)), byD = cells.map((row) => row.reduce((a, b) => a + b, 0));
    const bh = byH.indexOf(Math.max(...byH)), bd = byD.indexOf(Math.max(...byD));
    const tzl = et ? "US Eastern" : "UTC";
    this.body.replaceChildren(h("div", { class: "row" }, h("p", { class: "sub", html: `Weekends carry <b>${fmt.pct(wk / tot)}</b> of builds. Busiest hour: <b>${String(bh).padStart(2, "0")}:00 ${tzl}</b>; busiest day: <b>${DOWL[bd]}</b>.` }),
      h("div", { class: "segs", role: "group", "aria-label": "Timezone" }, btn("UTC", !et, () => set({ tz: null }, { keepPage: true })), btn("US Eastern", et, () => set({ tz: "et" }, { keepPage: true })))));
    const tzs = et ? "ET" : "UTC", same = (S.dhtz === "et") === et;
    heatmap(chartBox(this), { cells, tz: tzs, selDow: same && S.dow ? +S.dow : null, selHour: same && S.hour != null ? +S.hour : null,
      onCell: (d, hr) => set(S.dow == d && S.hour == hr ? { dow: null, hour: null, dhtz: null } : { dow: d, hour: hr, dhtz: et ? "et" : null }),
      onDow: (d) => set(S.dow == d && S.hour == null ? { dow: null, dhtz: null } : { dow: d, hour: null, dhtz: et ? "et" : null }),
      onHour: (hr) => set(S.hour == hr && S.dow == null ? { hour: null, dhtz: null } : { hour: hr, dow: null, dhtz: et ? "et" : null }) });
    this.body.append(h("div", { class: "scale" }, h("span", {}, "fewer"), h("i"), h("span", {}, "more builds")));
  }, { note: "Times are build start times. UTC is shown by default; “US Eastern” converts each build with daylight saving (America/New_York). Colour uses a square-root scale so quiet hours stay visible." });

  view(sec, "regions", "Different regions, different working hours", null, function () {
    const r = q("region_hours", ["dow", "hour", "dhtz", "region"]);
    const G = [["European national bodies", "Europe", "var(--s1)"], ["Asia-Pacific national bodies", "Asia-Pacific", "var(--s3)"], ["HL7 International", null, "var(--s2)"]];
    const series = [], peaks = [];
    for (const [name, key, color] of G) {
      const v = Array(24).fill(0); for (const x of r) if (x.grp === (key || "HL7 International")) v[x.hr] += x.n;
      const t = v.reduce((a, b) => a + b, 0); if (t < 200) continue;
      series.push({ name, color, values: v.map((x) => (x / t) * 100) }); const pk = v.indexOf(Math.max(...v));
      const busy = v.map((x, i) => [x, i]).sort((a, b) => b[0] - a[0]); let acc = 0; const hrs = []; for (const [x, i] of busy) { if (acc >= t * 0.5) break; acc += x; hrs.push(i); }
      peaks.push(`${name.replace(" national bodies", "")}: peak ${String(pk).padStart(2, "0")}:00 UTC (n=${fmt.int(t)})`);
    }
    this.body.replaceChildren(h("p", { class: "sub", html: series.length ? peaks.join(" · ") : "Not enough builds from the region-tagged organizations in this selection." }),
      legend(G.filter((g) => series.some((s2) => s2.name === g[0])).map(([name, key, color]) => ({ label: name, color, kind: "line", value: key, active: S.region === key })), (k) => k && set({ region: S.region === k ? null : k })));
    lines(chartBox(this), { x: [...Array(24).keys()], series, height: 190, yfmt: (v) => v + "%", vfmt: (v) => v.toFixed(1) + "%",
      xticks: [0, 3, 6, 9, 12, 15, 18, 21].map((v) => ({ v, label: String(v).padStart(2, "0") })), tipTitle: (i) => `${String(i).padStart(2, "0")}:00 UTC`,
      onClick: (i) => set({ hour: i, dow: null, dhtz: null }), aria: "Share of builds by hour, by region" });
  }, { note: "Each line is that group’s builds by start hour (UTC), as a share of its own total. Regions are assigned by hand only to organizations that are identifiable national bodies (e.g. ansforge, Nictiz, HL7Austria, hl7-eu for Europe; hl7au, TWNHIFHIR, tewhatuora for Asia-Pacific); all others are left untagged. Tap a legend entry to filter to that region." });

  view(sec, "orghours", "Each organization’s working day", "Dot = the average start hour (UTC) of the organization’s builds. Tap a row to filter.", function () {
    const r = q("org_hours", ["dow", "hour", "dhtz", "org", "repo", "branch"]);
    const g = {}; for (const x of r) { const o = (g[x.org] ||= { org: x.org, cls: x.cls, n: 0, s: 0, c: 0 }); const a = ((x.hr + 0.5) / 24) * 2 * Math.PI; o.n += x.n; o.s += Math.sin(a) * x.n; o.c += Math.cos(a) * x.n; }
    const items = Object.values(g).sort((a, b) => b.n - a.n).slice(0, 28).map((o) => ({ ...o, x: ((Math.atan2(o.s, o.c) / (2 * Math.PI)) * 24 + 24) % 24, conc: Math.hypot(o.s, o.c) / o.n }))
      .sort((a, b) => a.x - b.x);
    dotstrip(chartBox(this), { items: items.map((o) => ({ label: o.org, x: o.x, color: CCOL[o.cls - 1], sel: S.org === o.org,
      tip: () => [o.org, [{ value: `${String(Math.floor(o.x)).padStart(2, "0")}:${String(Math.round((o.x % 1) * 60)).padStart(2, "0")} UTC`, label: "average start" }, { value: fmt.int(o.n), label: "builds" }, { value: o.conc.toFixed(2), label: "concentration (0–1)" }]],
      onClick: () => set({ org: S.org === o.org ? null : o.org, repo: null, branch: null }) })) });
  }, { note: "Organizations with at least 150 builds in the selection (up to 28 busiest). Average uses a circular mean, so 23:00 and 01:00 average to midnight. A low concentration means builds are spread around the clock." });

  // ---------- HL7 calendar ----------
  sec = section("calendar", "The HL7 calendar shows up in the builds");
  view(sec, "cal", "Weekly build requests, with HL7 events", "Tap a week to filter to it.", function () {
    const r = q("weekly_hl7").filter((x) => x.wk < LK.lastFullWeekEnd && x.wk >= "2025-09-29");
    const cal = run(Q.calendar); const day = 86400;
    const xs = r.map((x) => unix(x.wk) + 3.5 * day);
    const bands = cal.filter((e) => e.kind !== "connectathon").map((e) => ({ x0: unix(e.start), x1: unix(e.end) + day, fill: e.kind === "ballot" ? "var(--band-ballot)" : "var(--band-wgm)" }));
    const xmin = r.length ? unix(r[0].wk) : 0, xmax = r.length ? unix(r[r.length - 1].wk) + 7 * day : 1;
    const span = (xmax - xmin) / day, xt = [];
    if (span > 120) { for (let m = r.length ? r[0].wk.slice(0, 7) : "2025-10"; unix(m + "-01") <= xmax; m = nextMonth(m)) if (unix(m + "-01") >= xmin && +m.slice(5) % 2 === 0) xt.push({ v: unix(m + "-01"), label: mlabel(m) }); }
    else r.forEach((x, i) => { if (i % Math.ceil(r.length / 6) === 0) xt.push({ v: unix(x.wk) + 3.5 * day, label: dlabel(x.wk) }); });
    const med = (a) => { const s2 = a.slice().sort((x, y) => x - y); return s2[Math.floor(s2.length / 2)] || 0; };
    const mh = med(r.map((x) => x.hl7)), mo = med(r.map((x) => x.oth)), ma = med(r.map((x) => x.n));
    const pk = r.reduce((a, x) => (x.hl7 > (a?.hl7 ?? -1) ? x : a), null);
    this.body.replaceChildren(h("p", { class: "sub", html: pk && mh ? `HL7 International’s busiest week was <b>${dlabel(pk.wk, true)}</b> with ${fmt.int(pk.hl7)} builds, <b>${(pk.hl7 / mh).toFixed(1)}×</b> its typical week (${fmt.int(mh)}).` : "" }),
      legend([{ label: "Ballot window (approx.)", color: "var(--band-ballot)", kind: "band" }, { label: "WGM week", color: "var(--band-wgm)", kind: "band" }]));
    const pick = (i) => set({ from: r[i].wk, to: addDays(r[i].wk, 6) });
    this.body.append(h("h4", {}, "HL7 International"));
    lines(chartBox(this, "a"), { x: xs, xmin, xmax, series: [{ name: "HL7 International", color: "var(--s1)", values: r.map((x) => x.hl7) }], bands, xticks: xt, height: 160, tipTitle: (i) => "Week of " + dlabel(r[i].wk, true), onClick: pick, aria: "Weekly HL7 International builds" });
    this.body.append(h("h4", {}, "Everyone else (incl. affiliates) — own scale"));
    lines(chartBox(this, "b"), { x: xs, xmin, xmax, series: [{ name: "everyone else", color: "var(--s5)", values: r.map((x) => x.oth) }], bands, xticks: xt, height: 160, tipTitle: (i) => "Week of " + dlabel(r[i].wk, true), onClick: pick, aria: "Weekly builds outside HL7 International" });
    // event weeks vs typical
    const rows = [];
    for (const e of cal) {
      if (e.kind !== "wgm") continue;
      const hits = r.filter((x) => unix(x.wk) <= unix(e.end) && unix(x.wk) + 6 * day >= unix(e.start)); if (!hits.length) continue;
      const ov = (x) => Math.min(unix(x.wk) + 7 * day, unix(e.end) + day) - Math.max(unix(x.wk), unix(e.start));
      const best = hits.reduce((a, x) => (ov(x) > ov(a) ? x : a));
      rows.push({ w: best.wk, cells: [`${e.label.slice(0, 8)} WGM, wk of ${dlabel(best.wk)}`, fmt.int(best.n), ma ? (best.n / ma).toFixed(2) + "×" : "–", e.confidence] });
    }
    for (const wk of ["2025-12-22", "2025-12-29"]) { const x = r.find((y) => y.wk === wk); if (x) rows.push({ w: wk, cells: [`Holidays, wk of ${dlabel(wk)}`, fmt.int(x.n), ma ? (x.n / ma).toFixed(2) + "×" : "–", "exact"] }); }
    if (rows.length) this.body.append(h("h4", {}, `Meeting and holiday weeks vs the median week (${fmt.int(ma)})`), table(["Week", "Builds", "vs typical", "Confidence"], rows.map((x) => x.cells), { onRow: (_, i) => set({ from: rows[i].w, to: addDays(rows[i].w, 6) }) }));
  }, { note: "<b>The calendar is approximate.</b> WGM dates come from HL7 event pages; the January ballot from an HL7 Canada post; the May and September 2026 ballot windows are inferred from bursts of ballot-package publications, not HL7’s official schedule. The Sep 2026 WGM end date is assumed. Weeks run Monday–Sunday; the last, partial week is left out." });

  // ---------- People ----------
  sec = section("people", "The people behind the commits");
  view(sec, "pkpi", "Contributors", null, function () {
    const k = q("c_kpi")[0] || {}; const ppl = q("c_people", ["login"]);
    const hum = ppl.filter((p) => !p.is_bot), hc = hum.reduce((a, p) => a + p.n, 0);
    const top10 = hum.slice(0, 10).reduce((a, p) => a + p.n, 0); let acc = 0, half = 0; for (const p of hum) { acc += p.n; half++; if (acc >= hc / 2) break; }
    const multi = hum.filter((p) => p.repos >= 3).length;
    const cov = q("c_coverage");
    this.body.replaceChildren(h("div", { class: "tiles" },
      tile("People", fmt.int(k.humans), "with a GitHub login"), tile("Commits", fmt.int(k.commits), `${fmt.int(k.repos)} repos`),
      tile("Top 10 share", fmt.pct(hc ? top10 / hc : 0), "of human commits"), tile("Bots", fmt.int(k.bots), `${fmt.int(k.bot_commits)} commits`)),
      h("p", { class: "sub", html: hc ? `Half of all human commits come from <b>${half}</b> people. <b>${multi}</b> people committed to three or more of these repositories. ${fmt.int(k.unlinked)} commits have no linked GitHub account and are counted only in the commit total.` : "No commits for this selection." }),
      h("p", { class: "note", html: `Coverage: commits were collected for the ${fmt.int(+LK.meta.gh_repos)} busiest repositories (by build requests), default branch plus every built branch that still exists, ${LK.meta.gh_window}. In this selection, ${fmt.int(cov[0]?.covered || 0)} of ${fmt.int(cov[0]?.built || 0)} built repositories are covered, ${fmt.pct((cov[0]?.covered_builds || 0) / (cov[0]?.all_builds || 1))} of builds. Commit counts follow the org, repository, date and contributor filters only.` }));
  });
  function tile(l, v, s2) { return h("div", { class: "tile" }, h("div", { class: "label" }, l), h("div", { class: "value" }, v), s2 ? h("div", { class: "sub" }, s2) : null); }

  view(sec, "ptop", "Most active contributors", "Tap a person to filter everything to the repositories they commit to.", function () {
    const r = q("c_people", ["login"]).filter((p) => !p.is_bot).slice(0, 20);
    hbars(chartBox(this), { rows: r.map((p) => ({ label: p.login, value: p.n, color: "var(--s1)", note: `${p.repos} repos · ${p.orgs} orgs`, key: p.login,
      tip: [{ value: fmt.int(p.n), label: "commits" }, { value: p.repos, label: "repositories" }, { value: p.orgs, label: "organizations" }] })),
      selected: (x) => x.key === S.login, onClick: (x) => set({ login: S.login === x.key ? null : x.key }) });
  });

  view(sec, "pmatrix", "Who works across many guides", "Rows: the 30 people active in the most repositories. Columns: organizations. Dot size = commits. Tap a name to filter to that person, a column to filter to the organization.", function () {
    const ppl = q("c_people", ["login"]).filter((p) => !p.is_bot).sort((a, b) => b.repos - a.repos || b.n - a.n).slice(0, 30);
    const m = q("c_matrix", ["login"]); const set1 = new Set(ppl.map((p) => p.login));
    const orgT = {}; const cell = {}; for (const x of m) { if (!set1.has(x.login)) continue; orgT[x.org] = (orgT[x.org] || 0) + x.n; cell[x.login + "|" + x.org] = x.n; }
    const cols = Object.entries(orgT).sort((a, b) => b[1] - a[1]).slice(0, Math.max(6, Math.floor(((this.body.clientWidth || 340) - 120) / 24))).map(([o]) => o);
    matrix(chartBox(this), { rows: ppl.map((p) => ({ label: p.login, key: p.login, sub: `${p.repos} repos, ${fmt.int(p.n)} commits`, onClick: () => set({ login: S.login === p.login ? null : p.login }) })),
      cols: cols.map((o) => ({ label: o, key: o, onClick: () => set({ org: o, repo: null, branch: null }) })), get: (r, c) => cell[r.key + "|" + c.key], unit: "commits" });
  }, { note: "Only the organizations with the most commits from these people are shown as columns; the row tooltip gives each person’s full repository count." });

  view(sec, "pbots", "Bots, separated out", null, function () {
    const r = q("c_people", ["login"]).filter((p) => p.is_bot).slice(0, 12);
    this.body.replaceChildren(r.length ? table(["Bot", "Commits", "Repos"], r.map((p) => [p.login, fmt.int(p.n), p.repos]), { onRow: (_, i) => set({ login: r[i].login }) }) : h("p", { class: "sub" }, "No bot commits in this selection."));
  }, { note: "Bots: GitHub accounts of type Bot, or logins like dependabot, github-actions, renovate, *[bot]." });

  // ---------- Cost ----------
  sec = section("cost", "Cost and footprint");
  view(sec, "costm", "Cluster cost by month", "Tap a cost class to drill into its node pools, then SKUs.", function () {
    const W = costWhere();
    const r = run(`select substr(day, 1, 7) m, cls, sum(cost) cost from billing_daily where day >= '2026-03-01' ${W.sql} group by 1, 2 order by 1`, W.p);
    lastSQL.costm = `select substr(day,1,7) m, cls, sum(cost) from billing_daily where day >= '2026-03-01' ${W.sql} group by 1,2\n-- params ${JSON.stringify(W.p)}`;
    const by = {}; for (const x of r) (by[x.m] ||= { m: x.m })[x.cls] = x.cost;
    const rows = Object.values(by); const jobs = Object.fromEntries(run(Q.billing_jobs).map((x) => [x.m, x.n]));
    const tot = r.reduce((a, x) => a + x.cost, 0), alljobs = rows.reduce((a, x) => a + (jobs[x.m] || 0), 0);
    const eg = rows.map((x) => x["egress/net"] || 0);
    this.body.replaceChildren(h("p", { class: "sub", html: `<b>${fmt.usd(tot)}</b> ${S.ccls ? "of " + esc(S.ccls) + " " : ""}over ${rows.length} months${!S.ccls && !S.cpool && alljobs ? `, about <b>${fmt.usd(tot / alljobs, 2)}</b> per build request including serving the site` : ""}.${!S.ccls && eg.length > 1 ? ` Egress went from ${fmt.usd(eg[0])} to ${fmt.usd(eg[eg.length - 1])} a month and is the largest cost.` : ""}` }),
      legend(COSTC.map(([k, l, c]) => ({ label: l, color: c, value: k, active: S.ccls === k, dim: S.ccls && S.ccls !== k })), (k) => set({ ccls: S.ccls === k ? null : k, cpool: null })));
    columns(chartBox(this), { rows, x: "m", series: COSTC.map(([k, l, c]) => ({ key: k, name: l, color: c })), yfmt: (v) => "$" + v, vfmt: (v) => fmt.usd(v), labelAll: true,
      xfmt: (m) => mlabel(m), tipTitle: (x) => mlabel(x.m, true), extraTip: (x) => !S.ccls && !S.cpool ? [{ value: fmt.usd(rows.find((y) => y.m === x.m) ? COSTC.reduce((a, [k]) => a + (x[k] || 0), 0) / (jobs[x.m] || 1) : 0, 3), label: "per build request" }] : [],
      onClick: (x) => set({ from: x.m + "-01", to: addDays(nextMonth(x.m) + "-01", -1) }) });
  }, { note: "GCP billing export rows labelled with the build.fhir.org Kubernetes cluster, before credits. <b>Billing data starts in March 2026</b>; earlier months are not available in this form. Only the date range (and the cost drill-down) filters this chart; org, repo and other filters do not apply to raw billing. Tap a month to filter the whole page to it." });

  view(sec, "costbreak", "Where the money goes", null, function () {
    const W = costWhere(true);
    let lvl, sql;
    if (!S.ccls) { lvl = "class"; sql = `select cls k, sum(cost) v from billing_daily where day >= '2026-03-01' ${W.sql} group by 1 order by v desc`; }
    else if (!S.cpool) { lvl = "node pool"; sql = `select coalesce(pool, '(cluster)') k, sum(cost) v from billing_daily where day >= '2026-03-01' ${W.sql} group by 1 order by v desc`; }
    else { lvl = "SKU"; sql = `select (select name from skus where id = sku_id) k, sum(cost) v from billing_daily where day >= '2026-03-01' ${W.sql} group by 1 order by v desc limit 15`; }
    const r = run(sql, W.p); lastSQL.costbreak = sql + "\n-- params " + JSON.stringify(W.p);
    const tot = r.reduce((a, x) => a + x.v, 0);
    const crumbs = h("div", { class: "crumbs" }, h("button", { type: "button", class: "link", onclick: () => set({ ccls: null, cpool: null }) }, "All cost"));
    if (S.ccls) crumbs.append(" › ", h("button", { type: "button", class: "link", onclick: () => set({ cpool: null }) }, S.ccls));
    if (S.cpool) crumbs.append(" › ", h("span", {}, S.cpool));
    this.body.replaceChildren(crumbs, h("p", { class: "sub" }, `By ${lvl}. ${lvl !== "SKU" ? "Tap to drill down." : ""}`));
    hbars(chartBox(this), { rows: r.map((x) => ({ label: x.k.length > 46 ? x.k.slice(0, 45) + "…" : x.k, value: x.v, color: lvl === "class" ? (COSTC.find((c) => c[0] === x.k) || [0, 0, "var(--s1)"])[2] : "var(--s1)", note: fmt.pct(x.v / tot), key: x.k, tip: [{ value: fmt.usd(x.v, 2), label: x.k }] })),
      fmt: (v) => fmt.usd(v), valW: 70, onClick: lvl === "SKU" ? null : (x) => set(lvl === "class" ? { ccls: x.key } : { cpool: x.key }) });
  });

  view(sec, "attr", "Estimated cost by organization, repository and branch", "An estimate: shared costs split by usage. Tap a bar to drill: organization → repository → branch.", function () {
    const lvl = S.repo ? "branch" : S.org ? "repo" : "org";
    const W = where(lvl === "org" ? ["org", "repo", "branch"] : lvl === "repo" ? ["repo", "branch"] : ["branch"]);
    const grp = { org: "o.name", repo: "r.name", branch: "br.name" }[lvl];
    const comp = run(`select ${grp} k, sum(b.minutes * cr.usd_per_min) compute from builds b join compute_rate cr on cr.month = strftime('%Y-%m', b.ts, 'unixepoch')
      join orgs o on o.id = b.org_id join repos r on r.id = b.repo_id join branches br on br.id = b.branch_id where b.minutes is not null ${W.W} group by 1`, W.p);
    const mr = monthRange();
    const mrr = one("select min(month) a, max(month) z from egress_month where month between :m0 and :m1", { ":m0": mr[0], ":m1": mr[1] });
    let other = [];
    if (lvl !== "branch") other = run(`select ${lvl === "org" ? "o.name" : "r.name"} k, sum(a.disk) disk, sum(a.egress) egress from repo_month_cost a join repos r on r.id = a.repo_id join orgs o on o.id = r.org_id
      where a.month between :m0 and :m1 and a.repo_id in (select distinct b.repo_id from builds b where 1=1 ${W.W}) group by 1`, { ...W.p, ":m0": mr[0], ":m1": mr[1] });
    else other = run(`select e.branch k, sum(e.share * mc.egress) egress, 0 disk from egress_branch_share e cross join (select sum(egress) egress from egress_month where month between :m0 and :m1) mc
      where e.repo_id = :rid group by 1`, { ":rid": LK.repoId[S.repo] ?? -1, ":m0": mr[0], ":m1": mr[1] });
    lastSQL.attr = "-- compute: build-minutes × monthly $/min (view compute_rate)\n-- disk & egress: view repo_month_cost (monthly cost × repo's share of disk bytes / sampled egress bytes)";
    const all = {}; for (const x of comp) (all[x.k] ||= { k: x.k }).compute = x.compute; for (const x of other) Object.assign((all[x.k] ||= { k: x.k }), { disk: x.disk, egress: x.egress });
    const rows = Object.values(all).map((x) => ({ ...x, t: (x.compute || 0) + (x.disk || 0) + (x.egress || 0) })).sort((a, b) => b.t - a.t).slice(0, 15);
    const tot = Object.values(all).reduce((a, x) => a + (x.compute || 0) + (x.disk || 0) + (x.egress || 0), 0);
    const crumbs = h("div", { class: "crumbs" }, h("button", { type: "button", class: "link", onclick: () => set({ org: null, repo: null, branch: null }) }, "All orgs"));
    if (S.org) crumbs.append(" › ", h("button", { type: "button", class: "link", onclick: () => set({ repo: null, branch: null }) }, S.org));
    if (S.repo) crumbs.append(" › ", h("span", {}, S.repo.split("/")[1]));
    this.body.replaceChildren(crumbs, h("p", { class: "sub", html: `Estimated <b>${fmt.usd(tot)}</b> attributable in the selection (${mlabel(mrr.a, true)} – ${mlabel(mrr.z, true)}).` }),
      legend([{ label: "Build compute", color: "var(--s2)" }, { label: "Disk", color: "var(--s5)" }, { label: "Egress", color: "var(--s1)" }]));
    stackedH(chartBox(this), rows, [["compute", "var(--s2)", "build compute"], ["disk", "var(--s5)", "disk"], ["egress", "var(--s1)", "egress"]], (x) => {
      if (lvl === "org") set({ org: x.k, repo: null, branch: null }); else if (lvl === "repo") set({ repo: S.org + "/" + x.k, branch: null }); else set({ branch: S.branch === x.k ? null : x.k });
    }, (x) => (lvl === "org" ? S.org : lvl === "repo" ? S.repo?.split("/")[1] : S.branch) === x.k);
  }, { note: "<b>Method (estimates).</b> Build compute: each month’s build-node-pool cost (spot plus on-demand failover) split across builds by their share of that month’s logged build-minutes; it follows every filter. Disk: each month’s web-server disk cost split by each repository’s share of bytes in the dated disk scan. Egress: each month’s web-server egress cost split by each repository’s (or branch’s) share of response bytes in a sampled two-day slice of the web server’s access logs. Disk and egress apply only to org/repo/date filters, assume today’s disk layout and the sampled traffic mix hold for every month, and cover months from March 2026. The GKE fee and web-server compute are not attributed." });

  view(sec, "attrtime", "Estimated cost per organization over time", "Top 6 organizations in the selection; tap a line’s legend to filter.", function () {
    const W = where(["org", "repo", "branch"]);
    const r = run(`select o.name org, cr.month m, sum(b.minutes * cr.usd_per_min) compute from builds b join compute_rate cr on cr.month = strftime('%Y-%m', b.ts, 'unixepoch')
      join orgs o on o.id = b.org_id where b.minutes is not null ${W.W} group by 1, 2`, W.p);
    const r2 = run(`select o.name org, a.month m, sum(a.disk + a.egress) de from repo_month_cost a join repos r on r.id = a.repo_id join orgs o on o.id = r.org_id
      where a.repo_id in (select distinct b.repo_id from builds b where 1=1 ${W.W}) group by 1, 2`, W.p);
    const months = [...new Set(r.map((x) => x.m).concat(r2.map((x) => x.m)))].sort();
    const tot = {}; const cell = {}; for (const x of r) { tot[x.org] = (tot[x.org] || 0) + x.compute; cell[x.org + x.m] = (cell[x.org + x.m] || 0) + x.compute; }
    for (const x of r2) { tot[x.org] = (tot[x.org] || 0) + x.de; cell[x.org + x.m] = (cell[x.org + x.m] || 0) + x.de; }
    const top = Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0]);
    const cols = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)"];
    this.body.replaceChildren(legend(top.map((o, i) => ({ label: o, color: cols[i], kind: "line", value: o, active: S.org === o })), (o) => set({ org: S.org === o ? null : o, repo: null, branch: null })));
    lines(chartBox(this), { x: months.map((_, i) => i), series: top.map((o, i) => ({ name: o, color: cols[i], values: months.map((m) => cell[o + m] || 0) })), height: 190,
      yfmt: (v) => "$" + v, vfmt: (v) => fmt.usd(v, 2), xticks: months.map((m, i) => ({ v: i, label: mlabel(m) })), tipTitle: (i) => mlabel(months[i], true), aria: "Estimated monthly cost per organization" });
  }, { note: "Same estimate as above (compute + disk + egress). Six series is the most this chart shows; use the drill-down above for the rest." });

  view(sec, "egress", "What the egress is (sampled)", null, function () {
    const W = egressWhere();
    const by = (col) => run(`select ${col} k, sum(n) n, sum(bytes) bytes from egress_sample e where 1=1 ${W.sql} group by 1 order by bytes desc limit 10`, W.p);
    const cl = by("client"), ft = by("ftype"), bots = by("case when bot = '' then null else bot end").filter((x) => x.k);
    const tb = cl.reduce((a, x) => a + x.bytes, 0), tn = cl.reduce((a, x) => a + x.n, 0);
    lastSQL.egress = `select client, sum(n), sum(bytes) from egress_sample e where 1=1 ${W.sql} group by 1 -- (also by ftype, bot)`;
    const meta = one("select max(days) dd, max(sample_min) sm from egress_sample"); meta.d0 = (meta.dd || "").split("+")[0]; meta.d1 = (meta.dd || "").split("+").pop();
    this.body.replaceChildren(h("p", { class: "sub", html: tn ? `In the sample, ${fmt.int(tn)} requests served ${fmt.num(tb / 1e9)} GB. <b>${fmt.pct((cl.find((x) => x.k === "browser")?.bytes || 0) / tb)}</b> of bytes went to browsers; named bots took ${fmt.pct(((cl.find((x) => x.k === "named bot")?.bytes || 0) + (cl.find((x) => x.k === "other bot")?.bytes || 0)) / tb)}.` : "No sampled traffic for this selection." }),
      h("h4", {}, "By client"));
    hbars(chartBox(this, "a"), { rows: cl.map((x) => ({ label: x.k, value: x.bytes / 1e9, color: "var(--s1)", note: fmt.pct(x.bytes / tb) + " of bytes", tip: [{ value: fmt.num(x.bytes / 1e9, 2) + " GB", label: "" }, { value: fmt.int(x.n), label: "requests" }] })), fmt: (v) => fmt.num(v, 2) + " GB", valW: 80 });
    this.body.append(h("h4", {}, "By file type"));
    hbars(chartBox(this, "b"), { rows: ft.map((x) => ({ label: x.k, value: x.bytes / 1e9, color: "var(--s1)", note: fmt.int(x.n) + " req", tip: [{ value: fmt.num(x.bytes / 1e9, 2) + " GB", label: "" }, { value: fmt.int(x.n), label: "requests" }] })), fmt: (v) => fmt.num(v, 2) + " GB", valW: 80 });
    if (bots.length) { this.body.append(h("h4", {}, "Named bots")); hbars(chartBox(this, "c"), { rows: bots.map((x) => ({ label: x.k, value: x.bytes / 1e9, color: "var(--s7)", note: fmt.int(x.n) + " req" })), fmt: (v) => fmt.num(v, 2) + " GB", valW: 80 }); }
    this.card.querySelector(".note").innerHTML = `Sample: the first ${meta.sm == 1 ? "minute" : meta.sm + " minutes"} of every hour on ${meta.d0} and ${meta.d1} (UTC), from the web server’s access logs, aggregated on the fly. Only aggregates are stored: organization, repository, branch, file type, client class and status. No IP addresses or user-agent strings are kept. Client class comes from the user agent (browser, a fixed list of named crawlers, other bots, tools/scripts). Follows the org and repo filters.`;
  }, { note: "" });

  view(sec, "preempt", "Spot VMs get reclaimed often", null, function () {
    const p = { ":pfrom": S.from || "2025-01-01", ":pto": S.to || "2099-01-01" };
    const r = run(Q.preempt_weekly, p).filter((x) => x.wk < LK.lastFullWeekEnd); lastSQL.preempt = Q.preempt_weekly + "\n-- " + JSON.stringify(p);
    const tot = one("select sum(n) n, count(*) d from preemptions_daily where day >= :pfrom and day <= :pto", p);
    this.body.replaceChildren(h("p", { class: "sub", html: `<b>${fmt.int(tot.n)}</b> preemptions, about <b>${fmt.num(tot.n / Math.max(1, tot.d), 0)} a day</b>.` }));
    lines(chartBox(this), { x: r.map((x) => unix(x.wk)), series: [{ name: "preemptions", color: "var(--s2)", values: r.map((x) => x.n) }], height: 150,
      xticks: r.filter((_, i) => i % Math.ceil(r.length / 6) === 0).map((x) => ({ v: unix(x.wk), label: dlabel(x.wk) })), tipTitle: (i) => "Week of " + dlabel(r[i].wk, true),
      onClick: (i) => set({ from: r[i].wk, to: addDays(r[i].wk, 6) }), aria: "Weekly preemptions" });
  }, { note: "Compute Engine preemption events in the project; follows the date filter only." });

  view(sec, "disk", "Disk", null, function () {
    const vol = run(Q.disk_volume);
    const dw = []; const dp = {};
    if (S.cls) { dw.push("o.cls = :cls"); dp[":cls"] = CLASSES.indexOf(S.cls) + 1; }
    if (S.org) { dw.push("d.org = :org"); dp[":org"] = S.org; }
    const DW = dw.map((x) => " and " + x).join("");
    const lvl = S.org ? "repo" : "org";
    const r = lvl === "org" ? run(Q.disk_orgs.replace("{DISKW}", DW), dp) : run(Q.disk_repos.replace("{DISKW}", DW), dp);
    lastSQL.disk = (lvl === "org" ? Q.disk_orgs : Q.disk_repos).replace("{DISKW}", DW);
    const tot = run("select sum(gib) g from disk_by_repo")[0].g;
    const scan = vol.find((v) => / scan$/.test(v.asof)), cur = vol.find((v) => / current$/.test(v.asof)) || scan;
    const tb = (g) => (g * 2 ** 30 / 1e12).toFixed(1) + " TB";
    this.body.replaceChildren(h("div", { class: "tiles" },
      tile("Upload volume", cur ? tb(cur.size_gib) : "–", cur ? `${fmt.int(cur.size_gib)} GiB; ${cur.used_pct}% used, ~${fmt.int(cur.free_gib)} GiB free · ${cur.asof.replace(/ (current|scan)$/, "")}` : ""),
      cur !== scan && scan ? tile("At the scan", `${scan.used_pct}% full`, `${fmt.int(scan.size_gib)} GiB volume · ${scan.asof.replace(/ scan$/, "")}`) : null),
      h("p", { class: "sub", html: `Breakdown from the <b>${esc(LK.meta.disk_scan)} disk scan</b>: ${fmt.int(tot)} GiB in IG and core-spec folders. ${lvl === "org" ? "Tap an organization to see its repositories." : "Largest repositories in " + esc(S.org) + "; tap one to filter to it."}` }));
    if (cur !== scan && cur) this.card.querySelector(".note").textContent = cur.source + " The per-organization and per-repository breakdown is from the dated scan.";
    const shown = r.slice(0, 12);
    hbars(chartBox(this), { rows: shown.map((x) => ({ label: lvl === "org" ? x.org : x.repo, value: x.gib, color: x.cls ? CCOL[x.cls - 1] : "var(--muted)", note: lvl === "org" ? `${x.repos} repos` : `${x.branch_dirs ?? 0} branches`, key: lvl === "org" ? x.org : x.org + "/" + x.repo })),
      fmt: (v) => fmt.num(v) + " GiB", valW: 80, onClick: (x) => lvl === "org" ? (x.key.startsWith("(") ? null : set({ org: x.key, repo: null, branch: null })) : (LK.repoId[x.key] ? set({ repo: x.key, branch: null }) : null) });
  }, { note: "Volume size and use from df, taken with the dated du scan of the upload volume." });

  // ---------- Inside a build ----------
  sec = section("inside", "Inside a build");
  view(sec, "errs", "QA errors in successful builds", "Tap a bucket to filter to those builds (the row list below then shows them).", function () {
    const r = q("err_buckets", ["errb"]); const tot = r.reduce((a, x) => a + x.n, 0);
    const z = r.find((x) => x.bk === 0)?.n || 0;
    this.body.replaceChildren(h("p", { class: "sub", html: tot ? `Only <b>${fmt.pct(z / tot)}</b> of ${fmt.int(tot)} successful builds report zero QA errors.` : "No error counts in this selection." }));
    const SEQ = ["var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)"];
    hbars(chartBox(this), { rows: r.map((x) => ({ label: ERRB[x.bk][0], value: x.n, color: SEQ[x.bk], note: fmt.pct(x.n / tot), key: ERRB[x.bk][0] })),
      selected: (x) => x.key === S.errb, onClick: (x) => { set({ errb: S.errb === x.key ? null : x.key, tab: "builds" }); } });
  }, { note: "Error counts come from the publish log line, which carries them only from April 2026." });

  view(sec, "fhir", "Which FHIR version", "Branches built in the selection, by the FHIR version in their current QA report. Tap to filter.", function () {
    const r = q("fhir", ["fhir"]); const tot = r.reduce((a, x) => a + x.n, 0);
    hbars(chartBox(this), { rows: r.map((x) => ({ label: x.fhir, value: x.n, color: "var(--s1)", note: fmt.pct(x.n / tot), key: x.fhir })), selected: (x) => x.key === S.fhir, onClick: (x) => set({ fhir: S.fhir === x.key ? null : x.key }) });
  }, { note: "From qas.json, the site’s list of the latest build of each guide and branch (a snapshot of what is published now)." });

  view(sec, "mem", "Peak memory", "Per branch, from its current QA report. Tap a bar to filter.", function () {
    const r = q("mem_hist", ["mem"]); const heap = 19000 / 1024;
    const all = r.flatMap((x) => Array(x.n).fill(x.gib)); const med = all.sort((a, b) => a - b)[Math.floor(all.length / 2)];
    this.body.replaceChildren(h("p", { class: "sub", html: all.length ? `Median branch peaks in the <b>${med}–${med + 1} GiB</b> range; ${fmt.int(r.filter((x) => x.gib >= 16).reduce((a, x) => a + x.n, 0))} reach 16 GiB or more, against the ${heap.toFixed(1)} GiB Java heap every build gets.` : "" }));
    const rows = []; for (let g = 0; g <= Math.max(18, ...r.map((x) => x.gib)); g++) rows.push({ gib: g, n: r.find((x) => x.gib === g)?.n || 0 });
    columns(chartBox(this), { rows, x: "gib", series: [{ key: "n", name: "branches", color: "var(--s1)" }], height: 170, xfmt: (g) => (g % 4 === 0 ? String(g) : ""), labelAll: true,
      tipTitle: (x) => `${x.gib}–${x.gib + 1} GiB`, refX: heap, refLabel: `heap ${heap.toFixed(1)} GiB`, selected: S.mem != null ? (x) => String(x.gib) === S.mem : null, onClick: (x) => set({ mem: S.mem === String(x.gib) ? null : x.gib }) });
  }, { note: "JAVA_MEMORY=19000m on every build job in the audit log." });

  // ---------- Multi-year proxy ----------
  sec = section("longer", "A longer view, by proxy");
  view(sec, "pkg", "Published hl7.fhir.* package versions per year", "A proxy for IG activity, not a count of builds. Tap a year to list its versions.", function () {
    const r = run(Q.pkg_years).map((x) => ({ ...x, other: x.n - x.ballot })); lastSQL.pkg = Q.pkg_years;
    const a = r.find((x) => x.y === 2020), z = r.find((x) => x.y === 2025);
    this.body.replaceChildren(h("p", { class: "sub", html: a && z ? `Build logs only reach back a year. Published versions grew from <b>${a.n}</b> in 2020 to <b>${z.n}</b> in 2025.` : "" }),
      legend([{ label: "Other versions", color: "var(--s1)" }, { label: "Ballot versions", color: "var(--s2)" }]));
    const sel = this._year;
    columns(chartBox(this), { rows: r, x: "y", series: [{ key: "other", name: "other versions", color: "var(--s1)" }, { key: "ballot", name: "ballot versions", color: "var(--s2)" }],
      xfmt: (y) => "’" + String(y).slice(2) + (y === 2026 ? "*" : ""), labelAll: true, fade: (x) => x.y === 2026, selected: sel ? (x) => x.y === sel : null,
      tipTitle: (x) => String(x.y) + (x.y === 2026 ? " (to date)" : ""), extraTip: (x) => [{ value: x.pk, label: "distinct packages" }],
      onClick: (x) => { this._year = this._year === x.y ? null : x.y; this.draw(); } });
    if (sel) { const l = run(Q.pkg_year_list, { ":y": String(sel) }); this.body.append(h("h4", {}, `${l.length} versions published in ${sel}`), table(["Package", "Version", "Date"], l.slice(0, 200).map((x) => [x.name, x.version, x.day]))); }
  }, { note: `* 2026 is the year to date, drawn faded. Source: packages2.fhir.org version dates for hl7.fhir.* packages. “Ballot” = version string contains “ballot”.` });

  // ---------- Rows ----------
  sec = section("rows", "The rows behind the numbers");
  view(sec, "rows", "Matching rows", "Everything that matches the current filters. Tap a column header to sort, a row to filter to it.", function () {
    const tab = S.tab || "builds";
    const T = { builds: ["rows_builds", "\"start (UTC)\"", "desc"], repos: ["rows_repos", "builds", "desc"], people: ["rows_people", "commits", "desc"] }[tab];
    const sort = S.sort && /^[\w ()%-]+$/.test(S.sort) ? `"${S.sort}"` : T[1], dir = S.dir === "asc" ? "asc" : S.dir === "desc" ? "desc" : T[2];
    const page = +S.page || 0, per = 25;
    const base = q(T[0]);
    const w = where(); let sql = Q[T[0]].replaceAll("/*W*/", w.W).replaceAll("/*C*/", w.C);
    const n = one(`select count(*) n from (${sql})`, w.p).n;
    let rows; try { rows = run(`${sql} order by ${sort} ${dir} limit ${per} offset ${page * per}`, w.p); } catch (e) { rows = run(`${sql} limit ${per} offset ${page * per}`, w.p); }
    lastSQL.rows = sql + `\norder by ${sort} ${dir} limit ${per} offset ${page * per}`;
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const tabs = h("div", { class: "segs", role: "tablist" }, ["builds", "repos", "people"].map((t) => btn({ builds: "Builds", repos: "Repositories", people: "Contributors" }[t], tab === t, () => set({ tab: t === "builds" ? null : t, sort: null, dir: null }))));
    const pager = h("div", { class: "pager" }, h("button", { type: "button", class: "seg", disabled: page === 0 ? "" : null, onclick: () => set({ page: page - 1 || null }, { keepPage: true }) }, "‹ Prev"),
      h("span", {}, n ? `${fmt.int(page * per + 1)}–${fmt.int(Math.min(n, (page + 1) * per))} of ${fmt.int(n)}` : "No rows"),
      h("button", { type: "button", class: "seg", disabled: (page + 1) * per >= n ? "" : null, onclick: () => set({ page: page + 1 }, { keepPage: true }) }, "Next ›"));
    this.body.replaceChildren(tabs, table(cols, rows, { sortable: true, sortCol: S.sort || T[1].replaceAll('"', ""), sortDir: dir,
      onSort: (c) => set({ sort: c, dir: (S.sort || T[1].replaceAll('"', "")) === c && dir === "desc" ? "asc" : "desc" }),
      onRow: (r) => tab === "builds" ? set({ org: r.org, repo: r.org + "/" + r.repo, branch: r.branch }) : tab === "repos" ? set({ org: r.org, repo: r.org + "/" + r.repo }) : set({ login: r.login }) }), pager);
  });

  // ---------- Free-form SQL ----------
  sec = section("about", "About the data");
  const ta = h("textarea", { id: "sqlbox", rows: 5, spellcheck: "false", "aria-label": "SQL query" }, "select o.name org, count(*) builds\nfrom builds b join orgs o on o.id = b.org_id\ngroup by 1 order by 2 desc limit 10");
  const out = h("div", { id: "sqlout" });
  sec.append(h("ul", { class: "caveats" },
    h("li", { html: `<b>Build requests</b>: Kubernetes audit log of job creations, ${dlabel(LK.meta.first_ts, true)} – ${dlabel(LK.meta.last_ts, true)}; -a/-b sibling jobs within 5 s merged.` }),
    h("li", { html: `<b>Outcomes, durations, sizes, QA errors</b>: build container logs from ${dlabel(LK.meta.logs_first, true)}. Upload size is logged for about half of successful builds; error counts from April 2026.` }),
    h("li", { html: "<b>Cost</b>: GCP billing export rows labelled with the cluster, from March 2026. Attributed cost is an estimate (see the method note)." }),
    h("li", { html: "<b>Commits</b>: GitHub API, the busiest repositories only (see coverage note). Logins only; no email addresses." }),
    h("li", { html: "<b>Egress mix</b>: a sampled slice of web-server access logs, stored only as aggregates." }),
    h("li", { html: `<b>Disk</b>: one dated du scan of the upload volume (${esc(LK.meta.disk_scan)}), plus df figures.` }),
    h("li", { html: "<b>HL7 calendar</b>: hand-assembled and approximate." })),
    h("details", { class: "card" }, h("summary", {}, "Query the database yourself"),
      h("p", { class: "note" }, "Tables: builds, orgs, repos, branches, classes, outcomes, kinds, commits, people, calendar, billing_daily, preemptions_daily, pkg_versions, disk_by_repo, disk_volume, egress_sample, meta. Views: compute_rate, repo_month_cost."),
      ta, h("div", { class: "row" }, h("button", { type: "button", class: "seg on", onclick: () => {
        try { const r = run(ta.value + (/limit\s+\d+\s*;?\s*$/i.test(ta.value) ? "" : "")); out.replaceChildren(r.length ? table(Object.keys(r[0]), r.slice(0, 500)) : h("p", { class: "note" }, "No rows.")); }
        catch (e) { out.replaceChildren(h("p", { class: "err" }, String(e.message || e))); }
      } }, "Run"), h("label", { class: "note" }, h("input", { type: "checkbox", id: "showsql", onchange: (e) => set({ sql: e.target.checked ? "1" : null }, { keepPage: true }) }), " show the SQL under every chart")), out));
  app().append(h("footer", {}, `Draft for discussion. Database built ${LK.meta.built}. Private (Tailscale only).`));
}
const DOWL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const COSTC = [["egress/net", "Egress / network", "var(--s1)"], ["spot compute", "Spot compute", "var(--s2)"], ["on-demand compute/other", "On-demand compute", "var(--s3)"], ["gke fee", "GKE fee", "var(--s4)"], ["disk", "Disks", "var(--s5)"]];
function nextMonth(m) { let [y, mo] = m.split("-").map(Number); mo++; if (mo > 12) { mo = 1; y++; } return `${y}-${String(mo).padStart(2, "0")}`; }
function monthRange() { return [S.from ? S.from.slice(0, 7) : "2026-03", S.to ? S.to.slice(0, 7) : "2099-12"]; }
function costWhere(drill) {
  const w = [], p = {};
  if (S.from) { w.push("day >= :c0"); p[":c0"] = S.from; } if (S.to) { w.push("day <= :c1"); p[":c1"] = S.to; }
  if (drill && S.ccls) { w.push("cls = :ccls"); p[":ccls"] = S.ccls; } if (drill && S.cpool) { w.push("coalesce(pool, '(cluster)') = :cpool"); p[":cpool"] = S.cpool; }
  if (!drill && S.ccls) { w.push("cls = :ccls"); p[":ccls"] = S.ccls; } if (!drill && S.cpool) { w.push("coalesce(pool, '(cluster)') = :cpool"); p[":cpool"] = S.cpool; }
  return { sql: w.map((x) => " and " + x).join(""), p };
}
function egressWhere() {
  const w = [], p = {};
  if (S.org) { w.push("lower(e.org) = lower(:eo)"); p[":eo"] = S.org; }
  if (S.repo) { w.push("lower(e.repo) = lower(:er)"); p[":er"] = S.repo.split("/")[1]; }
  if (S.cls) { w.push("e.org in (select name from orgs where cls = :ec)"); p[":ec"] = CLASSES.indexOf(S.cls) + 1; }
  return { sql: w.map((x) => " and " + x).join(""), p };
}
/** horizontal stacked bars (used for attributed cost) */
function stackedH(el, rows, parts, onClick, isSel) {
  const rowH = 34, H = Math.max(1, rows.length) * rowH + 4; const { svg, W } = svgFor(el, H);
  if (!rows.length) { s("text", { x: 0, y: 20, class: "tick", text: "No data in this selection" }, svg); return; }
  const max = Math.max(...rows.map((r) => r.t), 1e-9), pw = W - 70; const anySel = rows.some(isSel);
  rows.forEach((r, i) => {
    const y0 = i * rowH; let x = 0; const marks = [];
    s("text", { x: 0, y: y0 + 13, class: "lab" + (isSel(r) ? " strong" : ""), text: r.k.length > 44 ? r.k.slice(0, 43) + "…" : r.k }, svg);
    parts.forEach(([k, col], j) => { const v = r[k] || 0; if (v <= 0) return; const w = (v / max) * pw; const last = parts.slice(j + 1).every(([k2]) => !(r[k2] > 0));
      const p = s("path", { d: last ? barPath(x, y0 + 18, Math.max(1, w - (x > 0 ? 0 : 0)), 10, 4, true) : `M${x},${y0 + 18}h${Math.max(0.5, w - 2)}v10h${-Math.max(0.5, w - 2)}Z`, style: `fill:${col}` }, svg);
      if (anySel && !isSel(r)) p.style.opacity = 0.35; marks.push(p); x += w; });
    s("text", { x: x + 6, y: y0 + 27, class: "val", text: fmt.usd(r.t, r.t < 10 ? 2 : 0) }, svg);
    const hit = s("rect", { x: 0, y: y0, width: W, height: rowH, class: "hit" }, svg);
    interact(hit, { marks, tip: () => [r.k, parts.map(([k, col, l]) => ({ color: col, value: fmt.usd(r[k] || 0, 2), label: l })).concat([{ value: fmt.usd(r.t, 2), label: "total (estimate)" }])], click: () => onClick(r) });
  });
}

// ================= header: kpis, focus panel =================
function drawKpis() {
  curView = "kpi"; lastSQL.kpi = "";
  const k = q("kpi")[0] || {}; const med = one(Q.median_minutes.replace("/*W*/", where().W), where().p).m;
  const filtered = Object.keys(CHIPS).some((x) => S[x] != null);
  $("#kpis").replaceChildren(
    tileEl("Build requests", fmt.int(k.n), k.t0 ? `${dlabel(isoDay(k.t0), true)} – ${dlabel(isoDay(k.t1), true)}` : ""),
    tileEl("Organizations", fmt.int(k.orgs), `${fmt.int(k.repos)} repos`), tileEl("Branches", fmt.int(k.branches), ""),
    tileEl("Median build", med != null ? fmt.num(med) + " min" : "–", `${fmt.pct(k.bad / ((k.ok + k.bad) || 1))} failed`));
  $("#within").innerHTML = k.n ? `${filtered ? "<b>Within this selection:</b> " : ""}${fmt.int(k.n)} build request${k.n === 1 ? "" : "s"} from ${fmt.int(k.orgs)} organization${k.orgs === 1 ? "" : "s"}, about ${perDay(k)} a day; ${fmt.pct(k.weekend / k.n)} on weekends; ${fmt.int(k.hours)} build-hours logged.` : "Nothing matches these filters.";
}
const perDay = (k) => { const d = k.n / Math.max(1, (k.t1 - k.t0) / 86400 + 1); return d < 10 ? d.toFixed(1) : fmt.int(d); };
const tileEl = (l, v, sub) => h("div", { class: "tile" }, h("div", { class: "label" }, l), h("div", { class: "value" }, v), sub ? h("div", { class: "sub" }, sub) : null);

function drawFocus() {
  const f = $("#focus"); f.replaceChildren();
  if (!S.org && !S.repo && !S.login) return;
  curView = "focus";
  const card = h("div", { class: "card focus" });
  const crumbs = h("div", { class: "crumbs big" }, h("button", { type: "button", class: "link", onclick: () => set({ org: null, repo: null, branch: null }) }, "All"));
  if (S.org) crumbs.append(" › ", h("button", { type: "button", class: "link", onclick: () => set({ repo: null, branch: null }) }, S.org));
  if (S.repo) crumbs.append(" › ", h("button", { type: "button", class: "link", onclick: () => set({ branch: null }) }, S.repo.split("/")[1]));
  if (S.branch) crumbs.append(" › ", h("span", {}, S.branch));
  card.append(crumbs);
  if (S.repo) {
    const rid = LK.repoId[S.repo];
    const r = one(Q.focus_repo, { ":rid": rid ?? -1 });
    card.append(h("p", { class: "sub", html: `<a href="https://github.com/${esc(encodeURI(S.repo))}" target="_blank" rel="noopener">github.com/${esc(S.repo)}</a> · ${fmt.int(r.n)} build requests over ${fmt.int(r.branches)} branches · ${fmt.pct(r.bad / (r.done || 1))} of finished builds failed${r.gc ? "" : " · commits not collected for this repository"}.` }));
    const br = q("tm_branches", ["branch"]).slice(0, 12);
    card.append(h("h4", {}, "Branches (tap to filter)"), table(["Branch", "Builds", "Build-h"], br.map((x) => [x.name, fmt.int(x.n), fmt.num(x.hrs)]), { onRow: (_, i) => set({ branch: S.branch === br[i].name ? null : br[i].name }) }));
    const cc = q("focus_contrib", ["login"]);
    if (cc.length) card.append(h("h4", {}, "Contributors in this repository (tap to filter)"), h("div", { class: "pills" }, cc.map((c) => h("button", { type: "button", class: "chip" + (S.login === c.login ? " on" : ""), onclick: () => set({ login: S.login === c.login ? null : c.login }) }, `${c.login}${c.is_bot ? " (bot)" : ""} · ${c.n}`))));
    card.append(h("p", { class: "note" }, "Its builds over time, durations, outcomes and HL7-calendar context are in the charts below, which now show only this repository."));
  } else if (S.org) {
    const r = q("tm_repos", ["repo", "branch"]).slice(0, 10);
    card.append(h("p", { class: "sub" }, "Busiest repositories in this organization (tap one to drill in):"), table(["Repository", "Builds", "Build-h"], r.map((x) => [x.repo, fmt.int(x.n), fmt.num(x.hrs, 0)]), { onRow: (_, i) => set({ repo: S.org + "/" + r[i].repo }) }));
  }
  if (S.login) {
    const r = run(`select o.name org, r.name repo, count(*) n from commits c join repos r on r.id = c.repo_id join orgs o on o.id = r.org_id where c.person_id = :p group by r.id order by n desc limit 12`, { ":p": LK.personId[S.login] ?? -1 });
    card.append(h("h4", {}, `${S.login}: repositories they commit to (tap to drill in)`), table(["Repository", "Commits"], r.map((x) => [x.org + "/" + x.repo, fmt.int(x.n)]), { onRow: (_, i) => set({ org: r[i].org, repo: r[i].org + "/" + r[i].repo }) }));
  }
  f.append(card);
}

// ================= update loop =================
let timer = null;
function schedule() { clearTimeout(timer); document.body.classList.add("busy"); timer = setTimeout(update, 60); }
let gen = 0;
async function update() {
  const my = ++gen, t0 = performance.now();
  try {
    drawChips(); drawKpis(); drawFocus();
    document.body.classList.toggle("show-sql", S.sql === "1"); const cb = $("#showsql"); if (cb) cb.checked = S.sql === "1";
    let slice = performance.now();
    for (const v of views) {
      if (my !== gen) return; // a newer filter change superseded this pass
      curView = v.id; lastSQL[v.id] = "";
      const tv = performance.now();
      try { v.draw(); } catch (e) { console.error(v.id, e); v.body.replaceChildren(h("p", { class: "err" }, "Query failed: " + e.message)); }
      v.sqlBox.querySelector("pre").textContent = lastSQL[v.id] || "";
      (window.__vt ||= {})[v.id] = Math.round(performance.now() - tv);
      if (performance.now() - slice > 40) { await new Promise((r) => setTimeout(r, 0)); slice = performance.now(); } // keep the page responsive
    }
  } finally { if (my === gen) document.body.classList.remove("busy"); }
  if (my === gen) $("#timing").textContent = `${views.length} views re-queried in ${Math.round(performance.now() - t0)} ms`;
}
let rz; const ro = new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { if (views.some((v) => v.body.querySelector(".chart") && Math.abs((v.body.querySelector(".chart").clientWidth || 0) - (v.body.querySelector(".chart")._w || 0)) > 2)) update(); }, 150); });

// ================= boot =================
(function themeToggle() {
  const b = $("#theme"), modes = ["auto", "light", "dark"]; let m = "auto"; try { m = localStorage.getItem("theme") || "auto"; } catch (e) { /* no storage */ }
  const apply = () => { if (m === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", m); b.textContent = "Theme: " + m; };
  apply(); b.addEventListener("click", () => { m = modes[(modes.indexOf(m) + 1) % 3]; try { localStorage.setItem("theme", m); } catch (e) { /* ignore */ } apply(); });
})();

(async function boot() {
  try {
    const [SQL, buf] = await Promise.all([initSqlJs({ locateFile: (f) => "vendor/" + f }), fetch("data/igstats.sqlite").then((r) => { if (!r.ok) throw new Error("database " + r.status); return r.arrayBuffer(); })]);
    db = new SQL.Database(new Uint8Array(buf));
    for (const r of run("select key, value from meta")) LK.meta[r.key] = r.value;
    for (const r of run("select id, name from orgs")) { LK.orgId[r.name] = r.id; LK.orgName[r.id] = r.name; }
    for (const r of run("select r.id, o.name || '/' || r.name fullname from repos r join orgs o on o.id = r.org_id")) { LK.repoId[r.fullname] = r.id; LK.repoName[r.id] = r.fullname; }
    for (const r of run("select id, login from people")) { LK.personId[r.login] = r.id; LK.personLogin[r.id] = r.login; }
    LK.meta.requests = one("select count(*) n from builds").n;
    LK.lastFullWeekEnd = one("select date(max(ts), 'unixepoch', 'weekday 0', '-6 days') w from builds").w; // the partial last week starts here
    $("#lede").textContent = "";
    readHash(); buildPage();
    app().append(h("p", { id: "timing", class: "note" }));
    update(); ro.observe(app());
  } catch (e) { console.error(e); $("#lede").textContent = "Could not load the database: " + e.message; }
})();
