// The Aegis playground: attack a small ontology, find the damage, and roll back, in the browser.
// A port of the toy of examples/attack_and_recover.py: ontology and actions, workload F1 and harm, per-action attribution,
// the versioned log with rollback and last-healthy, and the library's greedy and beam attack searches. The page's tests
// recompute the impacts, the candidate units, the searches, and 40 random chains against the Python (playground-data.json).
var AE = (function () {
  var SUB = "subClassOf";
  var cmp = function (a, b) { return a < b ? -1 : a > b ? 1 : 0; };
  var cmpRel = function (a, b) { return cmp(a[0], b[0]) || cmp(a[1], b[1]) || cmp(a[2], b[2]); };
  var rkey = function (r) { return r.join("\u0001"); };
  function Ont(concepts, relations) { this.concepts = new Set(concepts); this.relations = new Map(); (relations || []).forEach(function (r) { this.relations.set(rkey(r), r); }, this); }
  Ont.prototype.has = function (r) { return this.relations.has(rkey(r)); };
  Ont.prototype.rels = function () { return Array.from(this.relations.values()).sort(cmpRel); };
  Ont.prototype.cs = function () { return Array.from(this.concepts).sort(cmp); };
  Ont.prototype.incident = function (c) { return this.rels().filter(function (r) { return r[0] === c || r[2] === c; }); };
  Ont.prototype.without = function (c) { var inc = new Set(this.incident(c).map(rkey)); return new Ont(Array.from(this.concepts).filter(function (x) { return x !== c; }), this.rels().filter(function (r) { return !inc.has(rkey(r)); })); };
  Ont.prototype.withoutRel = function (r) { var k = rkey(r); return new Ont(this.concepts, this.rels().filter(function (x) { return rkey(x) !== k; })); };
  Ont.prototype.withConcept = function (c) { return new Ont(Array.from(this.concepts).concat([c]), this.rels()); };
  Ont.prototype.withRel = function (r) { return new Ont(this.concepts, this.rels().concat([r])); };
  Ont.prototype.descendants = function (c) {
    var found = new Set([c]), frontier = new Set([c]), rels = this.rels();
    while (frontier.size) { var next = new Set(); rels.forEach(function (r) { if (r[1] === SUB && frontier.has(r[2]) && !found.has(r[0])) next.add(r[0]); }); next.forEach(function (x) { found.add(x); }); frontier = next; }
    return found;
  };
  // examples/attack_and_recover.py: every concept that reaches `root` through subClassOf (the root itself only through a cycle)
  Ont.prototype.subclasses = function (root) {
    var found = new Set(), frontier = new Set([root]), rels = this.rels();
    while (frontier.size) { var next = new Set(); rels.forEach(function (r) { if (r[1] === SUB && frontier.has(r[2]) && !found.has(r[0])) next.add(r[0]); }); next.forEach(function (x) { found.add(x); }); frontier = next; }
    return found;
  };
  Ont.prototype.digest = function () { return JSON.stringify([this.cs(), this.rels()]); };
  function InvalidAction(msg) { this.message = msg; this.name = "InvalidAction"; }
  var act = function (op, target) { return { op: op, target: target }; };
  var tup = function (t) { return "(" + t.map(function (x) { return "'" + x + "'"; }).join(", ") + ")"; };
  var str = function (a) { return a.op + "(" + (typeof a.target === "string" ? a.target : tup(a.target)) + ")"; };
  function applyAction(o, a) {
    var t = a.target;
    if (a.op === "remove_concept") { if (!o.concepts.has(t)) throw new InvalidAction("remove_concept(" + t + "): no such concept"); return [o.without(t), [act("inject_concept", t)].concat(o.incident(t).map(function (r) { return act("inject_relation", r); }))]; }
    if (a.op === "remove_relation") { if (!o.has(t)) throw new InvalidAction("remove_relation" + tup(t) + ": no such relation"); return [o.withoutRel(t), [act("inject_relation", t)]]; }
    if (a.op === "inject_concept") { if (o.concepts.has(t)) throw new InvalidAction("inject_concept(" + t + "): concept already exists"); return [o.withConcept(t), [act("remove_concept", t)]]; }
    if (a.op === "inject_relation") {
      if (o.has(t)) throw new InvalidAction("inject_relation" + tup(t) + ": relation already exists");
      if (!o.concepts.has(t[0]) || !o.concepts.has(t[2])) throw new InvalidAction("inject_relation" + tup(t) + ": endpoint concept missing");
      return [o.withRel(t), [act("remove_relation", t)]];
    }
    throw new InvalidAction("unknown action " + a.op);
  }
  function applyChain(o, chain) { chain.forEach(function (a) { o = applyAction(o, a)[0]; }); return o; }
  // The workload: queries "What kinds of X are there?", answered by every concept below the root through subClassOf
  function Workload(spec) { this.queries = Object.keys(spec); this.spec = spec; }
  Workload.prototype.result = function (o, q) { return o.subclasses(this.spec[q].root); };
  function f1(pred, gold) {
    var p = new Set(pred), g = new Set(gold);
    if (!p.size && !g.size) return 1.0;
    var hits = 0; p.forEach(function (x) { if (g.has(x)) hits++; });
    if (hits === 0) return 0.0;
    var pr = hits / p.size, rc = hits / g.size; return 2 * pr * rc / (pr + rc);
  }
  Workload.prototype.score = function (o, q) { return f1(this.result(o, q), this.spec[q].gold); };
  Workload.prototype.mean = function (o) { var self = this; return this.queries.reduce(function (s, q) { return s + self.score(o, q); }, 0) / this.queries.length; };
  Workload.prototype.harm = function (before, after) { var self = this; return this.queries.reduce(function (s, q) { return s + (self.score(before, q) - self.score(after, q)); }, 0) / this.queries.length; };
  Workload.prototype.attribute = function (o, chain) {
    var steps = [], state = o, self = this;
    chain.forEach(function (a) {
      var next = applyAction(state, a)[0], size = 0, per = {};
      self.queries.forEach(function (q) {
        var old = self.result(state, q), nw = self.result(next, q), added = [], removed = [];
        nw.forEach(function (x) { if (!old.has(x)) added.push(x); }); old.forEach(function (x) { if (!nw.has(x)) removed.push(x); });
        if (added.length || removed.length) { per[q] = { added: added.sort(), removed: removed.sort() }; size += added.length + removed.length; }
      });
      steps.push({ action: a, size: size, affected: per }); state = next;
    });
    return steps;
  };
  function netDelta(before, after) {
    var removedC = new Set(Array.from(before.concepts).filter(function (c) { return !after.concepts.has(c); }));
    var removedR = before.rels().filter(function (r) { return !after.has(r) && !removedC.has(r[0]) && !removedC.has(r[2]); });
    var chain = removedR.map(function (r) { return act("remove_relation", r); });
    chain = chain.concat(Array.from(removedC).sort(cmp).map(function (c) { return act("remove_concept", c); }));
    chain = chain.concat(after.cs().filter(function (c) { return !before.concepts.has(c); }).map(function (c) { return act("inject_concept", c); }));
    return chain.concat(after.rels().filter(function (r) { return !before.has(r); }).map(function (r) { return act("inject_relation", r); }));
  }
  function minimize(o, chain) { return netDelta(o, applyChain(o, chain)); }
  // Versioned ontology: a log of actions with their undo, rollback truncates it
  function Versioned(base) { this.state = base; this.log = []; }
  Versioned.prototype.lsn = function () { return this.log.length ? this.log[this.log.length - 1].lsn : 0; };
  Versioned.prototype.apply = function (a) {
    var before = this.state.digest(), r = applyAction(this.state, a); this.state = r[0];
    var rec = { lsn: this.lsn() + 1, action: a, undo: r[1], before: before, after: this.state.digest() }; this.log.push(rec); return rec;
  };
  Versioned.prototype.applyChain = function (chain) { var start = this.lsn(); try { return chain.map(this.apply, this); } catch (e) { this.rollbackTo(start); throw e; } };
  Versioned.prototype.rollbackTo = function (lsn) {
    while (this.log.length && this.log[this.log.length - 1].lsn > lsn) { var rec = this.log.pop(); rec.undo.forEach(function (u) { this.state = applyAction(this.state, u)[0]; }, this); }
  };
  function lastHealthy(v, healthy) {
    var state = v.state; if (healthy(state)) return v.lsn();
    for (var i = v.log.length - 1; i >= 0; i--) { var rec = v.log[i]; rec.undo.forEach(function (u) { state = applyAction(state, u)[0]; }); if (healthy(state)) return rec.lsn - 1; }
    return null;
  }
  // Impact and the attack search (aegis.impact, aegis.attacks)
  function conceptImpact(w, o) { var base = w.mean(o), out = {}; o.cs().forEach(function (c) { out[c] = base - w.mean(o.without(c)); }); return out; }
  function relationImpact(w, o) { var base = w.mean(o), out = []; o.rels().forEach(function (r) { out.push([r, base - w.mean(o.withoutRel(r))]); }); return out; }
  function candidateUnits(o, cd, rd, top) {
    top = top || 5;
    var concepts = o.cs().sort(function (a, b) { return -(cd[a] || 0) - -(cd[b] || 0); }).slice(0, top);
    var dmap = new Map(rd.map(function (x) { return [rkey(x[0]), x[1]]; }));
    var relations = o.rels().sort(function (a, b) { return -(dmap.get(rkey(a)) || 0) - -(dmap.get(rkey(b)) || 0); }).slice(0, top);
    var targets = o.cs(), units = relations.map(function (r) { return [act("remove_relation", r)]; });
    units = units.concat(concepts.map(function (c) { return [act("remove_concept", c)]; }));
    relations.forEach(function (r) {
      if (r[1] !== SUB) return;
      var below = o.descendants(r[0]);
      targets.forEach(function (t) { if (t !== r[2] && !below.has(t) && !o.has([r[0], r[1], t])) units.push([act("remove_relation", r), act("inject_relation", [r[0], r[1], t])]); });
    });
    return units;
  }
  function Search(w, o) { this.w = w; this.o = o; this.cache = new Map(); }
  Search.prototype.extend = function (chain, unit) {
    var cand = chain.concat(unit), after;
    try { after = applyChain(this.o, cand); } catch (e) { if (e instanceof InvalidAction) return null; throw e; }
    var k = after.digest(); if (!this.cache.has(k)) this.cache.set(k, this.w.harm(this.o, after));
    return [cand, this.cache.get(k)];
  };
  function greedy(w, o, units, budget) {
    var s = new Search(w, o), chain = [], best = 0;
    for (;;) {
      var options = []; units.forEach(function (u) { if (chain.length + u.length <= budget) { var r = s.extend(chain, u); if (r) options.push(r); } });
      if (!options.length) break;
      var top = options.reduce(function (m, r) { return r[1] > m[1] ? r : m; });
      if (top[1] <= best) break;
      chain = top[0]; best = top[1];
    }
    return { chain: minimize(o, chain), harm: best, evaluations: s.cache.size };
  }
  function beam(w, o, units, budget, width, k) {
    width = width || 4; k = k || 3;
    var s = new Search(w, o), frontier = [[[], 0]], found = new Map();
    while (frontier.length) {
      var expanded = [];
      frontier.forEach(function (f) {
        units.forEach(function (u) {
          if (f[0].length + u.length > budget) return;
          var r = s.extend(f[0], u); if (!r) return; expanded.push(r);
          var net = minimize(o, r[0]), key = applyChain(o, net).digest();
          if (r[1] > 0 && (!found.has(key) || net.length < found.get(key).chain.length)) found.set(key, { chain: net, harm: r[1] });
        });
      });
      expanded.sort(function (a, b) { return (b[1] - a[1]) || (a[0].length - b[0].length); });
      frontier = expanded.slice(0, width);
    }
    return Array.from(found.values()).sort(function (a, b) { return (b.harm - a.harm) || (a.chain.length - b.chain.length); }).slice(0, k).map(function (x) { return { chain: x.chain, harm: x.harm, evaluations: s.cache.size }; });
  }
  return { Ont: Ont, Workload: Workload, Versioned: Versioned, InvalidAction: InvalidAction, act: act, str: str, applyAction: applyAction, applyChain: applyChain, minimize: minimize, lastHealthy: lastHealthy,
    conceptImpact: conceptImpact, relationImpact: relationImpact, candidateUnits: candidateUnits, greedy: greedy, beam: beam, f1: f1 };
})();

(async function () {
  var root = document.getElementById("eplay");
  if (!root) return;
  var h = PG.h, data = await fetch("playground-data.json").then(function (r) { return r.json(); });
  var base = new AE.Ont(data.ontology.concepts, data.ontology.relations), wl = new AE.Workload(data.workload), v, STORAGE = "aegis-playground";
  var healthy = function (o) { var d = o.subclasses("Material"); return ["Metal", "Alloy", "Steel"].every(function (c) { return d.has(c); }); };
  var out = { tree: h("div", { id: "ep-tree" }), damage: h("div", { id: "ep-damage" }), recover: h("div", { id: "ep-recover" }), search: h("div", { id: "ep-search" }), msg: h("p", { class: "pg-note", id: "ep-msg", role: "status" }) };
  var compare = 0;

  function fresh() { v = new AE.Versioned(base); compare = 0; }
  function save() { try { localStorage.setItem(STORAGE, JSON.stringify(v.log.map(function (r) { return r.action; }))); } catch (e) { /* storage may be off */ } }
  function restore() { fresh(); try { (JSON.parse(localStorage.getItem(STORAGE) || "[]") || []).forEach(function (a) { try { v.apply(a); } catch (e) { /* skip a stale action */ } }); } catch (e) { /* ignore */ } }
  function run(a) { try { v.apply(a); out.msg.textContent = ""; save(); render(); } catch (e) { out.msg.textContent = e.message || String(e); } }
  function runChain(chain) { try { v.applyChain(chain); out.msg.textContent = ""; save(); render(); } catch (e) { out.msg.textContent = (e.message || String(e)) + " The chain was not applied (it is all or nothing)."; render(); } }

  var op = h("select", { id: "ep-op", "aria-label": "Edit" }, [["remove_concept", "Remove a concept"], ["remove_relation", "Remove a relation"], ["inject_concept", "Add a concept"], ["inject_relation", "Add a relation"]].map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
  var f1i = h("input", { type: "text", id: "ep-a", placeholder: "concept or subject", autocomplete: "off", "aria-label": "First field" });
  var f2i = h("input", { type: "text", id: "ep-p", value: "subClassOf", autocomplete: "off", "aria-label": "Predicate" });
  var f3i = h("input", { type: "text", id: "ep-o", placeholder: "object", autocomplete: "off", "aria-label": "Object" });
  function fields() { var rel = /relation/.test(op.value); f2i.hidden = !rel; f3i.hidden = !rel; f1i.placeholder = rel ? "subject" : "concept"; }
  op.onchange = fields;
  function apply() { var a = f1i.value.trim(), t = /relation/.test(op.value) ? [a, f2i.value.trim(), f3i.value.trim()] : a; if (!a) { out.msg.textContent = "Name the concept or relation to edit."; return; } run(AE.act(op.value, t)); }

  function treeOf(o) {
    var rels = o.rels().filter(function (r) { return r[1] === "subClassOf"; }), kids = {}, hasParent = new Set(), impact = AE.conceptImpact(wl, base);
    rels.forEach(function (r) { (kids[r[2]] = kids[r[2]] || []).push(r[0]); hasParent.add(r[0]); });
    function node(c, seen) {
      var d = impact[c], el = h("li", {}, h("span", { class: "cn" + (base.concepts.has(c) ? "" : " injected") + (d > 0 ? " hot" : "") }, c, d !== undefined ? h("small", { text: "Δ " + d.toFixed(2) }) : null));
      var ch = (kids[c] || []).slice().sort(); if (ch.length && seen.indexOf(c) < 0) el.append(h("ul", {}, ch.map(function (x) { return node(x, seen.concat([c])); })));
      return el;
    }
    var roots = o.cs().filter(function (c) { return !hasParent.has(c); });
    var other = o.rels().filter(function (r) { return r[1] !== "subClassOf"; }), gone = base.rels().filter(function (r) { return !o.has(r); });
    return h("div", {}, h("ul", { class: "tree" }, roots.map(function (c) { return node(c, []); })),
      other.map(function (r) { return h("div", { class: "rel", text: r.join(" ") }); }),
      gone.map(function (r) { return h("div", { class: "rel gone", title: "removed from the original", text: r.join(" ") }); }));
  }
  function render() {
    var o = v.state, lsn = v.lsn();
    if (compare > lsn) compare = lsn;
    // replay the log up to `compare` to get the baseline state
    var ref = base; v.log.forEach(function (r) { if (r.lsn <= compare) ref = AE.applyAction(ref, r.action)[0]; });
    out.tree.replaceChildren(treeOf(o));
    var rows = wl.queries.map(function (q) { var res = Array.from(wl.result(o, q)).sort(); return h("tr", {}, h("td", { text: q }), h("td", { class: "mono", text: res.join(", ") || "–" }), h("td", { class: "num f1", text: wl.score(ref, q).toFixed(3) }), h("td", { class: "num f1", text: wl.score(o, q).toFixed(3) })); });
    var steps = wl.attribute(ref, v.log.filter(function (r) { return r.lsn > compare; }).map(function (r) { return r.action; }));
    var pick = h("select", { id: "ep-compare", "aria-label": "Compare against" }, [h("option", { value: 0, text: "the original ontology (lsn 0)" })].concat(v.log.map(function (r) { return h("option", { value: r.lsn, text: "after lsn " + r.lsn + ": " + AE.str(r.action) }); })));
    pick.value = String(compare); pick.onchange = function () { compare = +pick.value; render(); };
    out.damage.replaceChildren(h("div", { class: "pg-row" }, h("label", { for: "ep-compare" }, "Compare against "), pick),
      h("div", { class: "pg-scroll" }, h("table", { class: "pg-table" }, h("thead", {}, h("tr", {}, ["Query", "Returns now", "F1 then", "F1 now"].map(function (t, i) { return h("th", { scope: "col", class: i > 1 ? "num" : "", text: t }); }))), h("tbody", {}, rows))),
      h("p", { class: "pg-line" }, "Workload harm: ", h("b", { id: "ep-harm", text: wl.harm(ref, o).toFixed(4) }), " (the mean F1 drop over the two queries)."),
      steps.length ? h("div", {}, h("h4", { text: "Which action did what" }), h("ol", { class: "chain" }, steps.map(function (s) { return h("li", {}, AE.str(s.action), " → ", h("b", { text: s.size }), " result elements affected"); }))) : h("p", { class: "pg-note", text: "No edits after this position." }));
    var ok = healthy(o), lh = AE.lastHealthy(v, healthy);
    var rb = h("button", { type: "button", class: "btn solid", id: "ep-rollback", disabled: lh === null || lh >= lsn, onclick: function () { v.rollbackTo(lh); save(); render(); } }, lh !== null && lh < lsn ? "Roll back to lsn " + lh : "Nothing to roll back");
    out.recover.replaceChildren(h("p", { class: "pg-line" }, "Health check: Metal, Alloy, and Steel are all still under Material. ", h("span", { class: "pg-tag " + (ok ? "ok" : "bad"), id: "ep-health", text: ok ? "healthy" : "unhealthy" })),
      h("p", { class: "pg-line" }, "Last healthy state: ", h("b", { id: "ep-lh", text: lh === null ? "none" : "lsn " + lh }), lh !== null && lh < lsn ? ", so the actions after it are the damage." : "."), h("div", { class: "pg-row" }, rb),
      h("div", { class: "pg-scroll" }, h("table", { class: "pg-table" }, h("thead", {}, h("tr", {}, ["lsn", "action", "undo"].map(function (t) { return h("th", { scope: "col", text: t }); }))),
        h("tbody", {}, v.log.map(function (r) { return h("tr", {}, h("td", { text: r.lsn }), h("td", { text: AE.str(r.action) }), h("td", { text: r.undo.map(AE.str).join("; ") })); })))));
  }
  var budget = h("select", { id: "ep-budget", "aria-label": "Budget" }, [1, 2, 3, 4].map(function (b) { return h("option", { value: b, selected: b === 2, text: b + (b > 1 ? " edits" : " edit") }); }));
  var strat = h("select", { id: "ep-strategy", "aria-label": "Search" }, [["beam", "Beam search"], ["greedy", "Greedy"]].map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
  function find() {
    var o = v.state, cd = AE.conceptImpact(wl, o), rd = AE.relationImpact(wl, o), units = AE.candidateUnits(o, cd, rd, 5), b = +budget.value;
    var found = strat.value === "greedy" ? [AE.greedy(wl, o, units, b)] : AE.beam(wl, o, units, b, 4, 3);
    out.search.replaceChildren(found.length && found[0].chain.length ? h("div", {}, found.map(function (s, i) { return h("div", { class: "pg-row" }, h("span", { class: "chain", text: s.chain.map(AE.str).join(", then ") }), h("span", { class: "pg-tag", text: "harm " + s.harm.toFixed(2) }),
      h("button", { type: "button", class: "btn", onclick: function () { runChain(s.chain); } }, "Apply this attack")); }), h("p", { class: "pg-note", text: found[0].evaluations + " harm evaluations. The search is the library's: candidate units from the most-depended-on concepts and relations, then " + (strat.value === "greedy" ? "greedy" : "beam search of width 4") + "." })) : h("p", { class: "pg-note", text: "No edit within this budget does any harm." }));
  }
  var EXAMPLE = [AE.act("remove_relation", ["Metal", "subClassOf", "Material"]), AE.act("inject_relation", ["Metal", "subClassOf", "Temperature"]), AE.act("inject_concept", "Metall"), AE.act("inject_relation", ["Metall", "subClassOf", "Material"])];

  root.className = "pg";
  root.replaceChildren(
    h("div", { class: "pg-panel" }, h("h3", { text: "1. The ontology" }), h("p", { class: "pg-sub", text: "A small materials ontology. Each concept shows its impact Δ: how much the two queries' F1 drops if it is removed. Dashed concepts were injected; struck-through relations were removed." }), out.tree),
    h("div", { class: "pg-panel" }, h("h3", { text: "2. Edit it, or attack it" }), h("p", { class: "pg-sub", text: "Every edit is a logged transaction with its undo. Make one yourself, run the example attack, or let the library's search find the worst chain." }),
      h("div", { class: "pg-row" }, op, f1i, f2i, f3i, h("button", { type: "button", class: "btn solid", id: "ep-apply", onclick: apply }, "Apply the edit")),
      h("div", { class: "pg-row" }, h("button", { type: "button", class: "btn", id: "ep-honest", onclick: function () { runChain([AE.act("inject_concept", "Ceramic"), AE.act("inject_relation", ["Ceramic", "subClassOf", "Material"])]); } }, "An honest edit: add Ceramic"),
        h("button", { type: "button", class: "btn", id: "ep-example", onclick: function () { runChain(EXAMPLE); } }, "The example attack"), h("button", { type: "button", class: "btn", id: "ep-reset", onclick: function () { fresh(); save(); out.msg.textContent = ""; out.search.replaceChildren(); render(); } }, "Start over")), out.msg,
      h("div", { class: "pg-row" }, h("label", { for: "ep-strategy" }, "Find the worst chain with "), strat, h("label", { for: "ep-budget" }, "within "), budget, h("button", { type: "button", class: "btn", id: "ep-find", onclick: find }, "Search")), out.search),
    h("div", { class: "pg-panel" }, h("h3", { text: "3. The damage" }), out.damage),
    h("div", { class: "pg-panel" }, h("h3", { text: "4. Recovery" }), h("p", { class: "pg-sub", text: "Find the newest healthy state in the log and roll back to it. An honest edit made before the attack is kept." }), out.recover));
  fields(); restore(); render();
  window.__ae = { AE: AE, data: data };
})();
