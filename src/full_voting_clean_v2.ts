import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Options } from 'k6/options';
import exec from 'k6/execution';

// --- CONFIGURACIÓN BASE ---
const BASE_URL = 'https://qhbge6tp76.execute-api.us-east-1.amazonaws.com/qa/votantes';
const ORIGIN = 'https://qa-app.smartvoting.cl';

// --- INTERFACES CORREGIDAS (MATCH EXACTO CON TU JSON) ---
interface User {
  rut: string;
  link: string;
}

interface LoginResponse {
  refreshToken: string;
}

interface RepresentanteResponse {
  representante: {
    id: number;
    correoElectronico: string;
  }
}

// Estructura Root de la respuesta de papeletas
interface PapeletasResponse {
  papeletas: Array<PapeletaActiva>;
}

interface PapeletaActiva {
  id: number;
  titulo: string;
  puntosVotacion: Array<{
    id: number;
    titulo: string;
    opcionesVotacion: Array<{ // CORREGIDO: Antes era 'opciones'
      id: number;
      titulo: string;
    }>;
  }>;
}

// --- CARGA DE DATOS ---
const users = new SharedArray('users', function () {
  return JSON.parse(open('../data/users.json')) as User[];
});

export const options: Options = {
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
function cleanRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, '');
}

function extractTokenFromLink(url: string): string | null {
  const match = url.match(/[?&]token=([^&]+)/);
  return match ? match[1] : null;
}

function extractSlug(url: string): string | null {
  const match = url.match(/\/votacion\/([^?]+)/);
  return match ? match[1] : null;
}

function extractElectionId(url: string): string | null {
  const match = url.match(/\/votacion\/(\d+)-/);
  return match ? match[1] : null;
}

function formatRut(rut: string): string {
  const cleaned = cleanRut(rut);
  if (cleaned.length < 2) return cleaned;
  const dv = cleaned.slice(-1);
  const body = cleaned.slice(0, -1);
  return body.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.') + '-' + dv;
}

// --- FLUJO PRINCIPAL ---
export default function () {
  const idx = exec.scenario.iterationInTest;
  if (idx >= users.length) return;
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
  const loginRes = http.post(`${BASE_URL}/iniciar-sesion`, JSON.stringify({
    nombreUsuario: compositeUsername,
    mecanismoIdentificacion: 2,
    contrasenia: magicToken
  }), { headers });

  if (!check(loginRes, { 'Login OK': (r) => r.status === 200 })) {
    console.error(`❌ Fallo Login ${formatRut(cleanedRut)}: ${loginRes.body}`);
    return;
  }

  const sessionToken = (loginRes.json() as unknown as LoginResponse).refreshToken;
  const authHeaders = { ...headers, 'Authorization': `Bearer ${sessionToken}` };

  // 2. OBTENER VOTACIÓN
  http.get(`${BASE_URL}/obtener-votacion/${votingSlug}`, { headers: authHeaders });

  // 3. OBTENER REPRESENTANTE
  const repRes = http.post(`${BASE_URL}/obtener-representante`, JSON.stringify({
    dni: cleanedRut,
    votacionId: Number(electionId)
  }), { headers: authHeaders });

  if (!check(repRes, { 'Rep OK': (r) => r.status === 200 })) return;

  const repData = (repRes.json() as unknown as RepresentanteResponse).representante;
  const representanteId = repData.id;
  const emailUser = repData.correoElectronico;

  // 4. OBTENER VOTANTES
  http.post(`${BASE_URL}/obtener-votantes`, JSON.stringify({
    representanteId: representanteId,
    votacionId: Number(electionId)
  }), { headers: authHeaders });

  // ===========================================================================
  // PASO 5: OBTENER PAPELETAS (ESTRUCTURA CORREGIDA)
  // ===========================================================================
  const papeletasRes = http.get(`${BASE_URL}/obtener-papeletas-activas/${electionId}?etiquetasIds=*`, { headers: authHeaders });
  
  if (!check(papeletasRes, { 'Papeletas Status 200': (r) => r.status === 200 })) return;

  // CORRECCIÓN: Parseamos la respuesta completa primero
  const responseBody = papeletasRes.json() as unknown as PapeletasResponse;
  
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
  http.post(`${BASE_URL}/guardar-bitacora`, JSON.stringify({
    nivel: "INFO",
    modulo: "VOTANTE",
    tipoEvento: "AUTOSELECCION_PAPELETA_UNICA",
    votacionId: Number(electionId)
  }), { headers: authHeaders });

  sleep(0.5);

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

  const voteRes = http.post(`${BASE_URL}/depositar-voto`, votePayload, { headers: authHeaders });

  if (!check(voteRes, { 'Voto OK': (r) => r.status === 200 })) {
    console.error(`❌ Fallo Voto ${formatRut(cleanedRut)}: ${voteRes.body}`);
    return;
  }

  // 8. CERTIFICADO
  http.post(`${BASE_URL}/obtener-certificado-votante`, JSON.stringify({
    votacionId: Number(electionId),
    dniRepresentante: cleanedRut,
    correoElectronico: emailUser
  }), { headers: authHeaders });

  console.log(`🎉 Voto completado para ${formatRut(cleanedRut)}`);
}