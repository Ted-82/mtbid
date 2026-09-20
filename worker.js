export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/cars") {
      const cars = [
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

      const search = (url.searchParams.get("s") || "")
        .trim()
        .toLowerCase();

      let result = cars;

      if (search) {
        result = cars.filter(car =>
          String(car.vin).toLowerCase().includes(search) ||
          String(car.lot).toLowerCase().includes(search) ||
          String(car.make).toLowerCase().includes(search) ||
          String(car.model).toLowerCase().includes(search) ||
          String(car.title).toLowerCase().includes(search)
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          data: result,
          demo: true
        }),
        {
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    return env.ASSETS.fetch(request);
  }
};
