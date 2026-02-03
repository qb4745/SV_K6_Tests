import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Options } from 'k6/options';
import exec from 'k6/execution';

// --- CONSTANTES ---
const CONFIG = {
  VOTACION_ID: 255, // Actualizado según tu flujo
  PAPELETA_ID: 395,
  PUNTO_VOTACION_ID: 448,
  OPCION_ID: 1242,
  BASE_URL: 'https://qhbge6tp76.execute-api.us-east-1.amazonaws.com/qa/votantes',
  ORIGIN: 'https://qa-app.smartvoting.cl'
};

interface User {
  rut: string;
  nombre: string;
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

const users = new SharedArray('users', function () {
  return JSON.parse(open('../data/users.json')) as User[];
});

export const options: Options = {
  scenarios: {
    clean_flow: {
      executor: 'shared-iterations',
      vus: Math.min(20, users.length),
      iterations: users.length,
      maxDuration: '30m',
    },
  },
};

// --- Helpers ---
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

export default function () {
  const idx = exec.scenario.iterationInTest;
  if (idx >= users.length) return;
  const user = users[idx];
  
  const magicToken = extractTokenFromLink(user.link); // TOKEN A (Del correo)
  const cleanedRut = cleanRut(user.rut);
  const votingSlug = extractSlug(user.link); // "255-test-10-vu"

  if (!magicToken || !votingSlug) return;

  const compositeUsername = `${CONFIG.VOTACION_ID}-${cleanedRut}`;
  
  console.log(`[${idx+1}] Procesando: ${cleanedRut}`);

  // Headers Públicos (SIN Authorization)
  const publicHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'Origin': CONFIG.ORIGIN,
    'x-proveedor': '2',
    'User-Agent': 'k6-clean-agent',
  };

  // ===========================================================================
  // PASO 1: OBTENER VOTACIÓN (Metadata Pública)
  // ===========================================================================
  // Probamos sin Auth. Si falla 401, significa que la votación es privada y requiere un "Guest Token" previo.
  // Pero según tu flujo, esto debería ser público.
  const metaRes = http.get(`${CONFIG.BASE_URL}/obtener-votacion/${votingSlug}`, { headers: publicHeaders });
  
  // ===========================================================================
  // PASO 2: LOGIN (El Intercambio Real)
  // ===========================================================================
  // Aquí usamos el TOKEN A (Magic Link) como contraseña.
  // NO enviamos ningún Bearer en el header.
  const loginRes = http.post(`${CONFIG.BASE_URL}/iniciar-sesion`, JSON.stringify({
    nombreUsuario: compositeUsername,
    contrasenia: magicToken,
    mecanismoIdentificacion: 2
  }), { headers: publicHeaders });

  if (!check(loginRes, { 'Login OK': (r) => r.status === 200 })) {
    console.error(`❌ Login falló: ${loginRes.body}`);
    return;
  }

  // AQUÍ NACE EL TOKEN DE SESIÓN (Bearer)
  const sessionToken = (loginRes.json() as unknown as LoginResponse).refreshToken;
  
  // Headers Autenticados (CON Authorization)
  const authHeaders = {
    ...publicHeaders,
    'Authorization': `Bearer ${sessionToken}`,
  };

  // ===========================================================================
  // PASO 3: OBTENER REPRESENTANTE (Datos de Usuario)
  // ===========================================================================
  const repRes = http.post(`${CONFIG.BASE_URL}/obtener-representante`, JSON.stringify({
    dni: cleanedRut,
    votacionId: CONFIG.VOTACION_ID
  }), { headers: authHeaders });

  if (!check(repRes, { 'Rep OK': (r) => r.status === 200 })) return;
  
  const repData = (repRes.json() as unknown as RepresentanteResponse).representante;
  const representanteId = repData.id;
  const emailUser = repData.correoElectronico; // Capturamos email dinámico

  // ===========================================================================
  // PASO 4: OBTENER VOTANTES
  // ===========================================================================
  http.post(`${CONFIG.BASE_URL}/obtener-votantes`, JSON.stringify({
    representanteId: representanteId,
    votacionId: CONFIG.VOTACION_ID
  }), { headers: authHeaders });

  // ===========================================================================
  // PASO 5: BITÁCORA
  // ===========================================================================
  http.post(`${CONFIG.BASE_URL}/guardar-bitacora`, JSON.stringify({
    nivel: "INFO",
    votacionId: CONFIG.VOTACION_ID,
    modulo: "VOTANTE",
    tipoEvento: "AUTOSELECCION_PAPELETA_UNICA"
  }), { headers: authHeaders });

  sleep(1);

  // ===========================================================================
  // PASO 6: VOTAR
  // ===========================================================================
  const voteRes = http.post(`${CONFIG.BASE_URL}/depositar-voto`, JSON.stringify({
    papeletaId: CONFIG.PAPELETA_ID,
    dniVotante: cleanedRut,
    voto: {
      votacionId: CONFIG.VOTACION_ID,
      papeletaId: CONFIG.PAPELETA_ID,
      pesoVoto: 1,
      distribucionMaxima: 0,
      puntosVotacion: [
        {
          puntoVotacionId: CONFIG.PUNTO_VOTACION_ID,
          tipo: 'seleccion',
          opciones: { preferencias: [CONFIG.OPCION_ID], votoBlanco: false, votoNulo: false }
        }
      ]
    }
  }), { headers: authHeaders });

  if (!check(voteRes, { 'Voto OK': (r) => r.status === 200 })) {
    console.error(`❌ Voto falló: ${voteRes.body}`);
    return;
  }

  // ===========================================================================
  // PASO 7: CERTIFICADO
  // ===========================================================================
  http.post(`${CONFIG.BASE_URL}/obtener-certificado-votante`, JSON.stringify({
    votacionId: CONFIG.VOTACION_ID,
    dniRepresentante: cleanedRut,
    correoElectronico: emailUser // Email dinámico
  }), { headers: authHeaders });

  console.log(`✅ Flujo 100% completado para ${cleanedRut}`);
}