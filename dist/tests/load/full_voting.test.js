"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.options = void 0;
exports.default = default_1;
const data_1 = require("k6/data");
const execution_1 = __importDefault(require("k6/execution"));
const k6_1 = require("k6");
// Imports from POM structure
const index_js_1 = require("../../config/index.js");
const auth_js_1 = require("../../api/auth.js");
const voting_js_1 = require("../../api/voting.js");
const helpers_js_1 = require("../../utils/helpers.js");
// Data Loading
const users = new data_1.SharedArray('users', () => JSON.parse(open('../../../data/users.json')));
exports.options = {
    scenarios: {
        pom_refactor_load: {
            executor: 'shared-iterations',
            vus: Math.min(20, users.length),
            iterations: users.length,
            maxDuration: '45m',
        },
    },
    thresholds: index_js_1.THRESHOLDS.STRICT,
};
function default_1() {
    const vuId = execution_1.default.vu.idInTest;
    const idx = execution_1.default.scenario.iterationInTest;
    if (idx >= users.length)
        return;
    const user = users[idx];
    const startTime = Date.now();
    // 1. Preparation
    const magicToken = (0, helpers_js_1.extractTokenFromLink)(user.link);
    const rut = (0, helpers_js_1.cleanRut)(user.rut);
    const fmtRut = (0, helpers_js_1.formatRut)(rut);
    const electionId = (0, helpers_js_1.extractElectionId)(user.link);
    const slug = (0, helpers_js_1.extractSlug)(user.link);
    const logPrefix = `VU:${vuId} | RUT:${fmtRut}`;
    console.log(`── ${logPrefix} | START ──`);
    if (!magicToken || !electionId || !slug) {
        console.error(`❌ ${logPrefix} | DATA_MISSING | Token, ElectionId or Slug not found in link.`);
        return;
    }
    const username = `${electionId}-${rut}`;
    // 2. Login
    const sessionToken = auth_js_1.AuthAPI.login(username, magicToken);
    if (!sessionToken) {
        console.error(`❌ ${logPrefix} | LOGIN_FAILED`);
        return;
    }
    console.log(`✅ ${logPrefix} | LOGIN_OK`);
    // 3. Get Votation Meta
    voting_js_1.VotingAPI.getVotationMeta(slug, sessionToken);
    // 4. Get Representante
    const repRes = voting_js_1.VotingAPI.getRepresentante(rut, Number(electionId), sessionToken);
    if (repRes.status !== 200) {
        console.error(`❌ ${logPrefix} | REP_FAILED | Status: ${repRes.status}`);
        return;
    }
    const repData = repRes.json().representante;
    const emailUser = repData.correoElectronico;
    // 5. Get Votantes
    voting_js_1.VotingAPI.getVotantes(repData.id, Number(electionId), sessionToken);
    // 6. Get Papeletas
    const papRes = voting_js_1.VotingAPI.getPapeletas(electionId, sessionToken);
    if (papRes.status !== 200) {
        console.error(`❌ ${logPrefix} | PAPELETAS_FAILED | Status: ${papRes.status}`);
        return;
    }
    const responseBody = papRes.json();
    const papeletasList = responseBody.papeletas;
    if (!papeletasList || papeletasList.length === 0) {
        console.error(`❌ ${logPrefix} | NO_PAPELETAS`);
        return;
    }
    const targetPapeleta = papeletasList[0];
    const targetPunto = targetPapeleta.puntosVotacion[0];
    const targetOpcion = targetPunto.opcionesVotacion[0];
    console.log(`✅ ${logPrefix} | SELECTED | Pap:${targetPapeleta.id} / Punto:${targetPunto.id} / Opc:${targetOpcion.id}`);
    // 7. Save Log
    voting_js_1.VotingAPI.guardarBitacora(Number(electionId), sessionToken);
    (0, k6_1.sleep)(0.5);
    // 8. Emit Vote - CORREGIDO
    const votePayload = {
        papeletaId: targetPapeleta.id,
        dniVotante: rut, // <--- CAMBIO CLAVE: Usar 'rut' (limpio), no 'fmtRut'
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
    };
    voting_js_1.VotingAPI.emitVote(votePayload, sessionToken);
    // 9. Get Certificate
    voting_js_1.VotingAPI.obtenerCertificado(Number(electionId), rut, emailUser, sessionToken);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`── ${logPrefix} | END | Duration: ${duration}s ──`);
}
