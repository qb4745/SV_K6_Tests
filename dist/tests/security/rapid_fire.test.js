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
// --------------------------------------------------------------------------
// IMPORTS DE ARQUITECTURA (Ajustados a tu estructura POM)
// --------------------------------------------------------------------------
const index_js_1 = require("../../config/index.js");
const auth_js_1 = require("../../api/auth.js");
const voting_js_1 = require("../../api/voting.js");
const helpers_js_1 = require("../../utils/helpers.js");
// --------------------------------------------------------------------------
// CONFIGURACIÓN DINÁMICA DE TIEMPO
// --------------------------------------------------------------------------
// Lee la variable 'MS' de la consola (ej: k6 run -e MS=50 ...)
// Si no se define, usa 100ms por defecto.
const INPUT_MS = __ENV.MS ? parseInt(__ENV.MS) : 100;
const DELAY_SECONDS = INPUT_MS / 1000; // k6 sleep usa segundos (50ms = 0.05s)
// --------------------------------------------------------------------------
// CARGA DE DATOS
// --------------------------------------------------------------------------
const users = new data_1.SharedArray('users', () => JSON.parse(open('../../../data/users.json')));
exports.options = {
    scenarios: {
        rapid_fire_sequence: {
            executor: 'shared-iterations',
            // Probamos con los primeros 5 usuarios disponibles
            vus: Math.min(5, users.length),
            iterations: Math.min(5, users.length),
            maxDuration: '5m',
        },
    },
    thresholds: {
        // El test pasa SÓLO si el 100% de las verificaciones (1 voto exitoso) se cumplen
        'checks': ['rate==1.0'],
    },
};
function default_1() {
    const idx = execution_1.default.scenario.iterationInTest;
    if (idx >= users.length)
        return;
    const user = users[idx];
    // ========================================================================
    // FASE 1: PREPARACIÓN Y HANDSHAKE
    // ========================================================================
    const magicToken = (0, helpers_js_1.extractTokenFromLink)(user.link);
    const rutLimpio = (0, helpers_js_1.cleanRut)(user.rut);
    const rutFormateado = (0, helpers_js_1.formatRut)(rutLimpio);
    const electionId = (0, helpers_js_1.extractElectionId)(user.link);
    const slug = (0, helpers_js_1.extractSlug)(user.link);
    if (!magicToken || !electionId || !slug) {
        console.log(`⏩ ${rutFormateado}: Skipped (Link mal formado)`);
        return;
    }
    // 1. Iniciar Sesión (Handshake)
    const sessionToken = auth_js_1.AuthAPI.login(`${electionId}-${rutLimpio}`, magicToken);
    if (!sessionToken) {
        console.log(`❌ ${rutFormateado}: Login Fallido (¿Token quemado?)`);
        return;
    }
    // 2. Obtener Metadata (Papeletas y Opciones)
    // Nota: Llamamos a votationMeta primero para "calentar" cookies/sesión si fuera necesario
    voting_js_1.VotingAPI.getVotationMeta(slug, sessionToken);
    const papRes = voting_js_1.VotingAPI.getPapeletas(electionId, sessionToken);
    let papeletas = [];
    try {
        const body = papRes.json();
        papeletas = body.papeletas || [];
    }
    catch (e) {
        console.error(`❌ ${rutFormateado}: Error parseando JSON de papeletas`);
        return;
    }
    if (papeletas.length === 0) {
        console.log(`⚠️ ${rutFormateado}: Sin papeletas (¿Usuario ya votó?)`);
        return;
    }
    // 3. Selección de Opción (Primera papeleta -> Primera Opción)
    const targetPapeleta = papeletas[0];
    const targetPunto = targetPapeleta.puntosVotacion[0];
    const opciones = targetPunto.opcionesVotacion;
    if (!opciones || opciones.length === 0) {
        console.error(`❌ ${rutFormateado}: Papeleta vacía (sin candidatos)`);
        return;
    }
    const targetOpcion = opciones[0];
    // 4. Construcción del Payload
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
    const headers = {
        'Content-Type': 'application/json',
        'Origin': index_js_1.CONFIG.ORIGIN,
        'x-proveedor': index_js_1.CONFIG.PROVIDER_ID,
        'Authorization': `Bearer ${sessionToken}`,
    };
    const params = {
        headers: headers,
        tags: { name: 'Rapid_Fire_Vote' },
    };
    // ========================================================================
    // FASE 2: SECUENCIA RAPID FIRE (Bucle de Ataque)
    // ========================================================================
    const attempts = 5; // Intentaremos votar 5 veces seguidas
    let successCount = 0;
    let rejectedCount = 0;
    const url = `${index_js_1.CONFIG.BASE_URL}/depositar-voto`;
    console.log(`🔥 ${rutFormateado}: Iniciando Ráfaga. Intervalo: ${INPUT_MS}ms (${DELAY_SECONDS}s)...`);
    for (let i = 0; i < attempts; i++) {
        const res = http_1.default.post(url, votePayload, params);
        // Contamos éxitos (200 OK o 201 Created)
        if (res.status === 200 || res.status === 201) {
            successCount++;
        }
        else {
            rejectedCount++;
        }
        // Espera dinámica controlada por CLI
        (0, k6_1.sleep)(DELAY_SECONDS);
    }
    // ========================================================================
    // FASE 3: ANÁLISIS FORENSE
    // ========================================================================
    if (successCount === 1) {
        console.log(`✅ ${rutFormateado}: CORRECTO. 1 voto aceptado, ${rejectedCount} bloqueados.`);
    }
    else if (successCount > 1) {
        console.error(`🚨 ${rutFormateado}: FALLO CRÍTICO. Se aceptaron ${successCount} votos consecutivos (Intervalo: ${INPUT_MS}ms).`);
    }
    else {
        console.warn(`⚠️ ${rutFormateado}: 0 votos aceptados (Probablemente error de lógica o datos).`);
    }
    // Validación final para k6
    (0, k6_1.check)(successCount, {
        [`Unico Voto Permitido (${INPUT_MS}ms)`]: (count) => count === 1,
    });
}
