const APIBARA_BASE =
  "https://apibara.tech/api/v1/vehicle-auction";

const CACHE_TTL_SECONDS = 60;

function json(data, status = 200, cacheStatus = null) {
  const headers = {
    "Content-Type": "application/json; charset=UTF-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=60"
  };

  if (cacheStatus) {
    headers["X-RexBid-Cache"] = cacheStatus;
  }

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers
    }
  );
}

function errorJson(message, status = 502) {
  return json(
    {
      ok: false,
      error: message
    },
    status,
    "ERROR"
  );
}


/*
 * APIbara request
 *
 * Ważne:
 * Nie składamy ponownie pathname.
 * Budujemy dokładny URL endpointu Apibara.
 */

async function fetchApibara(
  endpoint,
  env,
  requestUrl
) {
  if (!env.APIBARA_API_KEY) {
    throw new Error(
      "Brak APIBARA_API_KEY w Cloudflare Secrets"
    );
  }

  const url =
    APIBARA_BASE + endpoint;

  const response =
    await fetch(
      url,
      {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "X-API-Key":
            env.APIBARA_API_KEY
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
    throw new Error(
      `Apibara zwróciła nie-JSON. HTTP ${response.status}. Odpowiedź: ${text.substring(0, 500)}`
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
 * LISTA / WYSZUKIWANIE
 *
 * /api/cars
 */

async function getCars(
  request,
  env
) {
  const incoming =
    new URL(request.url);

  const params =
    new URLSearchParams();

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
    "updated_within_minutes"
  ];

  for (
    const name of allowedParams
  ) {
    const value =
      incoming.searchParams.get(
        name
      );

    if (
      value !== null &&
      value !== ""
    ) {
      params.set(
        name,
        value
      );
    }
  }

  if (
    !params.has("per_page")
  ) {
    params.set(
      "per_page",
      "20"
    );
  }

  /*
   * Cache Cloudflare
   *
   * Ten sam request nie powinien
   * za każdym razem uderzać do Apibara.
   */

  const cache =
    caches.default;

  const cacheKey =
    new Request(
      request.url,
      request
    );

  const cached =
    await cache.match(
      cacheKey
    );

  if (cached) {
    const headers =
      new Headers(
        cached.headers
      );

    headers.set(
      "X-RexBid-Cache",
      "HIT"
    );

    return new Response(
      cached.body,
      {
        status: cached.status,
        headers
      }
    );
  }

  /*
   * Oficjalny endpoint Apibara:
   *
   * GET /vehicles
   */

  const result =
    await fetchApibara(
      "/vehicles?" +
      params.toString(),
      env,
      request.url
    );

  const response =
    json(
      {
        ok:
          result.ok !== false,
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
      "MISS"
    );

  /*
   * Zapisujemy odpowiedź
   * do Cloudflare Cache.
   */

  const cacheResponse =
    response.clone();

  await cache.put(
    cacheKey,
    cacheResponse
  );

  return response;
}


/*
 * POJEDYNCZY SAMOCHÓD
 *
 * /api/car/VIN
 */

async function getCar(
  request,
  env,
  identifier
) {
  /*
   * VIN / lot może zawierać
   * znaki wymagające kodowania.
   */

  const encoded =
    encodeURIComponent(
      identifier
    );

  const result =
    await fetchApibara(
      "/vehicles/" +
      encoded,
      env,
      request.url
    );

  return json(
    {
      ok:
        result.ok !== false,
      data:
        result.data || null
    },
    200,
    "MISS"
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
  const incoming =
    new URL(request.url);

  const params =
    new URLSearchParams();

  const perPage =
    incoming.searchParams.get(
      "per_page"
    );

  const cursor =
    incoming.searchParams.get(
      "cursor"
    );

  params.set(
    "per_page",
    perPage || "20"
  );

  if (cursor) {
    params.set(
      "cursor",
      cursor
    );
  }

  const encoded =
    encodeURIComponent(
      identifier
    );

  const result =
    await fetchApibara(
      "/vehicles/" +
      encoded +
      "/history?" +
      params.toString(),
      env,
      request.url
    );

  return json(
    {
      ok:
        result.ok !== false,
      data:
        result.data || null,
      meta:
        result.meta || null
    },
    200,
    "MISS"
  );
}


/*
 * WORKER
 */

export default {
  async fetch(
    request,
    env
  ) {

    /*
     * OPTIONS / CORS
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


    const url =
      new URL(request.url);


    /*
     * LISTA SAMOCHODÓW
     */

    if (
      url.pathname ===
      "/api/cars"
    ) {
      try {
        return await getCars(
          request,
          env
        );
      } catch (error) {

        console.error(
          "Rex.Bid cars error:",
          error
        );

        return errorJson(
          error.message
        );
      }
    }


    /*
     * HISTORIA
     *
     * Musi być przed
     * /api/car/
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
        return errorJson(
          "Brak identyfikatora samochodu",
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
          "Rex.Bid history error:",
          error
        );

        return errorJson(
          error.message
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
        return errorJson(
          "Brak identyfikatora samochodu",
          400
        );
      }

      try {
        return await getCar(
          request,
          env,
          identifier
        );
      } catch (error) {

        console.error(
          "Rex.Bid vehicle error:",
          error
        );

        return errorJson(
          error.message
        );
      }
    }


    /*
     * STRONA
     */

    return env.ASSETS.fetch(
      request
    );
  }
};
