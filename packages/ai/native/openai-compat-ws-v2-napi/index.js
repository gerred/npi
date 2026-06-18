"use strict";

const candidates = ["./openai-compat-ws-v2-napi.node", "./dist/openai-compat-ws-v2-napi.node"];
let lastError;

for (const candidate of candidates) {
	try {
		module.exports = require(candidate);
		return;
	} catch (error) {
		lastError = error;
	}
}

const error = new Error("Could not load openai-compat-ws-v2-napi native binding");
error.cause = lastError;
throw error;
