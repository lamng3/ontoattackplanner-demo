// Shows recorded attack search results (demo-data.json, exported by demo_data.py). Nothing is computed here.
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
  }

  fetch("demo-data.json").then(function (r) { return r.json(); }).then(function (d) {
    data = d;
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
    el("budget").oninput = render;
    render();
  });
})();
