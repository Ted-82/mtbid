const APIBARA_BASE =
  "https://apibara.tech/api/v1/vehicle-auction";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

async function apibaraFetch(path, env) {
  if (!env.APIBARA_API_KEY) {
    throw new Error(
      "Brak APIBARA_API_KEY w Cloudflare Secrets"
    );
  }

  const response = await fetch(
    APIBARA_BASE + path,
    {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-API-Key": env.APIBARA_API_KEY
      }
    }
  );

  const text = await response.text();

  let result;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      "Apibara zwróciła nie-JSON. " +
      "HTTP " +
      response.status +
      ". Odpowiedź: " +
      text.substring(0, 1000)
    );
  }

  if (!response.ok) {
    throw new Error(
      result.message ||
      result.error ||
      `Apibara HTTP ${response.status}`
    );
  }

  return result;
}


/*
 * LISTA SAMOCHODÓW
 *
 * /api/cars
 * /api/cars?s=VIN
 */

async function cars(request, env) {
  const incoming =
    new URL(request.url);

  const apiUrl =
    new URL(
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
    const value =
      incoming.searchParams.get(name);

    if (
      value !== null &&
      value !== ""
    ) {
      apiUrl.searchParams.set(
        name,
        value
      );
    }
  }

  if (
    !apiUrl.searchParams.has("per_page")
  ) {
    apiUrl.searchParams.set(
      "per_page",
      "20"
    );
  }

  const result =
    await apibaraFetch(
      apiUrl.pathname +
      apiUrl.search,
      env
    );

  return json({
    ok: true,
    data: Array.isArray(result.data)
      ? result.data
      : [],
    meta: result.meta || null
  });
}


/*
 * SZCZEGÓŁY JEDNEGO SAMOCHODU
 *
 * /api/car/VIN
 */

async function singleCar(
  request,
  env,
  identifier
) {
  const result =
    await apibaraFetch(
      "/vehicles/" +
      encodeURIComponent(identifier),
      env
    );

  return json({
    ok: true,
    data: result.data || null
  });
}


/*
 * HISTORIA AUKCJI
 *
 * /api/car/VIN/history
 */

async function carHistory(
  request,
  env,
  identifier
) {
  const incoming =
    new URL(request.url);

  const apiUrl =
    new URL(
      APIBARA_BASE +
      "/vehicles/" +
      encodeURIComponent(identifier) +
      "/history"
    );

  const perPage =
    incoming.searchParams.get(
      "per_page"
    );

  const cursor =
    incoming.searchParams.get(
      "cursor"
    );

  apiUrl.searchParams.set(
    "per_page",
    perPage || "20"
  );

  if (cursor) {
    apiUrl.searchParams.set(
      "cursor",
      cursor
    );
  }

  const result =
    await apibaraFetch(
      apiUrl.pathname +
      apiUrl.search,
      env
    );

  return json({
    ok: true,
    data: result.data || null,
    meta: result.meta || null
  });
}


/*
 * WORKER
 */

export default {
  async fetch(request, env) {
    const url =
      new URL(request.url);


    /*
     * CORS
     */

    if (
      request.method === "OPTIONS"
    ) {
      return new Response(
        null,
        {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods":
              "GET, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type"
          }
        }
      );
    }


    /*
     * LISTA SAMOCHODÓW
     */

    if (
      url.pathname === "/api/cars"
    ) {
      try {
        return await cars(
          request,
          env
        );
      } catch (error) {
        console.error(
          "Cars API error:",
          error
        );

        return json(
          {
            ok: false,
            error: error.message
          },
          502
        );
      }
    }


    /*
     * HISTORIA
     *
     * Musi być przed /api/car/
     */

    if (
      url.pathname.startsWith(
        "/api/car/"
      ) &&
      url.pathname.endsWith(
        "/history"
      )
    ) {
      const identifier =
        decodeURIComponent(
          url.pathname
            .substring(
              "/api/car/".length
            )
            .replace(
              /\/history$/,
              ""
            )
        );

      if (!identifier) {
        return json(
          {
            ok: false,
            error:
              "Brak identyfikatora samochodu"
          },
          400
        );
      }

      try {
        return await carHistory(
          request,
          env,
          identifier
        );
      } catch (error) {
        console.error(
          "History API error:",
          error
        );

        return json(
          {
            ok: false,
            error: error.message
          },
          502
        );
      }
    }


    /*
     * POJEDYNCZY SAMOCHÓD
     */

    if (
      url.pathname.startsWith(
        "/api/car/"
      )
    ) {
      const identifier =
        decodeURIComponent(
          url.pathname.substring(
            "/api/car/".length
          )
        );

      if (!identifier) {
        return json(
          {
            ok: false,
            error:
              "Brak identyfikatora samochodu"
          },
          400
        );
      }

      try {
        return await singleCar(
          request,
          env,
          identifier
        );
      } catch (error) {
        console.error(
          "Single car API error:",
          error
        );

        return json(
          {
            ok: false,
            error: error.message
          },
          502
        );
      }
    }


    /*
     * RESZTA → STRONA
     */

    return env.ASSETS.fetch(
      request
    );
  }
};
