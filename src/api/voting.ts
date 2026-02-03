import http from 'k6/http';
import { check } from 'k6';
import { CONFIG } from '../config/index.js';

/**
 * Helper para generar los parámetros de la petición incluyendo 
 * cabeceras de seguridad y etiquetas para Grafana.
 */
const getParams = (token: string, tagName: string) => ({
  headers: {
    'Content-Type': 'application/json',
    'Origin': CONFIG.ORIGIN,
    'x-proveedor': CONFIG.PROVIDER_ID,
    'User-Agent': CONFIG.USER_AGENT,
    'Authorization': `Bearer ${token}`,
  },
  tags: { name: tagName }, // <--- ESTO ES LO QUE HACE QUE GRAFANA FUNCIONE
});

export class VotingAPI {
  
  static getVotationMeta(slug: string, token: string) {
    return http.get(
      `${CONFIG.BASE_URL}/obtener-votacion/${slug}`, 
      getParams(token, '02_Get_Votation_Meta')
    );
  }

  static getRepresentante(dni: string, electionId: number, token: string) {
    const res = http.post(
      `${CONFIG.BASE_URL}/obtener-representante`, 
      JSON.stringify({ dni, votacionId: electionId }), 
      getParams(token, '03_Get_Representante')
    );
    
    check(res, { 'Get Representante 200': (r) => r.status === 200 });
    return res;
  }
  
  static getVotantes(representanteId: number, electionId: number, token: string) {
    return http.post(
      `${CONFIG.BASE_URL}/obtener-votantes`, 
      JSON.stringify({ representanteId, votacionId: electionId }), 
      getParams(token, '04_Get_Votantes')
    );
  }

  static getPapeletas(electionId: string, token: string) {
    const res = http.get(
      `${CONFIG.BASE_URL}/obtener-papeletas-activas/${electionId}?etiquetasIds=*`, 
      getParams(token, '05_Get_Papeletas')
    );
    check(res, { 'Get Papeletas 200': (r) => r.status === 200 });
    return res;
  }

  static guardarBitacora(electionId: number, token: string) {
    return http.post(
      `${CONFIG.BASE_URL}/guardar-bitacora`, 
      JSON.stringify({
        nivel: "INFO",
        modulo: "VOTANTE",
        tipoEvento: "AUTOSELECCION_PAPELETA_UNICA",
        votacionId: electionId
      }), 
      getParams(token, '06_Guardar_Bitacora')
    );
  }

  static emitVote(payload: any, token: string) {
    const res = http.post(
      `${CONFIG.BASE_URL}/depositar-voto`, 
      JSON.stringify(payload), 
      getParams(token, '07_Depositar_Voto')
    );

    const checkRes = check(res, { 'Voto Depositado 200': (r) => r.status === 200 });
    
    if (!checkRes) {
        const rut = payload.dniVotante || 'Desconocido';
        console.error(`❌ Vote Failed for ${rut}: ${res.status} Body: ${res.body}`);
    }
    
    return res;
  }

  static obtenerCertificado(electionId: number, dni: string, email: string, token: string) {
    return http.post(
      `${CONFIG.BASE_URL}/obtener-certificado-votante`, 
      JSON.stringify({
        votacionId: electionId,
        dniRepresentante: dni,
        correoElectronico: email
      }), 
      getParams(token, '08_Obtener_Certificado')
    );
  }
}