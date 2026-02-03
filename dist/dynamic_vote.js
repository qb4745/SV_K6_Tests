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
const execution_1 = __importDefault(require("k6/execution")); // Importante para saber qué usuario nos toca
// --- 2. Carga Dinámica de Datos ---
// Esto lee el archivo ANTES de que empiece la prueba para saber cuántos hay
const users = new data_1.SharedArray('users', function () {
    const data = JSON.parse(open('../data/user_test.json'));
    return data;
});
// --- 3. Configuración Adaptativa ---
exports.options = {
    scenarios: {
        process_all_records: {
            // 'shared-iterations' es ideal: una lista de tareas compartida entre los VUs
            executor: 'shared-iterations',
            // La cantidad de VUs (concurrencia) puede ser fija o calculada.
            // Aquí ponemos un tope de 20 hilos simultáneos para procesar la lista.
            // Si tienes 1000 usuarios, estos 20 se irán turnando para procesarlos todos.
            vus: 20,
            // DINAMISMO PURO: Ejecutar exactamente tantas veces como líneas tenga el archivo
            iterations: users.length,
            maxDuration: '30m', // Tiempo máximo de seguridad
        },
    },
    thresholds: {
        'http_req_duration': ['p(95)<3000'],
        // Queremos 0 fallos, ya que cada link es único
        'http_req_failed': ['rate==0'],
    },
};
// --- Helpers ---
function cleanRut(rut) {
    return rut.replace(/[^0-9kK]/g, '');
}
function extractTokenFromLink(url) {
    const match = url.match(/[?&]token=([^&]+)/);
    return match ? match[1] : null;
}
function extractElectionId(url) {
    const match = url.match(/\/votacion\/(\d+)-/);
    return match ? match[1] : null;
}
// --- Lógica Principal (VU) ---
function default_1() {
    // --- SELECCIÓN ÚNICA Y SECUENCIAL ---
    // exec.scenario.iterationInTest nos da un índice único global (0, 1, 2, ... N)
    // Esto garantiza que procesamos el Array ordenadamente y sin repetir.
    const uniqueIndex = execution_1.default.scenario.iterationInTest;
    // Seguridad: Si por alguna razón el índice se pasa, abortamos
    if (uniqueIndex >= users.length)
        return;
    const user = users[uniqueIndex];
    // --- PREPARACIÓN DE DATOS ---
    const magicToken = extractTokenFromLink(user.link);
    const cleanedRut = cleanRut(user.rut);
    const electionId = extractElectionId(user.link);
    if (!magicToken || !electionId) {
        console.error(`❌ Datos corruptos en línea ${uniqueIndex} (RUT: ${user.rut})`);
        return;
    }
    const compositeUsername = `${electionId}-${cleanedRut}`;
    // LOG: Para que veas el progreso
    console.log(`[${uniqueIndex + 1}/${users.length}] Procesando RUT: ${cleanedRut}`);
    // --- PASO 1: LOGIN (Token Exchange) ---
    const loginUrl = 'https://qhbge6tp76.execute-api.us-east-1.amazonaws.com/qa/votantes/iniciar-sesion';
    const commonHeaders = {
        'Content-Type': 'application/json',
        'Origin': 'https://qa-app.smartvoting.cl',
        'x-proveedor': '2',
        'User-Agent': 'k6-dynamic-loader',
    };
    const loginRes = http_1.default.post(loginUrl, JSON.stringify({
        nombreUsuario: compositeUsername,
        contrasenia: magicToken,
        mecanismoIdentificacion: 2
    }), { headers: commonHeaders });
    if (loginRes.status !== 200) {
        console.error(`❌ Fallo Login ${cleanedRut}: ${loginRes.status} ${loginRes.body}`);
        return;
    }
    const sessionToken = loginRes.json().refreshToken;
    // --- PASO 2: VOTAR ---
    const voteUrl = 'https://qhbge6tp76.execute-api.us-east-1.amazonaws.com/qa/votantes/depositar-voto';
    const votePayload = JSON.stringify({
        papeletaId: 394,
        dniVotante: cleanedRut,
        voto: {
            votacionId: Number(electionId),
            papeletaId: 394,
            pesoVoto: 1,
            distribucionMaxima: 10,
            puntosVotacion: [
                {
                    puntoVotacionId: 447,
                    tipo: 'seleccion',
                    opciones: { preferencias: [1240], votoBlanco: false, votoNulo: false },
                },
            ],
        },
    });
    const voteRes = http_1.default.post(voteUrl, votePayload, {
        headers: Object.assign(Object.assign({}, commonHeaders), { 'Authorization': `Bearer ${sessionToken}` }),
    });
    (0, k6_1.check)(voteRes, {
        'Voto OK': (r) => r.status === 200 || r.status === 201,
    });
    // Pausa aleatoria pequeña para no ser detectado como robot sincronizado
    (0, k6_1.sleep)(Math.random() * 0.5 + 0.5);
}
