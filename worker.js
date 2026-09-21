const APIBARA_BASE =
  "https://apibara.tech/api/v1/vehicle-auction";


// ============================================================
// REX.BID — CACHE
// ============================================================

const SEARCH_CACHE_SECONDS = 60;
const VEHICLE_CACHE_SECONDS = 300;
const HISTORY_CACHE_SECONDS = 3600;


// ============================================================
// JSON RESPONSE
// ============================================================

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


// ============================================================
// CORS
// ============================================================

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}


// ============================================================
// CACHE KEY
// ============================================================

function cacheRequest(url) {
  return new Request(url.toString(), {
    method: "GET"
  });
}


// ============================================================
// APibara REQUEST
// ============================================================

async function apibaraFetch(url, env) {

  if (!env.APIBARA_API_KEY) {
    return json(
      {
        ok: false,
        error:
          "Brak klucza APIBARA_API_KEY. API nie jest skonfigurowane."
      },
      500,
      corsHeaders()
    );
  }

  return fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "X-API-Key": env.APIBARA_API_KEY
    }
  });
}


// ============================================================
// SEARCH VEHICLES
// ============================================================

async function searchVehicles(request, env) {

  const incoming =
    new URL(request.url);

  const apiUrl =
    new URL(
      APIBARA_BASE + "/vehicles"
    );


  // ----------------------------------------------------------
  // Parametry obsługiwane przez Rex.Bid
  // ----------------------------------------------------------

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

    "has_key",

    "seller_type",

    "sale_document_type",

    "sale_document_pending",

    "has_shipping_price",

    "loc_state",

    "office_name",

    "facility_id",

    "zip",

    "radius",

    "auction_date_from",

    "auction_date_to",

    "today_only",

    "updated_within_minutes",

    "units",

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


  // Maksymalnie 20 zgodnie z API Apibara
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


  // ----------------------------------------------------------
  // CACHE
  // ----------------------------------------------------------

  const cache =
    caches.default;

  const cacheKey =
    cacheRequest(incoming);


  const cached =
    await cache.match(
      cacheKey
    );


  if (cached) {

    const response =
      new Response(
        cached.body,
        cached
      );

    response.headers.set(
      "X-Rex-Cache",
      "HIT"
    );

    return response;

  }


  // ----------------------------------------------------------
  // APibara
  // ----------------------------------------------------------

  const response =
    await apibaraFetch(
      apiUrl.toString(),
      env
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
          "Apibara zwróciła nieprawidłową odpowiedź.",
        status:
          response.status
      },
      502,
      corsHeaders()
    );

  }


  if (!response.ok) {

    return json(
      {
        ok: false,

        error:
          result?.message ||
          result?.error ||
          `Apibara HTTP ${response.status}`,

        status:
          response.status,

        details:
          result?.errors || null

      },
      response.status,
      corsHeaders()
    );

  }


  // ----------------------------------------------------------
  // Format używany przez Rex.Bid
  // ----------------------------------------------------------

  const output =
    new Response(
      JSON.stringify({
        ok: true,

        data:
          Array.isArray(
            result?.data
          )
            ? result.data
            : [],

        meta:
          result?.meta || null,

        demo: false
      }),
      {
        status: 200,

        headers: {
          "Content-Type":
            "application/json; charset=UTF-8",

          "Access-Control-Allow-Origin":
            "*",

          "Cache-Control":
            `public, max-age=${SEARCH_CACHE_SECONDS}`,

          "X-Rex-Cache":
            "MISS"
        }
      }
    );


  // ----------------------------------------------------------
  // Zapis do cache
  // ----------------------------------------------------------

  await cache.put(
    cacheKey,
    output.clone()
  );


  return output;
}


// ============================================================
// SINGLE VEHICLE
// ============================================================

async function singleVehicle(
  request,
  env,
  identifier
) {

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


  const incoming =
    new URL(request.url);


  const apiUrl =
    new URL(
      APIBARA_BASE +
      "/vehicles/" +
      encodeURIComponent(
        identifier
      )
    );


  const cache =
    caches.default;


  const cacheKey =
    cacheRequest(incoming);


  const cached =
    await cache.match(
      cacheKey
    );


  if (cached) {

    const response =
      new Response(
        cached.body,
        cached
      );

    response.headers.set(
      "X-Rex-Cache",
      "HIT"
    );

    return response;

  }


  const response =
    await apibaraFetch(
      apiUrl.toString(),
      env
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
          "Apibara zwróciła nieprawidłową odpowiedź.",
        status:
          response.status
      },
      502,
      corsHeaders()
    );

  }


  if (!response.ok) {

    return json(
      {
        ok: false,

        error:
          result?.message ||
          result?.error ||
          `Apibara HTTP ${response.status}`,

        status:
          response.status

      },
      response.status,
      corsHeaders()
    );

  }


  const car =
    result?.data || null;


  const output =
    new Response(
      JSON.stringify({
        ok: true,

        data:
          car
            ? [car]
            : [],

        demo: false

      }),
      {
        status: 200,

        headers: {
          "Content-Type":
            "application/json; charset=UTF-8",

          "Access-Control-Allow-Origin":
            "*",

          "Cache-Control":
            `public, max-age=${VEHICLE_CACHE_SECONDS}`,

          "X-Rex-Cache":
            "MISS"
        }
      }
    );


  await cache.put(
    cacheKey,
    output.clone()
  );


  return output;
}


// ============================================================
// VEHICLE HISTORY
// ============================================================

async function vehicleHistory(
  request,
  env,
  identifier
) {

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


  const perPage =
    incoming.searchParams.get(
      "per_page"
    );


  const cursor =
    incoming.searchParams.get(
      "cursor"
    );


  if (perPage) {

    apiUrl.searchParams.set(
      "per_page",
      perPage
    );

  }


  if (cursor) {

    apiUrl.searchParams.set(
      "cursor",
      cursor
    );

  }


  const cache =
    caches.default;


  const cacheKey =
    cacheRequest(incoming);


  const cached =
    await cache.match(
      cacheKey
    );


  if (cached) {

    const response =
      new Response(
        cached.body,
        cached
      );

    response.headers.set(
      "X-Rex-Cache",
      "HIT"
    );

    return response;

  }


  const response =
    await apibaraFetch(
      apiUrl.toString(),
      env
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
          "Apibara zwróciła nieprawidłową odpowiedź.",
        status:
          response.status
      },
      502,
      corsHeaders()
    );

  }


  if (!response.ok) {

    return json(
      {
        ok: false,

        error:
          result?.message ||
          result?.error ||
          `Apibara HTTP ${response.status}`,

        status:
          response.status

      },
      response.status,
      corsHeaders()
    );

  }


  const output =
    new Response(
      JSON.stringify({
        ok: true,

        data:
          result?.data || null,

        meta:
          result?.meta || null,

        demo: false

      }),
      {
        status: 200,

        headers: {
          "Content-Type":
            "application/json; charset=UTF-8",

          "Access-Control-Allow-Origin":
            "*",

          "Cache-Control":
            `public, max-age=${HISTORY_CACHE_SECONDS}`,

          "X-Rex-Cache":
            "MISS"
        }
      }
    );


  await cache.put(
    cacheKey,
    output.clone()
  );


  return output;
}


// ============================================================
// FILTERS
// ============================================================

async function filters(
  request,
  env
) {

  const incoming =
    new URL(request.url);


  const cache =
    caches.default;


  const cacheKey =
    cacheRequest(incoming);


  const cached =
    await cache.match(
      cacheKey
    );


  if (cached) {

    const response =
      new Response(
        cached.body,
        cached
      );

    response.headers.set(
      "X-Rex-Cache",
      "HIT"
    );

    return response;

  }


  const apiUrl =
    APIBARA_BASE +
    "/vehicles/filters";


  const response =
    await apibaraFetch(
      apiUrl,
      env
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
          "Nieprawidłowa odpowiedź Apibara."
      },
      502,
      corsHeaders()
    );

  }


  if (!response.ok) {

    return json(
      {
        ok: false,

        error:
          result?.message ||
          result?.error ||
          "Błąd filtrów Apibara",

        status:
          response.status

      },
      response.status,
      corsHeaders()
    );

  }


  const output =
    new Response(
      JSON.stringify({
        ok: true,
        data:
          result?.data ||
          result
      }),
      {
        status: 200,

        headers: {
          "Content-Type":
            "application/json; charset=UTF-8",

          "Access-Control-Allow-Origin":
            "*",

          "Cache-Control":
            "public, max-age=3600",

          "X-Rex-Cache":
            "MISS"
        }
      }
    );


  await cache.put(
    cacheKey,
    output.clone()
  );


  return output;
}


// ============================================================
// MAIN WORKER
// ============================================================

export default {

  async fetch(
    request,
    env
  ) {

    const url =
      new URL(request.url);


    // --------------------------------------------------------
    // OPTIONS
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // SEARCH
    // /api/cars
    // --------------------------------------------------------

    if (
      url.pathname ===
      "/api/cars"
    ) {

      try {

        return await searchVehicles(
          request,
          env
        );

      } catch (error) {

        console.error(
          "Rex.Bid search error:",
          error
        );

        return json(
          {
            ok: false,

            error:
              "Nie udało się pobrać ofert.",

            details:
              error?.message ||
              "Unknown error"

          },
          502,
          corsHeaders()
        );

      }

    }


    // --------------------------------------------------------
    // HISTORY
    //
    // MUSI BYĆ PRZED /api/car/
    // --------------------------------------------------------

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


      try {

        return await vehicleHistory(
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


    // --------------------------------------------------------
    // SINGLE VEHICLE
    //
    // /api/car/VIN
    // --------------------------------------------------------

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

        return await singleVehicle(
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
              "Nie udało się pobrać samochodu."

          },
          502,
          corsHeaders()
        );

      }

    }


    // --------------------------------------------------------
    // FILTERS
    // --------------------------------------------------------

    if (
      url.pathname ===
      "/api/filters"
    ) {

      try {

        return await filters(
          request,
          env
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
              "Nie udało się pobrać filtrów."

          },
          502,
          corsHeaders()
        );

      }

    }


    // --------------------------------------------------------
    // HEALTH CHECK
    // --------------------------------------------------------

    if (
      url.pathname ===
      "/api/health"
    ) {

      return json({
        ok: true,
        service: "Rex.Bid",
        apibara: Boolean(
          env.APIBARA_API_KEY
        )
      });

    }


    // --------------------------------------------------------
    // STRONA
    // --------------------------------------------------------

    return env.ASSETS.fetch(
      request
    );

  }

};
