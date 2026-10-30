// Attacking a knowledge graph through its ontology (kgattack-data.json, exported by kgattack_data.py from
// experiments/whitebox_kg and experiments/threat_levels). Nothing is computed here.
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

  function arms() {
    [["stealthy", "Stealthy: queries still validate"], ["any", "Any edit"]].forEach(function (a) {
      var b = h("button", "tab", a[1]);
      b.type = "button"; b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", a[0] === arm ? "true" : "false");
      b.onclick = function () {
        arm = a[0];
        Array.prototype.forEach.call(el("kg-arms").children, function (c) { c.setAttribute("aria-selected", c === b ? "true" : "false"); });
        render(); levels();
      };
      el("kg-arms").appendChild(b);
    });
  }

  function render() {
    var a = data.arms[arm][+el("kg-budget").value - 1];
    el("kg-budget-out").textContent = a.budget + " edit" + (a.budget > 1 ? "s" : "");
    var bars = el("kg-bars");
    bars.innerHTML = "";
    data.queries.forEach(function (q) {
      var f = a.f1[q.id], d = h("div", "bar" + (f < 1 ? "" : " alt"));
      d.title = q.id.toUpperCase() + ": " + q.label + " (" + q.gold + " answers)";
      d.appendChild(h("span", null, q.id.toUpperCase().replace("Q0", "Q")));
      var i = h("i"); i.style.setProperty("--w", Math.round(f * 100) + "%"); d.appendChild(i);
      d.appendChild(h("b", null, f.toFixed(2)));
      bars.appendChild(d);
    });
    var list = el("kg-mutations");
    list.innerHTML = "";
    a.mutations.forEach(function (m) {
      var li = h("li"); li.appendChild(h("b", null, m.family)); li.appendChild(document.createTextNode(" " + m.target));
      list.appendChild(li);
    });
    el("kg-summary").textContent = "Harm " + a.harm.toFixed(2) + ", answers lost " + a.lost + ", wrong answers added " + a.added + ".";
  }

  function levels() {
    var body = el("kg-levels");
    body.innerHTML = "";
    data.levels[arm].forEach(function (r) {
      var tr = h("tr");
      var name = h("td"); name.appendChild(h("b", null, r.level)); name.appendChild(document.createTextNode(" " + r.name));
      tr.appendChild(name);
      tr.appendChild(h("td", "muted", r.hidden));
      var td = h("td"); td.appendChild(meter(r.true_harm, r.level !== "L0")); tr.appendChild(td);
      tr.title = r.mutations.join("; ") + (r.level === "L0" ? "" : " (the attacker believed " + r.believed_harm.toFixed(2) + ")");
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
    arms(); render(); levels(); drift(); families();
  });
})();
