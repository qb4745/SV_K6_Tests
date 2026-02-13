"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.THRESHOLDS = exports.CONFIG = void 0;
// 2. Diccionario de configuraciones por entorno
const ENV_SETTINGS = {
    QA: {
        BASE_URL: 'https://qhbge6tp76.execute-api.us-east-1.amazonaws.com/qa/votantes',
        ORIGIN: 'https://qa-app.smartvoting.cl',
        PROVIDER_ID: '2',
    },
    PROD: {
        // Datos extraídos de tu cURL de producción
        BASE_URL: 'https://wzwy9cwu93.execute-api.sa-east-1.amazonaws.com/prod/votantes',
        ORIGIN: 'https://app.smartvoting.cl', // Generalmente cambia a la URL comercial
        PROVIDER_ID: '1',
    }
};
// 3. Selección dinámica basada en variable de entorno
// Si no se pasa nada, por defecto usará QA por seguridad
const TARGET_ENV = __ENV.ENV || 'QA';
const selected = ENV_SETTINGS[TARGET_ENV];
exports.CONFIG = {
    BASE_URL: selected.BASE_URL,
    ORIGIN: selected.ORIGIN,
    PROVIDER_ID: selected.PROVIDER_ID,
    ENV_NAME: TARGET_ENV,
    USER_AGENT: 'k6-load-test-agent/1.0',
};
// Umbrales se mantienen constantes para ambos entornos
exports.THRESHOLDS = {
    STRICT: {
        'http_req_failed': ['rate==0.00'],
        'http_req_duration': ['p(95)<5000'],
    },
};
