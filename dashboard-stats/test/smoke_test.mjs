// Headless smoke test over CDP (no deps; Node 22+ global WebSocket). Usage: node test/smoke_test.mjs [url]   (CHROME=path to override)
// Loads the page at phone width, clicks through filters, checks cross-updates, hash restore and console errors.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL0 = process.argv[2] || "https://build.fhir.org/ig/_dashboard/";
const port = 9333 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(join(tmpdir(), "igdash-cdp-"));
const chrome = spawn(process.env.CHROME || "chromium", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const errors = [];
async function connect() {
  for (let i = 0; i < 50; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = l.find((x) => x.type === "page"); if (p) return p.webSocketDebuggerUrl; } catch {} await sleep(200); }
  throw new Error("no chromium");
}
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function ev(expr) { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; }
const results = []; const ok = (name, cond, info = "") => { results.push([cond ? "PASS" : "FAIL", name, info]); };
async function settle() { await sleep(400); for (let i = 0; i < 40; i++) { if (await ev(`!document.body.classList.contains("busy") && !!document.querySelector("#kpis .value")`)) break; await sleep(150); } await sleep(150); }
const kpi = () => ev(`document.querySelector("#kpis .value").textContent`);
const within = () => ev(`document.querySelector("#within").textContent`);

try {
  ws = new WebSocket(await connect());
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(d.params.type)) errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error") errors.push(d.params.entry.text + " " + (d.params.entry.url || "")); };
  await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: URL0 }); await sleep(1500); await settle();
  const total = await kpi();
  const dbTotal = await ev(`db.exec("select count(*) from builds")[0].values[0][0].toLocaleString("en-US")`);
  ok("loads; unfiltered total matches the database", total === dbTotal, `${total} (db ${dbTotal})`);
  ok("wasm served as application/wasm", (await ev(`fetch("vendor/sql-wasm.wasm").then(r => r.headers.get("content-type"))`)) === "application/wasm");
  ok("views rendered", (await ev(`document.querySelectorAll(".card .chart svg").length`)) >= 20, await ev(`document.querySelectorAll(".card .chart svg").length`));

  // click a class bar (Who builds) -> cls filter, others re-query
  await ev(`document.querySelectorAll("#v-classes rect.hit")[0].dispatchEvent(new MouseEvent("click", {bubbles:true}))`); await settle();
  ok("class click sets hash", (await ev("location.hash")).includes("cls=HL7+International"), await ev("location.hash"));
  ok("class click updates KPIs", (await kpi()) !== total, await kpi());
  const hl7n = await kpi();
  // click treemap tile -> repo filter + focus panel
  await ev(`document.querySelector("#v-treemap rect[role=button]").dispatchEvent(new MouseEvent("click", {bubbles:true}))`); await settle();
  ok("treemap tile drills to repo", (await ev("location.hash")).includes("repo="), await ev("location.hash"));
  ok("focus panel shows", await ev(`!!document.querySelector("#focus .card")`));
  ok("treemap now shows branches", await ev(`document.querySelector("#v-treemap .crumbs").textContent.includes("›")`));
  // heatmap cell
  await ev(`document.querySelectorAll("#v-heat rect[role=button]")[7*24 > 50 ? 60 : 0].dispatchEvent(new MouseEvent("click", {bubbles:true}))`); await settle();
  ok("heatmap click sets dow/hour", /dow=\d.*hour=\d/.test(await ev("location.hash")), await ev("location.hash"));
  const chips = await ev(`document.querySelectorAll("#chips .chip").length`); ok("chips shown", chips >= 4, chips);
  // hash restore: reload with the same hash
  const h1 = await ev("location.hash"), w1 = await within();
  await send("Page.reload"); await sleep(1500); await settle();
  ok("hash restores state after reload", (await within()) === w1 && (await ev("location.hash")) === h1, await within());
  // remove all chips
  await ev(`[...document.querySelectorAll("#chips .chip")].find(c => c.textContent.includes("Clear")).click()`); await settle();
  ok("clear all returns to total", (await kpi()) === total, await kpi());
  // timeline drill: month -> weeks
  await ev(`document.querySelector("#v-timeline svg").dispatchEvent(new PointerEvent("pointerdown", {bubbles:true, clientX: document.querySelector("#v-timeline svg").getBoundingClientRect().right - 20, pointerId: 1}))`);
  await ev(`document.querySelector("#v-timeline svg").dispatchEvent(new PointerEvent("pointerup", {bubbles:true, clientX: document.querySelector("#v-timeline svg").getBoundingClientRect().right - 20, pointerId: 1}))`); await settle();
  ok("timeline click zooms to a month", /from=2026-10-01&to=2026-10-31/.test(await ev("location.hash")), await ev("location.hash"));
  // outcome + contributor + rows
  await ev(`location.hash = "#outcome=failure"`); await settle();
  ok("outcome filter via hash", (await within()).includes("Within this selection"), await kpi());
  await ev(`document.querySelector("#v-ptop rect.hit") && document.querySelector("#v-ptop rect.hit").dispatchEvent(new MouseEvent("click", {bubbles:true}))`); await settle();
  ok("contributor click filters", (await ev("location.hash")).includes("login="), await ev("location.hash"));
  ok("rows table has rows", (await ev(`document.querySelectorAll("#v-rows tbody tr").length`)) > 0);
  await ev(`location.hash = "#ccls=egress%2Fnet"`); await settle();
  ok("cost drill shows pools", await ev(`document.querySelector("#v-costbreak .sub").textContent.includes("node pool")`));
  await ev(`location.hash = "#errb=No+errors&tab=builds"`); await settle();
  ok("QA bucket -> rows", (await ev(`document.querySelector("#v-rows .pager span").textContent`)).includes("of"), await ev(`document.querySelector("#v-rows .pager span").textContent`));
  const timing = await ev(`document.querySelector("#timing").textContent`); ok("re-query timing", true, timing + " slowest: " + await ev(`JSON.stringify(Object.entries(window.__vt).sort((a,b)=>b[1]-a[1]).slice(0,6))`));
  await ev(`location.hash = ""`); await settle();
  ok("no console errors", errors.length === 0, errors.slice(0, 5).join(" | "));
} catch (e) { ok("harness", false, String(e)); }
for (const r of results) console.log(r.join("  "));
chrome.kill(); process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
