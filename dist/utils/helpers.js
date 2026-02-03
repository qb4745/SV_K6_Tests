"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanRut = cleanRut;
exports.extractTokenFromLink = extractTokenFromLink;
exports.extractElectionId = extractElectionId;
exports.extractSlug = extractSlug;
exports.formatRut = formatRut;
function cleanRut(rut) {
    return rut.replace(/[^0-9kK]/g, '');
}
function extractTokenFromLink(url) {
    const match = url.match(/[?&]token=([^&]+)/);
    return match ? match[1] : null;
}
function extractElectionId(url) {
    const match = url.match(/\/votacion\/(\d+)-/);
    return match ? match[1] : null;
}
function extractSlug(url) {
    const match = url.match(/\/votacion\/([^?]+)/);
    return match ? match[1] : null;
}
function formatRut(rut) {
    const cleaned = cleanRut(rut);
    if (cleaned.length < 2)
        return cleaned;
    const dv = cleaned.slice(-1);
    const body = cleaned.slice(0, -1);
    return body.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.') + '-' + dv;
}
