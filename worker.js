const APIBARA_BASE =
  "https://apibara.tech/api/v1/vehicle-auction";

const SEARCH_CACHE_TTL = 60;        // 60 sekund
const VEHICLE_CACHE_TTL = 600;      // 10 minut

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


/*
 * CORS
 */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}


/*
 * Cache key
 *
 * Każde inne zapytanie ma osobny wpis.
 */

function cacheKey(requestUrl, type) {
  const url = new URL(requestUrl);

  return new Request(
    "https://cache.rexbid.internal/" +
    type +
    "?" +
    url.searchParams.toString()
  );
}


/*
 * Pobranie z cache
 */

async function getCache(requestUrl, type) {
  const cache = caches.default;

  const key = cacheKey(requestUrl, type);

  const cached = await cache.match(key);

  if (!cached) {
    return null;
  }

  return cached;
}


/*
 * Zapis do cache
 */

async function putCache(
  requestUrl,
  type,
  response,
  ttl
) {
  const cache = caches.default;

  const key = cacheKey(requestUrl, type);

  const headers = new Headers(response.headers);

  headers.set(
    "Cache-Control",
    `public, max-age=${ttl}`
  );

  const cachedResponse = new Response(
    response.body,
    {
      status: response.status,
      headers
    }
  );

  await cache.put(
    key,
    cachedResponse.clone()
  );

  return cachedResponse;
}


/*
 * Parametry obsługiwane przez APIbara
 */

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

  "updated_within_minutes",

  "per_page",
  "cursor"
];


/*
 * Budowanie URL APIbara
 */

function buildApiUrl(requestUrl) {
  const incoming = new URL(requestUrl);

  const apiUrl = new URL(
    APIBARA_BASE + "/vehicles"
  );

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


  /*
   * Basic pozwala maksymalnie na 20.
   */

  let perPage =
    Number(
      apiUrl.searchParams.get("per_page") || 20
    );

  if (!Number.isFinite(perPage)) {
    perPage = 20;
  }

  perPage =
    Math.max(
      1,
      Math.min(20, perPage)
    );

  apiUrl.searchParams.set(
    "per_page",
    String(perPage)
  );


  return apiUrl;
}


/*
 * APIbara — lista samochodów
 */

async function apiBaraSearch(
  request,
  env
) {
  if (!env.APIBARA_API_KEY) {
    return json(
      {
        ok: false,
        error:
          "Brak APIBARA_API_KEY w Cloudflare Secrets."
      },
      500,
      corsHeaders()
    );
  }


  /*
   * Najpierw cache.
   */

  const cached =
    await getCache(
      request.url,
      "search"
    );

  if (cached) {
    return new Response(
      cached.body,
      {
        status: cached.status,
        headers: {
          ...Object.fromEntries(
            cached.headers
          ),
          ...corsHeaders(),
          "X-RexBid-Cache": "HIT"
        }
      }
    );
  }


  const apiUrl =
    buildApiUrl(
      request.url
    );


  let response;

  try {
    response =
      await fetch(
        apiUrl.toString(),
        {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "X-API-Key":
              env.APIBARA_API_KEY
          }
        }
      );
  } catch (error) {
    return json(
      {
        ok: false,
        error:
          "Nie udało się połączyć z APIbara."
      },
      502,
      corsHeaders()
    );
  }


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
          "APIbara zwróciło nieprawidłową odpowiedź."
      },
      502,
      corsHeaders()
    );
  }


  /*
   * Limit APIbara
   */

  if (response.status === 429) {
    return json(
      {
        ok: false,
        error:
          "APIbara osiągnęło limit zapytań. Spróbuj ponownie za chwilę.",
        status: 429
      },
      429,
      {
        ...corsHeaders(),
        "Retry-After": "60"
      }
    );
  }


  /*
   * Pozostałe błędy APIbara
   */

  if (!response.ok) {
    return json(
      {
        ok: false,
        error:
          result.message ||
          "APIbara zwróciło błąd.",
        status: response.status,
        details:
          result.errors || null
      },
      response.status,
      corsHeaders()
    );
  }


  /*
   * Normalizacja odpowiedzi
   */

  const data =
    Array.isArray(result.data)
      ? result.data
      : [];


  const output = {
    ok: true,
    data,
    meta:
      result.meta || null,
    demo: false
  };


  const finalResponse =
    json(
      output,
      200,
      {
        ...corsHeaders()
      }
    );


  /*
   * Udany wynik zapisujemy do cache.
   *
   * Nie cache'ujemy błędów.
   */

  await putCache(
    request.url,
    "search",
    finalResponse.clone(),
    SEARCH_CACHE_TTL
  );


  return new Response(
    finalResponse.body,
    {
      status: 200,
      headers: {
        ...Object.fromEntries(
          finalResponse.headers
        ),
        "X-RexBid-Cache": "MISS"
      }
    }
  );
}


/*
 * Pojedynczy samochód
 */

async function getVehicle(
  request,
  env,
  identifier
) {
  if (!env.APIBARA_API_KEY) {
    return json(
      {
        ok: false,
        error:
          "Brak APIBARA_API_KEY w Cloudflare Secrets."
      },
      500,
      corsHeaders()
    );
  }


  /*
   * Cache pojedynczego samochodu.
   */

  const cached =
    await getCache(
      request.url,
      "vehicle"
    );

  if (cached) {
    return new Response(
      cached.body,
      {
        status: cached.status,
        headers: {
          ...Object.fromEntries(
            cached.headers
          ),
          ...corsHeaders(),
          "X-RexBid-Cache": "HIT"
        }
      }
    );
  }


  const apiUrl =
    APIBARA_BASE +
    "/vehicles/" +
    encodeURIComponent(
      identifier
    );


  let response;

  try {
    response =
      await fetch(
        apiUrl,
        {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "X-API-Key":
              env.APIBARA_API_KEY
          }
        }
      );
  } catch {
    return json(
      {
        ok: false,
        error:
          "Nie udało się połączyć z APIbara."
      },
      502,
      corsHeaders()
    );
  }


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
          "APIbara zwróciło nieprawidłową odpowiedź."
      },
      502,
      corsHeaders()
    );
  }


  /*
   * 429
   */

  if (response.status === 429) {
    return json(
      {
        ok: false,
        error:
          "APIbara osiągnęło limit zapytań. Spróbuj ponownie za chwilę.",
        status: 429
      },
      429,
      {
        ...corsHeaders(),
        "Retry-After": "60"
      }
    );
  }


  /*
   * Inne błędy
   */

  if (!response.ok) {
    return json(
      {
        ok: false,
        error:
          result.message ||
          "Nie udało się pobrać samochodu z APIbara.",
        status: response.status,
        details:
          result.errors || null
      },
      response.status,
      corsHeaders()
    );
  }


  /*
   * APIbara może zwrócić obiekt
   * albo tablicę.
   */

  const car =
    result.data &&
    !Array.isArray(result.data)
      ? result.data
      : Array.isArray(result.data)
        ? result.data[0]
        : null;


  const output = {
    ok: true,
    data: car
      ? [car]
      : [],
    meta:
      result.meta || null,
    demo: false
  };


  const finalResponse =
    json(
      output,
      200,
      {
        ...corsHeaders()
      }
    );


  /*
   * Samochód trzymamy dłużej.
   */

  await putCache(
    request.url,
    "vehicle",
    finalResponse.clone(),
    VEHICLE_CACHE_TTL
  );


  return new Response(
    finalResponse.body,
    {
      status: 200,
      headers: {
        ...Object.fromEntries(
          finalResponse.headers
        ),
        "X-RexBid-Cache": "MISS"
      }
    }
  );
}


/*
 * HISTORIA AUKCJI
 *
 * To będzie używane przez kartę samochodu.
 *
 * /api/car/VIN/history
 */

async function getVehicleHistory(
  request,
  env,
  identifier
) {
  if (!env.APIBARA_API_KEY) {
    return json(
      {
        ok: false,
        error:
          "Brak APIBARA_API_KEY w Cloudflare Secrets."
      },
      500,
      corsHeaders()
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
   * Historia również ma cursor pagination.
   */

  const cursor =
    incoming.searchParams.get(
      "cursor"
    );

  if (cursor) {
    apiUrl.searchParams.set(
      "cursor",
      cursor
    );
  }


  apiUrl.searchParams.set(
    "per_page",
    "20"
  );


  /*
   * Historia ma cache 10 minut.
   */

  const cached =
    await getCache(
      request.url,
      "history"
    );

  if (cached) {
    return new Response(
      cached.body,
      {
        status: cached.status,
        headers: {
          ...Object.fromEntries(
            cached.headers
          ),
          ...corsHeaders(),
          "X-RexBid-Cache": "HIT"
        }
      }
    );
  }


  let response;

  try {
    response =
      await fetch(
        apiUrl.toString(),
        {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "X-API-Key":
              env.APIBARA_API_KEY
          }
        }
      );
  } catch {
    return json(
      {
        ok: false,
        error:
          "Nie udało się połączyć z APIbara."
      },
      502,
      corsHeaders()
    );
  }


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
          "APIbara zwróciło nieprawidłową odpowiedź."
      },
      502,
      corsHeaders()
    );
  }


  if (response.status === 429) {
    return json(
      {
        ok: false,
        error:
          "APIbara osiągnęło limit zapytań. Spróbuj ponownie za chwilę.",
        status: 429
      },
      429,
      {
        ...corsHeaders(),
        "Retry-After": "60"
      }
    );
  }


  if (!response.ok) {
    return json(
      {
        ok: false,
        error:
          result.message ||
          "Nie udało się pobrać historii aukcji.",
        status: response.status,
        details:
          result.errors || null
      },
      response.status,
      corsHeaders()
    );
  }


  const output = {
    ok: true,
    data:
      Array.isArray(result.data)
        ? result.data
        : [],
    meta:
      result.meta || null,
    demo: false
  };


  const finalResponse =
    json(
      output,
      200,
      {
        ...corsHeaders()
      }
    );


  await putCache(
    request.url,
    "history",
    finalResponse.clone(),
    VEHICLE_CACHE_TTL
  );


  return new Response(
    finalResponse.body,
    {
      status: 200,
      headers: {
        ...Object.fromEntries(
          finalResponse.headers
        ),
        "X-RexBid-Cache": "MISS"
      }
    }
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

    const url =
      new URL(
        request.url
      );


    /*
     * CORS preflight
     */

    if (
      request.method ===
      "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers:
            corsHeaders()
        }
      );
    }


    /*
     * Nie obsługujemy POST/PUT/DELETE
     * dla publicznego API Rex.Bid.
     */

    if (
      request.method !==
      "GET"
    ) {

      return json(
        {
          ok: false,
          error:
            "Method Not Allowed"
        },
        405,
        {
          ...corsHeaders(),
          "Allow": "GET, OPTIONS"
        }
      );

    }


    /*
     * LISTA / WYSZUKIWARKA
     *
     * /api/cars
     */

    if (
      url.pathname ===
      "/api/cars"
    ) {

      try {

        return await
          apiBaraSearch(
            request,
            env
          );

      } catch (error) {

        console.error(
          "Rex.Bid API search error:",
          error
        );

        return json(
          {
            ok: false,
            error:
              "Wystąpił błąd połączenia z APIbara."
          },
          502,
          corsHeaders()
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
      ) &&
      !url.pathname.endsWith(
        "/history"
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
              "Brak identyfikatora samochodu."
          },
          400,
          corsHeaders()
        );

      }


      try {

        return await
          getVehicle(
            request,
            env,
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
              "Nie udało się pobrać samochodu z APIbara."
          },
          502,
          corsHeaders()
        );

      }

    }


    /*
     * HISTORIA
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
              "Brak identyfikatora samochodu."
          },
          400,
          corsHeaders()
        );

      }


      try {

        return await
          getVehicleHistory(
            request,
            env,
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
              "Nie udało się pobrać historii aukcji."
          },
          502,
          corsHeaders()
        );

      }

    }


    /*
     * Wszystko pozostałe:
     * strona z /public
     */

    return env.ASSETS.fetch(
      request
    );

  }

};
