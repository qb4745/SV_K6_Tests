export const CONFIG = {
  BASE_URL: 'https://qhbge6tp76.execute-api.us-east-1.amazonaws.com/qa/votantes',
  ORIGIN: 'https://qa-app.smartvoting.cl',
  PROVIDER_ID: '2',
  USER_AGENT: 'k6-load-test-agent/1.0',
};

export const THRESHOLDS = {
  STRICT: {
    'http_req_failed': ['rate==0.00'],
    'http_req_duration': ['p(95)<5000'],
  },
};
