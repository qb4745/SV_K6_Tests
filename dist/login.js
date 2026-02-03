"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.options = void 0;
exports.default = default_1;
const http_1 = __importDefault(require("k6/http"));
const k6_1 = require("k6");
// --- Configuration ---
exports.options = {
    thresholds: {
        // DT Standard: 95% of requests must complete within 2s
        http_req_duration: ['p(95)<2000'],
        // Error rate must be less than 1%
        http_req_failed: ['rate<0.01'],
    },
};
// --- Main Logic ---
function default_1() {
    const url = 'https://dev-app.smartvoting.cl/api/auth/iniciar_sesion';
    const payload = {
        nombreUsuario: 'tester',
        contrasenia: 'Costanuss4115#$',
    };
    const params = {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'k6-load-test/1.0',
            'Origin': 'https://qa-app.smartvoting.cl',
        },
    };
    const res = http_1.default.post(url, JSON.stringify(payload), params);
    // --- Validations ---
    (0, k6_1.check)(res, {
        'status is 201 or 200': (r) => r.status === 200 || r.status === 201, // API might return 201 for creation or 200 for OK
        'has access token': (r) => {
            try {
                const json = r.json();
                return json.accessToken !== undefined && json.accessToken.length > 0;
            }
            catch (e) {
                return false;
            }
        },
    });
    if (res.status !== 200 && res.status !== 201) {
        console.error(`Login failed: ${res.status} ${res.body}`);
    }
    (0, k6_1.sleep)(1);
}
