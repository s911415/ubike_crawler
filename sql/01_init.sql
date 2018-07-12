PRAGMA foreign_keys = false;

-- ----------------------------
-- Table structure for stations
-- ----------------------------
CREATE TABLE "stations" (
  "no" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "area" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "total" INTEGER NOT NULL,
  "lat" DECIMAL(3,5) NOT NULL,
  "lng" DECIMAL(3,5) NOT NULL,
  PRIMARY KEY ("no")
);

-- ----------------------------
-- Table structure for status
-- ----------------------------
CREATE TABLE "status" (
  "no" TEXT NOT NULL,
  "time" INTEGER NOT NULL,
  "number_of_available_vehicles" INTEGER NOT NULL,
  "number_of_available_parking_space" INTEGER NOT NULL,
  "is_servicing" INTEGER NOT NULL,
  PRIMARY KEY ("no", "time"),
  CONSTRAINT "station_fk" FOREIGN KEY ("no") REFERENCES "stations" ("no") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- ----------------------------
-- Indexes structure for table stations
-- ----------------------------
CREATE INDEX "area_idx"
ON "stations" (
  "area" ASC
);

PRAGMA foreign_keys = true;
