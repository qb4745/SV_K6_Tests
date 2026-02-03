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
const index_js_1 = require("../../config/index.js");
const auth_js_1 = require("../../api/auth.js");
const voting_js_1 = require("../../api/voting.js");
const helpers_js_1 = require("../../utils/helpers.js");
const users = new data_1.SharedArray('users', () => JSON.parse(open('../../../data/users.json')));
exports.options = {
    scenarios: {
        race_condition_attack: {
            executor: 'shared-iterations',
            // Lanzamos 10 hilos concurrentes
            vus: Math.min(10, users.length),
            // Realizamos 10 ataques (uno por cada RUT del JSON)
            iterations: Math.min(10, users.length),
            maxDuration: '5m',
        },
    },
    thresholds: {
        'checks': ['rate==1.0'],
    },
};
function default_1() {
    const idx = execution_1.default.scenario.iterationInTest;
    if (idx >= users.length)
        return;
    const user = users[idx];
    // --- FASE 1: PREPARACIÓN ---
    const magicToken = (0, helpers_js_1.extractTokenFromLink)(user.link);
    const rutLimpio = (0, helpers_js_1.cleanRut)(user.rut); // Para el Payload (123456789)
    const rutFormateado = (0, helpers_js_1.formatRut)(rutLimpio); // Para los Logs (12.345.678-9)
    const electionId = (0, helpers_js_1.extractElectionId)(user.link);
    const slug = (0, helpers_js_1.extractSlug)(user.link);
    if (!magicToken || !electionId || !slug) {
        console.log(`⏩ ${rutFormateado}: Skipped (Datos inválidos)`);
        return;
    }
    // 1. Login
    const sessionToken = auth_js_1.AuthAPI.login(`${electionId}-${rutLimpio}`, magicToken);
    if (!sessionToken) {
        console.log(`❌ ${rutFormateado}: Falló Login`);
        return;
    }
    // 2. Obtener Datos (Metadata)
    voting_js_1.VotingAPI.getVotationMeta(slug, sessionToken);
    // 3. Obtener Papeletas (Con estructura corregida)
    const papRes = voting_js_1.VotingAPI.getPapeletas(electionId, sessionToken);
    // Parseo seguro de la estructura { papeletas: [...] }
    let papeletas = [];
    try {
        const body = papRes.json();
        papeletas = body.papeletas || [];
    }
    catch (e) {
        console.error(`❌ ${rutFormateado}: Error parseando papeletas`);
        return;
    }
    if (papeletas.length === 0) {
        console.log(`⚠️ ${rutFormateado}: Sin papeletas (¿Ya votó?)`);
        return;
    }
    // Selección dinámica de opciones
    const targetPapeleta = papeletas[0];
    const targetPunto = targetPapeleta.puntosVotacion[0];
    // FIX: Usamos 'opcionesVotacion' como descubrimos en el load test
    const opciones = targetPunto.opcionesVotacion || targetPunto.opciones;
    if (!opciones || opciones.length === 0) {
        console.error(`❌ ${rutFormateado}: Punto sin opciones`);
        return;
    }
    const targetOpcion = opciones[0];
    // 4. Construcción del Payload (CORREGIDO)
    const votePayload = JSON.stringify({
        papeletaId: targetPapeleta.id,
        dniVotante: rutLimpio, // <--- IMPORTANTE: RUT LIMPIO
        voto: {
            votacionId: Number(electionId),
            papeletaId: targetPapeleta.id,
            pesoVoto: 1,
            distribucionMaxima: 0,
            puntosVotacion: [{
                    puntoVotacionId: targetPunto.id,
                    tipo: 'seleccion',
                    opciones: {
                        preferencias: [targetOpcion.id],
                        votoBlanco: false,
                        votoNulo: false
                    }
                }]
        }
    });
    const headers = {
        'Content-Type': 'application/json',
        'Origin': index_js_1.CONFIG.ORIGIN,
        'x-proveedor': index_js_1.CONFIG.PROVIDER_ID,
        'User-Agent': index_js_1.CONFIG.USER_AGENT,
        'Authorization': `Bearer ${sessionToken}`,
    };
    // --- FASE 2: EL ATAQUE (Paralelo) ---
    const requestConfig = {
        method: 'POST',
        url: `${index_js_1.CONFIG.BASE_URL}/depositar-voto`,
        body: votePayload,
        params: { headers: headers, tags: { name: 'Race_Attack' } },
    };
    // Disparo simultáneo de 3 hilos
    const responses = http_1.default.batch([requestConfig, requestConfig, requestConfig]);
    // --- FASE 3: REPORTE FORENSE ---
    let successCount = 0; // 200 OK
    let errorCount = 0; // 500 Error
    let otherCount = 0; // 403, 400, etc
    let statusCodes = [];
    let errorBody = "";
    responses.forEach((res) => {
        statusCodes.push(res.status);
        if (res.status === 200 || res.status === 201) {
            successCount++;
        }
        else if (res.status === 500 || res.status === 409) {
            errorCount++;
            if (!errorBody)
                errorBody = String(res.body); // Guardamos un error para ver qué dice
        }
        else {
            otherCount++;
        }
    });
    // LOGICA DE REPORTE
    if (successCount === 1) {
        console.log(`✅ ${rutFormateado}: INTEGRIDAD CORRECTA. (1 aceptado, ${errorCount} rechazados)`);
    }
    else if (successCount > 1) {
        console.error(`🚨 ${rutFormateado}: CRÍTICO - RACE CONDITION. (${successCount} votos aceptados)`);
    }
    else {
        // Si todos fallaron, mostramos por qué
        console.warn(`⚠️ ${rutFormateado}: 0 Votos. Todos fallaron. Status: [${statusCodes}]`);
        if (errorBody)
            console.log(`   ↳ Razón del error: ${errorBody}`);
    }
    (0, k6_1.check)(successCount, {
        'Integridad Voto (Max 1)': (count) => count === 1,
    });
}
