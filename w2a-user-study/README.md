# Wake2Adapt comparison demo

Interactive comparison of three ASR conditions for a target word drawn from the selected entity set:

1. zero-shot, without reference audio;
2. 1-shot adaptation with **Android**;
3. 1-shot adaptation with **안드로이드**.

The target word is recorded once and the same audio is used by all three conditions.
Each analysis runs in two stages, shown separately: ASR (`/api/stt`, ASR only) and then
entity search on the transcript (`/api/retrieve`). The Stop button (or Backspace) empties the
queue and stops the running analysis; the server stops generating via `POST /cancel`.
Analyses go through one queue (one at a time on the GPU) and are queued as soon as their
recordings exist: finishing the target queues 01 plus 02/03 for each reference already
recorded; finishing a reference queues only its condition, if the current word is recorded.
Re-recording the target drops queued/in-flight results of the old recording; re-recording
a reference drops only that condition's. Each word keeps its recording and results: moving
to another word and back restores them (an analysis still running finishes in the
background; anything missing, or computed with a since re-recorded reference, is re-run). Recording stays available while
analyses run. Each reference word is recorded once at the top of its
lane and reused for every target word; recording a reference after the target fills in
that lane. The target card sits between the references and the results, crossing all three
lanes. Results are aligned row by row: ASR output (romanized, with the Hangul below and
characters that differ from the target highlighted), target rank with the change versus
zero-shot, the entity-search Top 5, and a session score (Top-1 / Top-5 hits per condition).

## Run

Use Node.js 22.13 or newer.

    cp .env.example .env
    npm run dev:http:8003

Then open http://localhost:8003. This command is for same-machine development only.

W2A_API_URL must point to the running w2a-api service. The browser posts recordings
to the same-origin /api/stt route, which proxies to the configured /transcribe endpoint.
The entity-set menu sends `roads`, `content`, `restaurants`, or `stations` with each
recording; `W2A_DOMAIN` remains the server-side fallback for older clients.

    W2A_API_URL=http://127.0.0.1:8000
    W2A_DOMAIN=roads
    W2A_TOP_K=5

### Target words

Each entity set draws a random target word from
`L2-KPNS/metadata/recording_targets/{domain}_200.csv` (columns `korean`, optional
`entity_id`/`id` and `romanized`). Press ← / → (or the arrow buttons beside the target
word) to go to the previous / next word; past either end a new random word is drawn.
Changing the word clears the target recordings but keeps the reference recordings.

The CSVs are read at dev/build time from `/home/user/L2-KPNS`; set `L2_KPNS_DIR` to use
another location.

    L2_KPNS_DIR=/path/to/L2-KPNS

The ASR result shows the transcript romanized (Revised Romanization, or the official
`romanized` value when the transcript is a known entity), with the Hangul below it.

Microphone recording works on localhost or HTTPS. Hold a recording button while
speaking and release it to submit.

## Public server: 143.248.56.128:8003

The public server must have Node.js 22.13 or newer, Python 3, and the Python
`venv` module. The setup command uses Certbot 5.4 or newer when it is already
installed, or installs a current compatible version into `/opt/certbot`.
Inbound TCP ports 80 and 8003 must be open. Port 80 is used by Let's Encrypt to
validate control of the IP address, and port 8003 serves the demo.

After cloning or pulling the repository on the server, run:

    npm ci
    npm run setup:https:8003
    npm run dev:8003

The setup accepts the Let's Encrypt subscriber agreement non-interactively so
it cannot stall at the `(Y)es/(N)o` prompt. By default it registers without an
email address. To associate an email address with the ACME account, use:

    CERTBOT_EMAIL=you@example.com npm run setup:https:8003

If the server reports that the Python `venv` module is missing on Ubuntu or
Debian, install it once and retry:

    sudo apt update
    sudo apt install -y python3-venv
    npm run setup:https:8003

If an automatic renewal process is already using Certbot, the setup command
waits and retries for up to one minute. If the lock remains, inspect the active
process, wait for it to finish, and retry; do not delete lock files while a
Certbot process is active:

    ps -ef | grep '[c]ertbot'
    npm run setup:https:8003

The one-time HTTPS setup requests a publicly trusted Let's Encrypt certificate
for `143.248.56.128`, copies it into the ignored `.certs` directory, and creates
the ignored `.env` file with the certificate paths. `npm run dev:8003` builds the
app and starts an explicit HTTPS listener on `0.0.0.0:8003`; it does not fall
back to HTTP. Then open:

    https://143.248.56.128:8003

At startup, the HTTPS command checks `.certs/cert.pem` and `.certs/key.pem`. If
they are missing but Certbot has already issued the certificate, it copies the
files from `/etc/letsencrypt/live/143.248.56.128/` automatically. If no issued
certificate exists, it stops with instructions instead of starting over HTTP.

Let's Encrypt IP certificates are short-lived. Run `npm run setup:https:8003`
again when Certbot renews the certificate, and restart the npm process so the
server loads the new certificate.

For a different public IP, use:

    npm run setup:https -- <public-IP>

## Checks

    npm run check
