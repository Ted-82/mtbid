(function (root) {
  "use strict";
  const aliases = new Map([
    ["bev", "BEV"], ["electric", "BEV"], ["battery electric", "BEV"],
    ["battery electric vehicle", "BEV"], ["all electric", "BEV"], ["pure electric", "BEV"],
    ["phev", "PHEV"], ["plug in hybrid", "PHEV"], ["plug-in hybrid", "PHEV"],
    ["hev", "HEV"], ["hybrid", "HEV"], ["hybrid electric", "HEV"], ["electric and gas hybrid", "HEV"], ["mild hybrid", "HEV"],
    ["fcev", "FCEV"], ["hydrogen", "FCEV"], ["fuel cell", "FCEV"],
    ["gasoline", "ICE"], ["petrol", "ICE"], ["diesel", "ICE"], ["flex fuel", "ICE"],
    ["flexfuel", "ICE"], ["natural gas", "ICE"], ["cng", "ICE"], ["lpg", "ICE"], ["combustion", "ICE"]
  ]);
  function normalize(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      value = value.value ?? value.name ?? value.label ?? value.display ?? value.description ?? value.code ?? "";
    }
    const key = String(value ?? "").trim().toLowerCase().replace(/[_.]+/g, " ").replace(/\s+/g, " ");
    return aliases.get(key) || "unknown";
  }
  function classify(vehicle = {}) {
    const description = vehicle.vehicle_description || vehicle.details?.vehicle_description || vehicle.details?.vehicleInformation || {};
    for (const value of [vehicle.fuel_type, vehicle.fuel, vehicle.powertrain, vehicle.engine_type,
      description.FuelTypeDesc, description.FuelType, description.fuel_type,
      description.Powertrain, description.powertrain,
      vehicle.details?.attributes?.FuelType, vehicle.details?.attributes?.FuelTypeDesc]) {
      const result = normalize(value);
      if (result !== "unknown") return result;
    }
    return "unknown";
  }
  const api = Object.freeze({normalize, classify, isConfirmedBev(vehicle) { return classify(vehicle) === "BEV"; }});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RexBidPowertrain = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
