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
// Imports de arquitectura (Asumiendo tu estructura POM)
const index_js_1 = require("../../config/index.js");
const auth_js_1 = require("../../api/auth.js");
const voting_js_1 = require("../../api/voting.js");
const helpers_js_1 = require("../../utils/helpers.js");
// Carga de datos
const users = new data_1.SharedArray('users', () => JSON.parse(open('../../../data/users.json')));
exports.options = {
    scenarios: {
        rapid_fire_sequence: {
            executor: 'shared-iterations',
            // Usamos los mismos usuarios del archivo, uno por uno
            vus: Math.min(5, users.length),
            iterations: Math.min(5, users.length),
            maxDuration: '5m',
        },
    },
    thresholds: {
        // El éxito aquí es que SOLO 1 voto pase, el resto falle
        'checks': ['rate==1.0'],
    },
};
function default_1() {
    const idx = execution_1.default.scenario.iterationInTest;
    if (idx >= users.length)
        return;
    const user = users[idx];
    // --- FASE 1: PREPARACIÓN (Idéntica al script anterior) ---
    const magicToken = (0, helpers_js_1.extractTokenFromLink)(user.link);
    const rutLimpio = (0, helpers_js_1.cleanRut)(user.rut);
    const rutFormateado = (0, helpers_js_1.formatRut)(rutLimpio);
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
    // 2. Obtener Metadata para construir el voto
    voting_js_1.VotingAPI.getVotationMeta(slug, sessionToken); // Necesario para 'calentar' sesión
    const papRes = voting_js_1.VotingAPI.getPapeletas(electionId, sessionToken);
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
        console.log(`⚠️ ${rutFormateado}: Sin papeletas disponibles`);
        return;
    }
    // Lógica de selección de opción (Papeleta 0 -> Punto 0 -> Opción 0)
    const targetPapeleta = papeletas[0];
    const targetPunto = targetPapeleta.puntosVotacion[0];
    const opciones = targetPunto.opcionesVotacion;
    if (!opciones || opciones.length === 0) {
        console.error(`❌ ${rutFormateado}: Punto sin opciones`);
        return;
    }
    const targetOpcion = opciones[0];
    // 3. Payload (Estructura Corregida)
    const votePayload = JSON.stringify({
        papeletaId: targetPapeleta.id,
        dniVotante: rutLimpio,
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
    const params = {
        headers: {
            'Content-Type': 'application/json',
            'Origin': index_js_1.CONFIG.ORIGIN,
            'x-proveedor': index_js_1.CONFIG.PROVIDER_ID,
            'Authorization': `Bearer ${sessionToken}`,
        },
        tags: { name: 'Rapid_Fire_Vote' },
    };
    // --- FASE 2: SECUENCIA RAPID FIRE (Intervalo 100ms) ---
    const attempts = 5; // Intentaremos votar 5 veces seguidas
    let successCount = 0;
    let rejectedCount = 0;
    const url = `${index_js_1.CONFIG.BASE_URL}/depositar-voto`;
    console.log(`🔥 ${rutFormateado}: Iniciando ráfaga secuencial (5 intentos, 100ms delay)...`);
    for (let i = 0; i < attempts; i++) {
        const res = http_1.default.post(url, votePayload, params);
        // Análisis inmediato
        if (res.status === 200 || res.status === 201) {
            successCount++;
        }
        else {
            rejectedCount++;
        }
        // Espera de 100ms antes del siguiente "clic"
        // sleep recibe segundos: 0.1s = 100ms
        (0, k6_1.sleep)(0.1);
    }
    // --- FASE 3: ANÁLISIS ---
    if (successCount === 1) {
        console.log(`✅ ${rutFormateado}: CORRECTO. Sistema aceptó 1 y rechazó ${rejectedCount}.`);
    }
    else if (successCount > 1) {
        console.error(`🚨 ${rutFormateado}: FALLO DE CONSISTENCIA. Se aceptaron ${successCount} votos consecutivos.`);
    }
    else {
        console.warn(`⚠️ ${rutFormateado}: Ningún voto fue aceptado.`);
    }
    // El check pasa si EXACTAMENTE 1 voto fue exitoso
    (0, k6_1.check)(successCount, {
        'Unico Voto Permitido': (count) => count === 1,
    });
}
