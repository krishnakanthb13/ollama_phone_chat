'use strict';

require('dotenv').config();

const path = require('path');

function toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toUrl(value, fallback) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return (trimmed || fallback).replace(/\/+$/, '');
}

const config = {
    port: toInt(process.env.PORT, 3000),
    host: process.env.HOST || '0.0.0.0',
    mode: (process.env.MODE || 'auto').toLowerCase(),
    appPassword: process.env.APP_PASSWORD || '',
    cloudApiKey: process.env.OLLAMA_API_KEY || '',
    localOllamaUrl: toUrl(process.env.OLLAMA_HOST, 'http://127.0.0.1:11434'),
    cloudOllamaUrl: toUrl(process.env.OLLAMA_CLOUD_URL, 'https://ollama.com/api'),
    requestTimeoutMs: toInt(process.env.REQUEST_TIMEOUT_MS, 120000),
    detectTimeoutMs: toInt(process.env.DETECT_TIMEOUT_MS, 3000),
    healthIntervalMs: toInt(process.env.OLLAMA_HEALTH_INTERVAL_MS, 30000),
    maxBodySize: process.env.MAX_BODY_SIZE || '2mb',
    modelsCacheFile: process.env.MODELS_CACHE || path.join(__dirname, 'models_cache.json'),
    loginMaxAttempts: toInt(process.env.LOGIN_MAX_ATTEMPTS, 5),
    loginWindowMs: toInt(process.env.LOGIN_WINDOW_MS, 60000),
    trustProxy: process.env.TRUST_PROXY === '1',
};

module.exports = config;
