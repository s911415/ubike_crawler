const sqlite3_mod = require('sqlite3');
const fetch = require('node-fetch');
const https = require('https');

const sqlite3 = sqlite3_mod.verbose();

const FILE_PATH = process.argv[2];

if (FILE_PATH === undefined) {
    throw new Error(`InvalidArgumentException\nUsage node ${process.argv[1]} databaseName.db`);
}

let agent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 60000
});

let stationMap = new Map();

function transformDate(str) {
    let arr = [
        [0, 4], //y
        [4, 2], //m
        [6, 2], //d
        [8, 2], //h
        [10, 2], //i,
        [12, 2], //s
    ];

    let iArr = arr.map(v => parseInt(str.substr(...v), 10));
    iArr[1] -= 1; // Month start from zero
    return new Date(...iArr);
}

async function createTableIfNotExists(dbCon) {
    return await new Promise((a, b) => {
        dbCon.serialize(function () {
            dbCon.run(`
              CREATE TABLE IF NOT EXISTS "stations" (
                "no"      TEXT          NOT NULL,
                "name"    TEXT          NOT NULL,
                "area"    TEXT          NOT NULL,
                "address" TEXT          NOT NULL,
                "total"   INTEGER       NOT NULL,
                "lat"     DECIMAL(3, 5) NOT NULL,
                "lng"     DECIMAL(3, 5) NOT NULL,
                PRIMARY KEY ("no")
              )
            `);

            dbCon.run(`
              CREATE TABLE IF NOT EXISTS "status" (
                "no"                                TEXT    NOT NULL,
                "time"                              INTEGER NOT NULL,
                "number_of_available_vehicles"      INTEGER NOT NULL,
                "number_of_available_parking_space" INTEGER NOT NULL,
                "is_servicing"                      INTEGER NOT NULL,
                PRIMARY KEY ("no", "time"),
                CONSTRAINT "station_fk" FOREIGN KEY ("no") REFERENCES "stations" ("no")
                  ON DELETE RESTRICT
                  ON UPDATE RESTRICT
              )
            `);

            a(dbCon);
        });
    });
}

async function createDbCon() {
    return await new Promise((a, b) => {
        let db = new sqlite3.Database(FILE_PATH);
        db.serialize(function () {
            db.run("PRAGMA synchronous = OFF");
            let stationP = new Promise((a, b) => {
                db.each("SELECT no FROM stations", (err, row) => {
                    if (err) b(err);
                    stationMap.set(row.no, -1);
                }, a);
            });
            let statusP = new Promise((a, b) => {
                db.each("SELECT no, MAX(time) AS max_time FROM status GROUP BY no", (err, row) => {
                    if (err) b(err);
                    stationMap.set(row.no, row.max_time);
                }, a);
            });

            Promise.all([stationP, statusP]).then(() => {
                a(db);
            });
        });
    });
}

async function fetchDataFromApi() {
    let opts = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Referer': 'https://www.youbike.com.tw/home',
        },
        body: 'action=ub_site_by_sno_class&datas%5Blang%5D=tw&datas%5Bloc%5D=all',
        redirect: 'follow',
        compress: true,
        agent: agent
    };
    return await fetch('https://apis.youbike.com.tw/useAPI', opts)
        .then(r => r.json());
}

async function writeToDb(db, data) {
    return new Promise((a, b) => {
        if (data[0].retcode === '1') {
            let sortData = data[0].resdata;
            let stationPs = db.prepare("INSERT INTO stations(no, name, area, address, total, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)");

            let statusPs = db.prepare("INSERT INTO status(no, time, number_of_available_vehicles, number_of_available_parking_space, is_servicing)" +
                " VALUES (?, ?, ?, ?, ?)");

            let stationKeys = ['sno', 'sna', 'sarea', 'ar', 'tot', 'lat', 'lng'];
            let stationPromises = [];
            let statusPromises = [];
            let cnt1, cnt2;
            stationPromises.push(new Promise(a => {
                db.run('BEGIN', a);
            }));
            //Create stations
            cnt1 = 0;
            for (let no in sortData) {
                if (!sortData.hasOwnProperty(no)) continue;
                let d = sortData[no];
                if (stationMap.has(no)) continue;
                cnt1++;
                stationPromises.push(
                    new Promise((_ok, _err) => {
                        stationPs.run(...stationKeys.map(k => d[k]), function (err) {
                            if (err) {
                                console.error(err);
                                _err(err);
                            } else {
                                stationMap.set(no, -1);
                                _ok(err);
                            }
                        })
                    })
                );
            }
            stationPs.finalize();
            if (cnt1 === 0) {
                stationPromises.push(new Promise(a => {
                    db.run('SELECT 1', a);
                }));
            }
            stationPromises.push(new Promise(a => {
                db.run('COMMIT', a);
            }));

            Promise
                .all(stationPromises)
                .then(() => console.log(`Added ${cnt1} stations.`))
                .then(() => {
                    statusPromises.push(new Promise(a => {
                        db.run('BEGIN', a);
                    }));

                    cnt2 = 0;
                    for (let no in sortData) {
                        if (!sortData.hasOwnProperty(no)) continue;
                        let d = sortData[no];
                        let curTime = transformDate(d.mday) / 1e3;
                        if (curTime > stationMap.get(no)) {
                            cnt2++;
                            statusPromises.push(
                                new Promise((_ok, _err) => {
                                    statusPs.run([
                                        no,
                                        curTime,
                                        d.sbi,
                                        d.bemp,
                                        d.sv
                                    ], function (err) {
                                        if (err) {
                                            console.error(err);
                                            _err(err);
                                        } else {
                                            stationMap.set(no, curTime);
                                            _ok(err);
                                        }
                                    });
                                })
                            );
                        }
                    }
                    statusPs.finalize();
                    if (cnt2 === 0) {
                        statusPromises.push(new Promise(a => {
                            db.run('SELECT 1', a);
                        }));
                    }
                    statusPromises.push(new Promise(a => {
                        db.run('COMMIT', a);
                    }));

                    return Promise.all(statusPromises);
                })
                .then(() => console.log(`Updated ${cnt2} station status.`))
                .then(a);
        } else {
            b(data[0]);
        }
    });
}

let dbCon = null;

function loop() {
    let delay = 10 * 1e3;
    fetchDataFromApi()
        .then(data => {
            return writeToDb(dbCon, data)
        }).then(() => {
        setTimeout(loop, delay + Math.random() * (5 * 1e3));
    });
}

createDbCon().then(db => {
    dbCon = db;
    createTableIfNotExists(db).then(loop);
});
