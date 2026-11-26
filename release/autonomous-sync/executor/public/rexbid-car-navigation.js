(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RexBidCarNavigation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CALCULATOR_HASH = "#importCalculator";

  function safeLocalReturnPath(value) {
    const fallback = "/?catalog=1#results";
    if (typeof value === 'string' && /^\/porownaj(?:\.html)?\?/.test(value) && value.length <= 512 && !/[\\\u0000-\u001f\u007f]/.test(value)) {
      try {
        const url = new URL(value, 'https://rexbid.pl'), items = url.searchParams.get('items');
        if (url.origin === 'https://rexbid.pl' && ['/porownaj','/porownaj.html'].includes(url.pathname) && !url.hash
          && [...url.searchParams.keys()].length === 1 && items && !/[\u0000-\u001f\u007f]/.test(items) && /^(copart|iaai):\d{1,12}(,(copart|iaai):\d{1,12}){0,2}$/.test(items))
          return '/porownaj.html?items=' + encodeURIComponent([...new Set(items.split(','))].join(','));
      } catch (_) { /* Fall through to the catalog default. */ }
      return fallback;
    }
    if (typeof value !== "string" || value.length > 4096 || /[\\\u0000-\u001f\u007f]/.test(value)
      || !/^\/(?:index\.html)?(?:\?|$)/.test(value)) return fallback;
    try {
      const url = new URL(value, "https://rexbid.pl");
      if (url.origin !== "https://rexbid.pl" || !["/", "/index.html"].includes(url.pathname)
        || url.searchParams.getAll("catalog").length !== 1 || url.searchParams.get("catalog") !== "1") return fallback;
      for (const [key, item] of url.searchParams) {
        if (key.length > 80 || item.length > 1000 || /[\\\u0000-\u001f\u007f]/.test(key + item)) return fallback;
      }
      url.searchParams.delete("cursor");
      return url.pathname + "?" + url.searchParams.toString() + "#results";
    } catch (_) { return fallback; }
  }

  function scrollCalculatorIntoView(documentRef, behavior = "smooth") {
    const target = documentRef?.getElementById?.("importCalculator");
    if (!target || typeof target.scrollIntoView !== "function") return false;
    target.scrollIntoView({ behavior, block: "start", inline: "nearest" });
    return true;
  }

  function placeCalculatorAfterVehicleDetails(documentRef) {
    const panel = documentRef?.getElementById?.("importCalculator");
    const vehicleDetails = documentRef?.querySelector?.(".primary-auction > #vehicleKeyDetails");
    if (!panel || !vehicleDetails || typeof vehicleDetails.after !== "function") return false;
    vehicleDetails.after(panel);
    return true;
  }

  function restoreCalculatorHash(documentRef, windowRef) {
    if (windowRef?.location?.hash !== CALCULATOR_HASH) return false;
    const requestFrame = typeof windowRef.requestAnimationFrame === "function"
      ? windowRef.requestAnimationFrame.bind(windowRef)
      : callback => callback();
    // The page and calculator mount are built asynchronously after the browser
    // may already have processed the initial fragment identifier.
    requestFrame(() => requestFrame(() => scrollCalculatorIntoView(documentRef)));
    return true;
  }

  function bindCalculatorNavigation(documentRef, windowRef) {
    if (!documentRef?.addEventListener || !windowRef?.history?.pushState) return () => {};
    const onClick = event => {
      const link = event.target?.closest?.('a[href="#importCalculator"]');
      if (!link || !documentRef.getElementById?.("importCalculator")) return;
      event.preventDefault?.();
      if (windowRef.location?.hash !== CALCULATOR_HASH) {
        windowRef.history.pushState(null, "", CALCULATOR_HASH);
      }
      restoreCalculatorHash(documentRef, windowRef);
    };
    documentRef.addEventListener("click", onClick);
    return () => documentRef.removeEventListener?.("click", onClick);
  }

  return Object.freeze({ safeLocalReturnPath, bindCalculatorNavigation, placeCalculatorAfterVehicleDetails, restoreCalculatorHash, scrollCalculatorIntoView });
});
