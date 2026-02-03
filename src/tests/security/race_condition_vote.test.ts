import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import { Options } from 'k6/options';
import exec from 'k6/execution';

import { CONFIG } from '../../config/index.js';
import { AuthAPI } from '../../api/auth.js';
import { VotingAPI } from '../../api/voting.js';
import { cleanRut, extractTokenFromLink, extractElectionId, extractSlug, formatRut } from '../../utils/helpers.js';
import { User, PapeletaActiva } from '../../types/smartvoting.js';

const users = new SharedArray('users', () => JSON.parse(open('../../../data/users.json')));

export const options: Options = {
  scenarios: {
    race_condition_attack: {
      executor: 'shared-iterations',
      // Lanzamos 10 hilos concurrentes
      vus: Math.min(10, users.length), 
      // Realizamos 10 ataques (uno por cada RUT del JSON)
      iterations: Math.min(10, users.length), 
      maxDuration: '5m',
    },
  },
  thresholds: {
    'checks': ['rate==1.0'], 
  },
};

export default function () {
  const idx = exec.scenario.iterationInTest;
  if (idx >= users.length) return;
  const user = users[idx] as User;
  
  // --- FASE 1: PREPARACIÓN ---
  const magicToken = extractTokenFromLink(user.link);
  const rutLimpio = cleanRut(user.rut);     // Para el Payload (123456789)
  const rutFormateado = formatRut(rutLimpio); // Para los Logs (12.345.678-9)
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

  // 2. Obtener Datos (Metadata)
  VotingAPI.getVotationMeta(slug, sessionToken);
  
  // 3. Obtener Papeletas (Con estructura corregida)
  const papRes = VotingAPI.getPapeletas(electionId, sessionToken);
  
  // Parseo seguro de la estructura { papeletas: [...] }
  let papeletas: PapeletaActiva[] = [];
  try {
      const body = papRes.json() as any;
      papeletas = body.papeletas || [];
  } catch (e) {
      console.error(`❌ ${rutFormateado}: Error parseando papeletas`);
      return;
  }
  
  if (papeletas.length === 0) {
      console.log(`⚠️ ${rutFormateado}: Sin papeletas (¿Ya votó?)`);
      return;
  }

  // Selección dinámica de opciones
  const targetPapeleta = papeletas[0];
  const targetPunto = targetPapeleta.puntosVotacion[0];
  
  // FIX: Usamos 'opcionesVotacion' como descubrimos en el load test
  const opciones = targetPunto.opcionesVotacion || (targetPunto as any).opciones;
  
  if (!opciones || opciones.length === 0) {
      console.error(`❌ ${rutFormateado}: Punto sin opciones`);
      return;
  }
  
  const targetOpcion = opciones[0];

  // 4. Construcción del Payload (CORREGIDO)
  const votePayload = JSON.stringify({
    papeletaId: targetPapeleta.id,
    dniVotante: rutLimpio, // <--- IMPORTANTE: RUT LIMPIO
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
    'User-Agent': CONFIG.USER_AGENT,
    'Authorization': `Bearer ${sessionToken}`,
  };

  // --- FASE 2: EL ATAQUE (Paralelo) ---
  
  const requestConfig = {
    method: 'POST',
    url: `${CONFIG.BASE_URL}/depositar-voto`,
    body: votePayload,
    params: { headers: headers, tags: { name: 'Race_Attack' } },
  };

  // Disparo simultáneo de 3 hilos
  const responses = http.batch([requestConfig, requestConfig, requestConfig]);

  // --- FASE 3: REPORTE FORENSE ---
  let successCount = 0; // 200 OK
  let errorCount = 0;   // 500 Error
  let otherCount = 0;   // 403, 400, etc
  let statusCodes: number[] = [];
  let errorBody = "";

  responses.forEach((res) => {
    statusCodes.push(res.status);
    if (res.status === 200 || res.status === 201) {
      successCount++;
    } else if (res.status === 500 || res.status === 409) {
      errorCount++;
      if (!errorBody) errorBody = String(res.body); // Guardamos un error para ver qué dice
    } else {
      otherCount++;
    }
  });

  // LOGICA DE REPORTE
  if (successCount === 1) {
      console.log(`✅ ${rutFormateado}: INTEGRIDAD CORRECTA. (1 aceptado, ${errorCount} rechazados)`);
  } else if (successCount > 1) {
      console.error(`🚨 ${rutFormateado}: CRÍTICO - RACE CONDITION. (${successCount} votos aceptados)`);
  } else {
      // Si todos fallaron, mostramos por qué
      console.warn(`⚠️ ${rutFormateado}: 0 Votos. Todos fallaron. Status: [${statusCodes}]`);
      if (errorBody) console.log(`   ↳ Razón del error: ${errorBody}`);
  }

  check(successCount, {
    'Integridad Voto (Max 1)': (count) => count === 1,
  });
}