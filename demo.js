// Shows recorded attack-and-defense results (demo-data.json, exported by demo_data.py). Nothing is computed here.
(function () {
  var root = document.getElementById("demo");
  if (!root) return;
  var el = function (id) { return document.getElementById(id); };
  var data, onto = 0;

  function bars(target, rows) {
    target.innerHTML = "";
    rows.forEach(function (r) {
      var d = document.createElement("div");
      d.className = "bar" + (r.alt ? " alt" : "");
      d.innerHTML = "<span></span><i></i><b></b>";
      d.children[0].textContent = r.label;
      d.children[1].style.setProperty("--w", Math.round(r.value * 100) + "%");
      d.children[2].textContent = r.value.toFixed(2);
      target.appendChild(d);
    });
  }

  function render() {
    var o = data.ontologies[onto];
    var a = o.attack[+el("budget").value - 1];
    el("budget-out").textContent = a.budget + " edit" + (a.budget > 1 ? "s" : "");
    bars(el("attack"), [
      { label: "UCT", value: a.uct_mean },
      { label: "beam", value: a.beam },
      { label: "greedy", value: a.greedy, alt: true },
      { label: "random", value: a.random_mean, alt: true },
    ]);
    el("chain").textContent = "best chain: " + a.uct_best_chain.join(" → ");
    var dIndex = +el("locks").value, d = o.defense[dIndex];
    el("locks-out").textContent = d.locks + " lock" + (d.locks === 1 ? "" : "s");
    bars(el("defense"), [
      { label: "none", value: d.none, alt: true },
      { label: "random", value: d.random_mean, alt: true },
      { label: "top impact", value: d.top_impact },
      { label: "best resp.", value: d.best_response },
    ]);
    el("locked").textContent = d.best_response_locks.length
      ? "locked: " + d.best_response_locks.map(function (t) { return t[0] + " ⊑ " + t[2]; }).join(", ")
      : "no triples locked";
  }

  fetch("demo-data.json").then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    el("locks").max = d.ontologies[0].defense.length - 1;
    d.ontologies.forEach(function (o, i) {
      var b = document.createElement("button");
      b.className = "tab"; b.setAttribute("role", "tab"); b.textContent = o.name;
      b.setAttribute("aria-selected", i === 0 ? "true" : "false");
      b.onclick = function () {
        onto = i;
        Array.prototype.forEach.call(el("tabs").children, function (c, j) { c.setAttribute("aria-selected", j === i ? "true" : "false"); });
        render();
      };
      el("tabs").appendChild(b);
    });
    el("budget").oninput = render; el("locks").oninput = render;
    render();
  });
})();
