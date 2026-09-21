const APIBARA_BASE =
  "https://apibara.tech/api/v1/vehicle-auction";

const CACHE_TTL = 300; // 5 minut


function json(data, status = 200, cacheStatus = null) {
  const headers = {
    "Content-Type": "application/json; charset=UTF-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=60"
  };

  if (cacheStatus) {
    headers["X-RexBid-Cache"] = cacheStatus;
  }

  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}


function errorResponse(message, status = 500) {
  return json(
    {
      ok: false,
      error: message
    },
    status
  );
}


async function cachedFetch(env, cacheKey, apiUrl) {
  const cache = caches.default;

  const cacheRequest = new Request(cacheKey, {
    method: "GET"
  });

  const cached = await cache.match(cacheRequest);

  if (cached) {
    const data = await cached.json();

    return json(data, 200, "HIT");
  }

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
    return errorResponse(
      "APIbara zwróciło nieprawidłową odpowiedź.",
      502
    );
  }

  if (!response.ok) {
    return json(
      {
        ok: false,
        error:
          result.message ||
          "APIbara zwróciło błąd.",
        status: response.status,
        details: result.errors || null
      },
      response.status,
      "MISS"
    );
  }

  const cacheResponse = new Response(
    JSON.stringify(result),
    {
      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",
        "Cache-Control":
          `public, max-age=${CACHE_TTL}`
      }
    }
  );

  await cache.put(
    cacheRequest,
    cacheResponse
  );

  return json(result, 200, "MISS");
}


/*
 * LISTA SAMOCHODÓW
 *
 * /api/cars
 */

async function getVehicles(request, env) {
  if (!env.APIBARA_API_KEY) {
    return errorResponse(
      "Brak APIBARA_API_KEY w Cloudflare.",
      500
    );
  }

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
    "cursor",
    "updated_within_minutes",
    "today_only",
    "sale_document_pending",
    "has_shipping_price"
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
    !apiUrl.searchParams.has(
      "per_page"
    )
  ) {
    apiUrl.searchParams.set(
      "per_page",
      "20"
    );
  }

  /*
   * Cache zależny od parametrów
   * wyszukiwania.
   */

  const cacheKey =
    new URL(request.url);

  cacheKey.searchParams.sort();

  return cachedFetch(
    env,
    cacheKey.toString(),
    apiUrl.toString()
  );
}


/*
 * POJEDYNCZY SAMOCHÓD
 *
 * /api/car/VIN
 */

async function getVehicle(
  request,
  env,
  identifier
) {
  if (!env.APIBARA_API_KEY) {
    return errorResponse(
      "Brak APIBARA_API_KEY w Cloudflare.",
      500
    );
  }

  const apiUrl =
    APIBARA_BASE +
    "/vehicles/" +
    encodeURIComponent(identifier);

  const cacheKey =
    new URL(request.url);

  return cachedFetch(
    env,
    cacheKey.toString(),
    apiUrl
  );
}


/*
 * HISTORIA AUKCJI
 *
 * /api/car/VIN/history
 */

async function getHistory(
  request,
  env,
  identifier
) {
  if (!env.APIBARA_API_KEY) {
    return errorResponse(
      "Brak APIBARA_API_KEY w Cloudflare.",
      500
    );
  }

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

  const cacheKey =
    new URL(request.url);

  cacheKey.searchParams.sort();

  return cachedFetch(
    env,
    cacheKey.toString(),
    apiUrl.toString()
  );
}


/*
 * POWIĄZANE POJAZDY
 *
 * /api/car/VIN/related
 */

async function getRelated(
  request,
  env,
  identifier
) {
  if (!env.APIBARA_API_KEY) {
    return errorResponse(
      "Brak APIBARA_API_KEY w Cloudflare.",
      500
    );
  }

  const apiUrl =
    APIBARA_BASE +
    "/vehicles/" +
    encodeURIComponent(identifier) +
    "/related";

  const cacheKey =
    new URL(request.url);

  return cachedFetch(
    env,
    cacheKey.toString(),
    apiUrl
  );
}


/*
 * GŁÓWNY WORKER
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
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin":
            "*",
          "Access-Control-Allow-Methods":
            "GET, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type"
        }
      });
    }


    /*
     * 1. LISTA
     *
     * /api/cars
     */

    if (
      url.pathname === "/api/cars"
    ) {
      try {
        return await getVehicles(
          request,
          env
        );
      } catch (error) {
        console.error(
          "Vehicles error:",
          error
        );

        return errorResponse(
          "Nie udało się pobrać ofert z APIbara.",
          502
        );
      }
    }


    /*
     * 2. HISTORIA
     *
     * Musi być PRZED /api/car/
     */

    if (
      url.pathname.startsWith(
        "/api/car/"
      ) &&
      url.pathname.endsWith(
        "/history"
      )
    ) {
      const prefix =
        "/api/car/";

      const suffix =
        "/history";

      const identifier =
        decodeURIComponent(
          url.pathname.substring(
            prefix.length,
            url.pathname.length -
              suffix.length
          )
        );

      if (!identifier) {
        return errorResponse(
          "Brak identyfikatora samochodu.",
          400
        );
      }

      try {
        return await getHistory(
          request,
          env,
          identifier
        );
      } catch (error) {
        console.error(
          "History error:",
          error
        );

        return errorResponse(
          "Nie udało się pobrać historii aukcji.",
          502
        );
      }
    }


    /*
     * 3. POWIĄZANE
     *
     * Musi być PRZED /api/car/
     */

    if (
      url.pathname.startsWith(
        "/api/car/"
      ) &&
      url.pathname.endsWith(
        "/related"
      )
    ) {
      const prefix =
        "/api/car/";

      const suffix =
        "/related";

      const identifier =
        decodeURIComponent(
          url.pathname.substring(
            prefix.length,
            url.pathname.length -
              suffix.length
          )
        );

      if (!identifier) {
        return errorResponse(
          "Brak identyfikatora samochodu.",
          400
        );
      }

      try {
        return await getRelated(
          request,
          env,
          identifier
        );
      } catch (error) {
        console.error(
          "Related error:",
          error
        );

        return errorResponse(
          "Nie udało się pobrać powiązanych samochodów.",
          502
        );
      }
    }


    /*
     * 4. POJEDYNCZY SAMOCHÓD
     *
     * /api/car/VIN
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
        return errorResponse(
          "Brak identyfikatora samochodu.",
          400
        );
      }

      try {
        return await getVehicle(
          request,
          env,
          identifier
        );
      } catch (error) {
        console.error(
          "Vehicle error:",
          error
        );

        return errorResponse(
          "Nie udało się pobrać samochodu z APIbara.",
          502
        );
      }
    }


    /*
     * 5. STRONA
     */

    return env.ASSETS.fetch(
      request
    );
  }
};
