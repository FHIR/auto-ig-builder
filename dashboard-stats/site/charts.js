/* Small SVG chart kit (no dependencies). Every chart takes data rows + callbacks; it never queries. */
"use strict";
const NS = "http://www.w3.org/2000/svg";
const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v; else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
function s(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "text") el.textContent = v; else if (v != null) el.setAttribute(k, v); }
  if (parent) parent.append(el);
  return el;
}
const fmt = {
  int: (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US")),
  pct: (x, d = 0) => (x == null || !isFinite(x) ? "–" : (x * 100).toFixed(d) + "%"),
  usd: (n, d = 0) => "$" + (+n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }),
  compact: (n) => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(n >= 10000 || n % 1000 === 0 ? 0 : 1).replace(/\.0$/, "") + "K" : String(Math.round(n * 100) / 100)),
  num: (n, d = 1) => (n == null ? "–" : (+n).toFixed(d)),
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dlabel = (iso, yr) => { const d = new Date(iso.slice(0, 10) + "T00:00:00Z"); return d.getUTCDate() + " " + MON[d.getUTCMonth()] + (yr ? " " + d.getUTCFullYear() : ""); };
const mlabel = (ym, yr) => MON[+ym.slice(5, 7) - 1] + (yr ? " " + ym.slice(0, 4) : "");

function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => max / st <= count) || 10 * mag;
  const t = []; for (let v = 0; v <= max + step * 1e-3; v += step) t.push(+v.toFixed(10));
  if (t[t.length - 1] < max) t.push(t[t.length - 1] + step);
  return t;
}

// ---------- tooltip ----------
const tipEl = () => $("#tip");
function showTip(evt, title, rows) {
  const tip = tipEl();
  tip.replaceChildren(h("div", { class: "t" }, title));
  for (const r of rows) {
    const row = h("div", { class: "r" });
    if (r.color) { const i = h("i"); i.style.background = r.color; row.append(i); }
    row.append(h("b", {}, r.value), h("span", {}, r.label || ""));
    tip.append(row);
  }
  tip.style.display = "block";
  const pad = 12, w = tip.offsetWidth, ht = tip.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY - ht - pad;
  if (x + w > innerWidth - 8) x = evt.clientX - w - pad;
  if (x < 8) x = 8; if (y < 8) y = evt.clientY + pad;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
function hideTip() { const t = tipEl(); if (t) t.style.display = "none"; }
addEventListener("scroll", hideTip, { passive: true });
const focusPt = (el) => { const r = el.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top }; };

/** Wire hover/focus tooltip + click/Enter activation onto a hit element. */
function interact(hit, { tip, click, marks = [] }) {
  hit.setAttribute("tabindex", "0");
  if (click) { hit.setAttribute("role", "button"); hit.classList.add("clickable"); }
  const on = (e) => { marks.forEach((m) => m.classList.add("mark-hover")); if (tip) showTip(e, ...tip()); };
  const off = () => { marks.forEach((m) => m.classList.remove("mark-hover")); hideTip(); };
  hit.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") on(e); });
  hit.addEventListener("pointerleave", off);
  hit.addEventListener("focus", () => on(focusPt(hit)));
  hit.addEventListener("blur", off);
  if (click) {
    hit.addEventListener("click", (e) => { off(); click(e); });
    hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); off(); click(e); } });
  } else hit.addEventListener("pointerdown", on);
}

function svgFor(el, height) {
  el.replaceChildren();
  const W = Math.max(280, el.clientWidth || 320);
  const svg = s("svg", { viewBox: `0 0 ${W} ${height}`, role: "img" }, el);
  el._w = W;
  return { svg, W };
}
function yAxis(g, ticks, y, x0, x1, f) {
  for (const v of ticks) {
    s("line", { x1: x0, x2: x1, y1: y(v), y2: y(v), class: v === 0 ? "axis" : "grid" }, g);
    s("text", { x: x0 - 6, y: y(v) + 4, "text-anchor": "end", class: "tick", text: f(v) }, g);
  }
}
function legend(items, onClick) {
  return h("div", { class: "legend" }, items.map((it) => {
    const i = h("i", { class: it.kind || "" }); i.style.background = it.color;
    const tag = onClick && it.value != null ? "button" : "span";
    return h(tag, { class: (it.active ? "on " : "") + (it.dim ? "dim" : ""), type: tag === "button" ? "button" : null,
      onclick: tag === "button" ? () => onClick(it.value) : null }, i, it.label);
  }));
}
function barPath(x, y, w, hgt, r = 4, horizontal = false) {
  if (horizontal) { r = Math.min(r, w, hgt / 2); return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt - r}Q${x + w},${y + hgt} ${x + w - r},${y + hgt}H${x}Z`; }
  r = Math.min(r, hgt, w / 2);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}

/** Columns, optionally stacked. o: {rows, x, series[{key,name,color}], xfmt, tipTitle, onClick(row,i), onBrush(i0,i1), selected(row)->bool|null, line, bands} */
function columns(el, o) {
  const H = o.height || 210, m = { l: 42, r: 8, t: 10, b: 24 };
  const { svg, W } = svgFor(el, H);
  if (!o.rows.length) { s("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "tick", text: "No data in this selection" }, svg); return; }
  const n = o.rows.length, pw = W - m.l - m.r, ph = H - m.t - m.b;
  const totals = o.rows.map((r) => o.series.reduce((a, se) => a + (+r[se.key] || 0), 0));
  const maxV = Math.max(...totals, ...(o.line ? o.rows.map((r) => +r[o.line.key] || 0) : [0]));
  const ticks = niceTicks(maxV, 4), top = ticks[ticks.length - 1];
  const y = (v) => m.t + ph - (v / top) * ph;
  const bw = pw / n, barW = Math.max(1, Math.min(24, bw - (bw > 4 ? 2 : 0.5)));
  const xc = (i) => m.l + bw * i + bw / 2;
  if (o.bands) for (const b of o.bands) {
    const i0 = b.i0, i1 = b.i1; if (i1 < 0 || i0 > n - 1) continue;
    s("rect", { x: m.l + bw * Math.max(0, i0), y: m.t, width: bw * (Math.min(n - 1, i1) - Math.max(0, i0) + 1), height: ph, style: `fill:${b.fill}` }, svg);
  }
  const g = s("g", {}, svg);
  yAxis(g, ticks, y, m.l, W - m.r, o.yfmt || fmt.compact);
  const every = Math.max(1, Math.ceil(n / Math.floor(pw / (o.labelW || 36))));
  const anySel = o.selected && o.rows.some((r) => o.selected(r));
  const colMarks = [];
  o.rows.forEach((r, i) => {
    const x = xc(i) - barW / 2; let cum = 0; const segs = [];
    o.series.forEach((se, si) => {
      const v = +r[se.key] || 0; if (v <= 0) return;
      const y1 = y(cum + v), y0 = y(cum), gap = cum > 0 && barW > 3 ? 2 : 0;
      const isTop = o.series.slice(si + 1).every((s2) => !(+r[s2.key] > 0));
      const hh = Math.max(0.5, y0 - y1 - gap);
      const p = s("path", { d: isTop && barW > 6 ? barPath(x, y1, barW, hh) : `M${x},${y1}h${barW}v${hh}h${-barW}Z`, style: `fill:${se.color}` }, g);
      if ((anySel && !o.selected(r)) || (o.fade && o.fade(r))) p.style.opacity = 0.35;
      segs.push(p); cum += v;
    });
    colMarks.push(segs);
    const lab = o.xfmt ? o.xfmt(r[o.x], i) : r[o.x];
    if (lab && ((n - 1 - i) % every === 0 || o.labelAll)) s("text", { x: xc(i), y: H - 7, "text-anchor": "middle", class: "tick", text: lab }, g);
  });
  if (o.line) {
    const pts = o.rows.map((r, i) => [xc(i), y(+r[o.line.key] || 0)]);
    s("path", { d: "M" + pts.map((p) => p.join(",")).join("L"), class: "line", style: `stroke:${o.line.color}` }, svg);
  }
  if (o.refX != null) {
    const rx = m.l + bw * o.refX;
    s("line", { x1: rx, x2: rx, y1: m.t, y2: m.t + ph, class: "ref" }, svg);
    s("text", { x: rx - 4, y: m.t + 10, "text-anchor": "end", class: "tick strong", text: o.refLabel }, svg);
  }
  // hit layer: per column; supports drag-brush when onBrush given
  const brushRect = s("rect", { y: m.t, height: ph, class: "brush", style: "display:none" }, svg);
  let drag = null;
  const idxAt = (e) => { const r = svg.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.floor((((e.clientX - r.left) / r.width) * W - m.l) / bw))); };
  o.rows.forEach((r, i) => {
    const hit = s("rect", { x: m.l + bw * i, y: m.t, width: bw, height: ph, class: "hit", "aria-label": `${o.tipTitle ? o.tipTitle(r) : r[o.x]}: ${fmt.int(totals[i])}` }, svg);
    const tip = () => {
      const rows = o.series.slice().reverse().filter((se) => r[se.key] != null && (+r[se.key] || o.series.length === 1)).map((se) => ({ color: se.color, value: (o.vfmt || fmt.int)(r[se.key]), label: se.name }));
      if (o.series.length > 1) rows.push({ value: (o.vfmt || fmt.int)(totals[i]), label: "total" });
      if (o.extraTip) rows.push(...o.extraTip(r));
      return [o.tipTitle ? o.tipTitle(r) : r[o.x], rows];
    };
    interact(hit, { tip, marks: colMarks[i], click: o.onClick && !o.onBrush ? () => o.onClick(r, i) : null });
    if (o.onBrush) {
      hit.classList.add("clickable"); hit.setAttribute("role", "button");
      hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.onClick(r, i); } });
    }
  });
  if (o.onBrush) {
    svg.style.touchAction = "pan-y";
    svg.addEventListener("pointerdown", (e) => { drag = { i0: idxAt(e), i1: idxAt(e), x: e.clientX }; svg.setPointerCapture(e.pointerId); });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return; drag.i1 = idxAt(e);
      if (Math.abs(e.clientX - drag.x) > 8) {
        const a = Math.min(drag.i0, drag.i1), b = Math.max(drag.i0, drag.i1);
        brushRect.setAttribute("x", m.l + bw * a); brushRect.setAttribute("width", bw * (b - a + 1)); brushRect.style.display = "";
        hideTip();
      }
    });
    const end = (e) => {
      if (!drag) return; const d = drag; drag = null; brushRect.style.display = "none";
      if (Math.abs(e.clientX - d.x) > 8 && d.i0 !== d.i1) o.onBrush(Math.min(d.i0, d.i1), Math.max(d.i0, d.i1));
      else o.onClick(o.rows[d.i0], d.i0);
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", () => { drag = null; brushRect.style.display = "none"; });
  }
}

/** Horizontal bars. rows: [{label, value, color, note, tip, key}] ; o.onClick(row), o.selected(row) */
function hbars(el, o) {
  const rowH = 34, H = Math.max(1, o.rows.length) * rowH + 4;
  const { svg, W } = svgFor(el, H);
  if (!o.rows.length) { s("text", { x: 0, y: 20, class: "tick", text: "No data in this selection" }, svg); return; }
  const maxV = Math.max(...o.rows.map((r) => r.value), 1e-9);
  const valW = o.valW || 70, pw = W - valW;
  const anySel = o.selected && o.rows.some((r) => o.selected(r));
  o.rows.forEach((r, i) => {
    const y0 = i * rowH;
    const sel = anySel && o.selected(r);
    s("text", { x: 0, y: y0 + 13, class: "lab" + (sel ? " strong" : ""), text: r.label }, svg);
    if (r.note) s("text", { x: W, y: y0 + 13, "text-anchor": "end", class: "tick", text: r.note }, svg);
    const w = Math.max(2, (r.value / maxV) * pw);
    const bar = s("path", { d: barPath(0, y0 + 18, w, 10, 4, true), style: `fill:${r.color}` }, svg);
    if (anySel && !sel) bar.style.opacity = 0.35;
    s("text", { x: w + 6, y: y0 + 27, class: "val", text: (o.fmt || fmt.int)(r.value) }, svg);
    const hit = s("rect", { x: 0, y: y0, width: W, height: rowH, class: "hit", "aria-label": `${r.label}: ${(o.fmt || fmt.int)(r.value)}` }, svg);
    interact(hit, { marks: [bar], tip: () => [r.label, (r.tip || [{ value: (o.fmt || fmt.int)(r.value), label: "" }]).map((x) => ({ color: r.color, ...x }))],
      click: o.onClick ? () => o.onClick(r) : null });
  });
}

/** Lines over numeric x with crosshair. o: {x[], series[{name,color,values,area}], bands[{x0,x1,fill}], xticks[{v,label}], tipTitle(i), onClick(i)} */
function lines(el, o) {
  const H = o.height || 190, m = { l: 42, r: o.mr ?? 10, t: 12, b: 24 };
  const { svg, W } = svgFor(el, H);
  const xs = o.x; if (!xs.length) { s("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "tick", text: "No data in this selection" }, svg); return; }
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const x0 = o.xmin ?? xs[0], x1 = o.xmax ?? xs[xs.length - 1];
  const x = (v) => m.l + (x1 === x0 ? pw / 2 : ((v - x0) / (x1 - x0)) * pw);
  const maxV = Math.max(...o.series.flatMap((se) => se.values), o.minMax || 0);
  const ticks = niceTicks(maxV, o.ticks || 4), top = ticks[ticks.length - 1];
  const y = (v) => m.t + ph - (v / top) * ph;
  for (const b of o.bands || []) {
    const bx0 = Math.max(m.l, x(b.x0)), bx1 = Math.min(W - m.r, x(b.x1)); if (bx1 <= bx0) continue;
    s("rect", { x: bx0, y: m.t, width: bx1 - bx0, height: ph, style: `fill:${b.fill}` }, svg);
  }
  yAxis(svg, ticks, y, m.l, W - m.r, o.yfmt || fmt.compact);
  for (const tk of o.xticks || []) s("text", { x: x(tk.v), y: H - 6, "text-anchor": "middle", class: "tick", text: tk.label }, svg);
  for (const se of o.series) {
    const d = "M" + se.values.map((v, i) => `${x(xs[i]).toFixed(1)},${y(v).toFixed(1)}`).join("L");
    if (se.area) s("path", { d: d + `L${x(xs[xs.length - 1])},${y(0)}L${x(xs[0])},${y(0)}Z`, style: `fill:${se.color};opacity:.1` }, svg);
    s("path", { d, class: "line", style: `stroke:${se.color}` }, svg);
    if (xs.length === 1) s("circle", { cx: x(xs[0]), cy: y(se.values[0]), r: 4, class: "dot", style: `fill:${se.color}` }, svg);
    if (se.endLabel) s("text", { x: x(xs[xs.length - 1]) + 8, y: y(se.values[se.values.length - 1]) + 4, class: "tick strong", text: se.endLabel }, svg);
  }
  for (const a of o.marks || []) {
    s("circle", { cx: x(a.x), cy: y(a.y), r: 4, class: "dot", style: `fill:${a.color}` }, svg);
    s("text", { x: x(a.x) + (a.dx || 0), y: y(a.y) - 8, "text-anchor": a.anchor || "middle", class: "tick strong", text: a.label }, svg);
  }
  const cross = s("line", { y1: m.t, y2: m.t + ph, class: "cross", style: "display:none" }, svg);
  const dots = o.series.map((se) => s("circle", { r: 4, class: "dot", style: `fill:${se.color};display:none` }, svg));
  const hit = s("rect", { x: m.l, y: m.t, width: pw, height: ph, class: "hit" + (o.onClick ? " clickable" : ""), tabindex: 0, "aria-label": o.aria || "chart" }, svg);
  let fi = xs.length - 1;
  const showAt = (i, e) => {
    const cx = x(xs[i]); cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.style.display = "";
    o.series.forEach((se, k) => { dots[k].setAttribute("cx", cx); dots[k].setAttribute("cy", y(se.values[i])); dots[k].style.display = ""; });
    const rows = o.series.map((se) => ({ color: se.color, value: (o.vfmt || fmt.int)(se.values[i]), label: se.name }));
    if (o.extraTip) rows.push(...o.extraTip(i));
    showTip(e, o.tipTitle(i), rows);
  };
  const nearest = (e) => { const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W; let b = 0, bd = Infinity; xs.forEach((v, i) => { const d = Math.abs(x(v) - px); if (d < bd) { bd = d; b = i; } }); return b; };
  const off = () => { cross.style.display = "none"; dots.forEach((d) => (d.style.display = "none")); hideTip(); };
  hit.addEventListener("pointermove", (e) => showAt(nearest(e), e));
  hit.addEventListener("pointerleave", off); hit.addEventListener("blur", off);
  hit.addEventListener("focus", () => showAt(fi, focusPt(hit)));
  if (o.onClick) hit.addEventListener("click", (e) => { off(); o.onClick(nearest(e)); });
  hit.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") fi = Math.max(0, fi - 1); else if (e.key === "ArrowRight") fi = Math.min(xs.length - 1, fi + 1);
    else if ((e.key === "Enter" || e.key === " ") && o.onClick) { e.preventDefault(); o.onClick(fi); return; } else return;
    e.preventDefault(); const r = svg.getBoundingClientRect(); showAt(fi, { clientX: r.left + (x(xs[fi]) / W) * r.width, clientY: r.top });
  });
}

/** Squarified treemap. items [{label, value, color, ink, sub, onClick, tip}] */
function treemap(el, o) {
  const H = o.height || 360;
  const { svg, W } = svgFor(el, H);
  const items = o.items.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  if (!items.length) { s("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "tick", text: "No data in this selection" }, svg); return; }
  const tot = items.reduce((a, d) => a + d.value, 0);
  const nodes = items.map((d) => ({ d, a: (d.value / tot) * W * H }));
  const out = []; let rest = nodes, x = 0, y = 0, w = W, hh = H;
  const worst = (row, len) => { let sm = 0, mx = 0, mn = Infinity; for (const r of row) { sm += r.a; mx = Math.max(mx, r.a); mn = Math.min(mn, r.a); } return Math.max((len * len * mx) / (sm * sm), (sm * sm) / (len * len * mn)); };
  while (rest.length) {
    const short = Math.min(w, hh); const row = [rest[0]]; let i = 1, cur = worst(row, short);
    while (i < rest.length) { row.push(rest[i]); const nw = worst(row, short); if (nw > cur) { row.pop(); break; } cur = nw; i++; }
    const sm = row.reduce((a, r) => a + r.a, 0);
    if (w >= hh) { const cw = sm / hh; let yy = y; for (const r of row) { const rh = r.a / cw; out.push({ ...r, x, y: yy, w: cw, h: rh }); yy += rh; } x += cw; w -= cw; }
    else { const rh = sm / w; let xx = x; for (const r of row) { const rw = r.a / rh; out.push({ ...r, x: xx, y, w: rw, h: rh }); xx += rw; } y += rh; hh -= rh; }
    rest = rest.slice(i);
  }
  for (const n of out) {
    const g = n.w > 3 && n.h > 3 ? 1 : 0.25; // half of the 2px surface gap on each side
    const rx = n.x + g, ry = n.y + g, rw = Math.max(0.3, n.w - 2 * g), rh = Math.max(0.3, n.h - 2 * g);
    const rect = s("rect", { x: rx, y: ry, width: rw, height: rh, rx: Math.min(4, rw / 4, rh / 4), style: `fill:${n.d.color}` }, svg);
    if (n.d.dim) rect.style.opacity = 0.35;
    if (rw > 46 && rh > 22) {
      const maxCh = Math.floor((rw - 8) / 6.4);
      const lab = n.d.label.length > maxCh ? n.d.label.slice(0, Math.max(1, maxCh - 1)) + "…" : n.d.label;
      s("text", { x: rx + 5, y: ry + 14, class: "tm-lab", style: `fill:${n.d.ink}`, text: lab }, svg);
      const maxS = Math.floor((rw - 8) / 5.6), sub = n.d.sub && n.d.sub.length > maxS ? n.d.sub.slice(0, Math.max(1, maxS - 1)) + "…" : n.d.sub;
      if (rh > 36 && sub) s("text", { x: rx + 5, y: ry + 28, class: "tm-sub", style: `fill:${n.d.ink}`, text: sub }, svg);
    }
    rect.setAttribute("aria-label", `${n.d.label}: ${n.d.sub || n.d.value}`);
    interact(rect, { marks: [rect], tip: n.d.tip, click: n.d.onClick });
  }
}

/** Day-of-week x hour heatmap. cells: 7x24 matrix of counts. */
function heatmap(el, o) {
  const lw = 34, top = 4, bottom = 18;
  const W0 = Math.max(280, el.clientWidth || 320), cw = (W0 - lw) / 24, ch = Math.min(26, Math.max(18, cw * 1.25));
  const H = top + ch * 7 + bottom;
  const { svg, W } = svgFor(el, H);
  const max = Math.max(1, ...o.cells.flat());
  for (let d = 0; d < 7; d++) {
    const t = s("text", { x: lw - 6, y: top + ch * d + ch / 2 + 4, "text-anchor": "end", class: "tick" + (o.selDow === d + 1 ? " strong" : ""), text: DOW[d] }, svg);
    if (o.onDow) { const hr = s("rect", { x: 0, y: top + ch * d, width: lw - 2, height: ch, class: "hit" }, svg); interact(hr, { tip: () => [DOW[d] + " (whole day)", [{ value: fmt.int(o.cells[d].reduce((a, b) => a + b, 0)), label: "builds" }]], click: () => o.onDow(d + 1) }); }
    for (let hr = 0; hr < 24; hr++) {
      const v = o.cells[d][hr], p = Math.round(Math.sqrt(v / max) * 100);
      const sel = (o.selDow == null || o.selDow === d + 1) && (o.selHour == null || o.selHour === hr);
      const r = s("rect", { x: lw + cw * hr + 1, y: top + ch * d + 1, width: cw - 2, height: ch - 2, rx: 2,
        style: `fill:color-mix(in oklab, var(--heat-hi) ${p}%, var(--heat-lo))${(o.selDow != null || o.selHour != null) && !sel ? ";opacity:.3" : ""}` }, svg);
      r.setAttribute("aria-label", `${DOW[d]} ${hr}:00 ${o.tz}: ${v}`);
      interact(r, { marks: [r], tip: () => [`${DOW[d]} ${String(hr).padStart(2, "0")}:00–${String(hr).padStart(2, "0")}:59 ${o.tz}`, [{ value: fmt.int(v), label: "builds" }]], click: () => o.onCell(d + 1, hr) });
    }
  }
  for (let hr = 0; hr < 24; hr += 3) {
    s("text", { x: lw + cw * hr + cw / 2, y: H - 4, "text-anchor": "middle", class: "tick" + (o.selHour === hr ? " strong" : ""), text: String(hr).padStart(2, "0") }, svg);
  }
  if (o.onHour) for (let hr = 0; hr < 24; hr++) {
    const hrect = s("rect", { x: lw + cw * hr, y: H - bottom, width: cw, height: bottom, class: "hit" }, svg);
    interact(hrect, { tip: () => [`${String(hr).padStart(2, "0")}:00 ${o.tz} (all days)`, [{ value: fmt.int(o.cells.reduce((a, row) => a + row[hr], 0)), label: "builds" }]], click: () => o.onHour(hr) });
  }
}

/** Dot strip: one row per item, dot at x in [0,24). items [{label, x, color, sub, onClick, sel}] */
function dotstrip(el, o) {
  const rowH = 22, lw = Math.min(150, (el.clientWidth || 320) * 0.42), top = 4, bottom = 18;
  const H = top + o.items.length * rowH + bottom;
  const { svg, W } = svgFor(el, H);
  const pw = W - lw - 8, x = (v) => lw + (v / 24) * pw;
  for (let hr = 0; hr <= 24; hr += 6) {
    s("line", { x1: x(hr), x2: x(hr), y1: top, y2: H - bottom, class: "grid" }, svg);
    s("text", { x: x(hr), y: H - 4, "text-anchor": "middle", class: "tick", text: String(hr % 24).padStart(2, "0") + ":00" }, svg);
  }
  for (const b of o.bands || []) s("rect", { x: x(b.x0), y: top, width: x(b.x1) - x(b.x0), height: H - bottom - top, style: `fill:${b.fill}` }, svg);
  o.items.forEach((it, i) => {
    const cy = top + rowH * i + rowH / 2;
    s("text", { x: lw - 8, y: cy + 4, "text-anchor": "end", class: "lab" + (it.sel ? " strong" : ""), text: it.label.length > 22 ? it.label.slice(0, 21) + "…" : it.label }, svg);
    const dot = s("circle", { cx: x(it.x), cy, r: 5, class: "dot", style: `fill:${it.color}` }, svg);
    const hit = s("rect", { x: 0, y: cy - rowH / 2, width: W, height: rowH, class: "hit" }, svg);
    interact(hit, { marks: [dot], tip: it.tip, click: it.onClick });
  });
}

/** Matrix of dots: rows x cols with values. o: {rows[{label,key,onClick,sub}], cols[{label,key,onClick}], get(r,c)->v} */
function matrix(el, o) {
  const lw = Math.min(130, (el.clientWidth || 320) * 0.36), rowH = 22, headH = 84;
  const W0 = Math.max(280, el.clientWidth || 320), cw = Math.min(34, (W0 - lw - 4) / o.cols.length);
  const H = headH + o.rows.length * rowH + 4;
  const { svg, W } = svgFor(el, H);
  let max = 1; for (const r of o.rows) for (const c of o.cols) max = Math.max(max, o.get(r, c) || 0);
  o.cols.forEach((c, j) => {
    const cx = lw + cw * j + cw / 2;
    s("line", { x1: cx, x2: cx, y1: headH, y2: H - 4, class: "grid" }, svg);
    const t = s("text", { x: cx + 3, y: headH - 6, transform: `rotate(-50 ${cx + 3} ${headH - 6})`, class: "tick", text: c.label.length > 16 ? c.label.slice(0, 15) + "…" : c.label }, svg);
    if (c.onClick) { const hr = s("rect", { x: cx - cw / 2, y: 0, width: cw, height: headH, class: "hit" }, svg); interact(hr, { tip: () => [c.label, [{ value: "", label: "tap to filter to this org" }]], click: c.onClick }); }
  });
  o.rows.forEach((r, i) => {
    const cy = headH + rowH * i + rowH / 2;
    s("line", { x1: lw, x2: W, y1: cy, y2: cy, class: "grid" }, svg);
    s("text", { x: lw - 6, y: cy + 4, "text-anchor": "end", class: "lab", text: r.label.length > 18 ? r.label.slice(0, 17) + "…" : r.label }, svg);
    const hitRow = s("rect", { x: 0, y: cy - rowH / 2, width: lw, height: rowH, class: "hit" }, svg);
    interact(hitRow, { tip: () => [r.label, [{ value: r.sub || "", label: "" }]], click: r.onClick });
    o.cols.forEach((c, j) => {
      const v = o.get(r, c); if (!v) return;
      const cx = lw + cw * j + cw / 2, rad = Math.max(2.5, Math.sqrt(v / max) * Math.min(cw / 2 - 1, 10));
      const dot = s("circle", { cx, cy, r: rad, class: "dot", style: `fill:${o.color || "var(--s1)"}` }, svg);
      interact(dot, { marks: [dot], tip: () => [`${r.label} · ${c.label}`, [{ value: fmt.int(v), label: o.unit || "" }]], click: r.onClick });
    });
  });
}
