"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.options = void 0;
exports.default = default_1;
const http_1 = __importDefault(require("k6/http"));
const k6_1 = require("k6");
const data_1 = require("k6/data");
const execution_1 = __importDefault(require("k6/execution"));
// --- CONFIGURACIÓN BASE ---
const BASE_URL = 'https://qhbge6tp76.execute-api.us-east-1.amazonaws.com/qa/votantes';
const ORIGIN = 'https://qa-app.smartvoting.cl';
// --- CARGA DE DATOS ---
const users = new data_1.SharedArray('users', function () {
    return JSON.parse(open('../data/users.json'));
});
exports.options = {
    scenarios: {
        xml_defined_flow: {
            executor: 'shared-iterations',
            vus: Math.min(20, users.length),
            iterations: users.length,
            maxDuration: '45m',
        },
    },
    thresholds: {
        'http_req_failed': ['rate==0.00'],
        'http_req_duration': ['p(95)<5000'],
    },
};
// --- HELPERS ---
function cleanRut(rut) {
    return rut.replace(/[^0-9kK]/g, '');
}
function extractTokenFromLink(url) {
    const match = url.match(/[?&]token=([^&]+)/);
    return match ? match[1] : null;
}
function extractSlug(url) {
    const match = url.match(/\/votacion\/([^?]+)/);
    return match ? match[1] : null;
}
function extractElectionId(url) {
    const match = url.match(/\/votacion\/(\d+)-/);
    return match ? match[1] : null;
}
function formatRut(rut) {
    const cleaned = cleanRut(rut);
    if (cleaned.length < 2)
        return cleaned;
    const dv = cleaned.slice(-1);
    const body = cleaned.slice(0, -1);
    return body.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.') + '-' + dv;
}
// --- FLUJO PRINCIPAL ---
function default_1() {
    const idx = execution_1.default.scenario.iterationInTest;
    if (idx >= users.length)
        return;
    const user = users[idx];
    const magicToken = extractTokenFromLink(user.link);
    const cleanedRut = cleanRut(user.rut);
    const votingSlug = extractSlug(user.link);
    const electionId = extractElectionId(user.link);
    if (!magicToken || !votingSlug || !electionId) {
        console.error(`❌ Datos corruptos: ${user.rut}`);
        return;
    }
    const compositeUsername = `${electionId}-${cleanedRut}`;
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Origin': ORIGIN,
        'x-proveedor': '2',
        'User-Agent': 'k6-fix-json-agent',
    };
    // 1. INICIAR SESIÓN
    const loginRes = http_1.default.post(`${BASE_URL}/iniciar-sesion`, JSON.stringify({
        nombreUsuario: compositeUsername,
        mecanismoIdentificacion: 2,
        contrasenia: magicToken
    }), { headers });
    if (!(0, k6_1.check)(loginRes, { 'Login OK': (r) => r.status === 200 })) {
        console.error(`❌ Fallo Login ${formatRut(cleanedRut)}: ${loginRes.body}`);
        return;
    }
    const sessionToken = loginRes.json().refreshToken;
    const authHeaders = Object.assign(Object.assign({}, headers), { 'Authorization': `Bearer ${sessionToken}` });
    // 2. OBTENER VOTACIÓN
    http_1.default.get(`${BASE_URL}/obtener-votacion/${votingSlug}`, { headers: authHeaders });
    // 3. OBTENER REPRESENTANTE
    const repRes = http_1.default.post(`${BASE_URL}/obtener-representante`, JSON.stringify({
        dni: cleanedRut,
        votacionId: Number(electionId)
    }), { headers: authHeaders });
    if (!(0, k6_1.check)(repRes, { 'Rep OK': (r) => r.status === 200 }))
        return;
    const repData = repRes.json().representante;
    const representanteId = repData.id;
    const emailUser = repData.correoElectronico;
    // 4. OBTENER VOTANTES
    http_1.default.post(`${BASE_URL}/obtener-votantes`, JSON.stringify({
        representanteId: representanteId,
        votacionId: Number(electionId)
    }), { headers: authHeaders });
    // ===========================================================================
    // PASO 5: OBTENER PAPELETAS (ESTRUCTURA CORREGIDA)
    // ===========================================================================
    const papeletasRes = http_1.default.get(`${BASE_URL}/obtener-papeletas-activas/${electionId}?etiquetasIds=*`, { headers: authHeaders });
    if (!(0, k6_1.check)(papeletasRes, { 'Papeletas Status 200': (r) => r.status === 200 }))
        return;
    // CORRECCIÓN: Parseamos la respuesta completa primero
    const responseBody = papeletasRes.json();
    // CORRECCIÓN: Accedemos a la propiedad .papeletas
    const papeletasList = responseBody.papeletas;
    if (!papeletasList || papeletasList.length === 0) {
        console.error(`⚠️ ALERTA: ${cleanedRut} no tiene papeletas activas. Response: ${papeletasRes.body}`);
        return;
    }
    const targetPapeleta = papeletasList[0];
    if (!targetPapeleta.puntosVotacion || targetPapeleta.puntosVotacion.length === 0) {
        console.error(`❌ Papeleta ${targetPapeleta.id} sin puntos de votación.`);
        return;
    }
    const targetPunto = targetPapeleta.puntosVotacion[0];
    // CORRECCIÓN: Buscamos 'opcionesVotacion', NO 'opciones'
    if (!targetPunto.opcionesVotacion || targetPunto.opcionesVotacion.length === 0) {
        console.error(`❌ Punto ${targetPunto.id} sin opciones de votación.`);
        return;
    }
    const targetOpcion = targetPunto.opcionesVotacion[0];
    console.log(`✅ [${formatRut(cleanedRut)}] Seleccionado: Pap:${targetPapeleta.id} / Opc:${targetOpcion.id}`);
    // 6. BITÁCORA
    http_1.default.post(`${BASE_URL}/guardar-bitacora`, JSON.stringify({
        nivel: "INFO",
        modulo: "VOTANTE",
        tipoEvento: "AUTOSELECCION_PAPELETA_UNICA",
        votacionId: Number(electionId)
    }), { headers: authHeaders });
    (0, k6_1.sleep)(0.5);
    // 7. DEPOSITAR VOTO
    const votePayload = JSON.stringify({
        papeletaId: targetPapeleta.id,
        dniVotante: cleanedRut,
        voto: {
            votacionId: Number(electionId),
            papeletaId: targetPapeleta.id,
            pesoVoto: 1,
            distribucionMaxima: 0,
            puntosVotacion: [
                {
                    puntoVotacionId: targetPunto.id,
                    tipo: 'seleccion',
                    opciones: {
                        preferencias: [targetOpcion.id],
                        votoBlanco: false,
                        votoNulo: false
                    }
                }
            ]
        }
    });
    const voteRes = http_1.default.post(`${BASE_URL}/depositar-voto`, votePayload, { headers: authHeaders });
    if (!(0, k6_1.check)(voteRes, { 'Voto OK': (r) => r.status === 200 })) {
        console.error(`❌ Fallo Voto ${formatRut(cleanedRut)}: ${voteRes.body}`);
        return;
    }
    // 8. CERTIFICADO
    http_1.default.post(`${BASE_URL}/obtener-certificado-votante`, JSON.stringify({
        votacionId: Number(electionId),
        dniRepresentante: cleanedRut,
        correoElectronico: emailUser
    }), { headers: authHeaders });
    console.log(`🎉 Voto completado para ${formatRut(cleanedRut)}`);
}
