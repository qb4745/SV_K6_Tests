import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { Options } from 'k6/options';
import { sleep } from 'k6';

// Imports from POM structure
import { THRESHOLDS } from '../../config/index.js';
import { AuthAPI } from '../../api/auth.js';
import { VotingAPI } from '../../api/voting.js';
import { cleanRut, extractTokenFromLink, extractElectionId, extractSlug, formatRut } from '../../utils/helpers.js';
import { User, PapeletaActiva, RepresentanteResponse,  } from '../../types/smartvoting.js';

// Data Loading
const users = new SharedArray('users', () => JSON.parse(open('../../../data/users.json')));

export const options: Options = {
  scenarios: {
    pom_refactor_load: {
      executor: 'shared-iterations',
      vus: Math.min(20, users.length),
      iterations: users.length,
      maxDuration: '45m',
    },
  },
  thresholds: THRESHOLDS.STRICT,
};

export default function () {
  const vuId = exec.vu.idInTest;
  const idx = exec.scenario.iterationInTest;
  if (idx >= users.length) return;
  const user = users[idx] as User;
  const startTime = Date.now();

  // 1. Preparation
  const magicToken = extractTokenFromLink(user.link);
  const rut = cleanRut(user.rut);
  const fmtRut = formatRut(rut);
  const electionId = extractElectionId(user.link);
  const slug = extractSlug(user.link);
  
  const logPrefix = `VU:${vuId} | RUT:${fmtRut}`;
  
  console.log(`── ${logPrefix} | START ──`);

  if (!magicToken || !electionId || !slug) {
      console.error(`❌ ${logPrefix} | DATA_MISSING | Token, ElectionId or Slug not found in link.`);
      return;
  }

  const username = `${electionId}-${rut}`;

  // 2. Login
  const sessionToken = AuthAPI.login(username, magicToken);
  
  if (!sessionToken) {
    console.error(`❌ ${logPrefix} | LOGIN_FAILED`);
    return;
  }
  console.log(`✅ ${logPrefix} | LOGIN_OK`);

  // 3. Get Votation Meta
  VotingAPI.getVotationMeta(slug, sessionToken);

  // 4. Get Representante
  const repRes = VotingAPI.getRepresentante(rut, Number(electionId), sessionToken);
  if (repRes.status !== 200) {
    console.error(`❌ ${logPrefix} | REP_FAILED | Status: ${repRes.status}`);
    return;
  }
  
  const repData = (repRes.json() as unknown as RepresentanteResponse).representante;
  const emailUser = repData.correoElectronico;

  // 5. Get Votantes
  VotingAPI.getVotantes(repData.id, Number(electionId), sessionToken);

  // 6. Get Papeletas
  const papRes = VotingAPI.getPapeletas(electionId, sessionToken);
  if (papRes.status !== 200) {
    console.error(`❌ ${logPrefix} | PAPELETAS_FAILED | Status: ${papRes.status}`);
    return;
  }
  
  const responseBody = papRes.json() as any; 
  const papeletasList = responseBody.papeletas as PapeletaActiva[];

  if (!papeletasList || papeletasList.length === 0) {
    console.error(`❌ ${logPrefix} | NO_PAPELETAS`);
    return;
  }

  const targetPapeleta = papeletasList[0];
  const targetPunto = targetPapeleta.puntosVotacion[0];
  const targetOpcion = targetPunto.opcionesVotacion[0];

  console.log(`✅ ${logPrefix} | SELECTED | Pap:${targetPapeleta.id} / Punto:${targetPunto.id} / Opc:${targetOpcion.id}`);

  // 7. Save Log
  VotingAPI.guardarBitacora(Number(electionId), sessionToken);

  sleep(0.5);

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

  VotingAPI.emitVote(votePayload, sessionToken);
    
  // 9. Get Certificate
  VotingAPI.obtenerCertificado(Number(electionId), rut, emailUser, sessionToken);

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`── ${logPrefix} | END | Duration: ${duration}s ──`);
}

