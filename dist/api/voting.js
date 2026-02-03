"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VotingAPI = void 0;
const http_1 = __importDefault(require("k6/http"));
const k6_1 = require("k6");
const index_js_1 = require("../config/index.js");
/**
 * Helper para generar los parámetros de la petición incluyendo
 * cabeceras de seguridad y etiquetas para Grafana.
 */
const getParams = (token, tagName) => ({
    headers: {
        'Content-Type': 'application/json',
        'Origin': index_js_1.CONFIG.ORIGIN,
        'x-proveedor': index_js_1.CONFIG.PROVIDER_ID,
        'User-Agent': index_js_1.CONFIG.USER_AGENT,
        'Authorization': `Bearer ${token}`,
    },
    tags: { name: tagName }, // <--- ESTO ES LO QUE HACE QUE GRAFANA FUNCIONE
});
class VotingAPI {
    static getVotationMeta(slug, token) {
        return http_1.default.get(`${index_js_1.CONFIG.BASE_URL}/obtener-votacion/${slug}`, getParams(token, '02_Get_Votation_Meta'));
    }
    static getRepresentante(dni, electionId, token) {
        const res = http_1.default.post(`${index_js_1.CONFIG.BASE_URL}/obtener-representante`, JSON.stringify({ dni, votacionId: electionId }), getParams(token, '03_Get_Representante'));
        (0, k6_1.check)(res, { 'Get Representante 200': (r) => r.status === 200 });
        return res;
    }
    static getVotantes(representanteId, electionId, token) {
        return http_1.default.post(`${index_js_1.CONFIG.BASE_URL}/obtener-votantes`, JSON.stringify({ representanteId, votacionId: electionId }), getParams(token, '04_Get_Votantes'));
    }
    static getPapeletas(electionId, token) {
        const res = http_1.default.get(`${index_js_1.CONFIG.BASE_URL}/obtener-papeletas-activas/${electionId}?etiquetasIds=*`, getParams(token, '05_Get_Papeletas'));
        (0, k6_1.check)(res, { 'Get Papeletas 200': (r) => r.status === 200 });
        return res;
    }
    static guardarBitacora(electionId, token) {
        return http_1.default.post(`${index_js_1.CONFIG.BASE_URL}/guardar-bitacora`, JSON.stringify({
            nivel: "INFO",
            modulo: "VOTANTE",
            tipoEvento: "AUTOSELECCION_PAPELETA_UNICA",
            votacionId: electionId
        }), getParams(token, '06_Guardar_Bitacora'));
    }
    static emitVote(payload, token) {
        const res = http_1.default.post(`${index_js_1.CONFIG.BASE_URL}/depositar-voto`, JSON.stringify(payload), getParams(token, '07_Depositar_Voto'));
        const checkRes = (0, k6_1.check)(res, { 'Voto Depositado 200': (r) => r.status === 200 });
        if (!checkRes) {
            const rut = payload.dniVotante || 'Desconocido';
            console.error(`❌ Vote Failed for ${rut}: ${res.status} Body: ${res.body}`);
        }
        return res;
    }
    static obtenerCertificado(electionId, dni, email, token) {
        return http_1.default.post(`${index_js_1.CONFIG.BASE_URL}/obtener-certificado-votante`, JSON.stringify({
            votacionId: electionId,
            dniRepresentante: dni,
            correoElectronico: email
        }), getParams(token, '08_Obtener_Certificado'));
    }
}
exports.VotingAPI = VotingAPI;
