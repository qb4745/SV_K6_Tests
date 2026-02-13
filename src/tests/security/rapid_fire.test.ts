import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import execution from 'k6/execution';
import { Options } from 'k6/options';

// --------------------------------------------------------------------------
// IMPORTS DE ARQUITECTURA (Ajustados a tu estructura POM)
// --------------------------------------------------------------------------
import { CONFIG } from '../../config/index.js';
import { AuthAPI } from '../../api/auth.js';
import { VotingAPI } from '../../api/voting.js';
import { 
  cleanRut, 
  formatRut, 
  extractTokenFromLink, 
  extractElectionId, 
  extractSlug 
} from '../../utils/helpers.js';
import { User, PapeletaActiva } from '../../types/smartvoting.js';

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
const users = new SharedArray('users', () => JSON.parse(open('../../../data/users.json')));

export const options: Options = {
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

export default function () {
  const idx = execution.scenario.iterationInTest;
  if (idx >= users.length) return;
  
  const user = users[idx] as User;

  // ========================================================================
  // FASE 1: PREPARACIÓN Y HANDSHAKE
  // ========================================================================
  const magicToken = extractTokenFromLink(user.link);
  const rutLimpio = cleanRut(user.rut);
  const rutFormateado = formatRut(rutLimpio);
  const electionId = extractElectionId(user.link);
  const slug = extractSlug(user.link);

  if (!magicToken || !electionId || !slug) {
    console.log(`⏩ ${rutFormateado}: Skipped (Link mal formado)`);
    return;
  }

  // 1. Iniciar Sesión (Handshake)
  const sessionToken = AuthAPI.login(`${electionId}-${rutLimpio}`, magicToken);
  if (!sessionToken) {
    console.log(`❌ ${rutFormateado}: Login Fallido (¿Token quemado?)`);
    return;
  }

  // 2. Obtener Metadata (Papeletas y Opciones)
  // Nota: Llamamos a votationMeta primero para "calentar" cookies/sesión si fuera necesario
  VotingAPI.getVotationMeta(slug, sessionToken);
  
  const papRes = VotingAPI.getPapeletas(electionId, sessionToken);

  let papeletas: PapeletaActiva[] = [];
  try {
    const body = papRes.json() as any;
    papeletas = body.papeletas || [];
  } catch (e) {
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
    'Origin': CONFIG.ORIGIN,
    'x-proveedor': CONFIG.PROVIDER_ID,
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
  const url = `${CONFIG.BASE_URL}/depositar-voto`;

  console.log(`🔥 ${rutFormateado}: Iniciando Ráfaga. Intervalo: ${INPUT_MS}ms (${DELAY_SECONDS}s)...`);

  for (let i = 0; i < attempts; i++) {
    const res = http.post(url, votePayload, params);
    
    // Contamos éxitos (200 OK o 201 Created)
    if (res.status === 200 || res.status === 201) {
      successCount++;
    } else {
      rejectedCount++;
    }

    // Espera dinámica controlada por CLI
    sleep(DELAY_SECONDS); 
  }

  // ========================================================================
  // FASE 3: ANÁLISIS FORENSE
  // ========================================================================
  
  if (successCount === 1) {
    console.log(`✅ ${rutFormateado}: CORRECTO. 1 voto aceptado, ${rejectedCount} bloqueados.`);
  } else if (successCount > 1) {
    console.error(`🚨 ${rutFormateado}: FALLO CRÍTICO. Se aceptaron ${successCount} votos consecutivos (Intervalo: ${INPUT_MS}ms).`);
  } else {
    console.warn(`⚠️ ${rutFormateado}: 0 votos aceptados (Probablemente error de lógica o datos).`);
  }

  // Validación final para k6
  check(successCount, {
    [`Unico Voto Permitido (${INPUT_MS}ms)`]: (count) => count === 1,
  });
}