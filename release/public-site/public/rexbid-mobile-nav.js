(() => {
  const header = document.querySelector("header");
  if (!header) return;

  const wrapper = header.querySelector(".header-inner, .header") || header.firstElementChild || header;
  let nav = header.querySelector("nav");
  if (!nav) {
    nav = document.createElement("nav");
    wrapper.append(nav);
  }
  header.querySelectorAll("nav").forEach(item => { if (item !== nav) item.remove(); });

  nav.classList.add("rex-primary-nav");
  nav.setAttribute("aria-label", "Nawigacja główna");
  const links = [
    ["Aukcje", "/?catalog=1#results"],
    ["Jak to działa", "/jak-to-dziala"],
    ["Ulubione", "/ulubione"],
    ["Konto", "/konto"],
    ["Pomoc", "/pomoc"],
    ["Kontakt", "/kontakt"]
  ];
  const catalogOnly = document.documentElement?.dataset?.rexbidPublicationPhase === "catalog";
  const visibleLinks = links.filter(([,href]) => !catalogOnly || href !== "/konto");
  // The build emits the final menu in HTML. Reuse it so first paint, focus and
  // layout stay stable; rebuild only for a legacy/unrecognised shell.
  if (catalogOnly) nav.querySelectorAll('a[href="/konto"],a[href="/konto.html"]').forEach(link => link.remove());
  const existing = Array.from(nav.querySelectorAll('a'));
  const reuse = existing.length === visibleLinks.length && existing.every((a,i) => a.getAttribute('href') === visibleLinks[i][1]);
  if (!reuse) nav.replaceChildren();
  let linkIndex = 0;
  for (const [label, href] of links) {
    // The publication wrapper removes unlaunched account links server-side.
    // Keep the same scope when rebuilding navigation after DOM bootstrap.
    if (catalogOnly && href === "/konto") continue;
    const link = reuse ? existing[linkIndex++] : document.createElement("a");
    if (!reuse) { link.href = href; link.textContent = label; }
    const current = window.location.pathname.replace(/\.html$/, "");
    const target = new URL(href, window.location.origin).pathname.replace(/\.html$/, "");
    if (current === target || (target === "/" && current === "/index")) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
    if (label === "Ulubione" && !link.querySelector('[data-rexbid-count="favorites"]')) {
      const count = document.createElement("span");
      count.dataset.rexbidCount = "favorites";
      count.textContent = "0";
      link.append(" ", count);
    }
    if (!reuse) nav.append(link);
  }

  let toggle = header.querySelector(".rex-menu-toggle");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.className = "rex-menu-toggle";
    toggle.type = "button";
    toggle.textContent = "☰";
    toggle.setAttribute("aria-label", "Otwórz menu główne");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "rexPrimaryNav");
    wrapper.insertBefore(toggle, nav);
  }
  nav.id = "rexPrimaryNav";
  window.RexBidStorage?.refreshCounts?.();

  const close = () => {
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Otwórz menu główne");
  };
  toggle.addEventListener("click", () => {
    const open = !nav.classList.contains("is-open");
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Zamknij menu główne" : "Otwórz menu główne");
  });
  nav.addEventListener("click", event => { if (event.target.closest("a")) close(); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && nav.classList.contains("is-open")) { close(); toggle.focus(); }
  });
  document.addEventListener("click", event => {
    if (!header.contains(event.target)) close();
  });
})();
