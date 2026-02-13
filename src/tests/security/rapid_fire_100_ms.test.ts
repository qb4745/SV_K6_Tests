import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import execution from 'k6/execution';
import { Options } from 'k6/options';

// Imports de arquitectura (Asumiendo tu estructura POM)
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

// Carga de datos
const users = new SharedArray('users', () => JSON.parse(open('../../../data/users.json')));

export const options: Options = {
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

export default function () {
  const idx = execution.scenario.iterationInTest;
  if (idx >= users.length) return;
  
  const user = users[idx] as User;

  // --- FASE 1: PREPARACIÓN (Idéntica al script anterior) ---
  const magicToken = extractTokenFromLink(user.link);
  const rutLimpio = cleanRut(user.rut);
  const rutFormateado = formatRut(rutLimpio);
  const electionId = extractElectionId(user.link);
  const slug = extractSlug(user.link);

  if (!magicToken || !electionId || !slug) {
    console.log(`⏩ ${rutFormateado}: Skipped (Datos inválidos)`);
    return;
  }

  // 1. Login
  const sessionToken = AuthAPI.login(`${electionId}-${rutLimpio}`, magicToken);
  if (!sessionToken) {
    console.log(`❌ ${rutFormateado}: Falló Login`);
    return;
  }

  // 2. Obtener Metadata para construir el voto
  VotingAPI.getVotationMeta(slug, sessionToken); // Necesario para 'calentar' sesión
  const papRes = VotingAPI.getPapeletas(electionId, sessionToken);

  let papeletas: PapeletaActiva[] = [];
  try {
    const body = papRes.json() as any;
    papeletas = body.papeletas || [];
  } catch (e) {
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
      'Origin': CONFIG.ORIGIN,
      'x-proveedor': CONFIG.PROVIDER_ID,
      'Authorization': `Bearer ${sessionToken}`,
    },
    tags: { name: 'Rapid_Fire_Vote' },
  };

  // --- FASE 2: SECUENCIA RAPID FIRE (Intervalo 100ms) ---
  
  const attempts = 5; // Intentaremos votar 5 veces seguidas
  let successCount = 0;
  let rejectedCount = 0;
  const url = `${CONFIG.BASE_URL}/depositar-voto`;

  console.log(`🔥 ${rutFormateado}: Iniciando ráfaga secuencial (5 intentos, 100ms delay)...`);

  for (let i = 0; i < attempts; i++) {
    const res = http.post(url, votePayload, params);
    
    // Análisis inmediato
    if (res.status === 200 || res.status === 201) {
      successCount++;
    } else {
      rejectedCount++;
    }

    // Espera de 100ms antes del siguiente "clic"
    // sleep recibe segundos: 0.1s = 100ms
    sleep(0.1); 
  }

  // --- FASE 3: ANÁLISIS ---
  
  if (successCount === 1) {
    console.log(`✅ ${rutFormateado}: CORRECTO. Sistema aceptó 1 y rechazó ${rejectedCount}.`);
  } else if (successCount > 1) {
    console.error(`🚨 ${rutFormateado}: FALLO DE CONSISTENCIA. Se aceptaron ${successCount} votos consecutivos.`);
  } else {
    console.warn(`⚠️ ${rutFormateado}: Ningún voto fue aceptado.`);
  }

  // El check pasa si EXACTAMENTE 1 voto fue exitoso
  check(successCount, {
    'Unico Voto Permitido': (count) => count === 1,
  });
}