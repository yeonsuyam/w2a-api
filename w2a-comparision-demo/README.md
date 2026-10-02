# Wake2Adapt comparison demo

Interactive comparison of three ASR conditions for the target entity **가로수길**:

1. zero-shot, without reference audio;
2. 1-shot adaptation with **Hello Android**;
3. 1-shot adaptation with **안녕 안드로이드**.

Each condition keeps its own target recording. The two adaptation panels require their
reference recording first. After a target recording, the page shows the ASR transcript,
IPA, target rank, and the phonetic entity-search Top 5.

## Run

Use Node.js 22.13 or newer.

    cp .env.example .env
    npm run dev -- --port 8003

Then open http://localhost:8003. With HTTPS certificate paths enabled in .env, open
https://localhost:8003 instead.

W2A_API_URL must point to the running w2a-api service. The browser posts recordings
to the same-origin /api/stt route, which proxies to the configured /transcribe endpoint.

    W2A_API_URL=http://127.0.0.1:8000
    W2A_DOMAIN=roads
    W2A_TOP_K=5

Microphone recording works on localhost or HTTPS. Hold a recording button while
speaking and release it to submit.

## Checks

    npm run check
