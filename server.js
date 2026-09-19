const express = require("express");
const session = require("express-session");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "mtbid-local-development-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use(express.static(__dirname));


// ======================================================
// DEMO CARS
// ======================================================

const BASE_DEMO_CARS = [
  {
    vin: "1FMCU9GDXMUA10001",
    platform: "COPART",
    lot: "DEMO-10001",
    make: "Ford",
    model: "Escape SE",
    title: "2021 Ford Escape SE",
    year: 2021,
    price: "$7,250",
    odometer: {
      value: 52341,
      formatted: "52 341 km"
    },
    damage: "Front End",
    condition: {
      damage: "Front End",
      run_cond: "Run & Drive",
      has_key: true
    },
    location: "Chicago, IL",
    vehicle_specs: {
      fuel_type: "Gasoline",
      transmission: "Automatic",
      drive_type: "AWD",
      engine: "1.5L",
      body_type: "SUV",
      color: "White"
    },
    auction: {
      platform: "COPART",
      date: "Termin aukcji do potwierdzenia"
    },
    media: [
      {
        url: "https://images.unsplash.com/photo-1551830820-330a71b99659?auto=format&fit=crop&w=1400&q=85"
      }
    ],
    is_demo: true
  },

  {
    vin: "1C4RJFBG8LC200002",
    platform: "IAAI",
    lot: "DEMO-20002",
    make: "Jeep",
    model: "Grand Cherokee",
    title: "2020 Jeep Grand Cherokee",
    year: 2020,
    price: "$9,800",
    odometer: {
      value: 67420,
      formatted: "67 420 km"
    },
    damage: "Side",
    condition: {
      damage: "Side",
      run_cond: "Run & Drive",
      has_key: true
    },
    location: "Dallas, TX",
    vehicle_specs: {
      fuel_type: "Gasoline",
      transmission: "Automatic",
      drive_type: "4WD",
      engine: "3.6L",
      body_type: "SUV",
      color: "Black"
    },
    auction: {
      platform: "IAAI",
      date: "Termin aukcji do potwierdzenia"
    },
    media: [
      {
        url: "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=1400&q=85"
      }
    ],
    is_demo: true
  },

  {
    vin: "1HGCV1F34LA300003",
    platform: "COPART",
    lot: "DEMO-30003",
    make: "Honda",
    model: "Accord Sport",
    title: "2020 Honda Accord Sport",
    year: 2020,
    price: "$8,400",
    odometer: {
      value: 61200,
      formatted: "61 200 km"
    },
    damage: "Rear End",
    condition: {
      damage: "Rear End",
      run_cond: "Run & Drive",
      has_key: true
    },
    location: "Miami, FL",
    vehicle_specs: {
      fuel_type: "Gasoline",
      transmission: "Automatic",
      drive_type: "FWD",
      engine: "1.5L Turbo",
      body_type: "Sedan",
      color: "Gray"
    },
    auction: {
      platform: "COPART",
      date: "Termin aukcji do potwierdzenia"
    },
    media: [
      {
        url: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?auto=format&fit=crop&w=1400&q=85"
      }
    ],
    is_demo: true
  },

  {
    vin: "5YFB4MDE2LP400004",
    platform: "IAAI",
    lot: "DEMO-40004",
    make: "Toyota",
    model: "Corolla SE",
    title: "2020 Toyota Corolla SE",
    year: 2020,
    price: "$7,900",
    odometer: {
      value: 49870,
      formatted: "49 870 km"
    },
    damage: "Hail",
    condition: {
      damage: "Hail",
      run_cond: "Run & Drive",
      has_key: true
    },
    location: "Houston, TX",
    vehicle_specs: {
      fuel_type: "Gasoline",
      transmission: "Automatic",
      drive_type: "FWD",
      engine: "2.0L",
      body_type: "Sedan",
      color: "Blue"
    },
    auction: {
      platform: "IAAI",
      date: "Termin aukcji do potwierdzenia"
    },
    media: [
      {
        url: "https://images.unsplash.com/photo-1590362891991-f776e747a588?auto=format&fit=crop&w=1400&q=85"
      }
    ],
    is_demo: true
  },

  {
    vin: "1G1ZD5ST5LF500005",
    platform: "COPART",
    lot: "DEMO-50005",
    make: "Chevrolet",
    model: "Malibu LT",
    title: "2020 Chevrolet Malibu LT",
    year: 2020,
    price: "$6,950",
    odometer: {
      value: 72115,
      formatted: "72 115 km"
    },
    damage: "Front End",
    condition: {
      damage: "Front End",
      run_cond: "Run & Drive",
      has_key: false
    },
    location: "Atlanta, GA",
    vehicle_specs: {
      fuel_type: "Gasoline",
      transmission: "Automatic",
      drive_type: "FWD",
      engine: "1.5L Turbo",
      body_type: "Sedan",
      color: "White"
    },
    auction: {
      platform: "COPART",
      date: "Termin aukcji do potwierdzenia"
    },
    media: [
      {
        url: "https://images.unsplash.com/photo-1619767886558-efdc259cde1a?auto=format&fit=crop&w=1400&q=85"
      }
    ],
    is_demo: true
  },

  {
    vin: "WBA5R1C04LF600006",
    platform: "IAAI",
    lot: "DEMO-60006",
    make: "BMW",
    model: "330I",
    title: "2020 BMW 330I",
    year: 2020,
    price: "$11,500",
    odometer: {
      value: 58920,
      formatted: "58 920 km"
    },
    damage: "Rear End",
    condition: {
      damage: "Rear End",
      run_cond: "Run & Drive",
      has_key: true
    },
    location: "Los Angeles, CA",
    vehicle_specs: {
      fuel_type: "Gasoline",
      transmission: "Automatic",
      drive_type: "RWD",
      engine: "2.0L Turbo",
      body_type: "Sedan",
      color: "Black"
    },
    auction: {
      platform: "IAAI",
      date: "Termin aukcji do potwierdzenia"
    },
    media: [
      {
        url: "https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1400&q=85"
      }
    ],
    is_demo: true
  }
];


// Tworzymy większą listę DEMO
const demoCars = [];

for (let repeat = 0; repeat < 4; repeat++) {
  for (const car of BASE_DEMO_CARS) {

    if (repeat === 0) {
      demoCars.push({ ...car });
    } else {

      const copy = {
        ...car,
        vin: car.vin.slice(0, 13) + String(repeat) + String(
          parseInt(car.vin.slice(-3)) + repeat
        ).padStart(3, "0"),

        lot: `${car.lot}-${repeat}`,

        price: car.price
      };

      demoCars.push(copy);
    }
  }
}


// ======================================================
// APIBARA
// ======================================================

async function fetchApibaraCars(queryParams = {}) {

  const apiKey = process.env.APIBARA_KEY;

  if (!apiKey) {
    throw new Error("Brak APIBARA_KEY");
  }

  const url =
    new URL(
      "https://api.apibara.com/api/v1/vehicle-auction/vehicles"
    );

  const allowedParams = [
    "platform",
    "s",
    "make",
    "model",
    "year_from",
    "year_to",
    "price_min",
    "price_max",
    "odometer_from",
    "odometer_to",
    "fuel_type",
    "transmission",
    "drive_type",
    "damage",
    "run_cond",
    "has_key"
  ];

  for (const key of allowedParams) {

    if (
      queryParams[key] !== undefined &&
      queryParams[key] !== ""
    ) {
      url.searchParams.set(
        key,
        queryParams[key]
      );
    }

  }

  const response =
    await fetch(
      url,
      {
        headers: {
          "X-API-Key": apiKey,
          "Accept": "application/json"
        }
      }
    );

  const text =
    await response.text();

  if (!response.ok) {

    throw new Error(
      `Apibara HTTP ${response.status}: ${text}`
    );

  }

  return JSON.parse(text);
}


// ======================================================
// FILTER DEMO
// ======================================================

function filterDemoCars(params) {

  let cars = [...demoCars];

  const {
    platform,
    s,
    make,
    model,
    year_from,
    year_to,
    price_min,
    price_max,
    odometer_from,
    odometer_to,
    fuel_type,
    transmission,
    drive_type,
    damage,
    run_cond,
    has_key
  } = params;


  if (platform) {

    cars = cars.filter(
      car =>
        String(car.platform).toLowerCase() ===
        String(platform).toLowerCase()
    );

  }


  if (s) {

    const search =
      String(s).toLowerCase();

    cars = cars.filter(car =>
      [
        car.title,
        car.make,
        car.model,
        car.vin,
        car.lot,
        car.location
      ]
        .filter(Boolean)
        .some(value =>
          String(value)
            .toLowerCase()
            .includes(search)
        )
    );

  }


  if (make) {

    cars = cars.filter(
      car =>
        String(car.make).toLowerCase() ===
        String(make).toLowerCase()
    );

  }


  if (model) {

    cars = cars.filter(
      car =>
        String(car.model).toLowerCase().includes(
          String(model).toLowerCase()
        )
    );

  }


  if (year_from) {

    cars = cars.filter(
      car =>
        Number(car.year) >=
        Number(year_from)
    );

  }


  if (year_to) {

    cars = cars.filter(
      car =>
        Number(car.year) <=
        Number(year_to)
    );

  }


  if (price_min) {

    cars = cars.filter(
      car =>
        parsePrice(car.price) >=
        Number(price_min)
    );

  }


  if (price_max) {

    cars = cars.filter(
      car =>
        parsePrice(car.price) <=
        Number(price_max)
    );

  }


  if (odometer_from) {

    cars = cars.filter(
      car =>
        Number(car.odometer?.value || 0) >=
        Number(odometer_from)
    );

  }


  if (odometer_to) {

    cars = cars.filter(
      car =>
        Number(car.odometer?.value || 0) <=
        Number(odometer_to)
    );

  }


  if (fuel_type) {

    cars = cars.filter(
      car =>
        String(
          car.vehicle_specs?.fuel_type || ""
        ).toLowerCase() ===
        String(fuel_type).toLowerCase()
    );

  }


  if (transmission) {

    cars = cars.filter(
      car =>
        String(
          car.vehicle_specs?.transmission || ""
        ).toLowerCase() ===
        String(transmission).toLowerCase()
    );

  }


  if (drive_type) {

    cars = cars.filter(
      car =>
        String(
          car.vehicle_specs?.drive_type || ""
        ).toLowerCase() ===
        String(drive_type).toLowerCase()
    );

  }


  if (damage) {

    cars = cars.filter(
      car =>
        String(car.damage || "")
          .toLowerCase()
          .includes(
            String(damage).toLowerCase()
          )
    );

  }


  if (run_cond) {

    cars = cars.filter(
      car =>
        String(
          car.condition?.run_cond || ""
        ).toLowerCase() ===
        String(run_cond).toLowerCase()
    );

  }


  if (has_key !== undefined && has_key !== "") {

    const wanted =
      String(has_key).toLowerCase() === "true";

    cars = cars.filter(
      car =>
        Boolean(
          car.condition?.has_key
        ) === wanted
    );

  }


  return cars;
}


function parsePrice(price) {

  if (price === null || price === undefined) {
    return 0;
  }

  return Number(
    String(price)
      .replace(/[^0-9.]/g, "")
  ) || 0;
}


// ======================================================
// CARS API
// ======================================================

app.get("/api/cars", async (req, res) => {

  try {

    try {

      const live =
        await fetchApibaraCars(req.query);

      return res.json(live);

    } catch (error) {

      console.log(
        "Apibara niedostępne — używam DEMO:",
        error.message
      );

      const demo =
        filterDemoCars(req.query);

      return res.json(demo);

    }

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      ok: false,
      error: "Nie udało się pobrać samochodów."
    });

  }

});


// ======================================================
// AUTH
// ======================================================

// Tymczasowa baza użytkowników w pamięci.
// Później zastąpimy ją prawdziwą bazą danych.
const users = [];


// REJESTRACJA
app.post("/api/register", (req, res) => {

  const {
    name,
    email,
    password
  } = req.body;


  if (
    !name ||
    !email ||
    !password
  ) {

    return res.status(400).json({
      ok: false,
      message: "Wypełnij wszystkie pola."
    });

  }


  if (password.length < 6) {

    return res.status(400).json({
      ok: false,
      message: "Hasło musi mieć minimum 6 znaków."
    });

  }


  const normalizedEmail =
    String(email)
      .trim()
      .toLowerCase();


  const existing =
    users.find(
      user =>
        user.email === normalizedEmail
    );


  if (existing) {

    return res.status(409).json({
      ok: false,
      message: "Konto z tym adresem e-mail już istnieje."
    });

  }


  const user = {

    id: Date.now().toString(),

    name:
      String(name).trim(),

    email:
      normalizedEmail,

    password,

    favorites: [],

    bids: [],

    orders: [],

    createdAt:
      new Date().toISOString()

  };


  users.push(user);


  req.session.regenerate(error => {

    if (error) {

      console.error(error);

      return res.status(500).json({
        ok: false,
        message: "Nie udało się utworzyć sesji."
      });

    }


    req.session.userId =
      user.id;


    req.session.save(saveError => {

      if (saveError) {

        console.error(saveError);

        return res.status(500).json({
          ok: false,
          message: "Nie udało się zapisać sesji."
        });

      }


      return res.json({
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        }
      });

    });

  });

});


// LOGOWANIE
app.post("/api/login", (req, res) => {

  const {
    email,
    password
  } = req.body;


  const normalizedEmail =
    String(email || "")
      .trim()
      .toLowerCase();


  const user =
    users.find(
      item =>
        item.email === normalizedEmail &&
        item.password === password
    );


  if (!user) {

    return res.status(401).json({
      ok: false,
      message: "Nieprawidłowy e-mail lub hasło."
    });

  }


  req.session.regenerate(error => {

    if (error) {

      console.error(error);

      return res.status(500).json({
        ok: false,
        message: "Nie udało się rozpocząć sesji."
      });

    }


    req.session.userId =
      user.id;


    req.session.save(saveError => {

      if (saveError) {

        console.error(saveError);

        return res.status(500).json({
          ok: false,
          message: "Nie udało się zapisać sesji."
        });

      }


      return res.json({
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        }
      });

    });

  });

});


// AKTUALNY UŻYTKOWNIK
app.get("/api/me", (req, res) => {

  if (!req.session.userId) {

    return res.json({
      loggedIn: false
    });

  }


  const user =
    users.find(
      item =>
        item.id === req.session.userId
    );


  if (!user) {

    return res.json({
      loggedIn: false
    });

  }


  return res.json({
    loggedIn: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      favorites: user.favorites,
      bids: user.bids,
      orders: user.orders,
      createdAt: user.createdAt
    }
  });

});


// WYLOGOWANIE
app.post("/api/logout", (req, res) => {

  req.session.destroy(error => {

    if (error) {

      console.error(error);

      return res.status(500).json({
        ok: false,
        message: "Nie udało się wylogować."
      });

    }


    res.clearCookie("connect.sid");


    return res.json({
      ok: true
    });

  });

});


// ======================================================
// PROSTE ZABEZPIECZENIE PANELU
// ======================================================

app.get("/api/protected", (req, res) => {

  if (!req.session.userId) {

    return res.status(401).json({
      ok: false,
      message: "Musisz być zalogowany."
    });

  }


  return res.json({
    ok: true,
    message: "Dostęp przyznany."
  });

});


// ======================================================
// START
// ======================================================

app.listen(PORT, () => {

  console.log("");
  console.log("=================================");
  console.log(" MTBID");
  console.log(" Serwer działa");
  console.log(" http://localhost:" + PORT);
  console.log("=================================");
  console.log("");

});