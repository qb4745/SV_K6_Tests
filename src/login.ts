import http from 'k6/http';
import { check, sleep } from 'k6';
import { Options } from 'k6/options';

// --- Interfaces ---

export interface LoginPayload {
  nombreUsuario: string;
  contrasenia: string;
}

export interface Permission {
  id: string;
  nombre: string;
  esActivo: boolean;
}

export interface Role {
  id: string;
  nombre: string;
  esActivo: boolean;
  permisos: Permission[];
}

export interface UserProfile {
  id: number;
  nombreUsuario: string;
  nombres: string;
  apellidos: string;
  correoElectronico: string;
  telefono: string;
  esActivo: boolean;
  usuario: number;
}

export interface User {
  id: number;
  nombreUsuario: string;
  perfil: UserProfile;
  esActivo: boolean;
  rol: Role;
}

export interface LoginResponse {
  usuario: User;
  accessToken: string;
}

// --- Configuration ---

export const options: Options = {
  thresholds: {
    // DT Standard: 95% of requests must complete within 2s
    http_req_duration: ['p(95)<2000'],
    // Error rate must be less than 1%
    http_req_failed: ['rate<0.01'],
  },
};

// --- Main Logic ---

export default function () {
  const url = 'https://dev-app.smartvoting.cl/api/auth/iniciar_sesion';
  
  const payload: LoginPayload = {
    nombreUsuario: 'tester',
    contrasenia: 'Costanuss4115#$',
  };

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'k6-load-test/1.0',
      'Origin': 'https://qa-app.smartvoting.cl',
    },
  };

  const res = http.post(url, JSON.stringify(payload), params);

  // --- Validations ---
  
  check(res, {
    'status is 201 or 200': (r) => r.status === 200 || r.status === 201, // API might return 201 for creation or 200 for OK
    'has access token': (r) => {
        try {
            const json = r.json() as unknown as LoginResponse;
            return json.accessToken !== undefined && json.accessToken.length > 0;
        } catch (e) {
            return false;
        }
    },
  });

  if (res.status !== 200 && res.status !== 201) {
    console.error(`Login failed: ${res.status} ${res.body}`);
  }

  sleep(1);
}
