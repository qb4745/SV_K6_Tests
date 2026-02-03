import http from 'k6/http';
import { check } from 'k6';
import { CONFIG } from '../config/index.js';
import { LoginResponse } from '../types/smartvoting.js';

/**
 * Helper interno para los headers de autenticación inicial.
 * Incluye el tag '01_Login' para que Grafana pueda identificar esta fase.
 */
const getLoginParams = () => ({
  headers: {
    'Content-Type': 'application/json',
    'Origin': CONFIG.ORIGIN,
    'x-proveedor': CONFIG.PROVIDER_ID,
    'User-Agent': CONFIG.USER_AGENT,
  },
  tags: { name: '01_Login' }, // <--- Crucial para el gráfico de Latencia
});

export class AuthAPI {
  /**
   * Realiza el intercambio de Token (Magic Link) por un RefreshToken de sesión.
   */
  static login(username: string, magicToken: string): string | null {
    const url = `${CONFIG.BASE_URL}/iniciar-sesion`;
    
    const payload = JSON.stringify({
      nombreUsuario: username,
      mecanismoIdentificacion: 2,
      contrasenia: magicToken
    });

    const res = http.post(url, payload, getLoginParams());

    const isOk = check(res, { 
      'Login OK': (r) => r.status === 200,
      'Has RefreshToken': (r) => r.json('refreshToken') !== undefined 
    });

    if (!isOk) {
        console.error(`❌ Login Failed for ${username}: ${res.status} ${res.body}`);
        return null;
    }
    
    // Retornamos el token necesario para el resto del flujo
    return (res.json() as unknown as LoginResponse).refreshToken;
  }
}