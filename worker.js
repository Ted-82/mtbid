const APIBARA_BASE =
  "https://apibara.tech/api/v1/vehicle-auction";

const CACHE_TTL = 300; // 5 minut

const SEARCH_PARAMS = [
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

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function apiKey(env) {
  return env.APIBARA_API_KEY || "";
}

function cacheKey(url) {
  const normalized = new URL(url);

  normalized.hostname = "rex-bid-cache.local";
  normalized.pathname =
    normalized.pathname || "/";

  return new Request(
    normalized.toString(),
    {
      method: "GET"
    }
  );
}

function buildApiUrl(request) {
  const incoming =
    new URL(request.url);

  const apiUrl =
    new URL(
      APIBARA_BASE + "/vehicles"
    );

  for (const name of SEARCH_PARAMS) {
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

  /*
   * APIbara Basic / Test / Power / Pro:
   * maksymalnie 20 rekordów.
   */
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

  return apiUrl;
}

async function fetchApiBara(
  apiUrl,
  env
) {
  return fetch(
    apiUrl.toString(),
    {
      method: "GET",
      headers: {
        "Accept":
          "application/json",
        "X-API-Key":
          apiKey(env)
      }
    }
  );
}

async function getCars(
  request,
  env,
  ctx
) {
  if (!apiKey(env)) {
    return json(
      {
        ok: false,
        error:
          "Brak konfiguracji APIBARA_API_KEY"
      },
      500
    );
  }

  const cache =
    caches.default;

  const key =
    cacheKey(request.url);

  /*
   * CACHE HIT
   */
  const cached =
    await cache.match(key);

  if (cached) {
    const response =
      new Response(
        cached.body,
        cached
      );

    response.headers.set(
      "X-RexBid-Cache",
      "HIT"
    );

    return response;
  }

  /*
   * CACHE MISS
   *
   * Dopiero tutaj pytamy APIbara.
   */
  const apiUrl =
    buildApiUrl(request);

  const upstream =
    await fetchApiBara(
      apiUrl,
      env
    );

  const text =
    await upstream.text();

  let result;

  try {
    result =
      JSON.parse(text);
  } catch {
    return json(
      {
        ok: false,
        error:
          "APIbara zwróciło nieprawidłową odpowiedź",
        status:
          upstream.status
      },
      502,
      {
        "X-RexBid-Cache":
          "MISS"
      }
    );
  }

  /*
   * Nie cache'ujemy błędów.
   */
  if (!upstream.ok) {
    return json(
      {
        ok: false,
        error:
          result.message ||
          "APIbara zwróciło błąd",
        status:
          upstream.status,
        details:
          result.errors || null
      },
      upstream.status,
      {
        "X-RexBid-Cache":
          "MISS"
      }
    );
  }

  /*
   * Zachowujemy pełną odpowiedź APIbara,
   * włącznie z meta.next_cursor.
   */
  const output =
    json(
      {
        ok: true,
        data:
          Array.isArray(
            result.data
          )
            ? result.data
            : [],
        meta:
          result.meta || null
      },
      200,
      {
        "X-RexBid-Cache":
          "MISS",
        "Cache-Control":
          `public, s-maxage=${CACHE_TTL}`
      }
    );

  /*
   * Zapis do Cloudflare Cache.
   */
  ctx.waitUntil(
    cache.put(
      key,
      output.clone()
    )
  );

  return output;
}

async function getSingleVehicle(
  request,
  env,
  ctx,
  identifier
) {
  if (!apiKey(env)) {
    return json(
      {
        ok: false,
        error:
          "Brak konfiguracji APIBARA_API_KEY"
      },
      500
    );
  }

  const cache =
    caches.default;

  const cacheUrl =
    new URL(request.url);

  cacheUrl.hostname =
    "rex-bid-cache.local";

  const key =
    new Request(
      cacheUrl.toString(),
      {
        method: "GET"
      }
    );

  /*
   * CACHE HIT
   */
  const cached =
    await cache.match(key);

  if (cached) {
    const response =
      new Response(
        cached.body,
        cached
      );

    response.headers.set(
      "X-RexBid-Cache",
      "HIT"
    );

    return response;
  }

  const apiUrl =
    APIBARA_BASE +
    "/vehicles/" +
    encodeURIComponent(
      identifier
    );

  const upstream =
    await fetch(
      apiUrl,
      {
        method: "GET",
        headers: {
          "Accept":
            "application/json",
          "X-API-Key":
            apiKey(env)
        }
      }
    );

  const text =
    await upstream.text();

  let result;

  try {
    result =
      JSON.parse(text);
  } catch {
    return json(
      {
        ok: false,
        error:
          "APIbara zwróciło nieprawidłową odpowiedź",
        status:
          upstream.status
      },
      502,
      {
        "X-RexBid-Cache":
          "MISS"
      }
    );
  }

  if (!upstream.ok) {
    return json(
      {
        ok: false,
        error:
          result.message ||
          "Nie udało się pobrać samochodu",
        status:
          upstream.status,
        details:
          result.errors || null
      },
      upstream.status,
      {
        "X-RexBid-Cache":
          "MISS"
      }
    );
  }

  const car =
    result.data &&
    !Array.isArray(
      result.data
    )
      ? result.data
      : Array.isArray(
          result.data
        )
        ? result.data[0]
        : null;

  const output =
    json(
      {
        ok: true,
        data: car
          ? [car]
          : []
      },
      200,
      {
        "X-RexBid-Cache":
          "MISS",
        "Cache-Control":
          `public, s-maxage=${CACHE_TTL}`
      }
    );

  ctx.waitUntil(
    cache.put(
      key,
      output.clone()
    )
  );

  return output;
}

async function getHistory(
  request,
  env,
  ctx,
  identifier
) {
  if (!apiKey(env)) {
    return json(
      {
        ok: false,
        error:
          "Brak konfiguracji APIBARA_API_KEY"
      },
      500
    );
  }

  const incoming =
    new URL(request.url);

  const apiUrl =
    new URL(
      APIBARA_BASE +
      "/vehicles/" +
      encodeURIComponent(
        identifier
      ) +
      "/history"
    );

  /*
   * Historia również korzysta
   * z cursor pagination.
   */
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

  const key =
    cacheKey(
      apiUrl.toString()
    );

  const cache =
    caches.default;

  const cached =
    await cache.match(key);

  if (cached) {
    const response =
      new Response(
        cached.body,
        cached
      );

    response.headers.set(
      "X-RexBid-Cache",
      "HIT"
    );

    return response;
  }

  const upstream =
    await fetch(
      apiUrl.toString(),
      {
        method: "GET",
        headers: {
          "Accept":
            "application/json",
          "X-API-Key":
            apiKey(env)
        }
      }
    );

  const text =
    await upstream.text();

  let result;

  try {
    result =
      JSON.parse(text);
  } catch {
    return json(
      {
        ok: false,
        error:
          "APIbara zwróciło nieprawidłową odpowiedź",
        status:
          upstream.status
      },
      502,
      {
        "X-RexBid-Cache":
          "MISS"
      }
    );
  }

  if (!upstream.ok) {
    return json(
      {
        ok: false,
        error:
          result.message ||
          "Nie udało się pobrać historii",
        status:
          upstream.status,
        details:
          result.errors || null
      },
      upstream.status,
      {
        "X-RexBid-Cache":
          "MISS"
      }
    );
  }

  const output =
    json(
      {
        ok:
          result.ok !== false,
        data:
          Array.isArray(
            result.data
          )
            ? result.data
            : result.data || [],
        meta:
          result.meta || null
      },
      200,
      {
        "X-RexBid-Cache":
          "MISS",
        "Cache-Control":
          `public, s-maxage=${CACHE_TTL}`
      }
    );

  ctx.waitUntil(
    cache.put(
      key,
      output.clone()
    )
  );

  return output;
}

async function getFilters(
  request,
  env,
  ctx
) {
  if (!apiKey(env)) {
    return json(
      {
        ok: false,
        error:
          "Brak konfiguracji APIBARA_API_KEY"
      },
      500
    );
  }

  const apiUrl =
    APIBARA_BASE +
    "/vehicles/filters";

  const key =
    cacheKey(apiUrl);

  const cache =
    caches.default;

  const cached =
    await cache.match(key);

  if (cached) {
    const response =
      new Response(
        cached.body,
        cached
      );

    response.headers.set(
      "X-RexBid-Cache",
      "HIT"
    );

    return response;
  }

  const upstream =
    await fetch(
      apiUrl,
      {
        method: "GET",
        headers: {
          "Accept":
            "application/json",
          "X-API-Key":
            apiKey(env)
        }
      }
    );

  const text =
    await upstream.text();

  let result;

  try {
    result =
      JSON.parse(text);
  } catch {
    return json(
      {
        ok: false,
        error:
          "APIbara zwróciło nieprawidłową odpowiedź",
        status:
          upstream.status
      },
      502,
      {
        "X-RexBid-Cache":
          "MISS"
      }
    );
  }

  if (!upstream.ok) {
    return json(
      {
        ok: false,
        error:
          result.message ||
          "Nie udało się pobrać filtrów",
        status:
          upstream.status,
        details:
          result.errors || null
      },
      upstream.status,
      {
        "X-RexBid-Cache":
          "MISS"
      }
    );
  }

  const output =
    json(
      {
        ok:
          result.ok !== false,
        data:
          result.data ||
          result
      },
      200,
      {
        "X-RexBid-Cache":
          "MISS",
        "Cache-Control":
          "public, s-maxage=3600"
      }
    );

  ctx.waitUntil(
    cache.put(
      key,
      output.clone()
    )
  );

  return output;
}

async function getUsage(
  env
) {
  if (!apiKey(env)) {
    return json(
      {
        ok: false,
        error:
          "Brak konfiguracji APIBARA_API_KEY"
      },
      500
    );
  }

  const response =
    await fetch(
      APIBARA_BASE +
        "/usage",
      {
        method: "GET",
        headers: {
          "Accept":
            "application/json",
          "X-API-Key":
            apiKey(env)
        }
      }
    );

  const text =
    await response.text();

  let result;

  try {
    result =
      JSON.parse(text);
  } catch {
    return json(
      {
        ok: false,
        error:
          "Nieprawidłowa odpowiedź APIbara",
        status:
          response.status
      },
      502
    );
  }

  return json(
    result,
    response.status
  );
}

export default {
  async fetch(
    request,
    env,
    ctx
  ) {
    const url =
      new URL(request.url);

    /*
     * CORS — obsługa OPTIONS.
     */
    if (
      request.method ===
      "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin":
              "*",
            "Access-Control-Allow-Methods":
              "GET, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type"
          }
        }
      );
    }

    /*
     * LISTA / WYSZUKIWANIE
     *
     * /api/cars
     */
    if (
      url.pathname ===
      "/api/cars"
    ) {
      try {
        return await getCars(
          request,
          env,
          ctx
        );
      } catch (error) {
        console.error(
          "Rex.Bid cars error:",
          error
        );

        return json(
          {
            ok: false,
            error:
              "Nie udało się pobrać ofert"
          },
          502
        );
      }
    }

    /*
     * POJEDYNCZY SAMOCHÓD
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

      try {
        return await getSingleVehicle(
          request,
          env,
          ctx,
          identifier
        );
      } catch (error) {
        console.error(
          "Rex.Bid vehicle error:",
          error
        );

        return json(
          {
            ok: false,
            error:
              "Nie udało się pobrać samochodu"
          },
          502
        );
      }
    }

    /*
     * HISTORIA AUKCJI
     *
     * /api/car/VIN/history
     */
    if (
      url.pathname.startsWith(
        "/api/car/"
      ) &&
      url.pathname.endsWith(
        "/history"
      )
    ) {
      const base =
        url.pathname.substring(
          "/api/car/".length,
          url.pathname.length -
            "/history".length
        );

      const identifier =
        decodeURIComponent(
          base
        );

      try {
        return await getHistory(
          request,
          env,
          ctx,
          identifier
        );
      } catch (error) {
        console.error(
          "Rex.Bid history error:",
          error
        );

        return json(
          {
            ok: false,
            error:
              "Nie udało się pobrać historii aukcji"
          },
          502
        );
      }
    }

    /*
     * FILTRY APIbara
     *
     * /api/filters
     */
    if (
      url.pathname ===
      "/api/filters"
    ) {
      try {
        return await getFilters(
          request,
          env,
          ctx
        );
      } catch (error) {
        console.error(
          "Rex.Bid filters error:",
          error
        );

        return json(
          {
            ok: false,
            error:
              "Nie udało się pobrać filtrów"
          },
          502
        );
      }
    }

    /*
     * UŻYCIE API
     *
     * /api/usage
     *
     * Na razie techniczny endpoint.
     * Później możemy wykorzystać go
     * w panelu administracyjnym.
     */
    if (
      url.pathname ===
      "/api/usage"
    ) {
      try {
        return await getUsage(
          env
        );
      } catch (error) {
        console.error(
          "Rex.Bid usage error:",
          error
        );

        return json(
          {
            ok: false,
            error:
              "Nie udało się pobrać informacji o limicie API"
          },
          502
        );
      }
    }

    /*
     * CAŁA RESZTA:
     * strona z /public
     */
    return env.ASSETS.fetch(
      request
    );
  }
};
