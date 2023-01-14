import https from "https";

function lastSunday(month, year) {
  var d = new Date();
  var lastDayOfMonth = new Date(
    Date.UTC(year || d.getFullYear(), month + 1, 0)
  );
  var day = lastDayOfMonth.getDay();
  return new Date(
    Date.UTC(
      lastDayOfMonth.getFullYear(),
      lastDayOfMonth.getMonth(),
      lastDayOfMonth.getDate() - day
    )
  );
}

function isBST() {
  var d = new Date();
  var starts = lastSunday(2, d.getFullYear());
  starts.setHours(1);
  var ends = lastSunday(9, d.getFullYear());
  starts.setHours(1);
  return d.getTime() >= starts.getTime() && d.getTime() < ends.getTime();
}

const makeHttpRequest = (options, jsonResponse = false) => {
  return new Promise((resolve, reject) => {
    const request = https.request(options, (resp) => {
      console.log(options.path, resp.statusCode);
      let data = "";

      // A chunk of data has been received.
      resp.on("data", (chunk) => {
        data += chunk;
      });

      resp.on("end", () => {
        resolve(jsonResponse ? JSON.parse(data) : undefined);
      });
    });

    if (options.body) {
      request.write(options.body);
    }

    request.on("error", (e) => {
      console.error(e);
      reject(e);
    });
    request.end();
  });
};

const makeHttpRequestForCookies = (options) => {
  return new Promise((resolve, reject) => {
    const request = https.request(options, (resp) => {
      console.log(options.path, resp.statusCode);
      const cookiesArray = resp.headers["set-cookie"];
      const cookies =
        cookiesArray.map((x) => x.split("; ")[0]).join("; ") + ";";
      resolve(cookies);
    });

    request.on("error", (e) => {
      console.error(e);
      reject(e);
    });
    request.end();
  });
};

const getTomorrowsDateString = () => {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split("T")[0];
};

const getTomorrowsTariffs = async () => {
  const tomorrow = getTomorrowsDateString();
  const response = await makeHttpRequest(
    {
      hostname: "api.octopus.energy",
      port: 443,
      path: "/v1/products/AGILE-18-02-21/electricity-tariffs/E-1R-AGILE-18-02-21-C/standard-unit-rates/",
      method: "GET",
    },
    true
  );
  const tariffs = response.results.filter((x) =>
    x.valid_from.startsWith(tomorrow)
  );
  return tariffs;
};

const getCheapestTariffs = (tariffs) => {
  const sorted = tariffs.sort((a, b) => a.value_exc_vat - b.value_exc_vat);
  return sorted.slice(0, 6);
};

const loginToGrowatt = async () => {
  const cookies = await makeHttpRequestForCookies({
    hostname: "server.growatt.com",
    port: 443,
    path: "/login",
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `userName=${process.env.USERNAME}&password=${process.env.PASSWORD}&validateCode=&isReadPact=0`,
  });
  return cookies;
};

const convertTariffToHoursAndMinutesRange = (tariff, bst) => {
  const costThreshold = parseInt(process.env.COST_THRESHOLD || "25", 10);
  // e.g. 2023-01-14T14:30:00Z
  const hoursAndMinsStart = tariff.valid_from
    .split("T")[1]
    .split(":")
    .slice(0, 2);
  const hoursAndMinsEnd = tariff.valid_to.split("T")[1].split(":").slice(0, 2);

  if (bst) {
    hoursAndMinsStart[0] = (parseInt(hoursAndMinsStart[0], 10) + 1)
      .toString()
      .padStart(2, "0");
    hoursAndMinsEnd[0] = (parseInt(hoursAndMinsEnd[0], 10) + 1)
      .toString()
      .padStart(2, "0");
  }
  const turnedOn = tariff.value_inc_vat < costThreshold;
  if (!turnedOn) {
    console.log(`Ignoring tariff at ${tariff.value_inc_vat} pence`);
  }
  return [...hoursAndMinsStart, ...hoursAndMinsEnd, turnedOn ? "1" : "0"]; // 1 refers to turning on this time range
};

const generateFormParamsFromArray = (values) => {
  return values.map((x, i) => `param${i + 1}=${x}`).join("&");
};

const updateBatteryTime1 = async (tariffs, cookies) => {
  const bst = isBST();
  const parameters = [
    "100", // charge power %
    "100", // charge stopped %
    "1", // AC Charge
    ...tariffs.flatMap((x) => convertTariffToHoursAndMinutesRange(x, bst)),
  ];
  await makeHttpRequest({
    hostname: "server.growatt.com",
    port: 443,
    path: "/tcpSet.do",
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Cookie: cookies,
    },
    body: `action=mixSet&serialNum=${
      process.env.SERIAL_NUMBER
    }&type=mix_ac_charge_time_period&${generateFormParamsFromArray(
      parameters
    )}`,
  });
};

const updateBatteryTime2 = async (tariffs, cookies) => {
  const bst = isBST();
  const parameters = tariffs.flatMap((x) =>
    convertTariffToHoursAndMinutesRange(x, bst)
  );
  await makeHttpRequest({
    hostname: "server.growatt.com",
    port: 443,
    path: "/tcpSet.do",
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Cookie: cookies,
    },
    body: `action=mixSet&serialNum=${
      process.env.SERIAL_NUMBER
    }&type=mix_ac_charge_time_multi_1&${generateFormParamsFromArray(
      parameters
    )}`,
  });
};

export const run = async () => {
  const tariffs = await getTomorrowsTariffs();
  const cheapestTariffs = getCheapestTariffs(tariffs);
  console.log("Cheapest 6 tariffs");
  console.log(cheapestTariffs);
  if (cheapestTariffs.length === 0) {
    console.error("Failed to get tariffs");
    return;
  }
  const cookies = await loginToGrowatt();
  await updateBatteryTime1(cheapestTariffs.slice(0, 3), cookies);
  await updateBatteryTime2(
    cheapestTariffs.slice(3, cheapestTariffs.length),
    cookies
  );
  return cheapestTariffs;
};
