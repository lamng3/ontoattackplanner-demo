// Attacking a knowledge graph through its ontology (kgattack-data.json, exported by kgattack_data.py from
// experiments/whitebox_kg and experiments/threat_levels). Nothing is computed here: every attacker and
// assumption the picker offers is a recorded run.
(function () {
  var root = document.getElementById("kg-attack");
  if (!root) return;
  var el = function (id) { return document.getElementById(id); };
  var h = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  var data, arm = "stealthy";

  function meter(value, alt) {
    var d = h("div", "bar meter" + (alt ? " alt" : ""));
    var i = h("i"); i.style.setProperty("--w", Math.round(Math.max(0, Math.min(1, value)) * 100) + "%");
    d.appendChild(i); d.appendChild(h("b", null, value.toFixed(2)));
    return d;
  }

  // The attackers, one per threat level, and the assumptions each was run under. Every combination
  // shown is a recorded run (data.runs); the white box comes from the budget sweep (data.arms).
  var ATTACKERS = [
    { level: "L0", name: "White box", knows: "Knows everything: the ontology, the full KG (100,543 triples), the reasoner, and the SPARQL queries." },
    { level: "L1", name: "Grey box", knows: "Knows the ontology, the reasoner, and the queries. The KG sits behind a guarded retriever: no wildcards or scans, at most 50 rows a call, counts and GROUP BY allowed. It crawls a pseudo-KG and searches on that." },
    { level: "L2", name: "Pipeline hidden", knows: "Like the grey box, but the reasoner is hidden too: it searches with an RDFS surrogate on its pseudo-KG." },
    { level: "L3", name: "Words", knows: "Sees the questions in words, not SPARQL; the pipeline links words to ontology terms by their labels, so the attacker can also edit labels." },
    { level: "L4", name: "Black box", knows: "Sees neither the KG nor the pipeline: it deploys an ontology and observes the answers, a fixed number of times." },
  ];
  // Assumption rows: which levels show them, the run field they pick, and their choices.
  var OPTIONS = [
    { key: "kg", label: "KG access", levels: ["L1", "L2", "L3"], choices: [["full", "full KG"], ["crawled", "crawled"], ["augmented", "augmented"]] },
    { key: "calls", label: "retriever calls", levels: ["L1", "L2"], choices: [[200, "200"], [1000, "1,000"], [5000, "5,000"]] },
    { key: "order", label: "row order", levels: ["L1", "L2"], choices: [["sorted", "sorted"], ["random", "random"]] },
    { key: "probes", label: "probes", levels: ["L4"], choices: [[50, "50"], [200, "200"], [1000, "1,000"]] },
  ];
  var pick = { level: "L0", kg: "augmented", calls: 1000, order: "random", probes: 200 };

  function tabs(choices, value, onpick) {
    var row = h("div", "tabs");
    row.setAttribute("role", "tablist");
    choices.forEach(function (c) {
      var b = h("button", "tab", c[1]);
      if (c[2]) b.appendChild(h("small", null, c[2]));
      b.type = "button"; b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", c[0] === value ? "true" : "false");
      b.disabled = !!c[3];
      b.onclick = function () { onpick(c[0]); };
      row.appendChild(b);
    });
    return row;
  }

  function arms() {
    var box = el("kg-arms");
    box.innerHTML = "";
    [["stealthy", "Stealthy: queries still validate"], ["any", "Any edit"]].forEach(function (a) {
      var b = h("button", "tab", a[1]);
      b.type = "button"; b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", a[0] === arm ? "true" : "false");
      b.onclick = function () { arm = a[0]; arms(); update(); };
      box.appendChild(b);
    });
  }

  // The recorded run matching the picked attacker and assumptions, or null.
  function current() {
    var lv = pick.level;
    return data.runs.filter(function (r) {
      if (r.level !== lv || r.arm !== arm) return false;
      if (lv === "L4") return r.probes === pick.probes;
      if (pick.kg === "full") return r.full_kg;
      if (r.full_kg || (r.augmented !== false) !== (pick.kg === "augmented")) return false;
      return lv === "L3" || (r.calls === pick.calls && r.order === pick.order);
    })[0] || null;
  }

  function picker() {
    var box = el("kg-pick");
    box.innerHTML = "";
    box.appendChild(h("span", null, "attacker"));
    box.appendChild(tabs(ATTACKERS.map(function (a) { return [a.level, a.name, a.level]; }), pick.level, function (v) { pick.level = v; update(); }));
    OPTIONS.forEach(function (o) {
      if (o.levels.indexOf(pick.level) < 0) return;
      var choices = o.choices.filter(function (c) { return !(c[0] === "full" && pick.level !== "L3"); });
      if (o.key === "kg" && pick.level !== "L3" && pick.kg === "full") pick.kg = "augmented";
      box.appendChild(h("span", null, o.label));
      box.appendChild(tabs(choices, pick[o.key], function (v) { pick[o.key] = v; update(); }));
    });
    var a = ATTACKERS.filter(function (x) { return x.level === pick.level; })[0];
    var extra = pick.level === "L3" ? (pick.kg === "full" ? " Here it also has the full KG." : " Its pseudo-KG comes from 1,000 retriever calls in random order.") : "";
    el("kg-knows").textContent = a.knows + extra;
    el("kg-budget-row").hidden = pick.level !== "L0";
  }

  function update() { picker(); render(); levels(); }

  function bars(f1) {
    var box = el("kg-bars");
    box.innerHTML = "";
    data.queries.forEach(function (q) {
      var f = f1 ? f1[q.id] : null, d = h("div", "bar" + (f === null || f < 1 ? "" : " alt"));
      d.title = q.id.toUpperCase() + ": " + q.label + " (" + q.gold + " answers)";
      d.appendChild(h("span", null, q.id.toUpperCase().replace("Q0", "Q")));
      var i = h("i"); i.style.setProperty("--w", Math.round((f || 0) * 100) + "%"); d.appendChild(i);
      d.appendChild(h("b", null, f === null ? "–" : f.toFixed(2)));
      box.appendChild(d);
    });
  }

  function edits(names) {
    var list = el("kg-mutations");
    list.innerHTML = "";
    if (!names.length) list.appendChild(h("li", null, "no edit found"));
    names.forEach(function (n) {
      var i = n.indexOf(": "), li = h("li");
      li.appendChild(h("b", null, n.slice(0, i))); li.appendChild(document.createTextNode(" " + n.slice(i + 2)));
      list.appendChild(li);
    });
  }

  function render() {
    var n = function (x) { return x.toLocaleString("en-US"); };
    if (pick.level === "L0") {
      var a = data.arms[arm][+el("kg-budget").value - 1];
      el("kg-budget-out").textContent = a.budget + " edit" + (a.budget > 1 ? "s" : "");
      bars(a.f1);
      edits(a.mutations.map(function (m) { return m.family + ": " + m.target; }));
      el("kg-summary").textContent = "Harm " + a.harm.toFixed(2) + ", answers lost " + n(a.lost) + ", wrong answers added " + n(a.added) + ".";
      return;
    }
    var r = current();
    if (!r) { bars(null); edits([]); el("kg-summary").textContent = "Not recorded yet: this run is still in progress."; return; }
    bars(r.f1 || null);
    edits(r.mutations);
    var model = r.probes ? r.probes + " probes" : r.full_kg ? "the full KG" : "a pseudo-KG of " + n(r.pseudo_triples) + " triples";
    el("kg-summary").textContent = "Two edits. On its own model (" + model + ", " + n(r.evaluations) + " evaluations) the attacker believed harm " +
      r.believed_harm.toFixed(2) + "; on the real KG the harm is " + r.true_harm.toFixed(2) +
      (r.lost != null ? ", answers lost " + n(r.lost) + ", wrong answers added " + n(r.added) : "") + ".";
  }

  function levels() {
    var body = el("kg-levels");
    body.innerHTML = "";
    data.levels[arm].forEach(function (r) {
      var tr = h("tr", r.level === pick.level ? "on" : "");
      var name = h("td"); name.appendChild(h("b", null, r.level)); name.appendChild(document.createTextNode(" " + r.name));
      tr.appendChild(name);
      tr.appendChild(h("td", "muted", r.hidden));
      var td = h("td"); td.appendChild(meter(r.true_harm, r.level !== "L0")); tr.appendChild(td);
      tr.title = r.mutations.join("; ") + (r.level === "L0" ? "" : " (the attacker believed " + r.believed_harm.toFixed(2) + ")");
      tr.onclick = function () { pick.level = r.level; if (r.level === "L3") pick.kg = "augmented"; else { pick.calls = 1000; pick.order = "random"; pick.kg = "augmented"; pick.probes = 200; } update(); };
      body.appendChild(tr);
    });
  }

  // Drift as random edits of one regime pile up: one line per regime, labelled at its end, hover for the numbers.
  function drift() {
    var svg = el("kg-drift"), ns = "http://www.w3.org/2000/svg";
    var W = 360, H = 190, L = 34, R = 74, T = 10, B = 26;
    var regimes = ["failure", "drift", "pollution"], max = 0, doses = 0;
    regimes.forEach(function (g) { data.drift[g].forEach(function (p) { max = Math.max(max, p.drift); doses = Math.max(doses, p.dose); }); });
    max = Math.max(0.05, Math.ceil(max * 20) / 20);
    var x = function (d) { return L + (d - 1) / Math.max(1, doses - 1) * (W - L - R); };
    var y = function (v) { return T + (1 - v / max) * (H - T - B); };
    var mk = function (tag, attrs, text) { var e = document.createElementNS(ns, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; svg.appendChild(e); return e; };
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    [0, max / 2, max].forEach(function (v) {
      mk("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" });
      mk("text", { x: L - 6, y: y(v) + 3, class: "tick", "text-anchor": "end" }, v.toFixed(2));
    });
    [1, Math.ceil(doses / 2), doses].forEach(function (d) { mk("text", { x: x(d), y: H - 8, class: "tick", "text-anchor": "middle" }, d); });
    regimes.forEach(function (g, i) {
      var pts = data.drift[g];
      mk("polyline", { points: pts.map(function (p) { return x(p.dose) + "," + y(p.drift); }).join(" "), class: "line s" + (i + 1) });
      var last = pts[pts.length - 1];
      mk("circle", { cx: x(last.dose), cy: y(last.drift), r: 4, class: "dot s" + (i + 1) });
      mk("text", { x: x(last.dose) + 8, y: y(last.drift) + 4, class: "lab" }, g);
    });
    var cross = mk("line", { x1: 0, x2: 0, y1: T, y2: H - B, class: "cross", visibility: "hidden" });
    var tip = el("kg-drift-tip");
    svg.onmousemove = function (e) {
      var r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W;
      var d = Math.max(1, Math.min(doses, Math.round(1 + (px - L) / (W - L - R) * (doses - 1))));
      cross.setAttribute("x1", x(d)); cross.setAttribute("x2", x(d)); cross.setAttribute("visibility", "visible");
      tip.textContent = d + " edit" + (d > 1 ? "s" : "") + ": " + regimes.map(function (g) {
        var p = data.drift[g][d - 1]; return p ? g + " " + p.drift.toFixed(3) + " (−" + Math.round(p.lost) + " +" + Math.round(p.added) + ")" : "";
      }).join(" · ");
    };
    svg.onmouseleave = function () { cross.setAttribute("visibility", "hidden"); tip.textContent = "Hover for the numbers at each dose."; };
    svg.onmouseleave();
  }

  function families() {
    var body = el("kg-families");
    data.families.forEach(function (f) {
      var tr = h("tr");
      tr.appendChild(h("td", null, f.family));
      tr.appendChild(h("td", "muted", f.regime));
      tr.appendChild(h("td", "num", f.harmful + " / " + f.candidates));
      var td = h("td"); td.appendChild(meter(f.max_harm)); tr.appendChild(td);
      tr.title = "Worst: " + f.worst + (f.words ? " (questions in words)" : "");
      body.appendChild(tr);
    });
  }

  fetch("kgattack-data.json").then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    el("kg-budget").max = d.arms[arm].length;
    el("kg-budget").oninput = render;
    arms(); update(); drift(); families();
  });
})();
