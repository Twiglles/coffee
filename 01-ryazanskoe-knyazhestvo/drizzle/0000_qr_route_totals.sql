CREATE TABLE qr_route_totals (
  route_id INTEGER PRIMARY KEY NOT NULL CHECK (route_id BETWEEN 1 AND 5),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0)
);
