const router = require("express").Router();
const pool = require("../db/pool");
const { authenticate, authorizeAdmin } = require("../middleware/auth");
const { syncPastFlightsStatus } = require("../utils/flightStatus");
const {
  getSeatPriceFromBase,
  normalizeSeatClass,
} = require("../utils/seatPricing");

function normalizedCityExpr(valueSql) {
  return `REGEXP_REPLACE(LOWER(TRIM(${valueSql})), '(.)\\1+', '\\1', 'g')`;
}

router.get("/", async (req, res) => {
  try {
    await syncPastFlightsStatus(pool);
    const { origin, destination, date, status } = req.query;

    let query = `
      SELECT
        f.*,
        CASE
          WHEN d.id IS NOT NULL THEN NULLIF(BTRIM(d.image_url), '')
          ELSE f.image_url
        END AS image_url,
        CASE
          WHEN d.id IS NOT NULL THEN NULLIF(BTRIM(d.tagline), '')
          ELSE f.tagline
        END AS tagline,
        COALESCE(NULLIF(BTRIM(d.city), ''), f.destination) AS destination
      FROM flights f
      LEFT JOIN destinations d
        ON ${normalizedCityExpr("d.city")} = ${normalizedCityExpr("f.destination")}
      WHERE 1=1`;
    const params = [];

    if (origin) {
      params.push(origin);
      query += ` AND LOWER(TRIM(f.origin)) = LOWER(TRIM($${params.length}::text))`;
    }

    if (destination) {
      params.push(destination);
      query += ` AND LOWER(TRIM(f.destination)) = LOWER(TRIM($${params.length}::text))`;
    }

    if (date) {
      params.push(date);
      query += ` AND DATE(f.departure_time) = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND f.status = $${params.length}`;
    }

    query += " ORDER BY f.departure_time ASC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/meta", async (req, res) => {
  try {
    await syncPastFlightsStatus(pool);
    const [origins, destinations, airlines] = await Promise.all([
      pool.query(
        `SELECT DISTINCT f.origin
         FROM flights f
         JOIN destinations d_origin
           ON ${normalizedCityExpr("d_origin.city")} = ${normalizedCityExpr("f.origin")}
         JOIN destinations d_destination
           ON ${normalizedCityExpr("d_destination.city")} = ${normalizedCityExpr("f.destination")}
         WHERE f.status = 'scheduled'
         ORDER BY f.origin`,
      ),
      pool.query(
        `SELECT DISTINCT f.destination
         FROM flights f
         JOIN destinations d_origin
           ON ${normalizedCityExpr("d_origin.city")} = ${normalizedCityExpr("f.origin")}
         JOIN destinations d_destination
           ON ${normalizedCityExpr("d_destination.city")} = ${normalizedCityExpr("f.destination")}
         WHERE f.status = 'scheduled'
         ORDER BY f.destination`,
      ),
      pool.query(
        `SELECT DISTINCT f.airline
         FROM flights f
         JOIN destinations d_origin
           ON ${normalizedCityExpr("d_origin.city")} = ${normalizedCityExpr("f.origin")}
         JOIN destinations d_destination
           ON ${normalizedCityExpr("d_destination.city")} = ${normalizedCityExpr("f.destination")}
         WHERE f.status = 'scheduled'
         ORDER BY f.airline`,
      ),
    ]);
    res.json({
      origins: origins.rows.map((r) => r.origin),
      destinations: destinations.rows.map((r) => r.destination),
      airlines: airlines.rows.map((r) => r.airline),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/deals", async (req, res) => {
  try {
    await syncPastFlightsStatus(pool);
    const { origin, include_all } = req.query;
    let query = `
      SELECT
        f.*,
        CASE
          WHEN d.id IS NOT NULL THEN NULLIF(BTRIM(d.image_url), '')
          ELSE f.image_url
        END AS image_url,
        CASE
          WHEN d.id IS NOT NULL THEN NULLIF(BTRIM(d.tagline), '')
          ELSE f.tagline
        END AS tagline,
        COALESCE(NULLIF(BTRIM(d.city), ''), f.destination) AS destination
      FROM flights f
      LEFT JOIN destinations d
        ON ${normalizedCityExpr("d.city")} = ${normalizedCityExpr("f.destination")}
      WHERE f.status = 'scheduled' AND f.available_seats > 0`;
    const params = [];
    if (include_all !== "1" && include_all !== "true") {
      query += " AND f.discount > 0";
    }
    if (origin) {
      params.push(origin);
      query += ` AND LOWER(TRIM(f.origin)) = LOWER(TRIM($${params.length}::text))`;
    }
    query += " ORDER BY f.departure_time ASC";
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/seat-class-normalize", (req, res) => {
  const raw =
    req.query.seatClass !== undefined
      ? req.query.seatClass
      : req.query.seat_class !== undefined
        ? req.query.seat_class
        : "";
  const normalized = normalizeSeatClass(raw);
  res.json({
    seat_class_input: String(raw),
    normalized_seat_class: normalized,
  });
});

router.get("/:flightId/seat-price", async (req, res) => {
  try {
    const flightId = Number(req.params.flightId);
    if (!Number.isInteger(flightId) || flightId <= 0) {
      return res.status(400).json({ error: "Invalid flight id." });
    }

    const seatNumber = String(req.query.seatNumber || "").trim();
    if (!seatNumber) {
      return res
        .status(400)
        .json({ error: "Query seatNumber is required (e.g. 5B, 12A)." });
    }

    const seatClass = String(req.query.seatClass || "economy").trim();
    const hasBaseOverride =
      req.query.basePrice !== undefined && String(req.query.basePrice) !== "";

    let basePrice;
    if (hasBaseOverride) {
      basePrice = Number(req.query.basePrice);
      if (!Number.isFinite(basePrice) || basePrice < 0) {
        return res.status(400).json({ error: "Invalid basePrice query." });
      }
    } else {
      const result = await pool.query(
        "SELECT price FROM flights WHERE id = $1",
        [flightId],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Flight not found." });
      }
      basePrice = result.rows[0].price;
    }

    const pricing = getSeatPriceFromBase({
      basePrice,
      seatNumber,
      seatClass,
    });

    res.json({
      flight_id: flightId,
      base_price_used: basePrice,
      seat_number: seatNumber,
      seat_class: seatClass,
      price: pricing.price,
      breakdown_items: pricing.breakdownItems,
      breakdown_text: pricing.breakdownText,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    await syncPastFlightsStatus(pool);
    const result = await pool.query(
      `SELECT
        f.*,
        CASE
          WHEN d.id IS NOT NULL THEN NULLIF(BTRIM(d.image_url), '')
          ELSE f.image_url
        END AS image_url,
        CASE
          WHEN d.id IS NOT NULL THEN NULLIF(BTRIM(d.tagline), '')
          ELSE f.tagline
        END AS tagline,
        COALESCE(NULLIF(BTRIM(d.city), ''), f.destination) AS destination
       FROM flights f
       LEFT JOIN destinations d
         ON ${normalizedCityExpr("d.city")} = ${normalizedCityExpr("f.destination")}
       WHERE f.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Flight not found." });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", authenticate, authorizeAdmin, async (req, res) => {
  try {
    const {
      flight_number,
      airline,
      origin,
      destination,
      departure_time,
      arrival_time,
      price,
      original_price,
      total_seats,
      image_url,
      tagline,
      discount,
    } = req.body;

    if (
      !flight_number ||
      !airline ||
      !origin ||
      !destination ||
      !departure_time ||
      !arrival_time ||
      !price
    ) {
      return res.status(400).json({ error: "Missing required flight fields." });
    }

    const result = await pool.query(
      `INSERT INTO flights (flight_number, airline, origin, destination, departure_time, arrival_time, price, original_price, total_seats, available_seats, image_url, tagline, discount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12)
       RETURNING *`,
      [
        flight_number,
        airline,
        origin,
        destination,
        departure_time,
        arrival_time,
        price,
        original_price || price,
        total_seats || 180,
        image_url || null,
        tagline || null,
        discount || 0,
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", authenticate, authorizeAdmin, async (req, res) => {
  try {
    const {
      flight_number,
      airline,
      origin,
      destination,
      departure_time,
      arrival_time,
      price,
      original_price,
      total_seats,
      available_seats,
      status,
      image_url,
      tagline,
      discount,
    } = req.body;

    const result = await pool.query(
      `UPDATE flights SET
        flight_number = COALESCE($1, flight_number),
        airline = COALESCE($2, airline),
        origin = COALESCE($3, origin),
        destination = COALESCE($4, destination),
        departure_time = COALESCE($5, departure_time),
        arrival_time = COALESCE($6, arrival_time),
        price = COALESCE($7, price),
        original_price = COALESCE($8, original_price),
        total_seats = COALESCE($9, total_seats),
        available_seats = COALESCE($10, available_seats),
        status = COALESCE($11, status),
        image_url = COALESCE($12, image_url),
        tagline = COALESCE($13, tagline),
        discount = COALESCE($14, discount)
       WHERE id = $15
       RETURNING *`,
      [
        flight_number,
        airline,
        origin,
        destination,
        departure_time,
        arrival_time,
        price,
        original_price,
        total_seats,
        available_seats,
        status,
        image_url,
        tagline,
        discount,
        req.params.id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Flight not found." });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", authenticate, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM flights WHERE id = $1 RETURNING id",
      [req.params.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Flight not found." });
    }
    res.json({ message: "Flight deleted successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
