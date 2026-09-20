const APIBARA_BASE =
  "https://apibara.tech/api/v1/vehicle-auction";

const DEMO_CARS = [
  {
    vin: "1FMCU9GDXMUA10001",
    year: 2021,
    make: "Ford",
    model: "Escape",
    title: "2021 Ford Escape",
    platform: "COPART",
    price: 8500,
    mileage: "52,341 mi",
    damage: "Front End",
    location: "USA",
    lot: "10001",
    transmission: "Automatic",
    fuel_type: "Gasoline",
    drive_type: "AWD",
    engine: "1.5L",
    body_type: "SUV",
    color: "White"
  },
  {
    vin: "1C4RJFBG8LC200002",
    year: 2020,
    make: "Jeep",
    model: "Grand Cherokee",
    title: "2020 Jeep Grand Cherokee",
    platform: "IAAI",
    price: 11200,
    mileage: "68,120 mi",
    damage: "Side",
    location: "USA",
    lot: "20002",
    transmission: "Automatic",
    fuel_type: "Gasoline",
    drive_type: "4WD",
    engine: "3.6L",
    body_type: "SUV",
    color: "Black"
  },
  {
    vin: "1HGCV1F34LA300003",
    year: 2020,
    make: "Honda",
    model: "Accord",
    title: "2020 Honda Accord",
    platform: "COPART",
    price: 9800,
    mileage: "45,600 mi",
    damage: "Rear End",
    location: "USA",
    lot: "30003",
    transmission: "Automatic",
    fuel_type: "Gasoline",
    drive_type: "FWD",
    engine: "1.5L",
    body_type: "Sedan",
    color: "Gray"
  },
  {
    vin: "5YFB4MDE2LP400004",
    year: 2020,
    make: "Toyota",
    model: "Corolla",
    title: "2020 Toyota Corolla",
    platform: "IAAI",
    price: 7600,
    mileage: "39,400 mi",
    damage: "Front End",
    location: "USA",
    lot: "40004",
    transmission: "Automatic",
    fuel_type: "Gasoline",
    drive_type: "FWD",
    engine: "1.8L",
    body_type: "Sedan",
    color: "Red"
  },
  {
    vin: "1G1ZD5ST5LF500005",
    year: 2020,
    make: "Chevrolet",
    model: "Malibu",
    title: "2020 Chevrolet Malibu",
    platform: "COPART",
    price: 6900,
    mileage: "61,200 mi",
    damage: "Hail",
    location: "USA",
    lot: "50005",
    transmission: "Automatic",
    fuel_type: "Gasoline",
    drive_type: "FWD",
    engine: "1.5L",
    body_type: "Sedan",
    color: "Silver"
  },
  {
    vin: "WBA5R1C04LF600006",
    year: 2020,
    make: "BMW",
    model: "530i",
    title: "2020 BMW 530i",
    platform: "IAAI",
    price: 15400,
    mileage: "48,900 mi",
    damage: "Front End",
    location: "USA",
    lot: "60006",
    transmission: "Automatic",
    fuel_type: "Gasoline",
    drive_type: "RWD",
    engine: "2.0L Turbo",
    body_type: "Sedan",
    color: "Black"
  }
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    }
  });
}

function demoResponse(search = "") {
  let data = DEMO_CARS;

  if (search) {
    const q = search.toLowerCase();

    data = DEMO_CARS.filter(car =>
      String(car.vin).toLowerCase().includes(q) ||
      String(car.lot).toLowerCase().includes(q) ||
      String(car.make).toLowerCase().includes(q) ||
      String(car.model).toLowerCase().includes(q) ||
      String(car.title).toLowerCase().includes(q)
    );
  }

  return json({
    ok: true,
    data,
    demo: true
  });
}

async function apiBara(request, env) {
  if (!env.APIBARA_API_KEY) {
    return demoResponse(
      new URL(request.url).searchParams.get("s") || ""
    );
  }

  const incoming = new URL(request.url);
  const apiUrl = new URL(
    APIBARA_BASE + "/vehicles"
  );

  const allowedParams = [
    "s",
    "platform",
    "auction_type",
    "lot_status",
    "lot_sub_status",
    "upcoming",
    "make",
    "model",
    "type",
    "year_from",
    "year_to",
    "price_min",
    "price_max",
    "odometer_from",
    "odometer_to",
    "fuel_type",
    "transmission",
    "drive_type",
    "run_cond",
    "color",
    "per_page",
    "cursor"
  ];

  for (const name of allowedParams) {
    const value = incoming.searchParams.get(name);

    if (value !== null && value !== "") {
      apiUrl.searchParams.set(name, value);
    }
  }

  if (!apiUrl.searchParams.has("per_page")) {
    apiUrl.searchParams.set("per_page", "20");
  }

  const response = await fetch(apiUrl.toString(), {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "X-API-Key": env.APIBARA_API_KEY
    }
  });

  const text = await response.text();

  let result;

  try {
    result = JSON.parse(text);
  } catch {
    return json(
      {
        ok: false,
        error: "Nieprawidłowa odpowiedź APIbara"
      },
      502
    );
  }

  if (!response.ok) {
    return json(
      {
        ok: false,
        error:
          result.message ||
          "APIbara zwróciło błąd",
        status: response.status,
        details: result.errors || null
      },
      response.status
    );
  }

  return json({
    ok: true,
    data: Array.isArray(result.data)
      ? result.data
      : [],
    meta: result.meta || null,
    demo: false
  });
}

async function singleVehicle(request, env, identifier) {
  if (!env.APIBARA_API_KEY) {
    return demoResponse(identifier);
  }

  const apiUrl =
    APIBARA_BASE +
    "/vehicles/" +
    encodeURIComponent(identifier);

  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "X-API-Key": env.APIBARA_API_KEY
    }
  });

  const text = await response.text();

  let result;

  try {
    result = JSON.parse(text);
  } catch {
    return json(
      {
        ok: false,
        error: "Nieprawidłowa odpowiedź APIbara"
      },
      502
    );
  }

  if (!response.ok) {
    return json(
      {
        ok: false,
        error:
          result.message ||
          "Nie udało się pobrać samochodu z APIbara",
        status: response.status
      },
      response.status
    );
  }

  const car =
    result.data && !Array.isArray(result.data)
      ? result.data
      : Array.isArray(result.data)
        ? result.data[0]
        : null;

  if (!car) {
    return json({
      ok: true,
      data: [],
      demo: false
    });
  }

  return json({
    ok: true,
    data: [car],
    demo: false
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /*
     * API MTBID
     */

    if (url.pathname === "/api/cars") {
      try {
        return await apiBara(request, env);
      } catch (error) {
        console.error("APIbara error:", error);

        return json(
          {
            ok: false,
            error:
              "Nie udało się połączyć z APIbara",
            details: error.message
          },
          502
        );
      }
    }

    /*
     * Pojedynczy samochód.
     *
     * /api/car/VIN
     */

    if (url.pathname.startsWith("/api/car/")) {
      const identifier =
        decodeURIComponent(
          url.pathname.substring("/api/car/".length)
        );

      try {
        return await singleVehicle(
          request,
          env,
          identifier
        );
      } catch (error) {
        console.error(
          "Single vehicle error:",
          error
        );

        return json(
          {
            ok: false,
            error:
              "Nie udało się pobrać samochodu z APIbara"
          },
          502
        );
      }
    }

    /*
     * Reszta → pliki strony z /public
     */

    return env.ASSETS.fetch(request);
  }
};
