export interface User {
  rut: string;
  link: string;
}

export interface LoginResponse {
  refreshToken: string;
}

export interface PapeletaActiva {
  id: number;
  titulo: string;
  puntosVotacion: Array<{
    id: number;
    titulo: string;
    opcionesVotacion: Array<{
      id: number;
      titulo: string;
    }>;
  }>;
}

export interface RepresentanteResponse {
  representante: {
    id: number;
    correoElectronico: string;
  }
}
