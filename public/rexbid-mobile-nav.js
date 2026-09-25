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
  nav.replaceChildren();
  const links = [
    ["Aukcje", "/#results"],
    ["Jak to działa", "/jak-to-dziala.html"],
    ["Ulubione", "/ulubione.html"],
    ["Konto", "/konto.html"],
    ["Kontakt", "/kontakt.html"]
  ];
  for (const [label, href] of links) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    if (label === "Ulubione") {
      const count = document.createElement("span");
      count.dataset.rexbidCount = "favorites";
      count.textContent = "0";
      link.append(" ", count);
    }
    nav.append(link);
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
  document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  document.addEventListener("click", event => {
    if (!header.contains(event.target)) close();
  });
})();
