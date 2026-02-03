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
// --- Carga de Datos ---
const users = new data_1.SharedArray('users', function () {
    return JSON.parse(open('../data/users_poc_1_voto.json'));
});
exports.options = {
    // Configuración para 1 VU para validar el flujo
    vus: 1,
    iterations: 1,
    thresholds: {
        'http_req_duration': ['p(95)<2000'], // SLA
        'checks': ['rate==1.0'], // 100% de éxito requerido
    },
};
// --- Funciones Utilitarias (Helpers) ---
function cleanRut(rut) {
    // Elimina puntos y guion: 19.156.416-2 -> 191564162
    return rut.replace(/[^0-9kK]/g, '');
}
function extractTokenFromLink(url) {
    const match = url.match(/[?&]token=([^&]+)/);
    return match ? match[1] : null;
}
function extractElectionId(url) {
    // Extrae el ID de la elección de la URL
    // Ej: .../votacion/254-test... -> Retorna "254"
    const match = url.match(/\/votacion\/(\d+)-/);
    return match ? match[1] : null;
}
// --- Lógica Principal ---
function default_1() {
    const user = users[0]; // Tomamos el usuario
    // 1. Preparación de Datos
    const magicToken = extractTokenFromLink(user.link); // Token A (Contraseña)
    const cleanedRut = cleanRut(user.rut);
    const electionId = extractElectionId(user.link);
    if (!magicToken || !electionId) {
        console.error('❌ Error: No se pudo extraer token o ID de elección del link');
        return;
    }
    // Construimos el nombre de usuario compuesto: "ID_ELECCION-RUT"
    // Ej: "254-191564162"
    const compositeUsername = `${electionId}-${cleanedRut}`;
    // ------------------------------------------------------
    // PASO 1: INICIAR SESIÓN (Canje de Token)
    // ------------------------------------------------------
    console.log(`1. Iniciando sesión para: ${compositeUsername}...`);
    const loginUrl = 'https://qhbge6tp76.execute-api.us-east-1.amazonaws.com/qa/votantes/iniciar-sesion';
    const loginPayload = JSON.stringify({
        nombreUsuario: compositeUsername,
        contrasenia: magicToken, // ¡Aquí va el token del link!
        mecanismoIdentificacion: 2 // 2 = Magic Link
    });
    const commonHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://qa-app.smartvoting.cl',
        'x-proveedor': '2',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    };
    const loginRes = http_1.default.post(loginUrl, loginPayload, { headers: commonHeaders });
    const loginCheck = (0, k6_1.check)(loginRes, {
        'Login Exitoso (200)': (r) => r.status === 200,
        'Recibimos refreshToken': (r) => r.json('refreshToken') !== undefined,
    });
    if (!loginCheck) {
        console.error(`❌ Fallo Login: ${loginRes.status} ${loginRes.body}`);
        return; // Abortamos si no hay login
    }
    // Extraemos el Token Real (Token B)
    const sessionToken = loginRes.json().refreshToken;
    console.log('✅ Token de sesión obtenido. Procediendo a votar...');
    (0, k6_1.sleep)(1); // Pequeña pausa de procesamiento
    // ------------------------------------------------------
    // PASO 2: DEPOSITAR VOTO (Usando el Token Nuevo)
    // ------------------------------------------------------
    const voteUrl = 'https://qhbge6tp76.execute-api.us-east-1.amazonaws.com/qa/votantes/depositar-voto';
    const votePayload = JSON.stringify({
        papeletaId: 394,
        dniVotante: cleanedRut,
        voto: {
            votacionId: Number(electionId), // Usamos el ID dinámico
            papeletaId: 394,
            pesoVoto: 1,
            distribucionMaxima: 10,
            puntosVotacion: [
                {
                    puntoVotacionId: 447,
                    tipo: 'seleccion',
                    opciones: {
                        preferencias: [1240],
                        votoBlanco: false,
                        votoNulo: false,
                    },
                },
            ],
        },
    });
    const voteParams = {
        headers: Object.assign(Object.assign({}, commonHeaders), { 'Authorization': `Bearer ${sessionToken}` }),
    };
    const voteRes = http_1.default.post(voteUrl, votePayload, voteParams);
    const voteCheck = (0, k6_1.check)(voteRes, {
        'Voto Registrado (200/201)': (r) => r.status === 200 || r.status === 201,
    });
    if (!voteCheck) {
        console.error(`❌ Fallo Voto: ${voteRes.status} ${voteRes.body}`);
    }
    else {
        console.log(`🎉 ÉXITO TOTAL: Voto emitido para RUT ${cleanedRut}`);
    }
}
