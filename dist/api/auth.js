"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthAPI = void 0;
const http_1 = __importDefault(require("k6/http"));
const k6_1 = require("k6");
const index_js_1 = require("../config/index.js");
/**
 * Helper interno para los headers de autenticación inicial.
 * Incluye el tag '01_Login' para que Grafana pueda identificar esta fase.
 */
const getLoginParams = () => ({
    headers: {
        'Content-Type': 'application/json',
        'Origin': index_js_1.CONFIG.ORIGIN,
        'x-proveedor': index_js_1.CONFIG.PROVIDER_ID,
        'User-Agent': index_js_1.CONFIG.USER_AGENT,
    },
    tags: { name: '01_Login' }, // <--- Crucial para el gráfico de Latencia
});
class AuthAPI {
    /**
     * Realiza el intercambio de Token (Magic Link) por un RefreshToken de sesión.
     */
    static login(username, magicToken) {
        const url = `${index_js_1.CONFIG.BASE_URL}/iniciar-sesion`;
        const payload = JSON.stringify({
            nombreUsuario: username,
            mecanismoIdentificacion: 2,
            contrasenia: magicToken
        });
        const res = http_1.default.post(url, payload, getLoginParams());
        const isOk = (0, k6_1.check)(res, {
            'Login OK': (r) => r.status === 200,
            'Has RefreshToken': (r) => r.json('refreshToken') !== undefined
        });
        if (!isOk) {
            console.error(`❌ Login Failed for ${username}: ${res.status} ${res.body}`);
            return null;
        }
        // Retornamos el token necesario para el resto del flujo
        return res.json().refreshToken;
    }
}
exports.AuthAPI = AuthAPI;
