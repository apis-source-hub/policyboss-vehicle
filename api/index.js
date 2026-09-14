const UPSTREAM = "https://horizon.policyboss.com:5443/quote/vehicle_info_loggedin";
const SECRET_KEY = "SECRET-HZ07QRWY-JIBT-XRMQ-ZP95-J0RWP3DYRACW";
const CLIENT_KEY = "CLIENT-CNTP6NYE-CU9N-DUZW-CSPI-SH1IS4DOVHB9";
const SOURCE = "PB-BETA";
const UPSTREAM_TIMEOUT = 60000;

const REGEX = /^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{4}$|^[A-Z]{2}\s?\d{1,2}\s?BH\s?\d{4}$/i;

function normalizeNumber(number) {
    return (number || "").replace(/[\s-]+/g, "").toUpperCase();
}

function isValidNumber(number) {
    return REGEX.test(number.trim());
}

function cleanUpstream(raw) {
    const junk = new Set(["Ip_Address", "Calling_Source", "Product_Id_Request", "Ss_Id", "Channel", "Is_LM", "FastLaneId", "Match_Mode"]);
    
    const keys = Object.keys(raw);
    const firstSix = keys.slice(0, 6);
    const allDigits = firstSix.length > 0 && firstSix.every(k => /^\d+$/.test(k));

    const noVahan = (raw['0'] === 'N') || allDigits;
    
    let out = {};
    for (let [k, v] of Object.entries(raw)) {
        if (!junk.has(k) && !/^\d+$/.test(k)) {
            out[k] = v;
        }
    }
    
    out["found"] = !noVahan && Boolean(out["Make_Name"]);
    out["fastlane_response_obj"] = raw["FastlaneResponse_Obj"] || null;
    return out;
}

async function upstreamLookup(number, productId) {
    const payload = {
        secret_key: SECRET_KEY,
        client_key: CLIENT_KEY,
        RegistrationNumber: number,
        product_id: productId,
        ss_id: 0,
        source: SOURCE,
        session_id: "",
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT);

    try {
        const response = await fetch(UPSTREAM, {
            method: "POST",
            headers: {
                "Content-Type": "application/json;charset=utf-8",
                "Accept": "application/json",
                "Origin": "https://www.policyboss.com",
                "Referer": "https://www.policyboss.com/car-insurance",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Upstream error HTTP ${response.status}`);
        }

        return await response.json();
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    const { vehicle, number, product_id } = req.query;
    const vehicleParam = vehicle || number;

    if (!vehicleParam) {
        return res.status(400).json({
            status: "Error",
            message: "Please provide vehicle number parameter.",
            example: "/api?vehicle=UP32AB4567"
        });
    }

    let productId = parseInt(product_id || "1", 10);
    productId = Math.max(1, Math.min(productId, 12));

    const norm = normalizeNumber(vehicleParam);
    if (!isValidNumber(norm)) {
        return res.status(400).json({
            status: "Error",
            registration_number: norm,
            error: "Invalid Indian vehicle registration number format"
        });
    }

    const startTime = Date.now();
    try {
        const rawData = await upstreamLookup(norm, productId);
        let result = cleanUpstream(rawData);
        result["lookup_ms"] = Date.now() - startTime;

        return res.status(200).json({
            status: "Success",
            registration_number: norm,
            cached: false,
            data: result
        });
    } catch (err) {
        return res.status(502).json({
            status: "Error",
            registration_number: norm,
            error: `Upstream lookup failed: ${err.message}`
        });
    }
}
